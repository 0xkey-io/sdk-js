import { EventEmitter } from "node:events";
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
  const response: any = Object.assign(new EventEmitter(), {
    status: jest.fn(function (this: any, status: number) {
      this.statusCode = status;
      return this;
    }),
    setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value),
    write: jest.fn(() => true),
    end: jest.fn(),
  });

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
  expect(Buffer.concat(response.write.mock.calls.map(([chunk]: [Uint8Array]) => Buffer.from(chunk))).toString()).toBe('{"weather":"sunny"}');
  expect(response.end).toHaveBeenCalledTimes(1);
});

test("Express caches protect and streams binary multi-chunk bodies without text decoding", async () => {
  let protectCalls = 0;
  const server = delegatingServer([]);
  const originalProtect = server.protect;
  server.protect = (...args) => {
    protectCalls += 1;
    return originalProtect(...args);
  };
  const middleware = expressPayment(server, { price: "$0.01" }, async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(0xff));
        controller.enqueue(Uint8Array.of(0x00));
        controller.close();
      },
    });
    return new Response(stream);
  });
  const chunks: Buffer[] = [];
  const response: any = Object.assign(new EventEmitter(), {
    status() { return this; },
    setHeader() {},
    write(chunk: Uint8Array) { chunks.push(Buffer.from(chunk)); return true; },
    end: jest.fn(),
  });
  const request = {
    method: "GET", originalUrl: "/binary", protocol: "https",
    headers: { host: "api.example.com" }, get: () => "api.example.com",
  };

  await middleware(request, response, jest.fn());
  await middleware(request, response, jest.fn());

  expect(protectCalls).toBe(1);
  expect(Buffer.concat(chunks)).toEqual(Buffer.from([0xff, 0x00, 0xff, 0x00]));
  expect(response.end).toHaveBeenCalledTimes(2);
});

test("Express cancels the upstream reader and cleans drain listeners when downstream closes", async () => {
  let cancelCalls = 0;
  const middleware = expressPayment(
    delegatingServer([]),
    { price: "$0.01" },
    async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(0xff, 0x00));
      },
      cancel() {
        cancelCalls += 1;
      },
    })),
  );
  const response: any = Object.assign(new EventEmitter(), {
    status() { return this; },
    setHeader() {},
    write() {
      queueMicrotask(() => this.emit("close"));
      return false;
    },
    end: jest.fn(),
  });
  const next = jest.fn();

  await middleware({
    method: "GET", originalUrl: "/binary", protocol: "https",
    headers: { host: "api.example.com" }, get: () => "api.example.com",
  }, response, next);

  expect(cancelCalls).toBe(1);
  expect(response.end).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
  expect(response.listenerCount("drain")).toBe(0);
  expect(response.listenerCount("close")).toBe(0);
  expect(response.listenerCount("error")).toBe(0);
});

test("Express cancels upstream and forwards a downstream error without leaking listeners", async () => {
  let cancelCalls = 0;
  const middleware = expressPayment(
    delegatingServer([]),
    { price: "$0.01" },
    async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Uint8Array.of(1)); },
      cancel() { cancelCalls += 1; },
    })),
  );
  const downstream = new Error("socket failed");
  const response: any = Object.assign(new EventEmitter(), {
    status() { return this; }, setHeader() {},
    write() { queueMicrotask(() => this.emit("error", downstream)); return false; },
    end: jest.fn(),
  });
  const next = jest.fn();

  await middleware({
    method: "GET", originalUrl: "/binary", protocol: "https",
    headers: { host: "api.example.com" }, get: () => "api.example.com",
  }, response, next);

  expect(cancelCalls).toBe(1);
  expect(next).toHaveBeenCalledWith(downstream);
  expect(response.end).not.toHaveBeenCalled();
  expect(response.eventNames()).toEqual([]);
});

test.each(["before-first-chunk", "between-chunks"] as const)(
  "Express cancels a pending reader when downstream closes %s",
  async (timing) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let cancelCalls = 0;
    let firstWrite!: () => void;
    const firstWritten = new Promise<void>((resolve) => { firstWrite = resolve; });
    const middleware = expressPayment(
      delegatingServer([]),
      { price: "$0.01" },
      async () => new Response(new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
          if (timing === "between-chunks") value.enqueue(Uint8Array.of(1));
        },
        cancel() { cancelCalls += 1; },
      })),
    );
    const response: any = Object.assign(new EventEmitter(), {
      status() { return this; }, setHeader() {},
      write() { firstWrite(); return true; },
      end: jest.fn(),
    });
    const next = jest.fn();
    const running = middleware({
      method: "GET", originalUrl: "/binary", protocol: "https",
      headers: { host: "api.example.com" }, get: () => "api.example.com",
    }, response, next);
    if (timing === "between-chunks") await firstWritten;
    else await new Promise((resolve) => setImmediate(resolve));
    response.emit("close");
    const outcome = await Promise.race([
      running.then(() => "completed"),
      new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), 20)),
    ]);
    if (outcome === "blocked") controller.close();
    await running;
    expect(outcome).toBe("completed");
    expect(cancelCalls).toBe(1);
    expect(response.end).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(response.listenerCount("close")).toBe(0);
    expect(response.listenerCount("error")).toBe(0);
  },
);

test("Express cancels a pending first read and forwards downstream error", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelCalls = 0;
  const middleware = expressPayment(
    delegatingServer([]),
    { price: "$0.01" },
    async () => new Response(new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
      cancel() { cancelCalls += 1; },
    })),
  );
  const response: any = Object.assign(new EventEmitter(), {
    status() { return this; }, setHeader() {}, write() { return true; }, end: jest.fn(),
  });
  const externalErrorListener = () => undefined;
  response.on("error", externalErrorListener);
  const next = jest.fn();
  const running = middleware({
    method: "GET", originalUrl: "/binary", protocol: "https",
    headers: { host: "api.example.com" }, get: () => "api.example.com",
  }, response, next);
  await new Promise((resolve) => setImmediate(resolve));
  const downstream = new Error("socket failed before first chunk");
  response.emit("error", downstream);
  const outcome = await Promise.race([
    running.then(() => "completed"),
    new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), 20)),
  ]);
  if (outcome === "blocked") controller.close();
  await running;
  expect(outcome).toBe("completed");
  expect(cancelCalls).toBe(1);
  expect(next).toHaveBeenCalledWith(downstream);
  expect(response.listeners("error")).toEqual([externalErrorListener]);
  expect(response.listenerCount("close")).toBe(0);
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

test("Hono caches protect across requests", async () => {
  const events: string[] = [];
  const middleware = honoPayment(delegatingServer(events), { price: "$0.01" });
  for (let index = 0; index < 2; index += 1) {
    const context: any = {
      req: { raw: new Request(`https://api.example.com/weather?i=${index}`) },
      res: new Response("weather"),
      set: jest.fn(),
    };
    await middleware(context, async () => undefined);
  }
  expect(events.filter((event) => event.startsWith("protect:"))).toHaveLength(1);
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

test("Next caches protect while preserving concurrent request contexts", async () => {
  const events: string[] = [];
  const handler = withPayment(
    delegatingServer(events),
    { price: "$0.01" },
    async (_request, _payment, context) => Response.json(context),
  );
  const [first, second] = await Promise.all([
    handler(new Request("https://api.example.com/one"), { id: 1 }),
    handler(new Request("https://api.example.com/two"), { id: 2 }),
  ]);
  expect(await first.json()).toEqual({ id: 1 });
  expect(await second.json()).toEqual({ id: 2 });
  expect(events.filter((event) => event.startsWith("protect:"))).toHaveLength(1);
});
