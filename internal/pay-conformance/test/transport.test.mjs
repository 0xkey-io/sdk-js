import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tlsFetch, makeServer } from "../../../packages/pay/scripts/x402-boundary-runtime.mjs";

const exec = promisify(execFile);

test("native price profile rejects arbitrary or coercible input before constructing a server", () => {
  for (const priceProfile of [0.005, "$0.005", ["duplicate-second"], { toString: () => "duplicate-second" }, null, false, "arbitrary"]) assert.throws(() => makeServer(undefined, undefined, undefined, "/paid", "GET", priceProfile), error => error.message === "price-profile-rejected");
});

test("owned HTTPS transport preserves trusted bytes and rejects raw target aliases before dispatch", async t => {
  // Intentionally retained under the test's TMPDIR: no system trust changes.
  const directory = await mkdtemp(join(tmpdir(), "pay-transport-test-"));
  const openssl = async (...args) => exec("openssl", args, { cwd: directory, timeout: 10000 });
  await writeFile(join(directory, "san.cnf"), "subjectAltName=IP:127.0.0.1\n");
  for (const name of ["ca", "wrong-ca"]) await openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", `/CN=pay-test-${name}`, "-keyout", `${name}.key`, "-out", `${name}.pem`);
  await openssl("req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=pay-test-loopback", "-keyout", "server.key", "-out", "server.csr");
  await openssl("x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-days", "2", "-extfile", "san.cnf", "-out", "server.pem");
  await openssl("x509", "-in", "server.pem", "-checkend", "60", "-noout");
  let requests = 0, redirectTargets = 0, acceptedTimeouts = 0, innerTimeouts = 0;
  const server = https.createServer({ key: await readFile(join(directory, "server.key")), cert: await readFile(join(directory, "server.pem")) }, async (request, response) => {
    requests++;
    if (request.url === "/never") { acceptedTimeouts++; return; }
    if (request.url === "/observe-timeout" || request.url === "/observe-support-timeout") {
      try { await transport(origin + "/never"); response.writeHead(200); }
      catch { innerTimeouts++; response.writeHead(request.url === "/observe-support-timeout" ? 502 : 503); }
      response.end("inner-timeout"); return;
    }
    if (request.url === "/redirect") { response.writeHead(302, { Location: "/target" }); response.end(); }
    else if (request.url === "/target") { redirectTargets++; response.end("target"); }
    else { response.writeHead(200, { "content-type": "application/octet-stream" }); response.end(Buffer.from([0, 1, 127, 128, 255])); }
  });
  server.on("tlsClientError", () => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const origin = `https://127.0.0.1:${port}`;
  const allowed = new Set([origin]);
  const transport = tlsFetch(await readFile(join(directory, "ca.pem")), allowed);
  try {
    const response = await transport(origin + "/bytes");
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0, 1, 127, 128, 255]));
    assert.equal(requests, 1, "positive control reaches the real TLS listener");
    await assert.rejects(tlsFetch(await readFile(join(directory, "wrong-ca.pem")), allowed)(origin + "/bytes"), error => ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"].includes(error.code));
    assert.equal(requests, 1, "untrusted TLS never reaches HTTP");
    await assert.rejects(transport(origin + "/redirect"), /redirect-forbidden/);
    assert.equal(redirectTargets, 0);
    for (const alias of ["127.1", "2130706433", "0x7f000001", "%31%32%37.0.0.1"]) {
      const before = requests;
      await assert.rejects(transport(`https://${alias}:${port}/bytes`), /loopback-only-dispatch/, alias);
      assert.equal(requests, before, "rejected target must not reach the owned listener");
    }
    await t.test("explicit manual-response mode returns the redirect to the caller without following", async () => {
      const manual = tlsFetch(await readFile(join(directory, "ca.pem")), allowed, "manual-response");
      const response = await manual(new Request(origin + "/redirect", { redirect: "manual" }));
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/target");
      assert.equal(response.url, origin + "/redirect");
      assert.equal(redirectTargets, 0);
    });
    await t.test("manual-response mode rejects attempted follow and error modes before dispatch", async () => {
      const manual = tlsFetch(await readFile(join(directory, "ca.pem")), allowed, "manual-response");
      for (const redirect of ["follow", "error"]) {
        const before = requests;
        await assert.rejects(manual(new Request(origin + "/redirect", { redirect })), /manual-redirect-required/);
        assert.equal(requests, before);
      }
      assert.equal(redirectTargets, 0);
    });
    await t.test("manual-response mode retains literal target allowlist and CA rejection", async () => {
      const ca = await readFile(join(directory, "ca.pem")), manual = tlsFetch(ca, allowed, "manual-response");
      for (const target of [`https://127.1:${port}/bytes`, "https://example.invalid/bytes", `http://127.0.0.1:${port}/bytes`, `https://127.0.0.1:${port}/bytes#fragment`]) {
        await assert.rejects(manual(target, { redirect: "manual" }), /loopback-only-dispatch/);
      }
      await assert.rejects(tlsFetch(ca, new Set(), "manual-response")(origin + "/bytes", { redirect: "manual" }), /loopback-only-dispatch/);
      const before = requests;
      await assert.rejects(tlsFetch(await readFile(join(directory, "wrong-ca.pem")), allowed, "manual-response")(origin + "/bytes", { redirect: "manual" }));
      assert.equal(requests, before);
      assert.equal(redirectTargets, 0);
    });
    await t.test("transport rejects unknown private modes and defaults to redirect rejection even for manual requests", async () => {
      const ca = await readFile(join(directory, "ca.pem"));
      assert.throws(() => tlsFetch(ca, allowed, "follow"), /redirect-mode-rejected/);
      await assert.rejects(transport(new Request(origin + "/redirect", { redirect: "manual" })), /redirect-forbidden/);
      assert.equal(redirectTargets, 0);
    });
    await t.test("closed seller observer rejects numeric, coercible and unknown timeout profiles before I/O", async () => {
      const ca = await readFile(join(directory, "ca.pem")), before = requests;
      for (const profile of [10000, "10000", ["seller-fulfillment-observer"], { toString: () => "seller-fulfillment-observer" }, null, "arbitrary"]) assert.throws(() => tlsFetch(ca, allowed, "reject", profile), /timeout-profile-rejected/);
      assert.equal(requests, before);
    });
    await t.test("observer retains literal targets, CA checks and redirect rejection", async () => {
      const ca = await readFile(join(directory, "ca.pem")), observer = tlsFetch(ca, allowed, "reject", "seller-fulfillment-observer");
      const before = requests;
      await assert.rejects(observer(`https://127.1:${port}/bytes`), /loopback-only-dispatch/);
      await assert.rejects(tlsFetch(ca, new Set(), "reject", "seller-fulfillment-observer")(origin + "/bytes"), /loopback-only-dispatch/);
      await assert.rejects(tlsFetch(await readFile(join(directory, "wrong-ca.pem")), allowed, "reject", "seller-fulfillment-observer")(origin + "/bytes"));
      assert.equal(requests, before);
      await assert.rejects(observer(origin + "/redirect"), /redirect-forbidden/); assert.equal(redirectTargets, 0);
    });
    await t.test("standard remains five seconds while seller observer can receive a real inner five-second timeout response", async () => {
      const start = performance.now();
      await assert.rejects(transport(origin + "/never"));
      assert.ok(performance.now() - start >= 4500 && performance.now() - start < 8000);
      assert.equal(acceptedTimeouts, 1);
      const observer = tlsFetch(await readFile(join(directory, "ca.pem")), allowed, "reject", "seller-fulfillment-observer");
      const observedAt = performance.now(), response = await observer(origin + "/observe-timeout");
      assert.equal(response.status, 503); assert.equal(await response.text(), "inner-timeout");
      assert.equal(innerTimeouts, 1); assert.equal(acceptedTimeouts, 2);
      assert.ok(performance.now() - observedAt >= 4500 && performance.now() - observedAt < 10000);
    });
    await t.test("support discovery observer is closed and preserves target, CA and redirect guards", async () => {
      const ca = await readFile(join(directory, "ca.pem")), before = requests;
      for (const profile of [10000, "10000", ["support-discovery-observer"], { toString: () => "support-discovery-observer" }, null, "support-observer"]) assert.throws(() => tlsFetch(ca, allowed, "reject", profile), /timeout-profile-rejected/);
      const observer = tlsFetch(ca, allowed, "reject", "support-discovery-observer");
      await assert.rejects(observer(`https://127.1:${port}/bytes`), /loopback-only-dispatch/);
      await assert.rejects(tlsFetch(ca, new Set(), "reject", "support-discovery-observer")(origin + "/bytes"), /loopback-only-dispatch/);
      await assert.rejects(tlsFetch(await readFile(join(directory, "wrong-ca.pem")), allowed, "reject", "support-discovery-observer")(origin + "/bytes"));
      assert.equal(requests, before);
      await assert.rejects(observer(origin + "/redirect"), /redirect-forbidden/); assert.equal(redirectTargets, 0);
    });
    await t.test("support observer receives an actual inner default-five-second timeout as 502", async () => {
      const observer = tlsFetch(await readFile(join(directory, "ca.pem")), allowed, "reject", "support-discovery-observer"), start = performance.now();
      const before = acceptedTimeouts, beforeInner = innerTimeouts, response = await observer(origin + "/observe-support-timeout");
      assert.equal(response.status, 502); assert.equal(await response.text(), "inner-timeout");
      assert.equal(acceptedTimeouts, before + 1); assert.equal(innerTimeouts, beforeInner + 1);
      assert.ok(performance.now() - start >= 4500 && performance.now() - start < 8000);
    });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
