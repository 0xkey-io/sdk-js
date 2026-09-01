import type { PayRoute, PayServer } from "../server";

export function paymentMiddleware(server: PayServer, route: PayRoute) {
  const requests = new WeakMap<Request, { context: any; next: () => Promise<void> }>();
  const protectedHandler = server.protect(route, async (payment) => {
    const current = requests.get(payment.request);
    if (!current) throw new Error("missing Hono request context");
    current.context.set?.("paymentId", payment.paymentId);
    current.context.set?.("paymentProtocol", payment.protocol);
    await current.next();
    return current.context.res;
  });
  return async (context: any, next: () => Promise<void>) => {
    const request = context.req.raw as Request;
    requests.set(request, { context, next });
    try {
      const response = await protectedHandler(request);
      context.res = response;
      return response;
    } finally {
      requests.delete(request);
    }
  };
}
