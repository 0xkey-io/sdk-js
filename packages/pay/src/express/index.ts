import type { PaidHandlerContext, PayRoute, PayServer } from "../server";

export function paymentMiddleware(
  server: PayServer,
  route: PayRoute,
  handler: (
    request: unknown,
    context: PaidHandlerContext,
  ) => Response | Promise<Response>,
) {
  return async (req: any, res: any, next: (error?: unknown) => void) => {
    const protectedHandler = server.protect(route, (context) => handler(req, context));
    try {
      const request = new Request(
        `${req.protocol ?? "http"}://${req.get?.("host") ?? req.headers.host ?? "local"}${req.originalUrl ?? req.url}`,
        { method: req.method, headers: req.headers },
      );
      const response = await protectedHandler(request);
      res.status(response.status);
      for (const [name, value] of response.headers) res.setHeader(name, value);
      res.send(await response.text());
    } catch (error) {
      next(error);
    }
  };
}
