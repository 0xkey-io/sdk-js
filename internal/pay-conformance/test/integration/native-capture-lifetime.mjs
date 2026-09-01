import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inputPath = process.argv[2], { input, inputSha256 } = await readExecutionInput(inputPath);
assert.equal(input.stage, "development-only");
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const contract = matrix.rows.find(row => row.fixture === input.fixture && row.family === "recovery");
assert.ok(contract);

// Removing the recovery capture's IPC reference must expose the actual buyer's
// premature exit after its HTTPS handles drain, not merely test a dummy child.
test(input.fixture + " captured buyer stays alive and silent until supervisor SIGKILL", async () => {
  const directory = join(input.evidence, "capture-lifetime");
  await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(import.meta.dirname, "capture-lifetime-host.mjs"), inputPath, directory], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
  await writeFile(join(directory, "process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "lifetime.json")));
  assert.equal(observed.inputSha256, inputSha256);
  assert.equal(observed.artifactSha256, input.consumer.artifactSha256);
  assert.equal(observed.failure, null, "capture setup and durable authentication must succeed");
  assert.deepEqual([observed.prepared.counters.sign, observed.prepared.counters.save, observed.prepared.counters.signedSend, observed.prepared.counters.clear], [1, 1, 0, 0]);
  assert.equal(observed.recordSha256, observed.prepared.recordSha256);
  assert.equal(observed.credentialSha256, observed.prepared.credentialSha256);
  assert.equal(observed.ciphertextAfter, observed.ciphertextBefore);
  assert.equal(observed.ports.length, 2);
  assert.equal(observed.ports.every(port => port.rebound), true);
  assert.equal(observed.tls.length, 2);
  assert.equal(observed.tls.every(control => control.trusted && control.wrongCaRejected), true);
  assert.equal(observed.roles.length, 3);
  assert.equal(observed.roles.every(role => role.identifiedBeforeIo && role.absentAfterCleanup), true);
  assert.equal(observed.aliveUntilKill, true, `buyer exited before supervisor kill: ${JSON.stringify(observed.termination)}`);
  assert.deepEqual(observed.termination, { code: null, signal: "SIGKILL", reason: "ROLE_EXIT_NONZERO" });
  assert.equal(observed.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
  assert.ok(BigInt(observed.killAtNs) > BigInt(observed.drainedAtNs));
  assert.equal(run.status, "PASSED");
});
