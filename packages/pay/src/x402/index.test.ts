import {
  x402ResourceServer,
  FacilitatorResponseError,
  type FacilitatorClient,
} from "@x402/core/server";
import { x402HTTPResourceServer } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddlewareFromHTTPServer } from "@x402/express";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequirements,
} from "@x402/core/types";
import type { PayError } from "../errors";
import { create0xkeyFacilitatorClient, type Create0xkeyFacilitatorClientOptions } from "./index.mts";
import type { RequestStampInput, RequestStamper } from "../xstamp";

const ORG = "11111111-1111-4111-8111-111111111111";
const requirements = {
  scheme: "exact",
  network: "eip155:84532",
  amount: "1000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x1111111111111111111111111111111111111111",
  maxTimeoutSeconds: 300,
  extra: {
    assetTransferMethod: "eip3009",
    paymentFlow: "upfront",
    name: "USDC",
    version: "2",
  },
} satisfies PaymentRequirements;
const payload = {
  x402Version: 2,
  accepted: requirements,
  payload: {
    signature: `0x${"11".repeat(65)}`,
    authorization: {
      from: "0x2222222222222222222222222222222222222222",
      to: requirements.payTo,
      value: requirements.amount,
      validAfter: "0",
      validBefore: "9999999999",
      nonce: `0x${"22".repeat(32)}`,
    },
  },
} satisfies PaymentPayload;

function fakeStamper() {
  const inputs: RequestStampInput[] = [];
  const stamper: RequestStamper = {
    async stampRequest(input) {
      inputs.push(input);
      return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed-v2" };
    },
  };
  return { inputs, stamper };
}

