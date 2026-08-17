import type { PayRoute, PayServer } from "../server";

export type PayRoutes = Record<string, PayRoute>;

export function paymentMiddleware(server: PayServer, routes: PayRoutes) {
  return async (req: any, res: any, next: (error?: unknown) => void) => {
    try {
      const routeKey = `${String(req.method).toUpperCase()} ${req.route?.path ?? req.path ?? req.url}`;
      const route = routes[routeKey];
      if (!route) return next();
      const request = new Request(
        `${req.protocol ?? "http"}://${req.get?.("host") ?? req.headers.host ?? "local"}${req.originalUrl ?? req.url}`,
        { method: req.method, headers: req.headers },
      );
      const payment = await server.handle(request, route);
      if (payment.status !== 200) {
        res.status(payment.response.status);
        for (const [name, value] of payment.response.headers) res.setHeader(name, value);
        res.send(await payment.response.text());
        return;
      }
      req.paymentId = payment.paymentId;
      res.locals ??= {};
      res.locals.paymentId = payment.paymentId;
      const receipt = payment.withReceipt(new Response());
      for (const [name, value] of receipt.headers) res.setHeader(name, value);
      res.on?.("finish", () => {
        if (res.statusCode >= 500) {
          void server
            .fulfillmentFailed({
              paymentId: payment.paymentId,
              reference: payment.reference,
              route: routeKey,
              status: res.statusCode,
            })
            .catch((error) => {
              console.error("pay_fulfillment_failed_callback_error", {
                paymentId: payment.paymentId,
                route: routeKey,
                error: error instanceof Error ? error.message : "unknown error",
              });
            });
        }
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}
