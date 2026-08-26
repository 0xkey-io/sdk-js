import type { PaidHandlerContext, PayRoute, PayServer } from "./server";
import { paymentMiddleware as expressPayment } from "./express";
import { paymentMiddleware as honoPayment } from "./hono";
import { withPayment } from "./next";

function delegatingServer(events: string[]): PayServer {
  return {
    protect(
      route: PayRoute,
      handler: (context: PaidHandlerContext) => Response | Promise<Response>,
    ) {
      events.push(`protect:${route.price}`);
      return async (request) => {
        events.push("settled");
        const response = await handler({
          request,
          paymentId: "pay-1",
          reference: "0xtx",
          protocol: "x402",
        });
        const headers = new Headers(response.headers);
        headers.set("PAYMENT-RESPONSE", "receipt");
        return new Response(response.body, { status: response.status, headers });
      };
    },
  };
}

test("Express translates HTTP objects and delegates all payment behavior to protect", async () => {
  const events: string[] = [];
  const headers = new Map<string, string>();
  const middleware = expressPayment(
    delegatingServer(events),
    { price: "$0.01" },
    async (_request, context) => {
      events.push(`handler:${context.paymentId}`);
      return Response.json({ weather: "sunny" });
    },
  );
  const response: any = {
    status: jest.fn(function (this: any, status: number) {
      this.statusCode = status;
      return this;
    }),
    setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value),
    send: jest.fn(),
  };

  await middleware(
    {
      method: "GET",
      originalUrl: "/weather",
      protocol: "https",
      headers: { host: "api.example.com" },
      get: () => "api.example.com",
    },
    response,
    jest.fn(),
  );

  expect(events).toEqual(["protect:$0.01", "settled", "handler:pay-1"]);
  expect(headers.get("payment-response")).toBe("receipt");
  expect(response.send).toHaveBeenCalledWith('{"weather":"sunny"}');
});

test("Hono delegates to protect and returns its Fetch response", async () => {
  const events: string[] = [];
  const context: any = {
    req: { raw: new Request("https://api.example.com/weather") },
    res: new Response("weather", { status: 200 }),
    set: jest.fn(),
  };
  const middleware = honoPayment(delegatingServer(events), { price: "$0.01" });
  const response = await middleware(context, async () => {
    events.push("handler");
  });

  expect(events).toEqual(["protect:$0.01", "settled", "handler"]);
  expect(context.set).toHaveBeenCalledWith("paymentId", "pay-1");
  expect(response.headers.get("PAYMENT-RESPONSE")).toBe("receipt");
});

test("Next delegates the route handler to protect without payment parsing", async () => {
  const events: string[] = [];
  const nextContext = { params: { locale: "en" } };
  const handler = withPayment(
    delegatingServer(events),
    { price: "$0.01" },
    async (_request, context, frameworkContext) => {
      events.push(`handler:${context.paymentId}`);
      expect(frameworkContext).toBe(nextContext);
      return new Response("weather");
    },
  );
  const response = await handler(
    new Request("https://api.example.com/weather"),
    nextContext,
  );

  expect(events).toEqual(["protect:$0.01", "settled", "handler:pay-1"]);
  expect(response.headers.get("PAYMENT-RESPONSE")).toBe("receipt");
});
