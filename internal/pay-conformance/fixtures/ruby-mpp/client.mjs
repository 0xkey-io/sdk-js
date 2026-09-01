import assert from "node:assert/strict";
import https from "node:https";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [consumerRoot, certificateRoot, origin] = process.argv.slice(2);
assert.ok(consumerRoot && certificateRoot && origin, "RUBY_CLIENT_USAGE");
const requireConsumer = createRequire(join(resolve(consumerRoot), "package.json"));
const { createPayClient } = requireConsumer("@0xkey-io/pay/client");
const { privateKeyToAccount } = requireConsumer("viem/accounts");
const ca = await readFile(join(certificateRoot, "ca.pem"));
const allowed = new Set([new URL(origin).origin]);
async function fetchTls(input, init = {}) {
  const request = new Request(input, init), url = new URL(request.url);
  assert.equal(url.protocol === "https:" && url.hostname === "127.0.0.1" && allowed.has(url.origin), true, "RUBY_CLIENT_EGRESS");
  const body = Buffer.from(await request.arrayBuffer());
  return await new Promise((accept, reject) => {
    const req = https.request(url, { method: request.method, headers: Object.fromEntries(request.headers), ca, rejectUnauthorized: true, agent: false, signal: AbortSignal.timeout(10_000) }, response => {
      const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.on("end", () => accept(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    }); req.on("error", reject); req.end(body);
  });
}
let record;
const recovery = { protection: "aead", async load() { return record; }, async saveIfAbsent(value) { if (record) return false; record = value; return true; }, async clear(digest) { if (record?.digest !== digest) return false; record = undefined; return true; } };
const client = createPayClient({
  account: privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"), network: "eip155:84532",
  policy: { allowHosts: [new URL(origin).host], maxAmount: "$0.01", preference: ["mpp"] }, recovery,
  verification: { verifier: async () => true }, fetch: fetchTls,
});
const response = await client.fetch(origin);
assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true }); assert.equal(response.headers.has("Payment-Receipt"), true); assert.equal(record, undefined);
process.stdout.write(JSON.stringify({ status: "PASSED", paymentReceipt: true, pendingCleared: true }) + "\n");
