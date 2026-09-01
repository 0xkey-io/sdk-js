import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { currentX402AssetMismatchCases, resolveFinalX402AssetMismatchProfile } from "../../src/ipc.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [inputPath] = process.argv.slice(2); assert.equal(process.argv.length, 3);
const { input } = await readExecutionInput(inputPath); assert.equal(input.stage, "final-7b");
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const row = `${input.fixture}-asset-mismatch`;
const profile = resolveFinalX402AssetMismatchProfile(input.fixture, row, input.stage);

test(`${input.fixture} asset mismatch is complete before final-7b admission`, async () => {
  const contract = matrix.rows.find(candidate => candidate.id === row); assert.ok(contract);
  const directory = join(input.evidence, contract.id); await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "asset-mismatch-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000, maxOutputBytes: 4194304 });
  await writeFile(join(directory, "asset-mismatch.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED"); assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "observation.json")));
  assert.deepEqual([observed.scope, observed.coverage, observed.aggregateStatus, observed.stage], ["fault", "complete", "PASSED", "final-7b"]);
  assert.equal(observed.artifactSha256, input.consumer.artifactSha256); assert.deepEqual(observed.catalog, currentX402AssetMismatchCases);
  assert.deepEqual(observed.assetContract, { owner: profile.owner, version: profile.version, codecOwner: profile.codecOwner, offerField: "accepts.asset", offerDecimalsField: null, wireField: "accepted.asset" });
  const expected = Object.entries(currentX402AssetMismatchCases).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(observed.subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(observed.subcases.length, 6);
  for (const subcase of observed.subcases) {
    assert.equal(subcase.status, "PASSED");
    assert.equal(subcase.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === subcase.condition)), true);
    assert.equal(subcase.roles.some(role => role.inventory.some(entry => entry.name === "@x402/evm/exact/client" && entry.version === profile.version)), true);
    assert.equal(subcase.roles.some(role => role.inventory.some(entry => entry.name === "@x402/core/http" && entry.version === profile.version)), true);
    assert.equal(subcase.ports.every(port => port.rebound), true); assert.equal(subcase.tls.every(value => value.trusted && value.wrongCaRejected), true);
    assert.equal(subcase.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
    if (subcase.path === "offer") {
      const [negative, positive] = subcase.buyers, [failed] = subcase.checkpoints;
      assert.deepEqual([negative.counters.sign, negative.counters.save, negative.counters.signedSend, negative.counters.clear, negative.counters.rpc], [0, 0, 0, 0, 0]);
      assert.deepEqual([failed.merchant.counters.handler, failed.merchant.counters.applicationEffect, failed.facilitator.counters.verify, failed.facilitator.counters.settle, failed.facilitator.counters.economicEffect, failed.facilitator.counters.fulfillment, failed.facilitator.counters.rpc, failed.merchant.redirectTargets], [0, 0, 0, 0, 0, 0, 0, 0]);
      assert.deepEqual([positive.counters.sign, positive.counters.save, positive.counters.signedSend, positive.counters.clear, positive.counters.rpc, positive.status, positive.receiptValid], [1, 1, 1, 1, 4, 200, true]);
      assert.equal(subcase.merchant.offerChanges[0].field, "accepts.asset"); assert.equal(subcase.merchant.offerChanges[1].field, "none");
      assert.equal(subcase.merchant.offerChanges.every(value => value.codecOwner === profile.codecOwner && value.decoder === "decodePaymentRequiredHeader" && value.encoder === "encodePaymentRequiredHeader"), true);
      for (const change of subcase.merchant.offerChanges) {
        assert.match(change.unchangedBeforeSha256, /^[a-f0-9]{64}$/);
        assert.equal(change.unchangedBeforeSha256, change.unchangedAfterSha256);
      }
      assert.equal(subcase.merchant.offerChanges.every(value => value.envelopeBeforeSha256 === value.envelopeAfterSha256), true);
    } else {
      const [negative, positive] = subcase.checkpoints;
      assert.deepEqual([negative.buyer.counters.sign, negative.buyer.counters.signedSend, negative.buyer.status, negative.buyer.classification], [1, 1, 402, "no-matching-requirements"]);
      assert.deepEqual([negative.merchant.counters.handler, negative.merchant.counters.applicationEffect, negative.facilitator.counters.verify, negative.facilitator.counters.settle, negative.facilitator.counters.economicEffect, negative.facilitator.counters.fulfillment], [0, 0, 0, 0, 0, 0]);
      assert.deepEqual([negative.buyer.wire.field, negative.buyer.wire.codecOwner, negative.buyer.wire.decoder, negative.buyer.wire.encoder], ["accepted.asset", profile.codecOwner, "decodePaymentSignatureHeader", "encodePaymentSignatureHeader"]); assert.notEqual(negative.buyer.wire.originalSha256, negative.buyer.wire.transmittedSha256);
      assert.equal(negative.buyer.wire.unchangedBeforeSha256, negative.buyer.wire.unchangedAfterSha256); assert.equal(negative.buyer.wire.envelopeBeforeSha256, negative.buyer.wire.envelopeAfterSha256);
      assert.deepEqual([positive.buyer.status, positive.buyer.receiptValid, positive.buyer.wire.field], [200, true, "none"]);
    }
  }
});
