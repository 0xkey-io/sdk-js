import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { currentMppUnsupportedAuthorizationCases, resolveFinalMppUnsupportedAuthorizationProfile } from "../../src/ipc.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [inputPath] = process.argv.slice(2); assert.equal(process.argv.length, 3);
const { input } = await readExecutionInput(inputPath); assert.equal(input.stage, "final-7b");
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const row = `${input.fixture}-unsupported-authorization`;
const profile = resolveFinalMppUnsupportedAuthorizationProfile(input.fixture, row, input.stage);

test(`${input.fixture} unsupported authorization is complete before final-7b admission`, async () => {
  const contract = matrix.rows.find(candidate => candidate.id === row); assert.ok(contract);
  const directory = join(input.evidence, contract.id); await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "mpp-authorization-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000, maxOutputBytes: 4194304 });
  await writeFile(join(directory, "authorization.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED"); assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "observation.json")));
  assert.deepEqual([observed.scope, observed.coverage, observed.aggregateStatus, observed.stage], ["fault", "complete", "PASSED", "final-7b"]);
  assert.equal(observed.artifactSha256, input.consumer.artifactSha256);
  assert.deepEqual(observed.catalog, currentMppUnsupportedAuthorizationCases);
  assert.deepEqual(observed.selectionContract, { protocol: "mpp", owner: profile.owner, version: profile.version, method: "evm", intent: "charge", positiveAuthorization: "authorization", negativeAuthorization: "future-authorization" });
  const expected = Object.entries(currentMppUnsupportedAuthorizationCases).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(observed.subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(observed.subcases.length, 6);
  for (const subcase of observed.subcases) {
    assert.equal(subcase.status, "PASSED"); assert.equal(subcase.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === subcase.condition)), true);
    assert.equal(subcase.ports.every(port => port.rebound), true); assert.equal(subcase.tls.every(value => value.trusted && value.wrongCaRejected), true);
    const negative = subcase.path === "offer" ? subcase.buyers[0] : subcase.checkpoints[0].buyer;
    const positive = subcase.path === "offer" ? subcase.buyers[1] : subcase.checkpoints[1].buyer;
    assert.deepEqual([negative.counters.sign, negative.counters.signedSend], subcase.path === "offer" ? [0, 0] : [1, 1]);
    assert.deepEqual([positive.counters.sign, positive.counters.signedSend, positive.receiptValid], [1, 1, true]);
    const failed = subcase.checkpoints[0];
    assert.deepEqual([failed.merchant.counters.handler, failed.merchant.counters.applicationEffect, failed.facilitator.counters.settle, failed.facilitator.counters.economicEffect], [0, 0, 0, 0]);
    assert.equal(failed.merchant.redirectTargets, 0);
    if (subcase.path === "offer") {
      const target = { protocol: "mpp", method: subcase.caseId === "non-evm-method" ? "tempo" : "evm", intent: subcase.caseId === "session-intent" ? "session" : "charge", authorization: null, owner: profile.owner, operation: "challenge-decode", wireSha256: subcase.targetSelection.wireSha256 };
      const actual = { protocol: "mpp", method: "evm", intent: "charge", authorization: "authorization", owner: profile.owner, operation: "credential-decode", wireSha256: subcase.actualSelection.wireSha256 };
      assert.deepEqual(subcase.targetSelection, target); assert.deepEqual(subcase.actualSelection, actual);
      assert.deepEqual(subcase.buyers[0].targetSelection, target); assert.equal(subcase.buyers[0].actualSelection, null);
      assert.equal(subcase.buyers[1].targetSelection, null); assert.deepEqual(subcase.buyers[1].actualSelection, actual);
      assert.match(target.wireSha256, /^[a-f0-9]{64}$/); assert.match(actual.wireSha256, /^[a-f0-9]{64}$/);
      assert.equal(target.wireSha256, subcase.checkpoints[0].merchant.offerChanges[0].afterSha256);
      assert.equal(actual.wireSha256, subcase.buyers[1].credentialSha256);
    } else {
      const target = { protocol: "mpp", method: "evm", intent: "charge", authorization: "future-authorization", owner: profile.owner, operation: "credential-decode", wireSha256: subcase.checkpoints[0].buyer.targetSelection.wireSha256 };
      const actual = { protocol: "mpp", method: "evm", intent: "charge", authorization: "authorization", owner: profile.owner, operation: "credential-decode", wireSha256: subcase.checkpoints[1].buyer.actualSelection.wireSha256 };
      assert.deepEqual(subcase.targetSelection, target); assert.deepEqual(subcase.actualSelection, actual);
      assert.equal(subcase.checkpoints[0].buyer.actualSelection, null); assert.deepEqual(subcase.checkpoints[0].buyer.targetSelection, target);
      assert.equal(subcase.checkpoints[1].buyer.targetSelection, null); assert.deepEqual(subcase.checkpoints[1].buyer.actualSelection, actual);
      const failedCredential = subcase.checkpoints[0].merchant.wireArrivals.find(value => value.credentialSha256)?.credentialSha256;
      const actualCredential = subcase.checkpoints[1].merchant.wireArrivals.find(value => value.credentialSha256)?.credentialSha256;
      assert.equal(target.wireSha256, failedCredential); assert.equal(actual.wireSha256, actualCredential);
    }
  }
});
