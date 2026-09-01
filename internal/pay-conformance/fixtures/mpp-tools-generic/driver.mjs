import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "../../src/redact.mjs";

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const [provisionedRoot, rowId, evidenceDirectory] = process.argv.slice(2);
assert.ok(provisionedRoot && rowId && evidenceDirectory, "MPP_TOOLS_USAGE");
const vector = rowId.replace("official-mpp-tools-generic-", "");
const expectedChecks = { base64url: 32, "www-authenticate": 39, authorization: 11, receipt: 10, "challenge-id": 27 };
assert.equal(Number.isInteger(expectedChecks[vector]), true, "MPP_TOOLS_VECTOR");

async function files(root, current = root) {
  const result = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (["node_modules", ".venv", "__pycache__"].includes(entry.name)) continue;
    if (entry.isDirectory()) result.push(...await files(root, path));
    else if (entry.isFile()) result.push(relative(root, path));
  }
  return result.sort();
}
// The fixture package.json intentionally drops the upstream convenience scripts;
// the frozen package-lock and every executable source byte remain exact.
const closure = (await files(sourceRoot)).filter(name => !["driver.mjs", "package.json"].includes(name));
for (const name of closure) assert.equal(sha256(await readFile(join(sourceRoot, name))), sha256(await readFile(join(provisionedRoot, name))), `MPP_TOOLS_SOURCE:${name}`);
await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
const python = join(resolve(provisionedRoot), ".venv/bin/python");
const command = [python, join(resolve(provisionedRoot), "scripts/vector_runner.py"), "--adapter", "typescript", "--vector", vector, "--output", "json"];
const child = spawn(command[0], command.slice(1), {
  cwd: resolve(provisionedRoot), detached: true,
  env: { PATH: `${resolve(provisionedRoot)}/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin`, LANG: "C", LC_ALL: "C", HOME: "/private/tmp/pay-final-7c-empty-home", NPM_CONFIG_OFFLINE: "true", COREPACK_ENABLE_NETWORK: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
const stdout = [], stderr = []; child.stdout.on("data", chunk => stdout.push(chunk)); child.stderr.on("data", chunk => stderr.push(chunk));
let timedOut = false; const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 90_000);
const closed = await new Promise((accept, reject) => { child.once("error", reject); child.once("close", (code, signal) => accept({ code, signal })); }); clearTimeout(timer);
let groupAbsent = false; try { process.kill(-child.pid, 0); } catch (error) { groupAbsent = error?.code === "ESRCH"; }
const out = Buffer.concat(stdout), err = Buffer.concat(stderr);
await writeFile(join(evidenceDirectory, "result.json"), out, { flag: "wx", mode: 0o600 });
await writeFile(join(evidenceDirectory, "stderr.txt"), err, { flag: "wx", mode: 0o600 });
assert.deepEqual([closed.code, closed.signal, timedOut, groupAbsent, err.length], [0, null, false, true, 0], "MPP_TOOLS_PROCESS");
const result = JSON.parse(out);
assert.deepEqual([result.status, result.num_checks, result.passed, result.failed, result.skipped, result.errors.length], ["pass", expectedChecks[vector], expectedChecks[vector], 0, 0, 0], "MPP_TOOLS_RESULT");
assert.equal(result.checks.every(check => check.status === "SUCCESS" && check.details.adapter === "typescript" && check.details.vector === vector), true, "MPP_TOOLS_CHECKS");
process.stdout.write(JSON.stringify({ status: "PASSED", command, vector, observedVersions: { mppx: "0.8.18" }, checks: expectedChecks[vector], groupAbsent, sourceFiles: closure.length }) + "\n");
