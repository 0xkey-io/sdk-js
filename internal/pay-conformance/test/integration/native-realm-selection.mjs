import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
const inputPath = process.argv[2], { input } = await readExecutionInput(inputPath);
assert.equal(input.fixture, "x402-2.23");
for (const condition of ["import", "require"]) {
  const directory = join(input.evidence, condition); await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin" });
  const command = [process.execPath, join(import.meta.dirname, "../../fixtures/runtime/realm-selection.mjs"), inputPath, condition, directory];
  const result = await runProcess({ command, cwd: directory, env, expectedVersions: { node: "24.3.0", pay: "1.0.0-rc.1", x402: "2.23.0" }, timeoutMs: 60000 });
  await writeFile(join(directory, "process.json"), JSON.stringify({ command, env, result }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(result.status, "PASSED"); assert.deepEqual(result.cleanup, { groupAbsent: true, forced: false });
  const observation = JSON.parse(await readFile(join(directory, "observation.json")));
  assert.equal(observation.roles.length, 2); assert.equal(observation.ports.every(port => port.rebound), true);
  assert.equal(observation.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
  console.log(JSON.stringify({ condition, error: observation.error, forbiddenHost: observation.forbiddenHost, counters: observation.counters }));
}
