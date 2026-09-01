import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDecipheriv, createHash } from "node:crypto";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inputPath = process.argv[2], { input } = await readExecutionInput(inputPath);
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const families = { "malformed-ambiguous-offer": ["request-body-read-failure", "body-not-replayable"], "network-mismatch": ["pending-open-other-network"] };
// Dispatching before body readability/replayability is established, or losing
// valid POST bytes on payment retry, must fail this real public operation.
for (const [family, cases] of Object.entries(families)) test(input.fixture + " preflight " + family, async t => {
  const contract = matrix.rows.find(row => row.id === input.fixture + "-" + family), directory = join(input.evidence, contract.id);
  await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "preflight-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
  await writeFile(join(directory, "preflight.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED", "actual Request preflight rejection needs zero arrival and fresh POST calibration");
  assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "preflight-observations.json")));
  assert.equal(observed.scope, "preflight-controls-slice"); assert.equal(observed.coverage, "partial"); assert.equal(observed.aggregateStatus, "BLOCKED");
  assert.equal(observed.stage, "development-only"); assert.equal(observed.artifactSha256, input.consumer.artifactSha256);
  await assert.rejects(access(join(directory, "observation.json")), { code: "ENOENT" });
  assert.deepEqual(observed.subcases.map(({ caseId, condition }) => [caseId, condition]), cases.flatMap(id => [[id, "import"], [id, "require"]]));
  for (const s of observed.subcases) await t.test(s.caseId + "/" + s.condition, async () => {
    const networkCase = s.caseId === "pending-open-other-network";
    assert.equal(s.status, "PASSED"); assert.equal(s.roles.length, networkCase ? 5 : 4);
    assert.equal(s.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === s.condition)), true);
    assert.equal(s.ports.length, 2); assert.equal(s.ports.every(port => port.rebound), true);
    assert.equal(s.tls.length, 2); assert.equal(s.tls.every(tls => tls.trusted && tls.wrongCaRejected), true);
    assert.equal(s.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
    if (networkCase) {
      assert.equal(new Set(s.buyers.map(buyer => buyer.pid)).size, 3);
      const [capture, incompatible, resumed] = s.buyers;
      assert.deepEqual(s.buyers.map(buyer => buyer.stage), ["capture", "incompatible", "resume"]);
      assert.deepEqual(capture.termination, { code: null, signal: "SIGKILL", reason: "ROLE_EXIT_NONZERO" });
      assert.deepEqual([capture.counters.sign, capture.counters.save, capture.counters.signedSend, capture.counters.rpc, capture.counters.clear], [1, 1, 0, 0, 0]);
      assert.deepEqual(incompatible.error, { code: "PENDING_PAYMENT_CONFLICT", phase: "recovery", retryable: false });
      assert.deepEqual(incompatible.pendingError, incompatible.error); assert.equal(incompatible.pending, null);
      assert.equal(incompatible.network, "eip155:8453"); assert.equal(incompatible.input, null);
      assert.deepEqual(Object.values(incompatible.counters), Array(13).fill(0)); assert.equal(incompatible.saveAttempts, 0); assert.equal(incompatible.clearAttempts, 0);
      assert.deepEqual(incompatible.transports, []); assert.deepEqual(incompatible.requests, []);
      assert.deepEqual(s.persistedAfterConflict, s.persistedBeforeConflict);
      assert.equal(s.persistedBeforeConflict.credentialSha256, capture.credentialSha256);
      assert.equal(s.persistedBeforeConflict.recordSha256, capture.recordSha256);
      const evidence = join(directory, s.caseId + "-" + s.condition), bytes = await readFile(join(evidence, "captured-pending.aead")), key = await readFile(join(evidence, "durable/storage.key"));
      const hash = value => createHash("sha256").update(value).digest("hex");
      assert.equal(hash(bytes), s.persistedBeforeConflict.ciphertextSha256); assert.equal(hash(key), s.persistedBeforeConflict.keySha256);
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12)); decipher.setAAD(Buffer.from("pay-conformance-v1")); decipher.setAuthTag(bytes.subarray(12, 28));
      const record = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
      assert.equal(record.payment.network, "eip155:84532"); assert.equal(record.payment.method, "GET");
      assert.equal(record.digest, "0x" + capture.recordSha256);
      const { requestDigest, ...unsigned } = record.payment; assert.equal(requestDigest, "0x" + hash(JSON.stringify(unsigned)));
      assert.equal(hash(record.payment.headers.find(([name]) => name === (input.fixture.startsWith("mppx-") ? "authorization" : "payment-signature"))[1]), capture.credentialSha256);
      assert.deepEqual(s.checkpoints[2], s.checkpoints[1]); assert.equal(s.checkpoints[1].merchant.businessArrivals.length, 1);
      assert.equal(resumed.error, null); assert.equal(resumed.network, "eip155:84532"); assert.equal(resumed.status, 200);
      assert.deepEqual([resumed.counters.sign, resumed.saveAttempts, resumed.counters.save, resumed.counters.signedSend, resumed.counters.rpc, resumed.counters.clear], [0, 0, 0, 1, 4, 1]);
      assert.equal(resumed.credentialSha256, capture.credentialSha256); assert.equal(resumed.receiptValid, true); assert.equal(resumed.pending, false);
      assert.equal(resumed.requests.length, 1); assert.equal(resumed.requests[0].method, "GET"); assert.equal(resumed.requests[0].credentialSha256, capture.credentialSha256);
      assert.equal(s.checkpoints[3].merchant.businessArrivals.length, 2); assert.equal(s.persistedAfter, null);
      assert.deepEqual([s.counters.sign, s.counters.save, s.counters.signedSend, s.counters.settle, s.counters.handler, s.counters.economicEffect, s.counters.applicationEffect, s.counters.clear, s.counters.rpc], [1, 1, 1, 1, 1, 1, 1, 1, 4]);
      return;
    }
    assert.equal(new Set(s.buyers.map(buyer => buyer.pid)).size, 2);
    const [negative, positive] = s.buyers;
    assert.equal(negative.stage, "negative"); assert.equal(positive.stage, "positive");
    assert.deepEqual(negative.error, { code: "PAYMENT_SERVICE_UNAVAILABLE", phase: "request", retryable: true });
    assert.deepEqual(Object.values(negative.counters), Array(13).fill(0));
    assert.equal(negative.saveAttempts, 0); assert.equal(negative.clearAttempts, 0);
    assert.equal(negative.pending, false); assert.equal(negative.pendingError, null); assert.equal(negative.status, null);
    assert.equal(negative.input.method, "POST"); assert.equal(negative.input.bodyUsedBeforeCall, s.caseId === "body-not-replayable");
    if (s.caseId === "request-body-read-failure") {
      assert.equal(negative.input.pullCount, 1); assert.equal(negative.transports.length, 1);
      const transport = negative.transports[0]; assert.equal(transport.errorIdentity, true); assert.equal(transport.status, null);
      assert.ok(BigInt(negative.input.failedAtNs) <= BigInt(transport.completedAtNs));
      assert.ok(BigInt(negative.input.callAtNs) <= BigInt(transport.startedAtNs));
    } else { assert.equal(negative.transports.length, 0); assert.equal(negative.input.failedAtNs, null); }
    for (const checkpoint of s.checkpoints.slice(0, 2)) {
      assert.deepEqual(checkpoint.merchant.businessArrivals, []); assert.equal(checkpoint.merchant.counters.handler, 0);
      assert.equal(checkpoint.facilitator.counters.settle, 0); assert.equal(checkpoint.facilitator.counters.rpc, 0);
    }
    assert.deepEqual(s.checkpoints[1], s.checkpoints[0]);
    assert.equal(s.checkpoints[0].facilitator.counters.supported, input.fixture.startsWith("x402-") ? 1 : 0);
    assert.equal(positive.error, null); assert.equal(positive.status, 200); assert.equal(positive.pending, false); assert.equal(positive.receiptValid, true);
    assert.deepEqual([positive.counters.sign, positive.saveAttempts, positive.counters.save, positive.counters.signedSend, positive.counters.rpc, positive.counters.clear], [1, 1, 1, 1, 4, 1]);
    assert.equal(positive.requests.length, 2); assert.deepEqual(positive.requests.map(request => request.signed), [false, true]);
    assert.equal(positive.requests.every(request => request.method === "POST" && request.bodySha256 === positive.input.bodySha256), true);
    const arrivals = s.checkpoints[2].merchant.businessArrivals;
    assert.equal(arrivals.length, 2); assert.equal(arrivals.every(request => request.method === "POST" && request.bodySha256 === positive.input.bodySha256), true);
    assert.equal(arrivals[1].credentialSha256, positive.credentialSha256);
    assert.equal(s.persistedAfter, null);
    assert.deepEqual([s.counters.sign, s.counters.save, s.counters.signedSend, s.counters.settle, s.counters.handler, s.counters.economicEffect, s.counters.applicationEffect, s.counters.clear, s.counters.rpc], [1, 1, 1, 1, 1, 1, 1, 1, 4]);
  });
});
