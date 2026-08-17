import type { PayRoute, PayServer } from "../server";

export function paymentMiddleware(server: PayServer, route: PayRoute) {
  return async (context: any, next: () => Promise<void>) => {
    const payment = await server.handle(context.req.raw, route);
    if (payment.status !== 200) return payment.response;
    context.set?.("paymentId", payment.paymentId);
    const receipt = payment.withReceipt(new Response());
    for (const [name, value] of receipt.headers) context.header(name, value);
    try {
      await next();
    } catch (error) {
      await server.fulfillmentFailed({
        paymentId: payment.paymentId,
        reference: payment.reference,
        route: `${context.req.method} ${context.req.path}`,
        status: 500,
      });
      throw error;
    }
    if (context.res.status >= 500) {
      await server.fulfillmentFailed({
        paymentId: payment.paymentId,
        reference: payment.reference,
        route: `${context.req.method} ${context.req.path}`,
        status: context.res.status,
      });
    }
    return context.res;
  };
}
