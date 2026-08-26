import {
  x402ResourceServer,
  type FacilitatorClient,
} from "@x402/core/server";
import { x402HTTPResourceServer } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import type {
  PaymentPayload,
  PaymentRequirements,
} from "@x402/core/types";
import { PayError } from "../errors";
import { create0xkeyFacilitatorClient } from "./index.mts";
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
  it("is the official FacilitatorClient and signs exact immutable envelopes", async () => {
    const { inputs, stamper } = fakeStamper();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/verify")) {
        return Response.json({ isValid: true, payer: payload.payload.authorization.from });
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
        code: operation === "settle" ? "PAYMENT_STATUS_UNKNOWN" : "PAYMENT_SERVICE_UNAVAILABLE",
        retryable: true,
      } satisfies Partial<PayError>);
      await expect(promise).rejects.not.toThrow("secret upstream body");
      expect(fetch).toHaveBeenCalledTimes(1);
    }
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
        code: "PAYMENT_SERVICE_UNAVAILABLE",
        retryable: true,
      });
      await jest.runAllTimersAsync();
      await rejection;
      expect(fetch).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
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
      code: "PAYMENT_STATUS_UNKNOWN",
      retryable: true,
    });
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
      code: "PAYMENT_SERVICE_UNAVAILABLE",
      retryable: true,
    });
    await expect(verification).rejects.not.toThrow("secret signing backend detail");
  });
});
