import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixture = dirname(fileURLToPath(import.meta.url));
const [provisionedRoot, consumerRoot, certificateRoot, evidenceDirectory] = process.argv.slice(2);
assert.ok(provisionedRoot && consumerRoot && certificateRoot && evidenceDirectory, "VALIDATOR_USAGE");
await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
const resultPath = join(resolve(evidenceDirectory), "validator-result.json");
const command = [process.execPath, join(fixture, "runtime.cjs"), resolve(provisionedRoot), resolve(consumerRoot), resolve(certificateRoot), resultPath];
const child = spawn(command[0], command.slice(1), {
  cwd: resolve(evidenceDirectory), detached: true,
  env: { PATH: "/opt/homebrew/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C", CI: "true", COREPACK_ENABLE_NETWORK: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
const stdout = [], stderr = [];
child.stdout.on("data", chunk => stdout.push(chunk)); child.stderr.on("data", chunk => stderr.push(chunk));
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 120_000);
const closed = await new Promise((accept, reject) => { child.once("error", reject); child.once("close", (code, signal) => accept({ code, signal })); });
clearTimeout(timer);
let groupAbsent = false; try { process.kill(-child.pid, 0); } catch (error) { groupAbsent = error?.code === "ESRCH"; }
const out = Buffer.concat(stdout), err = Buffer.concat(stderr);
await writeFile(join(evidenceDirectory, "stdout.jsonl"), out, { flag: "wx", mode: 0o600 });
await writeFile(join(evidenceDirectory, "stderr.txt"), err, { flag: "wx", mode: 0o600 });
assert.deepEqual([closed.code, closed.signal, timedOut, groupAbsent, err.length], [0, null, false, true, 0], "VALIDATOR_PROCESS");
const result = JSON.parse(await readFile(resultPath));
assert.deepEqual(result.summary, { passed: 16, failed: 0, warnings: 0, skipped: 0 }, "VALIDATOR_SUMMARY");
assert.equal(result.discovery.found && result.discovery.valid, true, "VALIDATOR_DISCOVERY");
assert.deepEqual([result.discovery.checks.length, result.endpoint.challenge.length, result.endpoint.errorHandling.length, result.endpoint.payment.length], [3, 11, 2, 0], "VALIDATOR_CHECK_COUNTS");
assert.deepEqual([result.requestCount, result.paymentEvents, result.privateRequestAttempts, result.skipPayment], [3, 0, 0, true], "VALIDATOR_NO_PAYMENT");
assert.deepEqual(result.requestShape.map(item => [item.method, item.path, item.authorization]), [["GET", "/openapi.json", "absent"], ["GET", "/paid", "absent"], ["GET", "/paid", "present"]], "VALIDATOR_REQUEST_SHAPE");
process.stdout.write(JSON.stringify({ status: "PASSED", command, observedVersions: { incur: "0.5.1", mppx: "0.8.19", typescript: "5.4.3", viem: "2.54.0", zod: "4.4.3" }, checks: 16, paymentChecks: 0, groupAbsent }) + "\n");
