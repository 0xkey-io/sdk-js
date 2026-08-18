import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
import { Challenge, x402 } from "mppx";
import { x402Client } from "@x402/core/client";
import { x402HTTPResourceServer } from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme as ExactEvmServerScheme } from "@x402/evm/exact/server";
import { wrapFetchWithPayment } from "@x402/fetch";

import { createPayFetch } from "../dist/client/index.mjs";
import { createPayServer } from "../dist/server/index.mjs";

const [
  rootModule,
  clientModule,
  serverModule,
  adminModule,
  expressModule,
  honoModule,
  nextModule,
] = await Promise.all([
  import("../dist/index.mjs"),
  import("../dist/client/index.mjs"),
  import("../dist/server/index.mjs"),
  import("../dist/admin/index.mjs"),
  import("../dist/express/index.mjs"),
  import("../dist/hono/index.mjs"),
  import("../dist/next/index.mjs"),
]);

assert.equal(typeof clientModule.createPayFetch, "function");
assert.equal(typeof serverModule.createPayServer, "function");
assert.equal(typeof adminModule.createPayAdminClient, "function");
assert.equal(typeof expressModule.paymentMiddleware, "function");
assert.equal(typeof honoModule.paymentMiddleware, "function");
assert.equal(typeof nextModule.withPayment, "function");
assert.equal(
  "GasPayerBalanceResponse" in rootModule,
  false,
  "shared relayer balances must stay internal",
);
for (const [name, module] of Object.entries({
  root: rootModule,
  client: clientModule,
  server: serverModule,
  admin: adminModule,
  express: expressModule,
  hono: honoModule,
  next: nextModule,
})) {
  for (const removed of [
    "Pay",
    "createPayClient",
    "handlePaywallRequest",
    "paywallExpress",
    "paywallHono",
    "withPaywall",
  ]) {
    assert.equal(
      Object.hasOwn(module, removed),
      false,
      `${name} must not export removed ${removed}`,
    );
  }
  assert.equal(
    Object.keys(module).some((key) => key.toLowerCase().includes("commerce")),
    false,
    `${name} must not export Commerce`,
  );
}
assert.equal(
  Object.hasOwn(serverModule, "createFacilitatorClient"),
  false,
  "server must keep the facilitator adapter private",
);

const fixtureRoot = new URL(
  "../../api-key-stamper/src/__fixtures__/",
  import.meta.url,
);
const [publicKey, privateKey] = await Promise.all([
  readFile(new URL("api-key.public", fixtureRoot), "utf8").then((value) =>
    value.trim(),
  ),
  readFile(new URL("api-key.private", fixtureRoot), "utf8").then((value) =>
    value.trim(),
  ),
]);
const account = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);

async function testReceiptVerifier(effect) {
  assert.equal(effect.network, "eip155:84532");
  assert.equal(
    effect.asset.toLowerCase(),
    "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  );
  assert.equal(effect.authorization.from, account.address);
  assert.equal(
    effect.authorization.to,
    "0x1111111111111111111111111111111111111111",
  );
  assert.equal(effect.authorization.value, "10000");
  assert.match(effect.economicEffectId, /^eip3009:[0-9a-f]{64}$/);
  assert.ok(
    effect.transaction === `0x${"ab".repeat(32)}` ||
      effect.transaction === `0x${"cd".repeat(32)}`,
  );
  return true;
}

function createTestPendingPaymentStore() {
  const key = randomBytes(32);
  let slot;
  let lastSaved;

  function seal(record) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(record.digest));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(record), "utf8"),
      cipher.final(),
    ]);
    return {
      ciphertext,
      digest: record.digest,
      iv,
      tag: cipher.getAuthTag(),
    };
  }

  function open(value) {
    const decipher = createDecipheriv("aes-256-gcm", key, value.iv);
    decipher.setAAD(Buffer.from(value.digest));
    decipher.setAuthTag(value.tag);
    return JSON.parse(
      Buffer.concat([
        decipher.update(value.ciphertext),
        decipher.final(),
      ]).toString("utf8"),
    );
  }

  return {
    protection: "aead",
    async load() {
      return slot ? open(slot) : undefined;
    },
    async saveIfAbsent(record) {
      if (slot) return false;
      lastSaved = record;
      slot = seal(record);
      return true;
    },
    async clear(expectedDigest) {
      if (!slot || slot.digest !== expectedDigest) return false;
      slot = undefined;
      return true;
    },
    hasRecord() {
      return slot !== undefined;
    },
    lastSaved() {
      return lastSaved;
    },
  };
}

