import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { currentTemporalValidityCases, resolveFinalTemporalValidityProfile } from "../../src/ipc.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [inputPath] = process.argv.slice(2), { input } = await readExecutionInput(inputPath), row = `${input.fixture}-temporal-validity`;
const matrix = JSON.parse(await readFile(join(root, "matrix.json"))), contract = matrix.rows.find(value => value.id === row), profile = resolveFinalTemporalValidityProfile(input.fixture, row, input.stage);

test(`${row} final temporal validity`, async () => {
  assert.ok(contract && contract.family === "fault"); const directory = join(input.evidence, row); await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, row, directory, "temporal-validity-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000, maxOutputBytes: 4194304 });
  await writeFile(join(directory, "temporal-validity.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 }); assert.equal(run.status, "PASSED", JSON.stringify({ reason: run.reason, lifecycle: run.lifecycle, stderr: run.stderr })); assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "observation.json"))); assert.deepEqual([observed.scope, observed.coverage, observed.aggregateStatus, observed.stage], ["fault", "complete", "PASSED", "final-7b"]); assert.equal(observed.artifactSha256, input.consumer.artifactSha256); assert.deepEqual(observed.catalog, currentTemporalValidityCases[profile.protocol]);
  const expected = Object.entries(profile.catalog).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition]))); assert.deepEqual(observed.subcases.map(value => [value.path, value.caseId, value.condition]), expected);
  for (const subcase of observed.subcases) {
    assert.equal(subcase.status, "PASSED"); assert.equal(subcase.ports.every(port => port.rebound), true); assert.equal(subcase.tls.every(value => value.trusted && value.wrongCaRejected), true); assert.equal(subcase.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
    if (subcase.path === "offer") { assert.equal(subcase.caseId, "expired-challenge"); assert.deepEqual(subcase.buyers.map(value => [value.stage, value.counters.sign, value.status]), [["negative", 0, 402], ["positive", 1, 200]]); }
    else {
      const [negative, positive] = subcase.checkpoints; assert.deepEqual([negative.buyer.counters.sign, negative.buyer.counters.signedSend, negative.buyer.status, negative.buyer.classification], [2, 1, 402, profile.protocol === "mpp" ? "verification-failed" : "temporal-rejected"]); assert.deepEqual([negative.merchant.counters.handler, negative.facilitator.counters.settle, negative.facilitator.counters.economicEffect], [0, 0, 0]); assert.deepEqual([positive.buyer.counters.sign, positive.buyer.status, positive.buyer.receiptValid], [1, 200, true]);
      const expectedWindow = subcase.caseId === "expired-authorization" ? ["0", "1"] : subcase.caseId === "future-authorization" ? ["4102444800", "4102444801"] : ["4102444800", "1"]; assert.deepEqual([negative.buyer.wire.validAfter, negative.buyer.wire.validBefore], expectedWindow); assert.equal(negative.buyer.wire.unchangedBeforeSha256, negative.buyer.wire.unchangedAfterSha256); assert.equal(negative.buyer.wire.envelopeBeforeSha256, negative.buyer.wire.envelopeAfterSha256);
    }
  }
});
