import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Optional exact installed-consumer entry permits the same tests before and
// after a repair without rebuilding or substituting the old checked artifact.
const entry =
  process.argv[2] ??
  new URL("../dist/client/index.mjs", import.meta.url).pathname;
const require = createRequire(entry);
const { createPayClient } = await import(pathToFileURL(entry).href);
const { Challenge, Credential, x402 } = await import(
  pathToFileURL(require.resolve("mppx")).href
);
const { privateKeyToAccount } = await import(
  pathToFileURL(require.resolve("viem/accounts")).href
);
const account = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);
const url = "https://merchant.example/paid?item=one";
const currency = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const recipient = "0x1111111111111111111111111111111111111111";

function offer(realm, id = "parser-control-id") {
  // These are parser/selection controls, not genuine server-HMAC evidence.
  const challenge = Challenge.from({
    id,
    realm,
    method: "evm",
    intent: "charge",
    request: {
      amount: "10000",
      currency,
      recipient,
      methodDetails: { chainId: 84532, credentialTypes: ["authorization"] },
    },
  });
  return { challenge, header: Challenge.serialize(challenge) };
}
function x402Header() {
  return x402.Header.encodePaymentRequired({
    x402Version: 2,
    resource: { url },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        asset: currency,
        amount: "10000",
        payTo: recipient,
        maxTimeoutSeconds: 60,
        extra: { name: "USDC", version: "2", assetTransferMethod: "eip3009" },
      },
    ],
  });
}
function harness(headers, preference = ["mpp"]) {
  const requests = [],
    events = [];
  let saved;
  const recovery = {
    protection: "aead",
    async load() {
      return saved;
    },
    async saveIfAbsent(record) {
      events.push("save");
      if (saved) return false;
      saved = structuredClone(record);
      return true;
    },
    async clear() {
      throw new Error("No proof: clear forbidden");
    },
  };
  // In-process store is deliberately only a focused boundary double. Genuine
  // crash recovery and authenticated persistence run in separate native roles.
  const client = createPayClient({
    account: {
      address: account.address,
      async signTypedData(...args) {
        events.push("sign");
        return account.signTypedData(...args);
      },
    },
    network: "eip155:84532",
    policy: {
      allowHosts: ["merchant.example"],
      maxAmount: "$0.01",
      preference,
    },
    recovery,
    verification: {
      verifier: async () => {
        throw new Error("No receipt: verification forbidden");
      },
    },
    async fetch(input, init) {
      const request = new Request(input, init);
      requests.push(request.clone());
      if (requests.length === 1)
        return new Response(null, { status: 402, headers });
      events.push("send");
      assert.ok(saved);
      return new Response(null, { status: 401 });
    },
  });
  return { client, requests, events, recovery, saved: () => saved };
}

for (const realm of ["merchant.example", "x402", "billing", "Billing"]) {
  test(`native parser offer preserves realm ${realm} and signed request`, async () => {
    const native = offer(realm),
      h = harness({ "WWW-Authenticate": native.header });
    const controller = new AbortController();
    const request = new Request(url, {
      method: "POST",
      body: "original-request-body",
      signal: controller.signal,
      headers: {
        Authorization: "Bearer unrelated-initial-auth",
        "X-Request-Id": "request-one",
        "Content-Type": "text/plain",
        "PAYMENT-REQUIRED": "stale-required",
        "PAYMENT-RESPONSE": "stale-response",
      },
    });
    assert.equal((await h.client.fetch(request)).status, 401);
    assert.deepEqual(h.events, ["sign", "save", "send"]);
    const sent = h.requests[1];
    assert.equal(sent.url, url);
    assert.equal(sent.method, "POST");
    assert.equal(await sent.clone().text(), "original-request-body");
    assert.equal(sent.headers.get("X-Request-Id"), "request-one");
    for (const name of [
      "PAYMENT-REQUIRED",
      "PAYMENT-RESPONSE",
      "PAYMENT-SIGNATURE",
    ])
      assert.equal(sent.headers.has(name), false);
    const credential = Credential.deserialize(
      sent.headers.get("Authorization"),
    );
    assert.deepEqual(credential.challenge, native.challenge);
    assert.equal(
      h.saved().payment.headers.find(([key]) => key === "authorization")[1],
      sent.headers.get("Authorization"),
    );
    assert.equal(h.saved().payment.protocolId, "mpp-evm-charge-v0");
    assert.equal(h.saved().payment.adapterRevision, "pay-client-v1");
    controller.abort();
    assert.equal(sent.signal.aborted, true);
    assert.equal((await h.client.pending()).protocol, "mpp");
  });
}
test("x402-prefixed native id is a parser control, not a protocol brand", async () => {
  const h = harness({
    "WWW-Authenticate": offer("merchant.example", "x402:parser-only").header,
  });
  await h.client.fetch(url);
  assert.deepEqual(h.events, ["sign", "save", "send"]);
  assert.equal(h.requests[1].headers.has("Authorization"), true);
  assert.equal(h.requests[1].headers.has("PAYMENT-SIGNATURE"), false);
});
for (const preference of [
  ["mpp", "x402"],
  ["x402", "mpp"],
]) {
  test(`independent dual wire decoders select ${preference[0]} despite coincident realm`, async () => {
    const h = harness(
      {
        "WWW-Authenticate": offer("x402").header,
        "PAYMENT-REQUIRED": x402Header(),
      },
      preference,
    );
    await h.client.fetch(url);
    assert.deepEqual(h.events, ["sign", "save", "send"]);
    assert.equal(
      h.requests[1].headers.has("Authorization"),
      preference[0] === "mpp",
    );
    assert.equal(
      h.requests[1].headers.has("PAYMENT-SIGNATURE"),
      preference[0] === "x402",
    );
    assert.equal((await h.client.pending()).protocol, preference[0]);
  });
}
test("x402-only offer under MPP-only preference cannot enter the bridge", async () => {
  const h = harness({ "PAYMENT-REQUIRED": x402Header() });
  await assert.rejects(h.client.fetch(url), {
    code: "PAYMENT_OFFER_UNSUPPORTED",
    phase: "challenge",
    retryable: false,
  });
  assert.deepEqual(h.events, []);
  assert.equal(h.requests.length, 1);
  assert.equal(await h.client.pending(), undefined);
});
