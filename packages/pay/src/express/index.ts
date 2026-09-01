import type { PaidHandlerContext, PayRoute, PayServer } from "../server";

export function paymentMiddleware(
  server: PayServer,
  route: PayRoute,
  handler: (
    request: unknown,
    context: PaidHandlerContext,
  ) => Response | Promise<Response>,
) {
  const requests = new WeakMap<Request, unknown>();
  const protectedHandler = server.protect(route, (context) =>
    handler(requests.get(context.request), context),
  );
  return async (req: any, res: any, next: (error?: unknown) => void) => {
    let request: Request | undefined;
    try {
      request = new Request(
        `${req.protocol ?? "http"}://${req.get?.("host") ?? req.headers.host ?? "local"}${req.originalUrl ?? req.url}`,
        { method: req.method, headers: req.headers },
      );
      requests.set(request, req);
      const response = await protectedHandler(request);
      res.status(response.status);
      for (const [name, value] of response.headers) res.setHeader(name, value);
      if (response.body) {
        const reader = response.body.getReader();
        const lifecycle = responseLifecycle(res);
        try {
          while (true) {
            const event = await Promise.race([
              reader.read().then((result) => ({ type: "read" as const, result })),
              lifecycle.event,
            ]);
            if (event.type === "close") {
              await cancelReader(reader, "downstream response closed");
              return;
            }
            if (event.type === "error") throw event.error;
            const { done, value } = event.result;
            if (done) break;
            if (!res.write(value)) {
              const writable = await waitForWritable(res, lifecycle.event);
              if (writable.type === "close") {
                await cancelReader(reader, "downstream response closed");
                return;
              }
              if (writable.type === "error") throw writable.error;
            }
          }
        } catch (error) {
          await cancelReader(reader, "downstream response failed");
          throw error;
        } finally {
          lifecycle.cleanup();
          reader.releaseLock();
        }
      }
      res.end();
    } catch (error) {
      next(error);
    } finally {
      if (request) requests.delete(request);
    }
  };
}

type ResponseLifecycleEvent =
  | { type: "close" }
  | { type: "error"; error: unknown };

function responseLifecycle(res: any): {
  cleanup: () => void;
  event: Promise<ResponseLifecycleEvent>;
} {
  let accept!: (event: ResponseLifecycleEvent) => void;
  const event = new Promise<ResponseLifecycleEvent>((resolve) => { accept = resolve; });
  const onClose = () => accept({ type: "close" });
  const onError = (error: unknown) => accept({ type: "error", error });
  res.once("close", onClose);
  res.once("error", onError);
  if (res.destroyed || res.closed) onClose();
  return {
    event,
    cleanup() {
      res.removeListener("close", onClose);
      res.removeListener("error", onError);
    },
  };
}

async function waitForWritable(
  res: any,
  lifecycle: Promise<ResponseLifecycleEvent>,
): Promise<{ type: "drain" } | ResponseLifecycleEvent> {
  let onDrain!: () => void;
  const drain = new Promise<{ type: "drain" }>((resolve) => {
    onDrain = () => resolve({ type: "drain" });
    res.once("drain", onDrain);
  });
  try {
    return await Promise.race([drain, lifecycle]);
  } finally {
    res.removeListener("drain", onDrain);
  }
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: string,
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // Preserve the original downstream lifecycle result.
  }
}
