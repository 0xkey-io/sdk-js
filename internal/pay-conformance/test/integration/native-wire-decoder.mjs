import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [inputPath, caseId, condition] = process.argv.slice(2);
assert.equal(process.argv.length, 5);
assert.ok(["credential-invalid-encoding", "credential-invalid-json"].includes(caseId));
assert.ok(["import", "require"].includes(condition));
const { input } = await readExecutionInput(inputPath);
assert.equal(input.stage, "development-only");
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
// Removing the first-send replacement, allowing effects before rejection, or
// calibrating before all negative role streams close must fail this boundary.
test(input.fixture + "/" + caseId + "/" + condition + " signed decoder control", async t => {
  const contract = matrix.rows.find(row => row.id === input.fixture + "-malformed-ambiguous-offer"), directory = join(input.evidence, contract.id);
  await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "wire-decoder-controls", caseId + "/" + condition], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
  await writeFile(join(directory, "wire-decoder.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  // This persistence assertion is independent of the unresolved native output
  // gate below. Moving the completed checkpoint write after close must fail.
  await t.test("negative checkpoint survives final failure and precedes listener shutdown", async () => {
    const phaseDirectory = join(directory, caseId + "-" + condition + "-negative");
    const bytes = await readFile(join(phaseDirectory, "wire-decoder-checkpoint.json"));
    const saved = JSON.parse(bytes), final = JSON.parse(await readFile(join(phaseDirectory, "wire-decoder.json")));
    assert.equal(saved.caseId, caseId); assert.equal(saved.condition, condition); assert.equal(saved.stage, "negative");
    assert.equal(saved.endpointSha256, final.endpointSha256); assert.deepEqual(saved.roles, final.roles); assert.deepEqual(saved.checkpoint, final.checkpoint);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), final.checkpointSha256);
    assert.ok(BigInt(final.checkpointSavedAtNs) < BigInt(final.closeStartedAtNs));
    assert.ok(BigInt(final.closeStartedAtNs) < BigInt(final.cleanupStartedAtNs));
    const { buyer, merchant, facilitator } = saved.checkpoint;
    assert.deepEqual([buyer.counters.sign, buyer.counters.signedSend, merchant.counters.handler, merchant.counters.applicationEffect, facilitator.counters.verify, facilitator.counters.settle, facilitator.counters.economicEffect, facilitator.counters.fulfillment], [1, 1, 0, 0, 0, 0, 0, 0]);
    assert.equal(buyer.status, 402); assert.equal(buyer.receiptSha256, null);
    if (final.status === "FAILED") {
      await assert.rejects(access(join(directory, caseId + "-" + condition + "-positive")), { code: "ENOENT" });
      assert.equal(run.status, "FAILED");
    }
  });
  assert.equal(run.status, "PASSED", "reject malformed credential without role output before independent positive calibration");
  assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "wire-decoder-observations.json")));
  assert.equal(observed.scope, "wire-decoder-controls-slice"); assert.equal(observed.coverage, "partial"); assert.equal(observed.aggregateStatus, "BLOCKED");
  assert.equal(observed.stage, "development-only"); assert.equal(observed.artifactSha256, input.consumer.artifactSha256);
  await assert.rejects(access(join(directory, "observation.json")), { code: "ENOENT" });
  assert.equal(observed.subcases.length, 1);
  const s = observed.subcases[0], mpp = input.fixture.startsWith("mppx-");
  assert.equal(s.caseId, caseId); assert.equal(s.condition, condition); assert.equal(s.status, "PASSED");
  assert.equal(s.sendOwner, "native-first-send-wire-mutator"); assert.equal(s.calibrationOwner, "fresh-native-phase");
  assert.deepEqual(s.phases.map(p => p.stage), ["negative", "positive"]);
  for (const p of s.phases) {
    const positive = p.stage === "positive", b = p.checkpoint.buyer, merchant = p.checkpoint.merchant, facilitator = p.checkpoint.facilitator;
    assert.equal(p.status, "PASSED"); assert.match(p.endpointSha256, /^[0-9a-f]{64}$/);
    assert.equal(p.roles.length, 3); assert.equal(p.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === condition)), true);
    assert.equal(p.ports.length, 2); assert.equal(p.ports.every(port => port.rebound), true); assert.equal(p.tls.length, 2); assert.equal(p.tls.every(tls => tls.trusted && tls.wrongCaRejected), true);
    assert.equal(p.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
    assert.equal(b.status, positive ? 200 : 402); assert.equal(b.classification, positive ? "paid" : mpp ? "malformed-credential" : "payment-required");
    assert.equal(b.challenge, !positive); assert.equal(b.receiptValid, positive); assert.equal(b.receiptSha256 === null, !positive);
    assert.deepEqual([b.counters.sign, b.counters.signedSend, b.counters.save, b.counters.clear, b.counters.rpc, b.wrapperCalls], [1, 1, 0, 0, 0, 1]);
    assert.deepEqual([merchant.counters.handler, merchant.counters.applicationEffect, facilitator.counters.verify, facilitator.counters.settle, facilitator.counters.economicEffect, facilitator.counters.fulfillment], positive ? [1, 1, mpp ? 0 : 1, 1, 1, 1] : [0, 0, 0, 0, 0, 0]);
    assert.deepEqual(facilitator.wirePrivateArrivals.map(a => a.operation), mpp ? positive ? ["charge", "fulfillment"] : [] : positive ? ["supported", "verify", "charge", "fulfillment"] : ["supported"]);
    assert.equal(merchant.wireArrivals.length, 2); const arrival = merchant.wireArrivals[1];
    assert.equal(arrival.credentialSha256, b.wire.transmittedSha256); assert.equal(arrival.credentialHeadersSha256, b.wire.credentialHeadersSha256); assert.equal(arrival.bodySha256, b.wire.bodyAfterSha256);
    assert.equal(b.wire.originalSha256 === b.wire.transmittedSha256, positive); assert.equal(b.wire.originalHeadersSha256 === b.wire.transmittedHeadersSha256, positive);
    assert.equal(b.wire.field, positive ? "none" : caseId === "credential-invalid-encoding" ? "selected-credential-encoding" : "selected-credential-json");
    for (const field of ["body", "binding", "noncredential"]) assert.equal(b.wire[field + "BeforeSha256"], b.wire[field + "AfterSha256"]);
  }
  assert.equal(new Set(s.phases.flatMap(p => p.roles.map(r => r.pid))).size, 6);
});
