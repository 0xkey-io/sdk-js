import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import https from "node:https";
import { validateRoleMessage } from "../../src/ipc.mjs";
import { publicModule, tlsFetch, hash, network, organizationId, paymentId, requirements, transaction, block } from "../../../../packages/pay/scripts/x402-boundary-runtime.mjs";

export { publicModule, tlsFetch, hash, network, organizationId, paymentId, requirements, transaction, block };
export const counters = () => Object.fromEntries(["sign", "save", "signedSend", "supported", "verify", "settle", "economicEffect", "handler", "applicationEffect", "fulfillment", "rpc", "clear", "challenge"].map(key => [key, 0]));
export const send = (value) => process.send(validateRoleMessage(value));
export async function receive() { return validateRoleMessage((await once(process, "message"))[0]); }
export async function boot(load) {
  // All public network I/O in these cooperative fixtures must use an explicit
  // owned-CA transport; imported dependencies receive no ambient fetch path.
  globalThis.fetch = async () => { throw new Error("UNCONFIGURED_TRANSPORT"); };
  const { type, config } = await receive();
  assert.equal(type, "identify");
  const inventory = [];
  const modules = await load(config, (app, name) => publicModule(app, name, config.condition, inventory));
  send({ type: "identified", pid: process.pid, inventory });
  assert.deepEqual(await receive(), { type: "start" });
  return { config, modules, inventory };
}

export async function certificates(directory) {
  const [key, cert, ca, wrongCa] = await Promise.all(["server.key", "server.pem", "ca.pem", "wrong-ca.pem"].map(name => readFile(join(directory, name))));
  const leaf = new X509Certificate(cert), issuer = new X509Certificate(ca), unrelated = new X509Certificate(wrongCa), now = Date.now();
  for (const item of [leaf, issuer, unrelated]) assert.ok(Date.parse(item.validFrom) <= now && now < Date.parse(item.validTo), "CERTIFICATE_VALIDITY");
  assert.equal(leaf.checkIP("127.0.0.1"), "127.0.0.1");
  assert.equal(leaf.verify(issuer.publicKey), true);
  assert.equal(leaf.verify(unrelated.publicKey), false);
  return { key, cert, ca, wrongCa };
}

export async function body(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; assert.ok(size <= 65536, "REQUEST_BODY_LIMIT"); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export function json(response, data, status = 200) { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); }
export async function respond(response, result) {
  response.writeHead(result.status, result.statusText, Object.fromEntries(result.headers));
  response.end(Buffer.from(await result.arrayBuffer()));
}
export async function listen(tls, handle, onFailure) {
  const server = https.createServer({ key: tls.key, cert: tls.cert }, async (request, response) => {
    try {
      if (request.url === "/health") { response.writeHead(200); response.end("owned-loopback"); return; }
      await handle(request, response);
    } catch (error) {
      onFailure(hash(String(error?.message)));
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  server.on("tlsClientError", () => {});
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return { server, port: server.address().port, origin: `https://127.0.0.1:${server.address().port}` };
}
export async function serveControl(server, snapshot, configure = () => { throw new Error("CONFIGURATION_NOT_SUPPORTED"); }) {
  for (;;) {
    const message = await receive();
    if (message.type === "snapshot") send({ type: "snapshot", ...snapshot() });
    else if (message.type === "configure") { configure(message.step); send({ type: "configured", step: message.step }); }
    else {
      assert.equal(message.type, "close");
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      send({ type: "closed", ...snapshot() }); process.disconnect(); return;
    }
  }
}
