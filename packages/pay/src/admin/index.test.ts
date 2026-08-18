import { createPayAdminClient } from ".";
import type { PaymentRecord } from "../types";
import type { RequestStampInput, RequestStamper } from "../xstamp";

const paymentWithoutDirection = {
  paymentId: "22222222-2222-2222-2222-222222222222",
  organizationId: "11111111-1111-1111-1111-111111111111",
  scheme: "exact",
  network: "eip155:84532",
  asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  amount: "10000",
  payer: "0x1111111111111111111111111111111111111111",
  payTo: "0x2222222222222222222222222222222222222222",
  nonce: `0x${"01".repeat(32)}`,
  txHash: null,
  status: "PREPARED",
  protocol: "x402",
  protocolVersion: "2",
  intent: "charge",
  method: "evm",
  requirementsDigest: `0x${"02".repeat(32)}`,
  wireDigest: `0x${"03".repeat(32)}`,
  resourceDigest: null,
  economicEffectId: `0x${"04".repeat(32)}`,
  adapterRevision: "x402-rs:test",
  provider: "x402-rs",
  providerConfigRevision: "test",
  resourceUrl: "https://merchant.example/weather",
  resourceHost: "merchant.example",
  errorReason: null,
  traceId: null,
  networkFeeAtomic: null,
  feeToken: null,
  feeTokenDecimals: null,
  createdAt: "2026-08-18T00:00:00.000Z",
  submittedAt: null,
  confirmedAt: null,
  finalizedAt: null,
  unknownSince: null,
  lastObservedAt: null,
} satisfies PaymentRecord;

describe("createPayAdminClient", () => {
  it("reads the clean-start payment record without a direction field", async () => {
    const stamper: RequestStamper = {
      async stampRequest() {
        return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed-v2" };
      },
    };
    const client = createPayAdminClient({
      baseUrl: "https://pay.example",
      network: "eip155:84532",
      organizationId: paymentWithoutDirection.organizationId,
      stamper,
      fetch: async () => Response.json(paymentWithoutDirection),
    });

    const payment = await client.payments.get({
      paymentId: paymentWithoutDirection.paymentId,
    });

    expect(payment).toEqual(paymentWithoutDirection);
    expect("direction" in payment).toBe(false);
  });

  it("binds every organization-scoped URL to the configured organization", async () => {
    const stampInputs: RequestStampInput[] = [];
    const stamper: RequestStamper = {
      async stampRequest(input) {
        stampInputs.push(input);
        return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed-v2" };
      },
    };
    const urls: string[] = [];
    const fetch = jest.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Response.json({ payments: [] });
    }) as typeof globalThis.fetch;
    const client = createPayAdminClient({
      baseUrl: "https://pay.example/",
      network: "eip155:84532",
      organizationId: "11111111-1111-1111-1111-111111111111",
      stamper,
      fetch,
    });

    await client.payments.list({
      status: "CONFIRMED",
      protocol: "mpp",
      limit: 10,
    });
    await client.payments.get({
      paymentId: "22222222-2222-2222-2222-222222222222",
    });

    expect(urls).toEqual([
      "https://pay.example/v1/organizations/11111111-1111-1111-1111-111111111111/payments?status=CONFIRMED&network=eip155%3A84532&protocol=mpp&limit=10",
      "https://pay.example/v1/organizations/11111111-1111-1111-1111-111111111111/payments/22222222-2222-2222-2222-222222222222",
    ]);
    expect(stampInputs).toHaveLength(2);
    expect(stampInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: "11111111-1111-1111-1111-111111111111",
          wireProtocol: "admin",
        }),
      ]),
    );
  });

  it("keeps the HTTP status when an error body is not JSON", async () => {
    const stamper: RequestStamper = {
      async stampRequest() {
        return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed-v2" };
      },
    };
    const client = createPayAdminClient({
      baseUrl: "https://pay.example",
      network: "eip155:84532",
      organizationId: "11111111-1111-1111-1111-111111111111",
      stamper,
      fetch: async () => new Response("denied", { status: 403 }),
    });

    await expect(client.payments.list({})).rejects.toThrow(
      "Pay admin request failed with 403",
    );
  });

  it("includes a JSON error code without hiding the HTTP status", async () => {
    const stamper: RequestStamper = {
      async stampRequest() {
        return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed-v2" };
      },
    };
    const client = createPayAdminClient({
      baseUrl: "https://pay.example",
      network: "eip155:84532",
      organizationId: "11111111-1111-1111-1111-111111111111",
      stamper,
      fetch: async () =>
        Response.json(
          { errorCode: "TENANT_CONTEXT_MISMATCH" },
          { status: 401 },
        ),
    });

    await expect(client.payments.list({})).rejects.toThrow(
      "Pay admin request failed with 401: TENANT_CONTEXT_MISMATCH",
    );
  });

  it("routes the public Pay origin through the configured network channel", async () => {
    const urls: string[] = [];
    const client = createPayAdminClient({
      baseUrl: "https://pay.0xkey.io",
      network: "eip155:8453",
      organizationId: "11111111-1111-1111-1111-111111111111",
      stamper: {
        async stampRequest() {
          return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed-v2" };
        },
      },
      fetch: async (input) => {
        urls.push(String(input));
        return Response.json({ payments: [] });
      },
    });

    await client.payments.list({});

    expect(urls).toEqual([
      "https://pay.0xkey.io/base-mainnet/v1/organizations/11111111-1111-1111-1111-111111111111/payments?network=eip155%3A8453",
    ]);
  });
});
