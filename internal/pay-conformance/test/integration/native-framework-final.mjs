import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [inputPath, row] = process.argv.slice(2), { input } = await readExecutionInput(inputPath);
const matrix = JSON.parse(await readFile(join(root, "matrix.json"))), contract = matrix.rows.find(value => value.id === row && value.fixture === input.fixture);

test(`${row} final framework row`, async () => {
  assert.ok(contract && ["injection", "owner-control"].includes(contract.family));
  const directory = join(input.evidence, row); await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, row, directory], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000, maxOutputBytes: 4194304 });
  await writeFile(join(directory, "framework.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED", JSON.stringify({ reason: run.reason, lifecycle: run.lifecycle, stderr: run.stderr })); assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "observation.json")));
  assert.deepEqual([observed.row, observed.coverage, observed.aggregateStatus, observed.stage], [row, "complete", "PASSED", "final-7b"]); assert.equal(observed.artifactSha256, input.consumer.artifactSha256); assert.deepEqual(observed.versions, contract.expectedVersions);
  assert.equal(observed.inventory.every(value => typeof value.name === "string" && typeof value.version === "string" && /^[a-f0-9]{64}$/.test(value.entrySha256)), true);
  assert.equal(basename(contract.driver), "driver.mjs");
});
