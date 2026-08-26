import assert from "node:assert/strict";
import test from "node:test";
import { Challenge, x402 } from "mppx";
import { createPayClient } from "../dist/index.mjs";

const address = "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c";
const baseSepoliaUsdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const payTo = "0x1111111111111111111111111111111111111111";

function recovery() {
  let record;
  return {
    protection: "aead",
    async load() {
      return record;
    },
    async saveIfAbsent(next) {
      if (record) return false;
      record = next;
      return true;
    },
    async clear(expectedDigest) {
      if (record?.digest !== expectedDigest) return false;
      record = undefined;
      return true;
    },
  };
}

function clientFor(response) {
  let fetchCalls = 0;
  let signCalls = 0;
  const client = createPayClient({
    account: {
      address,
      async signTypedData() {
        signCalls += 1;
        throw new Error("policy rejection must happen before signing");
      },
    },
    network: "eip155:84532",
    policy: {
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
    },
    recovery: recovery(),
    verification: { verifier: async () => true },
    async fetch() {
      fetchCalls += 1;
      return response.clone();
    },
  });
  return {
    client,
    counts: () => ({ fetchCalls, signCalls }),
  };
}

function x402Response(overrides = {}) {
  return new Response(null, {
    status: 402,
    headers: {
      "PAYMENT-REQUIRED": x402.Header.encodePaymentRequired({
        x402Version: 2,
        resource: { url: "https://merchant.example/weather" },
        accepts: [
          {
            scheme: "exact",
            network: overrides.network ?? "eip155:84532",
            asset: overrides.asset ?? baseSepoliaUsdc,
            amount: overrides.amount ?? "10000",
            payTo: overrides.payTo ?? payTo,
            maxTimeoutSeconds: 60,
            extra: overrides.extra ?? {
              name: "USDC",
              version: "2",
              assetTransferMethod: "eip3009",
            },
          },
        ],
      }),
    },
  });
}

function mppResponse(overrides = {}) {
  const challenge = Challenge.from({
    id: "challenge-1",
    realm: "merchant.example",
    method: "evm",
    intent: "charge",
    request: {
      amount: overrides.amount ?? "10000",
      currency: overrides.currency ?? baseSepoliaUsdc,
      recipient: payTo,
      methodDetails: { chainId: overrides.chainId ?? 84532 },
    },
  });
  return new Response(null, {
    status: 402,
    headers: { "WWW-Authenticate": Challenge.serialize(challenge) },
  });
}

async function expectBoundaryError(response, code) {
  const { client, counts } = clientFor(response);
  await assert.rejects(
    client.fetch("https://merchant.example/weather"),
    (error) =>
      error?.code === code &&
      error?.retryable === false &&
      error?.phase ===
        (code === "PAYMENT_POLICY_DENIED" ? "policy" : "challenge"),
  );
  assert.deepEqual(counts(), { fetchCalls: 1, signCalls: 0 });
}

test("bare unsupported 402 is a nonretryable unsupported offer", async () => {
  await expectBoundaryError(
    new Response(null, { status: 402 }),
    "PAYMENT_OFFER_UNSUPPORTED",
  );
});

test("valid x402 delegates through the guarded save-before-send boundary", async () => {
  let saved;
  let calls = 0;
  const client = createPayClient({
    account: {
      address,
      async signTypedData() {
        return `0x${"11".repeat(65)}`;
      },
    },
    network: "eip155:84532",
    policy: {
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      preference: ["x402"],
    },
    recovery: {
      protection: "aead",
      async load() {
        return saved;
      },
      async saveIfAbsent(record) {
        saved = record;
        return true;
      },
      async clear() {
        return false;
      },
    },
    verification: { verifier: async () => true },
    async fetch(input) {
      calls += 1;
      const request = new Request(input);
      if (calls === 1) {
        assert.equal(request.headers.get("Accept-Payment"), "evm/charge");
        return x402Response();
      }
      assert.ok(request.headers.has("PAYMENT-SIGNATURE"));
      assert.ok(saved, "signed credential must be durable before transport");
      return new Response(null, { status: 401 });
    },
  });

  const response = await client.fetch("https://merchant.example/weather");
  assert.equal(response.status, 401);
  assert.equal(calls, 2);
  assert.ok(saved);
});

for (const [name, response] of [
  [
    "MPP",
    new Response(null, {
      status: 402,
      headers: { "WWW-Authenticate": "Payment definitely-not-valid" },
    }),
  ],
  [
    "x402",
    new Response(null, {
      status: 402,
      headers: { "PAYMENT-REQUIRED": "definitely-not-base64-json" },
    }),
  ],
  [
    "x402 EIP-3009 domain",
    x402Response({ extra: { assetTransferMethod: "eip3009" } }),
  ],
  ["x402 recipient", x402Response({ payTo: "not-an-address" })],
]) {
  test(`malformed ${name} header is a nonretryable invalid challenge`, async () => {
    await expectBoundaryError(response, "PAYMENT_CHALLENGE_INVALID");
  });
}

for (const [name, response] of [
  ["MPP amount", mppResponse({ amount: "100001" })],
  [
    "MPP asset",
    mppResponse({ currency: "0x2222222222222222222222222222222222222222" }),
  ],
  ["MPP network", mppResponse({ chainId: 8453 })],
  ["x402 amount", x402Response({ amount: "100001" })],
  [
    "x402 asset",
    x402Response({ asset: "0x2222222222222222222222222222222222222222" }),
  ],
  ["x402 network", x402Response({ network: "eip155:8453" })],
]) {
  test(`valid ${name} challenge rejected by policy is nonretryable`, async () => {
    await expectBoundaryError(response, "PAYMENT_POLICY_DENIED");
  });
}
