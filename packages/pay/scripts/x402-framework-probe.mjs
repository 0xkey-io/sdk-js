import assert from "node:assert/strict";
import https from "node:https";
import net from "node:net";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { publicModule, makeServer, network, organizationId, paymentId, requirements, payload, transaction, tlsFetch } from "./x402-boundary-runtime.mjs";
const [payApp, consumerApp, condition, framework, mode, tlsDir] = process.argv.slice(2);
const inventory = [];
const sdk = await publicModule(payApp, "@0xkey-io/pay/x402", condition, inventory);
const producerCore = await publicModule(payApp, "@x402/core/server", condition, inventory);
const core = await publicModule(consumerApp, "@x402/core/server", condition, inventory);
const evm = await publicModule(consumerApp, "@x402/evm/exact/server", condition, inventory);
const codec = await publicModule(consumerApp, "@x402/core/http", condition, inventory);
const adapter = await publicModule(consumerApp, "@x402/" + framework, condition, inventory);
const host = await publicModule(consumerApp, framework === "next" ? "next/server" : framework, framework === "hono" ? condition : "require", inventory);
assert.equal(adapter.x402ResourceServer, core.x402ResourceServer);
assert.equal(adapter.x402HTTPResourceServer, core.x402HTTPResourceServer);
const allowed = new Set(), ca = readFileSync(join(tlsDir, "loopback-ca-v2.pem"));
const trusted = tlsFetch(ca, allowed);
const rows = [];
let forbidden = 0;
globalThis.fetch = async () => { forbidden++; throw new Error("unexpected global fetch"); };
for (const operation of ["supported", "settle"]) for (const fault of ["503", "disconnect", "timeout", "malformed", ...(operation === "settle" ? ["UNKNOWN", "invalid", "success"] : [])]) {
  const counts = { supported: 0, verify: 0, settle: 0, stamp: 0, handler: 0 };
  const client = sdk.create0xkeyFacilitatorClient({ network, organizationId, facilitatorUrl: "https://fixture.invalid", timeoutMs: 10,
    ...(mode === "omitted" ? {} : { facilitatorResponseError: core.FacilitatorResponseError }),
    stamper: { async stampRequest() { counts.stamp++; return { stampHeaderName: "X-Stamp", stampHeaderValue: "synthetic" }; } },
    async fetch(input, init) {
      const op = new URL(input).pathname.slice(1); assert.ok(op in counts); counts[op]++;
      if (op !== operation) { assert.equal(op, "supported"); return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network }], extensions: [], signers: {} }); }
      if (fault === "disconnect") throw new Error("private-upstream-sentinel");
      if (fault === "timeout") return new Promise((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("fixture-timeout-bound")), 1000);
        init.signal.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal.reason); }, { once: true });
      });
      if (fault === "503") return new Response("private-upstream-sentinel", { status: 503 });
      if (fault === "malformed") return Response.json({ unexpected: true });
      if (fault === "UNKNOWN") return Response.json({ errorCode: "PAYMENT_STATUS_UNKNOWN", retryable: true, paymentId }, { status: 503 });
      return Response.json({ settlement: { success: fault === "success", transaction: fault === "success" ? transaction : "", network, payer: payload.payload.authorization.from, ...(fault === "invalid" ? { errorReason: "authorization rejected" } : {}) }, paymentId });
    },
  });
  const http = makeServer(core, evm, client);
  const header = codec.encodePaymentSignatureHeader(payload);
  let response;
  if (framework === "express") {
    const app = host();
    app.use(adapter.paymentMiddlewareFromHTTPServer(http));
    app.get("/paid", (_req, res) => { counts.handler++; res.json({ paid: true }); });
    const server = https.createServer({ key: readFileSync(join(tlsDir, "loopback-server-v2.key")), cert: readFileSync(join(tlsDir, "loopback-server-v2.pem")) }, app);
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const port = server.address().port, origin = `https://127.0.0.1:${port}`; allowed.add(origin);
    try { response = await trusted(origin + "/paid", { headers: { "PAYMENT-SIGNATURE": header } }); }
    finally { server.closeAllConnections(); await new Promise(done => server.close(done)); const probe = net.createServer(); probe.listen(port, "127.0.0.1"); await once(probe, "listening"); await new Promise(done => probe.close(done)); allowed.delete(origin); }
  } else if (framework === "hono") {
    const { Hono } = host;
    const app = new Hono(); app.use(adapter.paymentMiddlewareFromHTTPServer(http));
    app.get("/paid", c => { counts.handler++; return c.json({ paid: true }); });
    response = await app.request("https://fixture.invalid/paid", { headers: { "PAYMENT-SIGNATURE": header } });
  } else {
    const { NextRequest } = host;
    const handler = adapter.withX402FromHTTPServer(() => { counts.handler++; return Response.json({ paid: true }); }, http);
    response = await handler(new NextRequest("https://fixture.invalid/paid", { headers: { "PAYMENT-SIGNATURE": header } }));
  }
  assert.equal(response.status, fault === "success" ? 200 : fault === "invalid" ? 402 : 502);
  assert.equal(response.headers.has("PAYMENT-REQUIRED"), false);
  assert.equal(response.headers.has("PAYMENT-RESPONSE"), fault === "success" || fault === "invalid");
  if (response.headers.has("PAYMENT-RESPONSE")) assert.equal(codec.decodePaymentResponseHeader(response.headers.get("PAYMENT-RESPONSE")).success, fault === "success");
  assert.equal(counts.handler, fault === "success" ? 1 : 0); assert.equal(counts.verify, 0);
  assert.equal(counts.supported, 1); assert.equal(counts.settle, operation === "settle" ? 1 : 0);
  assert.equal(counts.stamp, operation === "settle" ? 2 : 1);
  assert.doesNotMatch(await response.text(), /private-upstream-sentinel|paymentId|organizationId/);
  rows.push({ operation, fault, status: response.status, counts });
}
assert.equal(forbidden, 0);
console.log(JSON.stringify({ inventory, condition, framework, mode, sameOwner: producerCore.FacilitatorResponseError === core.FacilitatorResponseError, rows, forbidden, scope: "real official middleware and HTTP server; Express loopback TLS; Hono/Next native Request dispatch" }));
