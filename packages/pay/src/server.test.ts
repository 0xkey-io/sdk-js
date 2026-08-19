import { createFacilitatorClient, createPayServer } from "./server";
import { resolvePayBaseUrl } from "./networks";
import type { PaymentPayload, PaymentRequirements } from "./types";
import type { RequestStampInput, RequestStamper } from "./xstamp";

jest.mock("mppx", () => ({
  Credential: { deserialize: jest.fn() },
  Receipt: { fromResponse: jest.fn() },
  x402: { Header: { decodePaymentSignature: jest.fn() } },
}));
jest.mock("mppx/server", () => ({
  Mppx: {
    create: jest.fn(() => ({
      evm: { charge: jest.fn(() => jest.fn()) },
    })),
  },
}));
jest.mock("mppx/evm/server", () => {
  const baseUsdc = {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    network: "eip155:8453",
    transfer: { name: "USD Coin", version: "2" },
  };
  const baseSepoliaUsdc = {
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    network: "eip155:84532",
    transfer: { name: "USDC", version: "2" },
  };
  return {
    assets: {
      base: { USDC: baseUsdc },
      baseSepolia: { USDC: baseSepoliaUsdc },
    },
    charge: jest.fn((config) => config),
  };
});
jest.mock("mppx/evm", () => ({
  Types: { challengeHash: jest.fn(() => "native-nonce") },
}));

const ORG = "11111111-1111-1111-1111-111111111111";

const requirements = {
  scheme: "exact",
  network: "eip155:84532",
  amount: "1000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x1111111111111111111111111111111111111111",
  maxTimeoutSeconds: 300,
  extra: {
    assetTransferMethod: "eip3009",
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
      validBefore: "99",
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

describe("createFacilitatorClient", () => {
  it("signs the exact request with its wire protocol", async () => {
    const { inputs, stamper } = fakeStamper();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = jest.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), ...(init ? { init } : {}) });
        return Response.json({ success: true, transaction: "0xtx" });
      },
    ) as typeof globalThis.fetch;
    const client = createFacilitatorClient({
      baseUrl: "https://pay.example",
      organizationId: ORG,
      stamper,
      fetch,
    });

    await client.settle(payload, requirements, "mpp");

    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      method: "POST",
      url: "https://pay.example/settle",
      organizationId: ORG,
      wireProtocol: "mpp",
    });
    expect(inputs[0]!.body).toBe(calls[0]!.init!.body);
    expect(JSON.parse(inputs[0]!.body!)).toMatchObject({
      organizationId: ORG,
      paymentPayload: { x402Version: 2 },
    });
    expect((calls[0]!.init!.headers as Record<string, string>)["X-Stamp"]).toBe(
      "signed-v2",
    );
  });

  it("keeps the HTTP status when a facilitator error is not JSON", async () => {
    const { stamper } = fakeStamper();
    const client = createFacilitatorClient({
      baseUrl: "https://pay.example",
      organizationId: ORG,
      stamper,
      fetch: async () => new Response("bad gateway", { status: 502 }),
    });

    await expect(client.settle(payload, requirements)).rejects.toThrow(
      "Pay facilitator request failed with 502",
    );
  });

  it("preserves a structured unknown 503 for durable recovery", async () => {
    const { stamper } = fakeStamper();
    const client = createFacilitatorClient({
      baseUrl: "https://pay.example",
      organizationId: ORG,
      stamper,
      fetch: async () =>
        Response.json(
          {
            success: false,
            errorReason: "PAYMENT_STATUS_UNKNOWN",
            paymentId: "22222222-2222-2222-2222-222222222222",
          },
          { status: 503 },
        ),
    });

    await expect(client.settle(payload, requirements)).resolves.toMatchObject({
      success: false,
      errorReason: "PAYMENT_STATUS_UNKNOWN",
      paymentId: "22222222-2222-2222-2222-222222222222",
    });
  });
});

