import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { currentMppPayeeMismatchCases, resolveFinalMppPayeeMismatchProfile } from "../../src/ipc.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [inputPath] = process.argv.slice(2); assert.equal(process.argv.length, 3);
const { input } = await readExecutionInput(inputPath); assert.equal(input.stage, "final-7b");
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const row = `${input.fixture}-payee-mismatch`;
const profile = resolveFinalMppPayeeMismatchProfile(input.fixture, row, input.stage);

test(`${input.fixture} payee mismatch is complete before final-7b admission`, async () => {
  const contract = matrix.rows.find(candidate => candidate.id === row); assert.ok(contract);
  const directory = join(input.evidence, contract.id); await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "mpp-payee-mismatch-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000, maxOutputBytes: 4194304 });
  await writeFile(join(directory, "mpp-payee-mismatch.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED"); assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "observation.json")));
  assert.deepEqual([observed.scope, observed.coverage, observed.aggregateStatus, observed.stage], ["fault", "complete", "PASSED", "final-7b"]);
  assert.equal(observed.artifactSha256, input.consumer.artifactSha256); assert.deepEqual(observed.catalog, currentMppPayeeMismatchCases);
  assert.deepEqual(observed.payeeContract, { owner: profile.owner, version: profile.version, codecOwner: profile.codecOwner, offerField: "request.recipient", wireField: "payload.to", offerBoundary: "invalid-address-syntax-only; no independent payee allowlist" });
  const expected = Object.entries(currentMppPayeeMismatchCases).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(observed.subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(observed.subcases.length, 4);
  for (const subcase of observed.subcases) {
    assert.equal(subcase.status, "PASSED");
    assert.equal(subcase.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === subcase.condition)), true);
    assert.equal(subcase.roles.some(role => role.inventory.some(entry => entry.name === "mppx" && entry.version === profile.version)), true);
    assert.equal(subcase.ports.every(port => port.rebound), true); assert.equal(subcase.tls.every(value => value.trusted && value.wrongCaRejected), true);
    assert.equal(subcase.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
    if (subcase.path === "offer") {
      const [negative, positive] = subcase.buyers, [failed] = subcase.checkpoints;
      assert.deepEqual([negative.counters.sign, negative.counters.save, negative.counters.signedSend, negative.counters.clear, negative.counters.rpc], [0, 0, 0, 0, 0]);
      assert.deepEqual([failed.merchant.counters.handler, failed.merchant.counters.applicationEffect, failed.facilitator.counters.verify, failed.facilitator.counters.settle, failed.facilitator.counters.economicEffect, failed.facilitator.counters.fulfillment, failed.facilitator.counters.rpc, failed.merchant.redirectTargets], [0, 0, 0, 0, 0, 0, 0, 0]);
      assert.deepEqual([positive.counters.sign, positive.counters.save, positive.counters.signedSend, positive.counters.clear, positive.counters.rpc, positive.status, positive.receiptValid], [1, 1, 1, 1, 4, 200, true]);
      const [changed, calibration] = subcase.merchant.offerChanges;
      assert.deepEqual([changed.field, changed.codecOwner, changed.decoder, changed.encoder], ["request.recipient", profile.codecOwner, "Challenge.fromResponse", "Challenge.serialize"]);
      assert.deepEqual([calibration.field, calibration.codecOwner, calibration.decoder, calibration.encoder], ["none", profile.codecOwner, "Challenge.fromResponse", "Challenge.serialize"]);
      for (const change of [changed, calibration]) {
        for (const key of ["decodedPayeeSha256", "unchangedBeforeSha256", "unchangedAfterSha256", "envelopeBeforeSha256", "envelopeAfterSha256"]) assert.match(change[key], /^[a-f0-9]{64}$/);
        assert.equal(change.unchangedBeforeSha256, change.unchangedAfterSha256);
        assert.equal(change.envelopeBeforeSha256, change.envelopeAfterSha256);
      }
    } else {
      const [negative, positive] = subcase.checkpoints;
      assert.deepEqual([negative.buyer.counters.sign, negative.buyer.counters.signedSend, negative.buyer.status, negative.buyer.classification], [1, 1, 402, "verification-failed"]);
      assert.deepEqual([negative.merchant.counters.handler, negative.merchant.counters.applicationEffect, negative.facilitator.counters.verify, negative.facilitator.counters.settle, negative.facilitator.counters.economicEffect, negative.facilitator.counters.fulfillment], [0, 0, 0, 0, 0, 0]);
      assert.deepEqual([negative.buyer.wire.field, negative.buyer.wire.codecOwner, negative.buyer.wire.decoder, negative.buyer.wire.encoder], ["payload.to", profile.codecOwner, "Credential.deserialize", "Credential.serialize"]);
      assert.notEqual(negative.buyer.wire.originalSha256, negative.buyer.wire.transmittedSha256);
      assert.equal(negative.buyer.wire.challengeBeforeSha256, negative.buyer.wire.challengeAfterSha256);
      assert.equal(negative.buyer.wire.payloadRemainderBeforeSha256, negative.buyer.wire.payloadRemainderAfterSha256);
      assert.equal(negative.buyer.wire.unchangedBeforeSha256, negative.buyer.wire.unchangedAfterSha256);
      assert.deepEqual([positive.buyer.status, positive.buyer.receiptValid, positive.buyer.wire.field, positive.buyer.wire.codecOwner], [200, true, "none", profile.codecOwner]);
    }
  }
});
