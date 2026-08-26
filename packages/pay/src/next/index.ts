import type { PaidHandlerContext, PayRoute, PayServer } from "../server";

export function withPayment(
  server: PayServer,
  route: PayRoute,
  handler: (
    request: Request,
    payment: PaidHandlerContext,
    context?: unknown,
  ) => Response | Promise<Response>,
) {
  return (request: Request, context?: unknown): Promise<Response> =>
    server.protect(route, (payment) =>
      handler(payment.request, payment, context),
    )(request);
}

export const paymentMiddleware = withPayment;
