// Public packed-module ownership regression. Arguments name installed package
// contexts, never product source aliases. Transport is deliberately in-memory;
// framework/TLS/recovery tests are separate evidence.
import assert from "node:assert/strict";
import { publicModule } from "./x402-boundary-runtime.mjs";

const [payApp, consumerApp, producerCondition, consumerCondition, mode = "configured", expected = "safe"] = process.argv.slice(2);
assert.ok(payApp && consumerApp);
const inventory = [];
let egress = 0;
globalThis.fetch = async () => { egress++; throw new Error("unexpected egress"); };
const sdk = await publicModule(payApp, "@0xkey-io/pay/x402", producerCondition, inventory);
const producerCore = await publicModule(payApp, "@x402/core/server", producerCondition, inventory);
const core = await publicModule(consumerApp, "@x402/core/server", consumerCondition, inventory);
const codec = await publicModule(consumerApp, "@x402/core/http", consumerCondition, inventory);
const evm = await publicModule(consumerApp, "@x402/evm/exact/server", consumerCondition, inventory);
let owner = core.FacilitatorResponseError;
if (mode === "wrong-subpath") owner = codec.FacilitatorResponseError;
if (mode === "wrong-producer") owner = producerCore.FacilitatorResponseError;
if (mode === "plain-error") owner = Error;
const network = "eip155:84532";
const requirements = { scheme: "exact", network, amount: "10000", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", payTo: "0x1111111111111111111111111111111111111111", maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2", assetTransferMethod: "eip3009", paymentFlow: "upfront" } };
const payload = { x402Version: 2, accepted: requirements, payload: { signature: "0x" + "11".repeat(65), authorization: { from: "0x2222222222222222222222222222222222222222", to: requirements.payTo, value: "10000", validAfter: "0", validBefore: "9999999999", nonce: "0x" + "22".repeat(32) } } };
const initial = JSON.stringify({ payload, requirements });
const counts = { supported: 0, verify: 0, settle: 0, stamp: 0 };
const client = sdk.create0xkeyFacilitatorClient({ network, organizationId: "11111111-1111-4111-8111-111111111111", facilitatorUrl: "https://fixture.invalid", ...(mode === "omitted" ? {} : { facilitatorResponseError: owner }),
  stamper: { async stampRequest() { counts.stamp++; return { stampHeaderName: "X-Stamp", stampHeaderValue: "synthetic" }; } },
  async fetch(input, init) {
    const url = new URL(input); assert.equal(url.origin, "https://fixture.invalid"); assert.equal(init.redirect, "error");
    const operation = url.pathname.slice(1); assert.ok(operation in counts); counts[operation]++;
    if (operation === "supported") return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network }], extensions: [], signers: {} });
    assert.ok(JSON.stringify(JSON.parse(init.body)) === JSON.stringify({ organizationId: "11111111-1111-4111-8111-111111111111", x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }), "private-envelope");
    return Response.json({ errorCode: "PAYMENT_STATUS_UNKNOWN", retryable: true }, { status: 503 });
  },
});
const exact = new evm.ExactEvmScheme();
const scheme = { scheme: exact.scheme, defaultAssetTransferMethod: exact.defaultAssetTransferMethod, paymentFlows: { eip3009: { supported: ["upfront"], default: "upfront" } }, parsePrice: exact.parsePrice.bind(exact), enhancePaymentRequirements: exact.enhancePaymentRequirements.bind(exact), getAssetDecimals: exact.getAssetDecimals.bind(exact) };
const route = { "GET /paid": { accepts: { scheme: "exact", network, payTo: requirements.payTo, price: "$0.01", extra: { assetTransferMethod: "eip3009", paymentFlow: "upfront" } } } };
assert.throws(() => new core.x402HTTPResourceServer(new core.x402ResourceServer(client).register(network, exact), route), error => error.errors[0].reason === "unsupported_payment_flow");
const http = new core.x402HTTPResourceServer(new core.x402ResourceServer(client).register(network, scheme), route);
await http.initialize();
const request = new Request("https://fixture.invalid/paid", { headers: { "PAYMENT-SIGNATURE": codec.encodePaymentSignatureHeader(payload) } });
let outcome;
try {
  const result = await http.processHTTPRequest({ path: "/paid", method: "GET", adapter: { getHeader: name => request.headers.get(name) ?? undefined, getMethod: () => "GET", getPath: () => "/paid", getUrl: () => request.url, getAcceptHeader: () => "", getUserAgent: () => "" } });
  outcome = { type: "returned", status: result.response?.status, kind: result.type, hasChallenge: !!result.response?.headers?.["PAYMENT-REQUIRED"] };
  assert.equal(result.type, "payment-error"); assert.equal(result.response.status, 402);
  assert.equal(codec.decodePaymentResponseHeader(result.response.headers["PAYMENT-RESPONSE"]).success, false);
} catch (error) {
  if (!(error instanceof core.FacilitatorResponseError)) throw error;
  assert.equal(error.cause.code, "PAYMENT_STATUS_UNKNOWN");
  assert.equal(Object.getOwnPropertyDescriptor(error, "cause").enumerable, false);
  outcome = { type: "thrown", consumerOwned: true, code: error.cause.code };
}
assert.deepEqual(counts, { supported: 1, verify: 0, settle: 1, stamp: 2 });
assert.equal(JSON.stringify({ payload, requirements }), initial); assert.equal(egress, 0);
console.log(JSON.stringify({ inventory, mode, producerCondition, consumerCondition, sameOwner: producerCore.FacilitatorResponseError === core.FacilitatorResponseError, outcome, counts, egress, scope: "actual public request processing; unsigned in-memory transport" }));
assert.equal(outcome.type, expected === "safe" ? "thrown" : "returned", "consumer error must survive actual official request processing");

