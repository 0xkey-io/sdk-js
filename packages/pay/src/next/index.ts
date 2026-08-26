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
  const contexts = new WeakMap<Request, unknown>();
  const protectedHandler = server.protect(route, (payment) =>
    handler(payment.request, payment, contexts.get(payment.request)),
  );
  return async (request: Request, context?: unknown): Promise<Response> => {
    contexts.set(request, context);
    try {
      return await protectedHandler(request);
    } finally {
      contexts.delete(request);
    }
  };
}

export const paymentMiddleware = withPayment;
