import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { resolveFinalSettleUnknownProfile } from "../../src/ipc.mjs";
import { prepareFinalExecutionBinding, retainFinalExecutionBinding } from "../../src/final-execution-binding.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inputPath = process.argv[2], { input } = await readExecutionInput(inputPath);
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const row = `${input.fixture}-settle-unknown`, profile = resolveFinalSettleUnknownProfile(input.fixture, row, input.stage);
const contract = matrix.rows.find(item => item.id === row);

test(`${row} closes durable unknown and physical owner boundaries`, async () => {
  assert.ok(contract); const directory = join(input.evidence, row); await mkdir(directory, { mode: 0o700 });
  const binding = await prepareFinalExecutionBinding({ inputPath, input });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, row, directory, "settle-unknown-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
  await writeFile(join(directory, "settle-unknown.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED"); assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "observation.json")));
  await retainFinalExecutionBinding({ binding, directory, observed });
  assert.deepEqual([observed.scope, observed.coverage, observed.aggregateStatus, observed.stage], ["fault", "complete", "PASSED", "final-7b"]);
  assert.equal(observed.artifactSha256, input.consumer.artifactSha256); assert.deepEqual(observed.catalog, profile.catalog);
  const expected = Object.entries(profile.catalog).flatMap(([path, ids]) => ids.flatMap(caseId => [[path, caseId, "import"], [path, caseId, "require"]]));
  assert.deepEqual(observed.subcases.map(s => [s.path, s.caseId, s.condition]), expected);
  for (const subcase of observed.subcases) { assert.equal(subcase.status, "PASSED"); assert.equal(subcase.inventory.some(entry => entry.version === profile.version), true); assert.equal(subcase.counters.clear, subcase.caseId === "verified-resume" ? 1 : 0); if (subcase.path === "seller") assert.equal(subcase.counters.handler, 0); }
  const bytes = JSON.stringify(observed); assert.doesNotMatch(bytes, /privateKey|rawBody|synthetic-secret/i);
});