const channelMatrix = [
  {
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    chainId: 8453,
    channel: "base-mainnet",
    network: "eip155:8453",
  },
  {
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    chainId: 84532,
    channel: "base-sepolia",
    network: "eip155:84532",
  },
];

for (const selected of channelMatrix) {
  for (const protocol of ["x402", "mpp"]) {
    await assertChannelInterop(selected, protocol);
  }
}

assert.throws(
  () =>
    createPayServer({
      network: "eip155:8453",
      organizationId: "11111111-1111-1111-1111-111111111111",
      payTo: "0x1111111111111111111111111111111111111111",
      apiKey: { publicKey, privateKey },
      mppSecretKey: "01234567890123456789012345678901",
      facilitatorUrl: "https://api-pay.0xkey.io/base-sepolia",
    }),
  /PAY_FACILITATOR_ORIGIN_MISMATCH/,
);

async function assertChannelInterop(selected, protocol) {
  const facilitatorPaths = [];
  const settledNetworks = [];
  const server = createPayServer({
    network: selected.network,
    organizationId: "11111111-1111-1111-1111-111111111111",
    payTo: "0x1111111111111111111111111111111111111111",
    apiKey: { publicKey, privateKey },
    mppSecretKey: "01234567890123456789012345678901",
    async fetch(url, init) {
      const parsedUrl = new URL(String(url));
      facilitatorPaths.push(parsedUrl.pathname);
      assert.match(
        parsedUrl.pathname,
        new RegExp(`^/${selected.channel}/(?:verify|settle)$`),
      );
      const body = JSON.parse(String(init?.body));
      assert.equal(body.paymentPayload.accepted.network, selected.network);
      assert.equal(body.paymentRequirements.network, selected.network);
      assert.equal(
        body.paymentRequirements.asset.toLowerCase(),
        selected.asset.toLowerCase(),
      );
      const stamp = JSON.parse(
        Buffer.from(
          String(new Headers(init?.headers).get("X-Stamp")),
          "base64url",
        ).toString(),
      );
      assert.equal(stamp.wireProtocol, protocol);
      if (parsedUrl.pathname.endsWith("/verify")) {
        return Response.json({
          isValid: true,
          payer: body.paymentPayload.payload.authorization.from,
        });
      }
      settledNetworks.push(body.paymentRequirements.network);
      return Response.json({
        success: true,
        transaction: `0x${"ab".repeat(32)}`,
        network: body.paymentRequirements.network,
        payer: body.paymentPayload.payload.authorization.from,
        paymentId: "22222222-2222-2222-2222-222222222222",
      });
    },
  });
  const signedCredentials = [];
  async function merchantFetch(input, init) {
    const request = new Request(input, init);
    const credential =
      request.headers.get("PAYMENT-SIGNATURE") ??
      request.headers.get("Authorization");
    if (credential) signedCredentials.push(credential);
    const payment = await server.handle(request, {
      price: "$0.01",
      protocols: [protocol],
    });
    return payment.status === 200
      ? payment.withReceipt(Response.json({ matrix: true }))
      : payment.response;
  }

  const unsigned = await merchantFetch("https://matrix.example/weather");
  assert.equal(unsigned.status, 402);
  if (protocol === "x402") {
    assert.equal(unsigned.headers.has("WWW-Authenticate"), false);
    const challenge = x402.Header.decodePaymentRequired(
      unsigned.headers.get("PAYMENT-REQUIRED"),
    );
    const accepted = challenge.accepts[0];
    assert.equal(accepted.network, selected.network);
    assert.equal(accepted.asset.toLowerCase(), selected.asset.toLowerCase());
  } else {
    assert.equal(unsigned.headers.has("PAYMENT-REQUIRED"), false);
    const challenge = Challenge.fromResponse(unsigned.clone());
    assert.equal(challenge.method, "evm");
    assert.equal(challenge.intent, "charge");
    assert.equal(
      `eip155:${challenge.request.methodDetails.chainId}`,
      selected.network,
    );
    assert.equal(
      challenge.request.currency.toLowerCase(),
      selected.asset.toLowerCase(),
    );
  }

  const receipts = [];
  const store = createTestPendingPaymentStore();
  const buyer = createPayFetch({
    account,
    allowHosts: ["matrix.example"],
    network: selected.network,
    maxAmount: "$0.10",
    protocolPreference: [protocol],
    pendingPaymentStore: store,
    receiptVerifier: async (effect) => {
      assert.equal(effect.network, selected.network);
      assert.equal(effect.asset.toLowerCase(), selected.asset.toLowerCase());
      return true;
    },
    fetch: merchantFetch,
    onReceipt(receipt) {
      receipts.push(receipt);
    },
  });
  const response = await buyer("https://matrix.example/weather");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { matrix: true });
  assert.deepEqual(facilitatorPaths, [
    `/${selected.channel}/verify`,
    `/${selected.channel}/settle`,
  ]);
  assert.deepEqual(settledNetworks, [selected.network]);
  assert.equal(signedCredentials.length, 1);
  assert.equal(store.lastSaved().payment.network, selected.network);
  assert.equal(receipts[0].protocol, protocol);
  if (receipts[0].network !== undefined) {
    assert.equal(receipts[0].network, selected.network);
  }
}

