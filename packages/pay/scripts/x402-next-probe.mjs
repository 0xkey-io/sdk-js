// Invoke only after an offline production build in an exactly locked fixture.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import net from "node:net";
import http from "node:http";
import { resolve, join } from "node:path";
import { publicModule, check, hash, payload } from "./x402-boundary-runtime.mjs";
const [app] = process.argv.slice(2);
const req = createRequire(resolve(app, "package.json"));
const inventory = [];
const codec = await publicModule(app, "@x402/core/http", "require", inventory);
await publicModule(app, "@x402/core/server", "require", inventory);
await publicModule(app, "@x402/next", "require", inventory);
const portProbe = net.createServer(); portProbe.listen(0, "127.0.0.1"); await once(portProbe, "listening");
const port = portProbe.address().port; await new Promise(done => portProbe.close(done));
const child = spawn(process.execPath, [req.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: app, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "", stderr = "", bytes = 0;
for (const [stream, kind] of [[child.stdout, "out"], [child.stderr, "err"]]) stream.on("data", chunk => {
  bytes += chunk.length;
  if (bytes > 131072) child.kill("SIGKILL");
  else if (kind === "out") stdout += chunk; else stderr += chunk;
});
const closed = once(child, "close"), timer = setTimeout(() => child.kill("SIGKILL"), 30000);
const request = path => new Promise((done, fail) => {
  const outgoing = http.request({ host: "127.0.0.1", port, path, method: "GET", agent: false, headers: { "PAYMENT-SIGNATURE": codec.encodePaymentSignatureHeader(payload) } }, incoming => {
    let size = 0; const chunks = [];
    incoming.on("data", chunk => { size += chunk.length; if (size > 65536) outgoing.destroy(new Error("response-bound")); else chunks.push(chunk); });
    incoming.on("end", () => done({ status: incoming.statusCode, headers: incoming.headers, body: Buffer.concat(chunks).toString() }));
    incoming.on("error", fail);
  });
  outgoing.on("error", fail); outgoing.setTimeout(3000, () => outgoing.destroy(new Error("socket-timeout"))); outgoing.end();
});
const rows = [];
try {
  for (let i = 0; !stdout.includes("Ready in"); i++) {
    check(i < 100 && child.exitCode === null, "next-start-bound");
    await new Promise(done => setTimeout(done, 100));
  }
  for (const operation of ["supported", "settle"]) for (const fault of ["503", "disconnect", "timeout", "malformed", ...(operation === "settle" ? ["UNKNOWN", "invalid", "success"] : [])]) {
    const response = await request(`/paid?operation=${operation}&fault=${fault}`);
    const counts = JSON.parse(response.headers["x-fixture-counts"] ?? "null");
    check(response.headers["x-fixture-owner"] === "same", "actual-bundled-framework-owner");
    check(response.status === (fault === "success" ? 200 : fault === "invalid" ? 402 : 502), "official-next-status");
    check(!response.headers["payment-required"] && Boolean(response.headers["payment-response"]) === (fault === "success" || fault === "invalid"), "official-next-headers");
    if (response.headers["payment-response"]) check(codec.decodePaymentResponseHeader(response.headers["payment-response"]).success === (fault === "success"), "official-next-receipt-result");
    check(counts?.supported === 1 && counts.verify === 0 && counts.settle === (operation === "settle" ? 1 : 0) && counts.stamp === (operation === "settle" ? 2 : 1) && counts.handler === (fault === "success" ? 1 : 0), "official-next-call-counts");
    check(!/private-upstream-sentinel|private-timeout-sentinel|paymentId|organizationId/.test(response.body), "public-redaction");
    rows.push({ operation, fault, status: response.status, counts });
  }
  console.log(JSON.stringify({ inventory, rows, buildId: readFileSync(join(app, ".next/BUILD_ID"), "utf8").trim(), scope: "actual Next production build/start route; unsigned synthetic transport" }));
} finally {
  child.kill("SIGTERM"); const [code, signal] = await closed; clearTimeout(timer);
  check(!/private-upstream-sentinel|private-timeout-sentinel/.test(stdout + stderr), "next-log-redaction");
  const rebound = net.createServer(); rebound.listen(port, "127.0.0.1"); await once(rebound, "listening"); await new Promise(done => rebound.close(done));
  console.log(JSON.stringify({ port, closed: true, child: { pid: child.pid, code, signal }, stdout, stderr, stdoutSha256: hash(stdout), stderrSha256: hash(stderr), bytes }));
}
