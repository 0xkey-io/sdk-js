import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inputPath = process.argv[2], row = process.argv[3], { input } = await readExecutionInput(inputPath);
const matrix = JSON.parse(await readFile(join(root, "matrix.json"))), contract = matrix.rows.find(item => item.id === row);
assert.ok(contract && contract.fixture === input.fixture && contract.family === "native-corpus" && ["import", "require"].some(condition => row === `${input.fixture}-malformed-wire-${condition}`));

test(row + " final redacted MPP malformed corpus", async () => {
  const directory = join(input.evidence, row); await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, row, directory, "mpp-malformed-corpus-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000, maxOutputBytes: 4194304 });
  await writeFile(join(directory, "mpp-malformed-corpus.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 }); assert.equal(run.status, "PASSED", JSON.stringify({ reason: run.reason, lifecycle: run.lifecycle, stdout: run.stdout, stderr: run.stderr })); assert.equal(run.cleanup.groupAbsent, true);
  const bytes = await readFile(join(directory, "observation.json"), "utf8"), observed = JSON.parse(bytes);
  assert.deepEqual([observed.scope, observed.coverage, observed.aggregateStatus, observed.stage, observed.tupleCount], ["native-corpus", "complete", "PASSED", "final-7b", 104]);
  assert.equal(observed.artifactSha256, input.consumer.artifactSha256); assert.equal(observed.corpus.rawOutputRetained, false); assert.equal(observed.inventory.some(entry => entry.name === "mppx" && entry.version === input.fixture.slice(5)), true);
  assert.equal(observed.rows.length, 104); assert.equal(observed.rows.every(value => typeof value.bodySha256 === "string" && typeof value.headersSha256 === "string" && !Object.hasOwn(value, "body") && !Object.hasOwn(value, "headers")), true);
  assert.doesNotMatch(bytes, /01234567890123456789012345678901|raw-input-sentinel|rawInputSentinel|dGhpcyBpcyBnYXJiYWdl|22222222-2222-4222-8222-222222222222/);
});