const seenWireProtocols = [];
const server = createPayServer({
  network: "eip155:84532",
  organizationId: "11111111-1111-1111-1111-111111111111",
  payTo: "0x1111111111111111111111111111111111111111",
  apiKey: { publicKey, privateKey },
  mppSecretKey: "01234567890123456789012345678901",
  async fetch(url, init) {
    const body = JSON.parse(String(init?.body));
    const stamp = JSON.parse(
      Buffer.from(
        String(new Headers(init?.headers).get("X-Stamp")),
        "base64url",
      ).toString(),
    );
    seenWireProtocols.push(stamp.wireProtocol);
    if (String(url).endsWith("/verify")) {
      return Response.json({
        isValid: true,
        payer: body.paymentPayload.payload.authorization.from,
      });
    }
    return Response.json({
      success: true,
      transaction: `0x${"ab".repeat(32)}`,
      network: body.paymentRequirements.network,
      payer: body.paymentPayload.payload.authorization.from,
      paymentId: "22222222-2222-2222-2222-222222222222",
    });
  },
});

async function merchantFetch(input, init) {
  const request = new Request(input, init);
  const payment = await server.handle(request, {
    price: "$0.01",
    protocols: ["x402", "mpp"],
  });
  if (payment.status !== 200) return payment.response;
  return payment.withReceipt(Response.json({ weather: "sunny" }));
}

async function pay(preference) {
  const receipts = [];
  const pendingPaymentStore = createTestPendingPaymentStore();
  const payFetch = createPayFetch({
    account,
    allowHosts: ["merchant.example"],
    network: "eip155:84532",
    maxAmount: "$0.10",
    protocolPreference: preference,
    pendingPaymentStore,
    receiptVerifier: testReceiptVerifier,
    fetch: merchantFetch,
    onReceipt(receipt) {
      receipts.push(receipt);
    },
  });
  const response = await payFetch("https://merchant.example/weather");
  if (response.status !== 200) {
    throw new Error(
      `pay failed for ${preference.join(",")}: ${response.status} ${await response.text()}`,
    );
  }
  assert.deepEqual(await response.json(), { weather: "sunny" });
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].protocol, preference[0]);
  assert.equal(pendingPaymentStore.hasRecord(), false);
}

await pay(["x402", "mpp"]);
await pay(["mpp", "x402"]);
await pay(["x402"]);
await pay(["mpp"]);

assert.throws(
  () =>
    createPayFetch({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0",
      network: "eip155:84532",
      allowInMemoryPendingPayment: true,
    }),
  /greater than zero/,
);

