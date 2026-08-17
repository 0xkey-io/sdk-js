import type { PayRoute, PayServer } from "../server";

export function withPayment(
  server: PayServer,
  route: PayRoute,
  handler: (request: Request, context?: unknown) => Response | Promise<Response>,
) {
  return async (request: Request, context?: unknown): Promise<Response> => {
    const payment = await server.handle(request, route);
    if (payment.status !== 200) return payment.response;
    const paidRequest = new Request(request, {
      headers: new Headers(request.headers),
    });
    paidRequest.headers.set("x-0xkey-payment-id", payment.paymentId);
    let response: Response;
    try {
      response = await handler(paidRequest, context);
    } catch (error) {
      await server.fulfillmentFailed({
        paymentId: payment.paymentId,
        reference: payment.reference,
        route: `${request.method} ${new URL(request.url).pathname}`,
        status: 500,
      });
      throw error;
    }
    if (response.status >= 500) {
      await server.fulfillmentFailed({
        paymentId: payment.paymentId,
        reference: payment.reference,
        route: `${request.method} ${new URL(request.url).pathname}`,
        status: response.status,
      });
    }
    return payment.withReceipt(response);
  };
}

export const paymentMiddleware = withPayment;
