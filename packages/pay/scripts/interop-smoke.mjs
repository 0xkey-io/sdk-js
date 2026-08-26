import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment } from "@x402/fetch";

import { createPayClient } from "../dist/client/index.mjs";
import { createPayServer } from "../dist/server/index.mjs";

const modules = await Promise.all([
  import("../dist/index.mjs"),
  import("../dist/client/index.mjs"),
  import("../dist/server/index.mjs"),
  import("../dist/x402/index.mjs"),
  import("../dist/mpp/index.mjs"),
  import("../dist/admin/index.mjs"),
  import("../dist/express/index.mjs"),
  import("../dist/hono/index.mjs"),
  import("../dist/next/index.mjs"),
]);
assert.equal(typeof modules[1].createPayClient, "function");
assert.equal(typeof modules[2].createPayServer, "function");
assert.equal(typeof modules[3].create0xkeyFacilitatorClient, "function");
assert.equal(typeof modules[4].create0xkeyEvmChargeMethod, "function");

const fixtureRoot = new URL("../../api-key-stamper/src/__fixtures__/", import.meta.url);
const [publicKey, privateKey] = await Promise.all([
  readFile(new URL("api-key.public", fixtureRoot), "utf8").then((value) => value.trim()),
  readFile(new URL("api-key.private", fixtureRoot), "utf8").then((value) => value.trim()),
]);
const apiKey = { publicKey, privateKey };
const account = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);
const organizationId = "11111111-1111-4111-8111-111111111111";
const payTo = "0x1111111111111111111111111111111111111111";
const matrix = [
  {
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    channel: "base-mainnet",
    network: "eip155:8453",
  },
  {
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    channel: "base-sepolia",
    network: "eip155:84532",
  },
];

for (const selected of matrix) {
  for (const protocol of ["x402", "mpp"]) await assertInterop(selected, protocol);
}

async function assertInterop(selected, protocol) {
  const transaction = `0x${(protocol === "x402" ? "ab" : "cd").repeat(32)}`;
  const paymentId = protocol === "x402"
    ? "22222222-2222-4222-8222-222222222222"
    : "33333333-3333-4333-8333-333333333333";
  const events = [];
  const wireProtocols = [];
  const server = createPayServer({
    network: selected.network,
    organizationId,
    payTo,
    apiKey,
    protocols: [protocol],
    ...(protocol === "mpp"
      ? { mppSecretKey: "01234567890123456789012345678901" }
      : {}),
    facilitatorUrl: "https://api-pay.staging.0xkey.io",
    async fetch(url, init) {
      const parsed = new URL(String(url));
      assert.ok(parsed.pathname.startsWith(`/${selected.channel}/`));
      const stamp = new Headers(init?.headers).get("X-Stamp");
      assert.ok(stamp);
      wireProtocols.push(JSON.parse(Buffer.from(stamp, "base64url").toString()).wireProtocol);
      if (parsed.pathname.endsWith("/supported")) {
        return Response.json({
          kinds: [{ x402Version: 2, scheme: "exact", network: selected.network }],
          extensions: [],
          signers: {},
        });
      }
      const body = JSON.parse(String(init?.body));
      assert.equal(body.organizationId, organizationId);
      if (parsed.pathname.endsWith("/verify")) {
        events.push("verify");
        assert.equal(body.paymentRequirements.network, selected.network);
        assert.equal(body.paymentRequirements.asset.toLowerCase(), selected.asset.toLowerCase());
        return Response.json({
          isValid: true,
          payer: body.paymentPayload.payload.authorization.from,
        });
      }
      if (parsed.pathname.endsWith("/settle")) {
        events.push("settle");
        if (protocol === "mpp") {
          assert.equal(body.command.network, selected.network);
          assert.equal(body.command.asset.toLowerCase(), selected.asset.toLowerCase());
          assert.equal(body.command.protocolId, "mpp-evm-charge-v0");
          return Response.json({ success: true, transaction, paymentId });
        }
        assert.equal(body.paymentRequirements.network, selected.network);
        return Response.json({
          settlement: {
            success: true,
            transaction,
            network: selected.network,
            payer: body.paymentPayload.payload.authorization.from,
          },
          paymentId,
        });
      }
      if (parsed.pathname.endsWith(`/v1/payments/${paymentId}/fulfillment`)) {
        events.push("fulfillment");
        assert.equal(body.state, "FULFILLED");
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected Pay URL ${url}`);
    },
  });
  const route = server.protect({ price: "$0.01" }, ({ paymentId: id, protocol: used }) => {
    events.push("handler");
    assert.equal(id, paymentId);
    assert.equal(used, protocol);
    return Response.json({ matrix: true });
  });
  const merchantFetch = (input, init) => route(new Request(input, init));
  const store = durableTestStore();
  const buyer = createPayClient({
    account,
    network: selected.network,
    policy: {
      allowHosts: ["matrix.example"],
      maxAmount: "$0.10",
      preference: [protocol],
    },
    recovery: store,
    verification: { verifier: async () => true },
    fetch: merchantFetch,
  });
  const response = await buyer.fetch("https://matrix.example/weather");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { matrix: true });
  assert.equal(store.hasPending(), false);
  assert.deepEqual(events, protocol === "x402"
    ? ["verify", "settle", "handler", "fulfillment"]
    : ["settle", "handler", "fulfillment"]);
  assert.ok(wireProtocols.every((value) => value === protocol));
  assert.ok(response.headers.has(protocol === "x402" ? "PAYMENT-RESPONSE" : "Payment-Receipt"));

  if (protocol === "x402" && selected.network === "eip155:84532") {
    const officialBuyer = new x402Client().register(
      selected.network,
      new ExactEvmScheme(toClientEvmSigner(account)),
    );
    const officialResponse = await wrapFetchWithPayment(merchantFetch, officialBuyer)(
      "https://matrix.example/weather",
    );
    assert.equal(officialResponse.status, 200);
    assert.ok(officialResponse.headers.has("PAYMENT-RESPONSE"));
  }
}

function durableTestStore() {
  let record;
  return {
    protection: "aead",
    async load() { return record; },
    async saveIfAbsent(value) {
      if (record) return false;
      record = value;
      return true;
    },
    async clear(digest) {
      if (record?.digest !== digest) return false;
      record = undefined;
      return true;
    },
    hasPending() { return record !== undefined; },
  };
}

console.log("pay interop smoke: official x402 + native MPP across Base networks passed");
