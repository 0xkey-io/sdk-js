import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createECDH } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import https from "node:https";
import { dirname, join, resolve } from "node:path";
import { once } from "node:events";

const [language, runtimeRoot, consumerRoot, certificateRoot, evidenceDirectory] = process.argv.slice(2);
assert.ok(["go", "python"].includes(language) && runtimeRoot && consumerRoot && certificateRoot && evidenceDirectory, "CROSS_LANGUAGE_USAGE");
await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
const requirePay = createRequire(join(resolve(consumerRoot), "package.json"));
const pay = requirePay("@0xkey-io/pay/server");
const payEntry = requirePay.resolve("@0xkey-io/pay/server");
const meta = JSON.parse(await readFile(join(dirname(payEntry), "../../package.json")));
assert.equal(meta.version, "1.0.0-rc.1", "CROSS_LANGUAGE_PAY_VERSION");
const tls = { key: await readFile(join(certificateRoot, "server.key")), cert: await readFile(join(certificateRoot, "server.pem")) };
const counts = { supported: 0, verify: 0, settle: 0, handler: 0, fulfillment: 0, merchant: 0 };
const transaction = `0x${"ab".repeat(32)}`, paymentId = "22222222-2222-4222-8222-222222222222";
const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
let origin;
const serverApi = pay.createPayServer({
  network: "eip155:84532", organizationId: "11111111-1111-4111-8111-111111111111", payTo: "0x1111111111111111111111111111111111111111",
  apiKey: { publicKey: ecdh.getPublicKey("hex", "compressed"), privateKey: ecdh.getPrivateKey("hex").padStart(64, "0") },
  protocols: ["x402"], facilitatorUrl: "https://fixture.invalid/base-sepolia", handlerRevision: "final-7c-cross-language-v1",
  async fetch(url, init) {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/supported")) { counts.supported++; return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }], extensions: [], signers: {} }); }
    const body = JSON.parse(String(init?.body));
    assert.equal(body.organizationId, "11111111-1111-4111-8111-111111111111");
    if (path.endsWith("/verify")) { counts.verify++; return Response.json({ isValid: true, payer: body.paymentPayload.payload.authorization.from }); }
    if (path.endsWith("/v1/settlements/charge")) { counts.settle++; assert.equal(body.command.protocolId, "x402-exact-v2-eip3009"); return Response.json({ settlement: { success: true, transaction, network: "eip155:84532", payer: body.command.payer }, paymentId }); }
    if (path.endsWith(`/v1/payments/${paymentId}/fulfillment`)) { counts.fulfillment++; return new Response(null, { status: 200 }); }
    throw new Error(`unexpected facilitator path ${path}`);
  },
});
const route = serverApi.protect({ price: "$0.01" }, () => { counts.handler++; return Response.json({ ok: true }); });
const server = https.createServer(tls, async (request, response) => {
  try {
    counts.merchant++;
    const web = new Request(origin + request.url, { method: request.method, headers: request.headers });
    const result = await route(web); response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) { response.writeHead(500); response.end("fixture failure"); }
});
server.requestTimeout = 20_000; server.headersTimeout = 20_000; server.listen(0, "127.0.0.1"); await once(server, "listening");
origin = `https://127.0.0.1:${server.address().port}/paid`;
const repository = resolve(new URL("../", import.meta.url).pathname);
const command = language === "go"
  ? ["/opt/homebrew/bin/go", "run", "-mod=readonly", join(repository, "fixtures/go-x402/main.go"), origin, join(certificateRoot, "ca.pem")]
  : [join(resolve(runtimeRoot), ".venv/bin/python"), "-I", "-B", join(repository, "fixtures/python-x402/client.py"), origin, join(certificateRoot, "ca.pem")];
const env = language === "go"
  ? { PATH: "/opt/homebrew/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C", CGO_ENABLED: "0", GOPROXY: "off", GOSUMDB: "off", GOTOOLCHAIN: "local", GOWORK: "off", GOMODCACHE: join(resolve(runtimeRoot), "go-cache/pkg/mod"), GOCACHE: join(resolve(evidenceDirectory), "go-build-cache") }
  : { PATH: "/opt/homebrew/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C", PYTHONNOUSERSITE: "1" };
const child = spawn(command[0], command.slice(1), { cwd: language === "go" ? join(repository, "fixtures/go-x402") : resolve(evidenceDirectory), detached: true, env, stdio: ["ignore", "pipe", "pipe"] });
const stdout = [], stderr = []; child.stdout.on("data", chunk => stdout.push(chunk)); child.stderr.on("data", chunk => stderr.push(chunk));
let timedOut = false; const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 180_000);
const closed = await new Promise((accept, reject) => { child.once("error", reject); child.once("close", (code, signal) => accept({ code, signal })); }); clearTimeout(timer);
server.closeAllConnections(); await new Promise(accept => server.close(accept));
let groupAbsent = false; try { process.kill(-child.pid, 0); } catch (error) { groupAbsent = error?.code === "ESRCH"; }
const out = Buffer.concat(stdout), err = Buffer.concat(stderr); await writeFile(join(evidenceDirectory, "stdout.jsonl"), out, { flag: "wx", mode: 0o600 }); await writeFile(join(evidenceDirectory, "stderr.txt"), err, { flag: "wx", mode: 0o600 });
assert.deepEqual([closed.code, closed.signal, timedOut, groupAbsent, err.length], [0, null, false, true, 0], "CROSS_LANGUAGE_PROCESS");
assert.deepEqual(counts, { supported: 1, verify: 1, settle: 1, handler: 1, fulfillment: 1, merchant: 2 }, "CROSS_LANGUAGE_COUNTS");
const childResult = JSON.parse(out.toString().trim()); assert.equal(childResult.status, "PASSED", "CROSS_LANGUAGE_RESULT");
const observedVersions = language === "go" ? { x402: "2.23.1-0.20260826184309-acaa90458564" } : { x402: "2.20.0" };
const observation = { status: "PASSED", language, command, observedVersions, artifactVersion: meta.version, counts, groupAbsent, network: "loopback_no_chain", externalMutations: false };
await writeFile(join(evidenceDirectory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 }); process.stdout.write(JSON.stringify(observation) + "\n");
