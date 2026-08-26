import type { PayRoute, PayServer } from "../server";

export function paymentMiddleware(server: PayServer, route: PayRoute) {
  return async (context: any, next: () => Promise<void>) => {
    const protectedHandler = server.protect(route, async (payment) => {
      context.set?.("paymentId", payment.paymentId);
      context.set?.("paymentProtocol", payment.protocol);
      await next();
      return context.res;
    });
    const response = await protectedHandler(context.req.raw);
    context.res = response;
    return response;
  };
}
