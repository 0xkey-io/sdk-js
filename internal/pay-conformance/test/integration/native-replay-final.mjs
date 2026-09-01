import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { currentReplayCases, resolveFinalReplayProfile } from "../../src/ipc.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [inputPath] = process.argv.slice(2), { input } = await readExecutionInput(inputPath), row = `${input.fixture}-replay`;
const matrix = JSON.parse(await readFile(join(root, "matrix.json"))), contract = matrix.rows.find(value => value.id === row), profile = resolveFinalReplayProfile(input.fixture, row, input.stage);

test(`${row} final replay`, async () => {
  assert.ok(contract && contract.family === "fault"); const directory = join(input.evidence, row); await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, row, directory, "replay-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000, maxOutputBytes: 4194304 });
  await writeFile(join(directory, "replay.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 }); assert.equal(run.status, "PASSED", JSON.stringify({ reason: run.reason, lifecycle: run.lifecycle, stderr: run.stderr })); assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "observation.json"))); assert.deepEqual([observed.scope, observed.coverage, observed.aggregateStatus, observed.stage], ["fault", "complete", "PASSED", "final-7b"]); assert.equal(observed.artifactSha256, input.consumer.artifactSha256); assert.deepEqual(observed.catalog, currentReplayCases); assert.equal(observed.replayContract.servicesDatabaseUniquenessProven, false);
  const expected = Object.entries(profile.catalog).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition]))); assert.deepEqual(observed.subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(observed.subcases.length, 10);
  for (const subcase of observed.subcases) {
    assert.equal(subcase.status, "PASSED"); assert.equal(subcase.ports.every(port => port.rebound), true); assert.equal(subcase.tls.every(value => value.trusted && value.wrongCaRejected), true); assert.equal(subcase.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
    if (subcase.path === "buyer") { const [first, replay] = subcase.buyers; assert.deepEqual([first.credentialSha256, first.recordSha256], [replay.credentialSha256, replay.recordSha256]); assert.deepEqual([subcase.counters.sign, subcase.counters.save, subcase.counters.signedSend, subcase.counters.clear, subcase.counters.economicEffect, subcase.counters.applicationEffect], [1, 1, 2, 1, 1, 1]); assert.equal(subcase.persistedAfterReplay, null); }
    else if (subcase.path === "seller") { assert.equal(subcase.underlyingCaseId, "handler-500"); const final = subcase.checkpoints.at(-1); assert.deepEqual(final.buyer.requests, [final.buyer.requests[0], final.buyer.requests[0]]); assert.deepEqual([subcase.counters.settle, subcase.counters.economicEffect, subcase.counters.handler, subcase.counters.applicationEffect], [2, 1, 2, 1]); }
    else { assert.equal(currentReplayCases.owner.includes(subcase.caseId), true); assert.equal(subcase.barrierReleasedAfterAllReady, true); assert.equal(subcase.counters.economicEffect <= 1 && subcase.counters.applicationEffect <= 1, true); }
  }
});
