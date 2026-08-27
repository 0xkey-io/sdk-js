import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import https from "node:https";
export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export function check(value, label) { if (!value) throw new Error(label); }
export async function publicModule(app, name, condition, inventory = []) {
  const req = createRequire(resolve(app, "package.json"));
  let root = dirname(req.resolve(name)), manifest;
  for (;;) {
    try { manifest = JSON.parse(readFileSync(join(root, "package.json"))); } catch {}
    if (manifest?.name && (name === manifest.name || name.startsWith(manifest.name + "/"))) break;
    const parent = dirname(root); assert.notEqual(parent, root); root = parent;
  }
  const exported = manifest.exports?.["." + name.slice(manifest.name.length)];
  const selected = typeof exported === "string" ? exported : exported?.[condition];
  const entry = realpathSync(selected ? join(root, typeof selected === "string" ? selected : selected.default) : req.resolve(name));
  if (condition === "require") assert.equal(entry, realpathSync(req.resolve(name)));
  let nativeResolution;
  if (condition === "import") {
    // Resolve a bare public specifier in a real ESM context rooted in this
    // consumer. The file-URL loader below must equal Node's native resolution;
    // export-map inspection alone is not native import evidence.
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", "console.log(import.meta.resolve(process.argv[1]));", name], { cwd: app, env: process.env, encoding: "utf8", timeout: 3000, maxBuffer: 4096 });
    check(result.status === 0 && !result.error && result.stderr === "", "native-esm-resolve");
    nativeResolution = result.stdout.trim();
    assert.equal(entry, realpathSync(fileURLToPath(nativeResolution)));
  }
  inventory.push({ name, version: manifest.version, condition, entry, sha256: hash(readFileSync(entry)), resolution: condition === "require" ? "native-bare-require" : "native-import-meta.resolve-equality", ...(nativeResolution ? { nativeResolution } : {}) });
  return condition === "require" ? req(name) : import(pathToFileURL(entry).href);
}
export const network = "eip155:84532";
export const organizationId = "11111111-1111-4111-8111-111111111111";
export const paymentId = "22222222-2222-4222-8222-222222222222";
export const transaction = "0x" + "ab".repeat(32);
export const block = "0x" + "cd".repeat(32);
export const requirements = { scheme: "exact", network, amount: "10000", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", payTo: "0x1111111111111111111111111111111111111111", maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2", assetTransferMethod: "eip3009", paymentFlow: "upfront" } };
export const payload = { x402Version: 2, accepted: requirements, payload: { signature: "0x" + "11".repeat(65), authorization: { from: "0x2222222222222222222222222222222222222222", to: requirements.payTo, value: "10000", validAfter: "0", validBefore: "9999999999", nonce: "0x" + "22".repeat(32) } } };
export function makeServer(core, evm, client, path = "/paid") {
  const exact = new evm.ExactEvmScheme();
  const scheme = { scheme: exact.scheme, defaultAssetTransferMethod: exact.defaultAssetTransferMethod, paymentFlows: { eip3009: { supported: ["upfront"], default: "upfront" } }, parsePrice: exact.parsePrice.bind(exact), enhancePaymentRequirements: exact.enhancePaymentRequirements.bind(exact), getAssetDecimals: exact.getAssetDecimals.bind(exact) };
  const routes = { [`GET ${path}`]: { accepts: { scheme: "exact", network, payTo: requirements.payTo, price: "$0.01", extra: { assetTransferMethod: "eip3009", paymentFlow: "upfront" } } } };
  assert.throws(() => new core.x402HTTPResourceServer(new core.x402ResourceServer(client).register(network, exact), routes), e => e.errors[0].reason === "unsupported_payment_flow");
  return new core.x402HTTPResourceServer(new core.x402ResourceServer(client).register(network, scheme), routes);
}
export function tlsFetch(ca, allowed) {
  return async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    check(url.protocol === "https:" && url.hostname === "127.0.0.1" && allowed.has(url.origin) && !url.username && !url.password, "loopback-only-dispatch");
    const body = Buffer.from(await request.arrayBuffer()); check(body.length <= 65536, "request-size-bound");
    return new Promise((accept, reject) => {
      const req = https.request(url, { ca, rejectUnauthorized: true, agent: false, method: request.method, headers: Object.fromEntries(request.headers), signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]) }, res => {
        const chunks = []; let length = 0;
        res.on("data", chunk => { length += chunk.length; if (length > 262144) req.destroy(new Error("response-size-bound")); else chunks.push(chunk); });
        res.on("error", reject); res.on("end", () => {
          if (res.statusCode >= 300 && res.statusCode < 400) return reject(new Error("redirect-forbidden"));
          const response = new Response([204, 205, 304].includes(res.statusCode) ? null : Buffer.concat(chunks), { status: res.statusCode, headers: res.headers });
          Object.defineProperty(response, "url", { value: url.href }); accept(response);
        });
      });
      req.setTimeout(5000, () => req.destroy(new Error("socket-timeout"))); req.on("error", reject); req.end(body);
    });
  };
}