describe("createPayServer", () => {
  it.each([
    [
      "production root",
      "eip155:8453",
      "https://api-pay.0xkey.io",
      "https://api-pay.0xkey.io/base-mainnet",
    ],
    [
      "production mainnet channel",
      "eip155:8453",
      "https://api-pay.0xkey.io/base-mainnet",
      "https://api-pay.0xkey.io/base-mainnet",
    ],
    [
      "production root",
      "eip155:84532",
      "https://api-pay.0xkey.io",
      "https://api-pay.0xkey.io/base-sepolia",
    ],
    [
      "production Sepolia channel",
      "eip155:84532",
      "https://api-pay.0xkey.io/base-sepolia",
      "https://api-pay.0xkey.io/base-sepolia",
    ],
    [
      "staging root",
      "eip155:8453",
      "https://api-pay.staging.0xkey.io",
      "https://api-pay.staging.0xkey.io/base-mainnet",
    ],
    [
      "staging mainnet channel",
      "eip155:8453",
      "https://api-pay.staging.0xkey.io/base-mainnet",
      "https://api-pay.staging.0xkey.io/base-mainnet",
    ],
    [
      "staging root",
      "eip155:84532",
      "https://api-pay.staging.0xkey.io",
      "https://api-pay.staging.0xkey.io/base-sepolia",
    ],
    [
      "staging Sepolia channel",
      "eip155:84532",
      "https://api-pay.staging.0xkey.io/base-sepolia",
      "https://api-pay.staging.0xkey.io/base-sepolia",
    ],
  ] as const)("routes the canonical %s for %s", (_, network, baseUrl, want) => {
    expect(resolvePayBaseUrl(network, baseUrl)).toBe(want);
  });

  describe.each([
    {
      label: "production mainnet",
      network: "eip155:8453" as const,
      origin: "https://api-pay.0xkey.io",
      host: "api-pay.0xkey.io",
      percentHost: "%61pi-pay.0xkey.io",
      channel: "base-mainnet",
      oppositeChannel: "base-sepolia",
    },
    {
      label: "production Sepolia",
      network: "eip155:84532" as const,
      origin: "https://api-pay.0xkey.io",
      host: "api-pay.0xkey.io",
      percentHost: "%61pi-pay.0xkey.io",
      channel: "base-sepolia",
      oppositeChannel: "base-mainnet",
    },
    {
      label: "staging mainnet",
      network: "eip155:8453" as const,
      origin: "https://api-pay.staging.0xkey.io",
      host: "api-pay.staging.0xkey.io",
      percentHost: "%61pi-pay.staging.0xkey.io",
      channel: "base-mainnet",
      oppositeChannel: "base-sepolia",
    },
    {
      label: "staging Sepolia",
      network: "eip155:84532" as const,
      origin: "https://api-pay.staging.0xkey.io",
      host: "api-pay.staging.0xkey.io",
      percentHost: "%61pi-pay.staging.0xkey.io",
      channel: "base-sepolia",
      oppositeChannel: "base-mainnet",
    },
  ])(
    "strict canonical API URL: $label",
    ({ network, origin, host, percentHost, channel, oppositeChannel }) => {
      it.each([
        ["root slash", `${origin}/`],
        ["leading whitespace", ` ${origin}/${channel}`],
        ["trailing whitespace", `${origin}/${channel} `],
        ["explicit default port", `https://${host}:443/${channel}`],
        ["explicit custom port", `https://${host}:8443/${channel}`],
        ["empty userinfo", `https://@${host}/${channel}`],
        ["username", `https://user@${host}/${channel}`],
        ["password-only userinfo", `https://:secret@${host}/${channel}`],
        ["empty query", `${origin}/${channel}?`],
        ["query", `${origin}/${channel}?tenant=wrong`],
        ["empty fragment", `${origin}/${channel}#`],
        ["fragment", `${origin}/${channel}#fragment`],
        ["dot segment", `${origin}/extra/../${channel}`],
        ["encoded dot segment", `${origin}/extra/%2e%2e/${channel}`],
        ["percent-encoded host", `https://${percentHost}/${channel}`],
        ["uppercase host", `https://${host.toUpperCase()}/${channel}`],
        ["trailing-dot host", `https://${host}./${channel}`],
        ["HTTP scheme", `http://${host}/${channel}`],
        ["opposite channel", `${origin}/${oppositeChannel}`],
        ["extra path", `${origin}/${channel}/v1`],
        ["channel trailing slash", `${origin}/${channel}/`],
      ])("rejects %s", (_, configuredBaseUrl) => {
        expect(() => resolvePayBaseUrl(network, configuredBaseUrl)).toThrow(
          "PAY_FACILITATOR_ORIGIN_MISMATCH",
        );
      });
    },
  );

  describe.each([
    {
      label: "production",
      origin: "https://pay.0xkey.io",
      host: "pay.0xkey.io",
      percentHost: "p%61y.0xkey.io",
    },
    {
      label: "staging",
      origin: "https://pay.staging.0xkey.io",
      host: "pay.staging.0xkey.io",
      percentHost: "p%61y.staging.0xkey.io",
    },
  ])("Pay website URL: $label", ({ origin, host, percentHost }) => {
    it.each([
      ["root", origin],
      ["root slash", `${origin}/`],
      ["channel path", `${origin}/base-mainnet`],
      ["leading whitespace", ` ${origin}`],
      ["trailing whitespace", `${origin} `],
      ["explicit default port", `https://${host}:443/base-mainnet`],
      ["explicit custom port", `https://${host}:8443/base-mainnet`],
      ["empty userinfo", `https://@${host}`],
      ["username", `https://user@${host}`],
      ["empty query", `${origin}?`],
      ["query", `${origin}?tenant=wrong`],
      ["empty fragment", `${origin}#`],
      ["fragment", `${origin}#fragment`],
      ["dot segment", `${origin}/extra/../base-mainnet`],
      ["percent-encoded host", `https://${percentHost}/base-mainnet`],
      ["uppercase host", `https://${host.toUpperCase()}/base-mainnet`],
      ["trailing-dot host", `https://${host}./base-mainnet`],
      ["HTTP scheme", `http://${host}/base-mainnet`],
    ])("rejects %s", (_, configuredBaseUrl) => {
      expect(() => resolvePayBaseUrl("eip155:8453", configuredBaseUrl)).toThrow(
        "PAY_FACILITATOR_ORIGIN_MISMATCH",
      );
    });
  });

  it("preserves an explicit third-party facilitator URL", () => {
    expect(
      resolvePayBaseUrl(
        "eip155:8453",
        "https://facilitator.example/base-sepolia",
      ),
    ).toBe("https://facilitator.example/base-sepolia");
  });

  it("rejects two credentials before settlement", async () => {
    const server = createPayServer({
      network: "eip155:84532",
      organizationId: ORG,
      payTo: requirements.payTo as `0x${string}`,
      apiKey: { publicKey: "unused", privateKey: "unused" },
      mppSecretKey: "01234567890123456789012345678901",
    });
    const request = new Request("https://merchant.example/weather", {
      headers: {
        Authorization: "Payment native-credential",
        "PAYMENT-SIGNATURE": "x402-credential",
      },
    });

    const result = await server.handle(request, { price: "$0.01" });

    expect(result.status).toBe(400);
    if (result.status === 400) {
      await expect(result.response.json()).resolves.toMatchObject({
        errorCode: "AMBIGUOUS_PAYMENT_CREDENTIAL",
      });
    }
  });

  it("rejects a facilitator channel for the other Base network", () => {
    expect(() =>
      createPayServer({
        network: "eip155:84532",
        organizationId: ORG,
        payTo: requirements.payTo as `0x${string}`,
        apiKey: { publicKey: "unused", privateKey: "unused" },
        mppSecretKey: "01234567890123456789012345678901",
        facilitatorUrl: "https://pay.0xkey.io/base-mainnet",
      }),
    ).toThrow("PAY_FACILITATOR_ORIGIN_MISMATCH");
  });

  it("configures mppx with canonical Base mainnet USDC", () => {
    const evmServer = jest.requireMock("mppx/evm/server") as {
      charge: jest.Mock;
    };
    evmServer.charge.mockClear();

    createPayServer({
      network: "eip155:8453",
      organizationId: ORG,
      payTo: requirements.payTo as `0x${string}`,
      apiKey: { publicKey: "unused", privateKey: "unused" },
      mppSecretKey: "01234567890123456789012345678901",
    });

    expect(evmServer.charge).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: expect.objectContaining({
          address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          network: "eip155:8453",
        }),
      }),
    );
  });
});
