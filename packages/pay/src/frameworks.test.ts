import type { PayServer } from "./server";
import { paymentMiddleware as expressPayment } from "./express";
import { paymentMiddleware as honoPayment } from "./hono";
import { withPayment } from "./next";

function paidServer(events: string[]): PayServer {
  return {
    async handle() {
      events.push("settled");
      return {
        status: 200,
        paymentId: "pay-1",
        reference: "0xtx",
        withReceipt(response) {
          const headers = new Headers(response.headers);
          headers.set("PAYMENT-RESPONSE", "receipt");
          return new Response(response.body, {
            status: response.status,
            headers,
          });
        },
      };
    },
    async fulfillmentFailed() {
      events.push("fulfillment_failed");
    },
  };
}

test("Express settles before the merchant handler", async () => {
  const events: string[] = [];
  const headers = new Map<string, string>();
  const response: any = {
    locals: {},
    statusCode: 200,
    setHeader: (name: string, value: string) => headers.set(name, value),
    on: jest.fn(),
  };
  const middleware = expressPayment(paidServer(events), {
    "GET /weather": { price: "$0.01" },
  });
  await middleware(
    {
      method: "GET",
      path: "/weather",
      originalUrl: "/weather",
      protocol: "https",
      headers: { host: "api.example.com" },
      get: () => "api.example.com",
    },
    response,
    () => events.push("handler"),
  );
  expect(events).toEqual(["settled", "handler"]);
  expect(response.locals.paymentId).toBe("pay-1");
  expect(headers.get("payment-response")).toBe("receipt");
});

test("Hono settles before next and reports fulfillment failure", async () => {
  const events: string[] = [];
  const context: any = {
    req: {
      raw: new Request("https://api.example.com/weather"),
      method: "GET",
      path: "/weather",
    },
    res: new Response(null, { status: 200 }),
    set: jest.fn(),
    header: jest.fn(),
  };
  const middleware = honoPayment(paidServer(events), { price: "$0.01" });
  await middleware(context, async () => {
    events.push("handler");
    context.res = new Response("failed", { status: 500 });
  });
  expect(events).toEqual(["settled", "handler", "fulfillment_failed"]);
  expect(context.set).toHaveBeenCalledWith("paymentId", "pay-1");
});

test("Next settles before the route handler and keeps the receipt on 5xx", async () => {
  const events: string[] = [];
  const handler = withPayment(
    paidServer(events),
    { price: "$0.01" },
    async (request) => {
      events.push("handler");
      expect(request.headers.get("x-0xkey-payment-id")).toBe("pay-1");
      return new Response("failed", { status: 500 });
    },
  );
  const response = await handler(
    new Request("https://api.example.com/weather"),
  );
  expect(events).toEqual(["settled", "handler", "fulfillment_failed"]);
  expect(response.status).toBe(500);
  expect(response.headers.get("PAYMENT-RESPONSE")).toBe("receipt");
});

test("Hono records a thrown merchant handler after payment", async () => {
  const events: string[] = [];
  const context: any = {
    req: {
      raw: new Request("https://api.example.com/weather"),
      method: "GET",
      path: "/weather",
    },
    res: new Response(null, { status: 200 }),
    set: jest.fn(),
    header: jest.fn(),
  };
  const middleware = honoPayment(paidServer(events), { price: "$0.01" });
  await expect(
    middleware(context, async () => {
      events.push("handler");
      throw new Error("merchant failed");
    }),
  ).rejects.toThrow("merchant failed");
  expect(events).toEqual(["settled", "handler", "fulfillment_failed"]);
});

test("Next records a thrown merchant handler after payment", async () => {
  const events: string[] = [];
  const handler = withPayment(
    paidServer(events),
    { price: "$0.01" },
    async () => {
      events.push("handler");
      throw new Error("merchant failed");
    },
  );
  await expect(
    handler(new Request("https://api.example.com/weather")),
  ).rejects.toThrow("merchant failed");
  expect(events).toEqual(["settled", "handler", "fulfillment_failed"]);
});