const redirectFetch = createPayFetch({
  account,
  allowHosts: ["merchant.example"],
  network: "eip155:84532",
  maxAmount: "$0.10",
  fetch: async () =>
    new Response(null, {
      status: 302,
      headers: { Location: "https://evil.example/paid" },
    }),
  allowInMemoryPendingPayment: true,
});
await assert.rejects(
  redirectFetch("https://merchant.example/weather"),
  /PAY_REDIRECT_DENIED: evil\.example/,
);

const unknownPaymentId = "33333333-3333-3333-3333-333333333333";
const unknownServer = createPayServer({
  network: "eip155:84532",
  organizationId: "11111111-1111-1111-1111-111111111111",
  payTo: "0x1111111111111111111111111111111111111111",
  apiKey: { publicKey, privateKey },
  mppSecretKey: "01234567890123456789012345678901",
  async fetch(url, init) {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/verify")) {
      return Response.json({
        isValid: true,
        payer: body.paymentPayload.payload.authorization.from,
      });
    }
    return Response.json(
      {
        success: false,
        errorReason: "PAYMENT_STATUS_UNKNOWN",
        paymentId: unknownPaymentId,
        transaction: `0x${"ef".repeat(32)}`,
      },
      { status: 503 },
    );
  },
});
async function unknownMerchantFetch(input, init) {
  const request = new Request(input, init);
  const credential =
    request.headers.get("PAYMENT-SIGNATURE") ??
    request.headers.get("Authorization");
  if (credential) seenUnknownCredentials.push(credential);
  const payment = await unknownServer.handle(request, {
    price: "$0.01",
    protocols: ["mpp"],
  });
  return payment.status === 200
    ? payment.withReceipt(Response.json({ shouldNotRun: true }))
    : payment.response;
}
const seenUnknownCredentials = [];
const unknownPendingPaymentStore = createTestPendingPaymentStore();
const unknownBuyer = createPayFetch({
  account,
  allowHosts: ["unknown.example"],
  network: "eip155:84532",
  maxAmount: "$0.10",
  protocolPreference: ["mpp"],
  fetch: unknownMerchantFetch,
  pendingPaymentStore: unknownPendingPaymentStore,
});
const unknownResponse = await unknownBuyer("https://unknown.example/weather");
assert.equal(unknownResponse.status, 503);
assert.equal(unknownResponse.headers.get("Retry-After"), "2");
assert.equal((await unknownResponse.json()).paymentId, unknownPaymentId);
assert.equal(unknownBuyer.hasPendingPayment(), true);
await assert.rejects(
  unknownBuyer("https://unknown.example/weather"),
  /PAYMENT_RESUME_REQUIRED/,
);
const resumedUnknown = await unknownBuyer.resume();
assert.equal(resumedUnknown.status, 503);
assert.equal((await resumedUnknown.json()).paymentId, unknownPaymentId);

// Export the signed request, restore it in a new SDK instance, and retry it
// without asking the wallet for another signature.
const pendingPayment = JSON.parse(
  JSON.stringify(await unknownBuyer.exportPendingPayment()),
);
assert.equal(pendingPayment.version, 3);
assert.equal(pendingPayment.network, "eip155:84532");
assert.equal(unknownPendingPaymentStore.hasRecord(), true);
const resumeOnlyAccount = {
  ...account,
  async signTypedData() {
    throw new Error("restoring a pending payment must not sign again");
  },
};
const restoredBuyer = createPayFetch({
  account: resumeOnlyAccount,
  allowHosts: ["unknown.example"],
  network: "eip155:84532",
  maxAmount: "$0.10",
  protocolPreference: ["mpp"],
  fetch: unknownMerchantFetch,
  pendingPaymentStore: unknownPendingPaymentStore,
});
assert.equal(restoredBuyer.hasPendingPayment(), false);
await assert.rejects(
  restoredBuyer("https://unknown.example/weather"),
  /PAYMENT_RESUME_REQUIRED/,
);
assert.equal(restoredBuyer.hasPendingPayment(), true);
const restoredUnknown = await restoredBuyer.resume();
assert.equal(restoredUnknown.status, 503);
assert.equal((await restoredUnknown.json()).paymentId, unknownPaymentId);
assert.equal(seenUnknownCredentials.length, 3);
assert.equal(new Set(seenUnknownCredentials).size, 1);
assert.deepEqual(await restoredBuyer.exportPendingPayment(), pendingPayment);

