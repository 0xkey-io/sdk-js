import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { resolveFinalVerifySettleRejectionProfile } from "../../src/ipc.mjs";
import { prepareFinalExecutionBinding, retainFinalExecutionBinding } from "../../src/final-execution-binding.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inputPath = process.argv[2], { input } = await readExecutionInput(inputPath);
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const row = `${input.fixture}-verify-settle-rejection`;
const profile = resolveFinalVerifySettleRejectionProfile(input.fixture, row, input.stage);
const contract = matrix.rows.find(item => item.id === row);

test(`${row} closes native rejection ownership and no-handler boundaries`, async () => {
  assert.ok(contract); assert.equal(input.stage, "final-7b");
  const directory = join(input.evidence, row); await mkdir(directory, { mode: 0o700 });
  const binding = await prepareFinalExecutionBinding({ inputPath, input });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, row, directory, "verify-settle-rejection-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
  await writeFile(join(directory, "verify-settle-rejection.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED"); assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "observation.json")));
  await retainFinalExecutionBinding({ binding, directory, observed });
  assert.deepEqual([observed.scope, observed.coverage, observed.aggregateStatus, observed.stage], ["fault", "complete", "PASSED", "final-7b"]);
  assert.equal(observed.artifactSha256, input.consumer.artifactSha256); assert.deepEqual(observed.catalog, profile.catalog);
  const expected = Object.entries(profile.catalog).flatMap(([path, ids]) => ids.flatMap(caseId => [[path, caseId, "import"], [path, caseId, "require"]]));
  assert.deepEqual(observed.subcases.map(s => [s.path, s.caseId, s.condition]), expected);
  for (const subcase of observed.subcases) {
    assert.equal(subcase.status, "PASSED"); assert.equal(subcase.owner, profile.owner);
    assert.equal(subcase.inventory.some(entry => entry.version === profile.version), true);
    assert.equal(subcase.counters.handler, 0); assert.equal(subcase.counters.applicationEffect, 0);
    if (subcase.caseId === "verify-positive") assert.deepEqual([subcase.outcome, subcase.counters.verify, subcase.counters.settle], ["verified", 1, 0]);
    else if (subcase.caseId === "owner-rejected" || subcase.caseId.includes("4xx")) assert.equal(subcase.outcome, "native-owner-error");
    else if (subcase.caseId.includes("failed-result") || subcase.caseId.includes("rejected")) assert.equal(subcase.outcome, "deterministic-rejection");
    else assert.equal(subcase.outcome, "native-owner-error");
  }
  const forbiddenKeys = [];
  const visit = value => { if (!value || typeof value !== "object") return; for (const [key, child] of Object.entries(value)) { if (/^(signature|credential|privateKey|rawBody)$/i.test(key)) forbiddenKeys.push(key); visit(child); } };
  visit(observed); assert.deepEqual(forbiddenKeys, []); assert.doesNotMatch(JSON.stringify(observed.subcases), /synthetic-secret/i);
});
