import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";

// Separate processes consume real saved native billing records. These are
// explicitly key-holder-created derived records, not genuine minted variants.
const [consumer, evidenceRoot, output] = process.argv.slice(2);
await mkdir(output, { mode: 0o700 });
const rows = [];
for (const version of ["0.8.19", "0.8.17"]) for (const condition of ["import", "require"]) {
  const directory = join(output, version + "-" + condition);
  await mkdir(directory, { mode: 0o700 });
  const original = join(evidenceRoot, "billing-mppx-" + version, "mppx-" + version + "-protocol-freeze", "billing-" + condition, "durable");
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin" });
  const command = [process.execPath, join(import.meta.dirname, "../../fixtures/runtime/realm-derived.mjs"), consumer, original, condition, directory];
  const run = await runProcess({ command, cwd: directory, env, expectedVersions: { node: "24.3.0", pay: "1.0.0-rc.1", mppx: "0.8.19" }, timeoutMs: 60000 });
  await writeFile(join(directory, "process.json"), JSON.stringify({ command, env, run }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED"); assert.deepEqual(run.cleanup, { groupAbsent: true, forced: false });
  const observation = JSON.parse(await readFile(join(directory, "observation.json")));
  assert.equal(observation.rows.length, 12);
  assert.equal(observation.rows.every(row => Object.values(row.counters).every(count => count === 0) && row.retained), true);
  rows.push({ version, condition, pid: run.pid, rows: observation.rows.length });
}
assert.equal(new Set(rows.map(row => row.pid)).size, 4);
await writeFile(join(output, "results.json"), JSON.stringify({ scope: "native-original-derived-rejection", coverage: "partial", aggregateStatus: "BLOCKED", rows }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(rows));