describe("create0xkeyFacilitatorClient", () => {
  it.each([
    ["null", null],
    ["number", 1],
    ["plain object", {}],
    ["arrow", () => new Error("private configuration sentinel")],
    ["throwing", class { constructor() { throw new Error("private configuration sentinel"); } }],
    ["non-Error", class {}],
    ["frozen", class extends Error { constructor(message: string) { super(message); Object.freeze(this); } }],
    ["locked cause", class extends Error { constructor(message: string) { super(message); Object.defineProperty(this, "cause", { value: "private configuration sentinel" }); } }],
    ["locked undefined cause", class extends Error { constructor(message: string) { super(message); Object.defineProperty(this, "cause", { value: undefined }); } }],
  ])("rejects invalid facilitator error constructor %s synchronously before I/O", (_label, candidate) => {
    const { stamper, inputs } = fakeStamper();
    const fetch = jest.fn();
    const options = {
      network: "eip155:84532", organizationId: ORG, stamper, fetch,
      facilitatorResponseError: candidate,
    } as unknown as Create0xkeyFacilitatorClientOptions;
    let failure: unknown;
    try { create0xkeyFacilitatorClient(options); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "PAY_PROFILE_INVALID", phase: "configuration", retryable: false });
    expect(failure).not.toHaveProperty("paymentId");
    expect((failure as PayError).cause).toBeUndefined();
    expect(String(failure)).not.toContain("private configuration sentinel");
    expect(JSON.stringify(failure)).not.toContain("private configuration sentinel");
    expect(inputs).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("captures the consumer owner and gives it only safe single-message arguments", async () => {
    const argumentsSeen: unknown[][] = [];
    class ConsumerError extends Error {
      constructor(...args: [string]) { super(...args); argumentsSeen.push(args); }
    }
    const { stamper } = fakeStamper();
    const options = {
      network: "eip155:84532" as const, organizationId: ORG, stamper,
      facilitatorResponseError: ConsumerError,
      fetch: async (input: RequestInfo | URL) => Response.json(String(input).endsWith("/settle")
        ? { errorCode: "PAYMENT_STATUS_UNKNOWN", retryable: true, paymentId: "22222222-2222-4222-8222-222222222222" }
        : {}, { status: 503 }),
    };
    const client = create0xkeyFacilitatorClient(options);
    options.facilitatorResponseError = class LaterError extends Error {};
    for (const operation of ["getSupported", "verify", "settle"] as const) {
      const failure = await (operation === "getSupported" ? client.getSupported() : client[operation](payload, requirements)).catch(error => error);
      expect(failure).toBeInstanceOf(ConsumerError);
      expect(Object.getOwnPropertyDescriptor(failure, "cause")).toMatchObject({
        enumerable: false, configurable: false, writable: false,
      });
      expect(failure.cause).toMatchObject({
        code: operation === "settle" ? "PAYMENT_STATUS_UNKNOWN" : "PAYMENT_SERVICE_UNAVAILABLE",
        phase: "request", retryable: true,
      });
      expect(JSON.stringify(failure)).not.toContain("paymentId");
    }
    expect(argumentsSeen).toEqual([
      ["payment service is unavailable"], // synchronous structural probe
      ["payment service is unavailable"], ["payment service is unavailable"],
      ["settlement outcome is indeterminate"],
    ]);
  });

  it.each(["getSupported", "verify", "settle"] as const)("preserves the default owner and no-new-retry fault policy for %s", async operation => {
    for (const fault of ["503", "disconnect", "timeout", "malformed-json", "malformed-shape"] as const) {
      const { stamper, inputs } = fakeStamper();
      const fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (fault === "disconnect") throw new Error("private disconnect sentinel");
        if (fault === "timeout") return new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
        });
        if (fault === "503") return new Response("private body sentinel", { status: 503 });
        return new Response(fault === "malformed-json" ? "private malformed sentinel" : "{}", { status: 200 });
      });
      const client = create0xkeyFacilitatorClient({ network: "eip155:84532", organizationId: ORG, stamper, fetch, timeoutMs: 5 });
      const before = JSON.stringify({ payload, requirements });
      const failure = await (operation === "getSupported" ? client.getSupported() : client[operation](payload, requirements)).catch(error => error);
      expect(failure).toBeInstanceOf(FacilitatorResponseError);
      expect(failure.cause).toMatchObject({ code: operation === "settle" ? "PAYMENT_STATUS_UNKNOWN" : "PAYMENT_SERVICE_UNAVAILABLE", phase: "request", retryable: true });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(inputs).toHaveLength(1);
      expect(inputs[0]!.wireProtocol).toBe("x402");
      expect(JSON.stringify({ payload, requirements })).toBe(before);
      if (operation !== "getSupported") expect(JSON.parse(inputs[0]!.body!)).toEqual({ organizationId: ORG, x402Version: 2, paymentPayload: payload, paymentRequirements: requirements });
      expect(String(failure)).not.toContain("sentinel");
    }
  });

  it("leaves programming errors before the transport catch unchanged", async () => {
    const failure = new TypeError("circular input");
    const malformed = { ...payload, toJSON() { throw failure; } };
    const { stamper, inputs } = fakeStamper();
    const fetch = jest.fn();
    const client = create0xkeyFacilitatorClient({ network: "eip155:84532", organizationId: ORG, stamper, fetch });
    await expect(client.verify(malformed, requirements)).rejects.toBe(failure);
    expect(inputs).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is the official FacilitatorClient and signs exact immutable envelopes", async () => {
    const { inputs, stamper } = fakeStamper();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init === undefined ? { url: String(url) } : { url: String(url), init });
      if (String(url).endsWith("/verify")) {
        return Response.json({ isValid: true, payer: payload.payload.authorization.from });
      }
      if (String(url).endsWith("/supported")) {
        return Response.json({
          kinds: [{ x402Version: 2, scheme: "exact", network: requirements.network }],
          extensions: [],
          signers: {},
        });
      }
      if (String(url).endsWith("/settle")) {
        return Response.json({
          settlement: {
            success: true,
            transaction: `0x${"ab".repeat(32)}`,
            network: requirements.network,
            payer: payload.payload.authorization.from,
          },
          paymentId: "22222222-2222-4222-8222-222222222222",
        });
      }
      return Response.json({
        kinds: [{ x402Version: 2, scheme: "exact", network: requirements.network }],
        extensions: [],
        signers: {},
      });
    }) as typeof globalThis.fetch;
    const beforePayload = structuredClone(payload);
    const beforeRequirements = structuredClone(requirements);
    const client: FacilitatorClient = create0xkeyFacilitatorClient({
      network: "eip155:84532",
      organizationId: ORG,
      stamper,
      facilitatorUrl: "https://facilitator.example///",
      fetch,
    });
    const officialResourceServer = new x402ResourceServer(client).register(
      "eip155:84532",
      new ExactEvmScheme(),
    );
    const officialHttpServer = new x402HTTPResourceServer(officialResourceServer, {
      accepts: {
        scheme: "exact",
        network: "eip155:84532",
        payTo: requirements.payTo,
        price: "$0.001",
      },
    });
    expect(officialHttpServer).toBeInstanceOf(x402HTTPResourceServer);

    await expect(client.verify(payload, requirements)).resolves.toEqual({
      isValid: true,
      payer: payload.payload.authorization.from,
    });
    const settlement = await client.settle(payload, requirements);
    await expect(client.getSupported()).resolves.toEqual({
      kinds: [{ x402Version: 2, scheme: "exact", network: requirements.network }],
      extensions: [],
      signers: {},
    });

    expect(calls.map(({ url, init }) => [url, init?.method])).toEqual([
      ["https://facilitator.example/verify", "POST"],
      ["https://facilitator.example/settle", "POST"],
      ["https://facilitator.example/supported", "GET"],
    ]);
    expect(calls.every(({ init }) => init?.redirect === "error")).toBe(true);
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({
      organizationId: ORG,
      x402Version: 2,
      paymentPayload: payload,
      paymentRequirements: requirements,
    });
    expect(inputs.map(({ method, wireProtocol, body }) => [method, wireProtocol, body])).toEqual([
      ["POST", "x402", calls[0]!.init!.body],
      ["POST", "x402", calls[1]!.init!.body],
      ["GET", "x402", undefined],
    ]);
    expect(settlement).toEqual({
      success: true,
      transaction: `0x${"ab".repeat(32)}`,
      network: requirements.network,
      payer: payload.payload.authorization.from,
    });
    expect(Object.keys(settlement)).not.toContain("paymentId");
    expect(payload).toEqual(beforePayload);
    expect(requirements).toEqual(beforeRequirements);
  });

  it("validates configuration before any request", () => {
    const { stamper } = fakeStamper();
    const base = {
      network: "eip155:84532" as const,
      organizationId: ORG,
      stamper,
    };
    expect(() => create0xkeyFacilitatorClient({ ...base, organizationId: "not-a-uuid" })).toThrow(
      "PAY_PROFILE_INVALID",
    );
    expect(() => create0xkeyFacilitatorClient({ ...base, facilitatorUrl: "http://localhost:3000" })).toThrow(
      "PAY_INSECURE_TRANSPORT",
    );
    expect(() => create0xkeyFacilitatorClient({ ...base, apiKey: { publicKey: "p", privateKey: "k" } })).toThrow(
      "PAY_PROFILE_INVALID",
    );
    expect(() => create0xkeyFacilitatorClient({ ...base, timeoutMs: 0 })).toThrow(
      "PAY_PROFILE_INVALID",
    );
  });

  it("never retries verify or settle and classifies dependency ambiguity", async () => {
    const { stamper } = fakeStamper();
    for (const operation of ["verify", "settle"] as const) {
      const fetch = jest.fn(async () => new Response("secret upstream body", { status: 503 }));
      const client = create0xkeyFacilitatorClient({
        network: "eip155:84532",
        organizationId: ORG,
        stamper,
        fetch: fetch as typeof globalThis.fetch,
      });
      const promise = client[operation](payload, requirements);
      await expect(promise).rejects.toMatchObject({
        cause: {
          code: operation === "settle" ? "PAYMENT_STATUS_UNKNOWN" : "PAYMENT_SERVICE_UNAVAILABLE",
          retryable: true,
        } satisfies Partial<PayError>,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("surfaces indeterminate settlement through official Express middleware as 502, never 402", async () => {
    const { stamper } = fakeStamper();
    const fetch = jest.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/verify")) {
        return Response.json({ isValid: true, payer: payload.payload.authorization.from });
      }
      if (String(url).endsWith("/supported")) {
        return Response.json({
          kinds: [{ x402Version: 2, scheme: "exact", network: requirements.network }],
          extensions: [],
          signers: {},
        });
      }
      return new Response(JSON.stringify({ errorCode: "PAYMENT_STATUS_UNKNOWN", retryable: true }), {
        status: 503,
      });
    }) as typeof globalThis.fetch;
    const client = create0xkeyFacilitatorClient({
      network: "eip155:84532",
      organizationId: ORG,
      stamper,
      fetch,
    });
    const httpServer = {
      routes: {},
      requiresPayment: () => true,
      async processHTTPRequest() {
        await client.settle(payload, requirements);
        throw new Error("unreachable");
      },
    };
    const middleware = paymentMiddlewareFromHTTPServer(
      httpServer as never,
      undefined,
      undefined,
      false,
    );
    const req = {
      body: undefined,
      headers: { host: "merchant.example" },
      header(name: string) {
        if (name.toLowerCase() === "payment-signature") {
          return encodePaymentSignatureHeader(payload);
        }
        return undefined;
      },
      method: "GET",
      originalUrl: "/weather",
      path: "/weather",
      protocol: "https",
      query: {},
    };
    const statusCodes: number[] = [];
    const bodies: unknown[] = [];
    const res = {
      status(code: number) {
        statusCodes.push(code);
        return this;
      },
      json(body: unknown) {
        bodies.push(body);
        return this;
      },
      setHeader() {
        return this;
      },
    };
    const next = jest.fn();

    await middleware(req as never, res as never, next);

    expect(statusCodes).toEqual([502]);
    expect(bodies).toEqual([{ error: "settlement outcome is indeterminate" }]);
    expect(next).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects redirects without forwarding a signed request to a second host", async () => {
    const { stamper } = fakeStamper();
    let secondHostCalls = 0;
    const fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).startsWith("https://redirect-target.example")) secondHostCalls += 1;
      expect(init?.redirect).toBe("error");
      return Response.redirect("https://redirect-target.example/credential", 302);
    }) as typeof globalThis.fetch;
    const client = create0xkeyFacilitatorClient({
      network: "eip155:84532", organizationId: ORG, stamper, fetch,
    });
    await expect(client.verify(payload, requirements)).rejects.toMatchObject({
      cause: { code: "PAYMENT_SERVICE_UNAVAILABLE", retryable: true },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(secondHostCalls).toBe(0);
  });

  it("retries only supported 429 for three total attempts", async () => {
    jest.useFakeTimers();
    try {
      const { stamper } = fakeStamper();
      const fetch = jest.fn(async () =>
        Response.json(
          { errorCode: "RATE_LIMITED", credential: "must-not-leak" },
          { status: 429, headers: { "Retry-After": "1" } },
        ),
      ) as typeof globalThis.fetch;
      const client = create0xkeyFacilitatorClient({
        network: "eip155:84532",
        organizationId: ORG,
        stamper,
        fetch,
      });
      const result = client.getSupported();
      const rejection = expect(result).rejects.toMatchObject({
        cause: { code: "PAYMENT_SERVICE_UNAVAILABLE", retryable: true },
      });
      await jest.runAllTimersAsync();
      await rejection;
      expect(fetch).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ["HTTP-date", 20_000, 20_000],
    ["clamped HTTP-date", 120_000, 30_000],
    ["past HTTP-date", -20_000, 0],
    ["clamped delta", "999", 30_000],
  ])("honors and clamps %s Retry-After", async (_label, retryInput, expectedDelay) => {
    const now = 1_800_000_000_000;
    jest.useFakeTimers({ now });
    try {
      const retryAfter = typeof retryInput === "number"
        ? new Date(now + retryInput).toUTCString()
        : retryInput;
      const { stamper } = fakeStamper();
      const fetch = jest.fn()
        .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": retryAfter } }))
        .mockResolvedValue(Response.json({ kinds: [], extensions: [], signers: {} }));
      const client = create0xkeyFacilitatorClient({
        network: "eip155:84532", organizationId: ORG, stamper,
        fetch: fetch as typeof globalThis.fetch,
      });
      const result = client.getSupported();
      if (expectedDelay === 0) {
        await jest.advanceTimersByTimeAsync(0);
        await result;
        expect(fetch).toHaveBeenCalledTimes(2);
        return;
      }
      await jest.advanceTimersByTimeAsync(expectedDelay - 1);
      expect(fetch).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await result;
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps a strict deterministic private rejection as standard success:false", async () => {
    const { stamper } = fakeStamper();
    const client = create0xkeyFacilitatorClient({
      network: "eip155:84532", organizationId: ORG, stamper,
      fetch: async () => Response.json({
        settlement: {
          success: false,
          transaction: "",
          network: requirements.network,
          payer: payload.payload.authorization.from,
          errorReason: "authorization rejected",
        },
        paymentId: "22222222-2222-4222-8222-222222222222",
      }),
    });
    await expect(client.settle(payload, requirements)).resolves.toMatchObject({
      success: false,
      transaction: "",
      network: requirements.network,
      payer: payload.payload.authorization.from,
    });
  });

  it("fails closed on malformed successful responses", async () => {
    const { stamper } = fakeStamper();
    const client = create0xkeyFacilitatorClient({
      network: "eip155:84532",
      organizationId: ORG,
      stamper,
      fetch: async () => Response.json({ success: true, paymentId: "private" }),
    });
    await expect(client.settle(payload, requirements)).rejects.toMatchObject({
      cause: { code: "PAYMENT_STATUS_UNKNOWN", retryable: true },
    });
  });

  it.each([
    ["outer extension", {
      settlement: {
        success: true, transaction: `0x${"ab".repeat(32)}`,
        network: requirements.network, payer: payload.payload.authorization.from,
      },
      paymentId: "22222222-2222-4222-8222-222222222222",
      privateMetadata: true,
    }],
    ["nested extension", {
      settlement: {
        success: true, transaction: `0x${"ab".repeat(32)}`,
        network: requirements.network, payer: payload.payload.authorization.from,
        providerPrivate: true,
      },
      paymentId: "22222222-2222-4222-8222-222222222222",
    }],
    ["wrong network", {
      settlement: {
        success: true, transaction: `0x${"ab".repeat(32)}`,
        network: "eip155:8453", payer: payload.payload.authorization.from,
      },
      paymentId: "22222222-2222-4222-8222-222222222222",
    }],
    ["wrong payer", {
      settlement: {
        success: true, transaction: `0x${"ab".repeat(32)}`,
        network: requirements.network, payer: requirements.payTo,
      },
      paymentId: "22222222-2222-4222-8222-222222222222",
    }],
    ["missing payer", {
      settlement: {
        success: true, transaction: `0x${"ab".repeat(32)}`,
        network: requirements.network,
      },
      paymentId: "22222222-2222-4222-8222-222222222222",
    }],
    ["zero transaction", {
      settlement: {
        success: true, transaction: `0x${"00".repeat(32)}`,
        network: requirements.network, payer: payload.payload.authorization.from,
      },
      paymentId: "22222222-2222-4222-8222-222222222222",
    }],
    ["malformed optional amount", {
      settlement: {
        success: true, transaction: `0x${"ab".repeat(32)}`,
        network: requirements.network, payer: payload.payload.authorization.from,
        amount: 0,
      },
      paymentId: "22222222-2222-4222-8222-222222222222",
    }],
    ["malformed optional extensions", {
      settlement: {
        success: true, transaction: `0x${"ab".repeat(32)}`,
        network: requirements.network, payer: payload.payload.authorization.from,
        extensions: [],
      },
      paymentId: "22222222-2222-4222-8222-222222222222",
    }],
  ])("rejects strict private settlement violation: %s", async (_label, body) => {
    const { stamper } = fakeStamper();
    const client = create0xkeyFacilitatorClient({
      network: "eip155:84532", organizationId: ORG, stamper,
      fetch: async () => Response.json(body),
    });
    await expect(client.settle(payload, requirements)).rejects.toMatchObject({
      cause: { code: "PAYMENT_STATUS_UNKNOWN", retryable: true },
    });
  });

  it.each([
    [400, "PAYMENT_REQUEST_INVALID", false, undefined],
    [401, "PAYMENT_AUTH_INVALID", false, undefined],
    [403, "PAYMENT_AUTH_FORBIDDEN", false, undefined],
    [409, "PAYMENT_INTENT_CONFLICT", false, "22222222-2222-4222-8222-222222222222"],
    [502, "PAYMENT_SERVICE_UNAVAILABLE", true, undefined],
    [503, "PAYMENT_STATUS_UNKNOWN", true, "22222222-2222-4222-8222-222222222222"],
  ] as const)("preserves official settle structured %i %s", async (
    status,
    errorCode,
    retryable,
    paymentId,
  ) => {
    const { stamper } = fakeStamper();
    const client = create0xkeyFacilitatorClient({
      network: "eip155:84532", organizationId: ORG, stamper,
      fetch: async () => Response.json({
        errorCode, retryable, ...(paymentId ? { paymentId } : {}),
      }, { status }),
    });
    await expect(client.settle(payload, requirements)).rejects.toMatchObject({
      cause: {
        code: errorCode,
        retryable,
        ...(paymentId ? { paymentId } : {}),
      },
    });
  });

  it("does not let official middleware continue after an unbound private success", async () => {
    const { stamper } = fakeStamper();
    const client = create0xkeyFacilitatorClient({
      network: "eip155:84532", organizationId: ORG, stamper,
      fetch: async () => Response.json({
        settlement: {
          success: true, transaction: "", network: "wrong",
          payer: requirements.payTo,
        },
        paymentId: "22222222-2222-4222-8222-222222222222",
      }),
    });
    const middleware = paymentMiddlewareFromHTTPServer({
      routes: {}, requiresPayment: () => true,
      async processHTTPRequest() { await client.settle(payload, requirements); },
    } as never, undefined, undefined, false);
    const statusCodes: number[] = [];
    const res = {
      status(code: number) { statusCodes.push(code); return this; },
      json() { return this; }, setHeader() { return this; },
    };
    const next = jest.fn();
    await middleware({
      body: undefined, headers: { host: "merchant.example" }, header() { return undefined; },
      method: "GET", originalUrl: "/weather", path: "/weather", protocol: "https", query: {},
    } as never, res as never, next);
    expect(statusCodes).toEqual([502]);
    expect(next).not.toHaveBeenCalled();
  });

  it("maps stamping failures to stable safe dependency errors", async () => {
    const client = create0xkeyFacilitatorClient({
      network: "eip155:84532",
      organizationId: ORG,
      stamper: {
        async stampRequest() {
          throw new Error("secret signing backend detail");
        },
      },
    });
    const verification = client.verify(payload, requirements);
    await expect(verification).rejects.toMatchObject({
      cause: { code: "PAYMENT_SERVICE_UNAVAILABLE", retryable: true },
    });
    await expect(verification).rejects.not.toThrow("secret signing backend detail");
  });
});