// Exercise each directly injected method separately. Request processing above
// is upfront-only and intentionally never calls verify.
const boundaryOwner = mode === "omitted" ? producerCore.FacilitatorResponseError : owner;
const matrix = [];
for (const operation of ["getSupported", "verify", "settle"]) {
  for (const fault of ["503", "disconnect", "timeout", "malformed-json", "malformed-shape", ...(operation === "settle" ? ["unknown"] : [])]) {
    let calls = 0, stamps = 0;
    const tested = sdk.create0xkeyFacilitatorClient({ network, organizationId: "11111111-1111-4111-8111-111111111111", facilitatorUrl: "https://fixture.invalid", timeoutMs: 10,
      ...(mode === "omitted" ? {} : { facilitatorResponseError: owner }),
      stamper: { async stampRequest() { stamps++; return { stampHeaderName: "X-Stamp", stampHeaderValue: "synthetic" }; } },
      async fetch(input, init) {
        calls++; assert.equal(new URL(input).pathname, operation === "getSupported" ? "/supported" : "/" + operation);
        if (operation !== "getSupported") assert.ok(JSON.stringify(JSON.parse(init.body)) === JSON.stringify({ organizationId: "11111111-1111-4111-8111-111111111111", x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }), "unchanged private envelope");
        if (fault === "disconnect") throw new Error("private-disconnect-sentinel");
        if (fault === "timeout") return new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error("fixture-timeout-bound")), 1000);
          init.signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("private-timeout-sentinel")); }, { once: true });
        });
        if (fault === "malformed-json") return new Response("private-invalid-json-sentinel", { status: 200 });
        if (fault === "malformed-shape") return Response.json({ private: "shape-sentinel" });
        return Response.json(fault === "unknown" ? { errorCode: "PAYMENT_STATUS_UNKNOWN", retryable: true } : {}, { status: 503 });
      },
    });
    let captured;
    try { await (operation === "getSupported" ? tested.getSupported() : tested[operation](payload, requirements)); } catch (error) { captured = error; }
    assert.ok(captured instanceof boundaryOwner, "chosen boundary owner");
    assert.equal(captured.message, operation === "settle" ? "settlement outcome is indeterminate" : "payment service is unavailable");
    assert.equal(Object.getOwnPropertyDescriptor(captured, "cause").enumerable, false);
    assert.equal(captured.cause.code, operation === "settle" ? "PAYMENT_STATUS_UNKNOWN" : "PAYMENT_SERVICE_UNAVAILABLE");
    assert.equal(calls, 1); assert.equal(stamps, 1); assert.equal(JSON.stringify({ payload, requirements }), initial);
    matrix.push({ operation, fault, calls, stamps, code: captured.cause.code });
  }
}
console.log(JSON.stringify({ matrix, egress, inventory }));
