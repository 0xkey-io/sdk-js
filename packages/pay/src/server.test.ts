import {
  createFacilitatorClient,
  createPayClient,
  type Stamper,
} from "./server";
import type { PaymentPayload, PaymentRequirements } from "./types";

const ORG = "11111111-1111-1111-1111-111111111111";

const payload = {
  x402Version: 2,
  scheme: "exact",
  network: "eip155:84532",
  payload: {
    signature: "0xsig",
    authorization: {
      from: "0xfrom",
      to: "0xto",
      value: "1000",
      validAfter: "0",
      validBefore: "99",
      nonce: "0xnonce",
    },
  },
} as unknown as PaymentPayload;

const requirements = {
  scheme: "exact",
  network: "eip155:84532",
  amount: "1000",
  asset: "0xusdc",
  payTo: "0xto",
  maxTimeoutSeconds: 300,
} as PaymentRequirements;

/** Records the exact payload it was asked to stamp, so tests can assert the
 *  signature is computed over the bytes that are actually sent. */
function fakeStamper(): Stamper & { stamped: string[] } {
  const stamped: string[] = [];
  return {
    stamped,
    async stamp(p: string) {
      stamped.push(p);
      return { stampHeaderName: "X-Stamp", stampHeaderValue: "stamp-of:" + p };
    },
  };
}

function mockFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async json() {
        return { isValid: true, success: true, payments: [], balances: [] };
      },
      async text() {
        return JSON.stringify({ payments: [], balances: [] });
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("createFacilitatorClient stamper mode", () => {
  it("embeds organizationId in the signed body and sends X-Stamp over those bytes", async () => {
    const stamper = fakeStamper();
    const { fn, calls } = mockFetch();
    const client = createFacilitatorClient({
      baseUrl: "https://pay.example",
      organizationId: ORG,
      stamper,
      fetch: fn,
    });

    await client.settle(payload, requirements);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe("https://pay.example/settle");
    const sentBody = init.body as string;
    // The stamp must be computed over the exact bytes that are sent.
    expect(stamper.stamped).toEqual([sentBody]);
    expect((init.headers as Record<string, string>)["X-Stamp"]).toBe(
      "stamp-of:" + sentBody,
    );
    // organizationId is embedded so the gateway can read+authorize it.
    expect(JSON.parse(sentBody).organizationId).toBe(ORG);
    // No bearer / org header in stamper mode.
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["x-0xkey-organization-id"]).toBeUndefined();
  });

  it("throws if organizationId is missing in stamper mode", async () => {
    const stamper = fakeStamper();
    const { fn } = mockFetch();
    const client = createFacilitatorClient({
      baseUrl: "https://pay.example",
      stamper,
      fetch: fn,
    });
    await expect(client.verify(payload, requirements)).rejects.toThrow(
      /organizationId is required/,
    );
  });
});

describe("createFacilitatorClient bearer mode", () => {
  it("sends Authorization + org header and no organizationId in the body", async () => {
    const { fn, calls } = mockFetch();
    const client = createFacilitatorClient({
      baseUrl: "https://facilitator.internal",
      apiKey: "internal-key",
      organizationId: ORG,
      fetch: fn,
    });

    await client.verify(payload, requirements);

    const { init } = calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer internal-key");
    expect(headers["x-0xkey-organization-id"]).toBe(ORG);
    expect(JSON.parse(init.body as string).organizationId).toBeUndefined();
  });
});

describe("createPayClient reads", () => {
  it("signs an empty body and forwards filters + cursor on list", async () => {
    const stamper = fakeStamper();
    const { fn, calls } = mockFetch();
    const pay = createPayClient({
      baseUrl: "https://pay.example",
      organizationId: ORG,
      stamper,
      fetch: fn,
    });

    await pay.payments.list({
      organizationId: ORG,
      status: "settled",
      network: "eip155:84532",
      direction: "inbound",
      address: "0xabc",
      limit: 20,
      after: "cursor-1",
    });

    const { url, init } = calls[0]!;
    expect(url).toContain(`/v1/organizations/${ORG}/payments?`);
    expect(url).toContain("status=settled");
    expect(url).toContain("network=eip155");
    expect(url).toContain("direction=inbound");
    expect(url).toContain("address=0xabc");
    expect(url).toContain("after=cursor-1");
    // GET signs the empty body; org travels in the path.
    expect(stamper.stamped).toEqual([""]);
    expect((init.headers as Record<string, string>)["X-Stamp"]).toBe(
      "stamp-of:",
    );
  });

  it("hits the gas-payer-balance endpoint", async () => {
    const stamper = fakeStamper();
    const { fn, calls } = mockFetch();
    const pay = createPayClient({
      baseUrl: "https://pay.example",
      organizationId: ORG,
      stamper,
      fetch: fn,
    });

    await pay.payments.gasPayerBalance({ organizationId: ORG });

    expect(calls[0]!.url).toBe(
      `https://pay.example/v1/organizations/${ORG}/payments/gas-payer-balance`,
    );
  });
});
