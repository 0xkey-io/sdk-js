import { once } from "node:events";
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
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!res.write(value)) await once(res, "drain");
          }
        } finally {
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