// Official x402 buyer -> 0xkey seller.
const officialBuyer = new x402Client().register(
  "eip155:84532",
  new ExactEvmScheme(toClientEvmSigner(account)),
);
const officialPayFetch = wrapFetchWithPayment(merchantFetch, officialBuyer);
const officialBuyerResponse = await officialPayFetch(
  "https://merchant.example/weather",
);
assert.equal(officialBuyerResponse.status, 200);
assert.ok(officialBuyerResponse.headers.has("PAYMENT-RESPONSE"));

// 0xkey buyer -> official x402 resource server.
const officialFacilitator = {
  async getSupported() {
    return {
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
      extensions: [],
      signers: {},
    };
  },
  async verify(payload) {
    return { isValid: true, payer: payload.payload.authorization.from };
  },
  async settle(payload, requirements) {
    return {
      success: true,
      transaction: `0x${"cd".repeat(32)}`,
      network: requirements.network,
      payer: payload.payload.authorization.from,
    };
  },
};
const officialResource = new x402ResourceServer(officialFacilitator).register(
  "eip155:84532",
  new ExactEvmServerScheme(),
);
const officialHttp = new x402HTTPResourceServer(officialResource, {
  "GET /weather": {
    accepts: {
      scheme: "exact",
      network: "eip155:84532",
      payTo: "0x1111111111111111111111111111111111111111",
      price: "$0.01",
    },
    mimeType: "application/json",
  },
});
await officialHttp.initialize();

async function officialSellerFetch(input, init) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const adapter = {
    getHeader(name) {
      return request.headers.get(name) ?? undefined;
    },
    getMethod() {
      return request.method;
    },
    getPath() {
      return url.pathname;
    },
    getUrl() {
      return request.url;
    },
    getAcceptHeader() {
      return request.headers.get("Accept") ?? "application/json";
    },
    getUserAgent() {
      return request.headers.get("User-Agent") ?? "0xkey-interop";
    },
  };
  const paymentHeader = request.headers.get("PAYMENT-SIGNATURE") ?? undefined;
  const result = await officialHttp.processHTTPRequest({
    adapter,
    path: url.pathname,
    method: request.method,
    ...(paymentHeader ? { paymentHeader } : {}),
  });
  if (result.type === "payment-error") {
    return Response.json(result.response.body ?? {}, {
      status: result.response.status,
      headers: result.response.headers,
    });
  }
  if (result.type !== "payment-verified") {
    return Response.json({ weather: "sunny" });
  }
  const settlement = await officialHttp.processSettlement(
    result.paymentPayload,
    result.paymentRequirements,
    result.declaredExtensions,
    undefined,
    undefined,
    result.beforeHandlerSettlement,
  );
  assert.equal(settlement.success, true);
  return Response.json({ weather: "sunny" }, { headers: settlement.headers });
}

const oxkeyBuyer = createPayFetch({
  account,
  allowHosts: ["official.example"],
  network: "eip155:84532",
  maxAmount: "$0.10",
  protocolPreference: ["x402", "mpp"],
  fetch: officialSellerFetch,
  pendingPaymentStore: createTestPendingPaymentStore(),
  receiptVerifier: testReceiptVerifier,
});
const officialSellerResponse = await oxkeyBuyer(
  "https://official.example/weather",
);
assert.equal(officialSellerResponse.status, 200);
assert.ok(officialSellerResponse.headers.has("PAYMENT-RESPONSE"));
const officialSellerReceipt = JSON.parse(
  Buffer.from(
    officialSellerResponse.headers.get("PAYMENT-RESPONSE"),
    "base64url",
  ).toString("utf8"),
);
assert.equal(
  Object.hasOwn(officialSellerReceipt, "extra"),
  false,
  "ordinary official x402 seller interop must not depend on 0xkey receipt data",
);

assert.deepEqual(seenWireProtocols, [
  "x402",
  "x402",
  "mpp",
  "mpp",
  "x402",
  "x402",
  "mpp",
  "mpp",
  "x402",
  "x402",
]);
console.log("pay interop smoke: official x402 + mppx x402/MPP passed");
