import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import net from "node:net";
import { isolatedEnvironment, runProcess } from "../src/process.mjs";

for (const [scenario, reason] of [["success", null], ["corrupt", "IPC_MESSAGE_REJECTED"], ["overflow", "ROLE_OUTPUT_LIMIT"], ["queue", "ROLE_QUEUE_LIMIT"], ["stderr", "ROLE_STDERR_PRESENT"]]) {
  test(`real ${scenario} role preserves a sticky closed failure and reclaims its port`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "pay-role-control-"));
    const env = await isolatedEnvironment(join(directory, "env"), { path: "/usr/bin:/bin" });
    const result = await runProcess({ command: [process.execPath, join(import.meta.dirname, "role-host.mjs"), scenario, join(directory, "observed.json")], cwd: directory, env, expectedVersions: { node: process.versions.node }, timeoutMs: 3000 });
    assert.equal(result.status, "PASSED", "supervisor test host completes; this is not a protocol row");
    assert.equal(result.cleanup.groupAbsent, true);
    const observed = JSON.parse(await readFile(join(directory, "observed.json")));
    assert.equal(observed.result.reason, reason);
    assert.equal(observed.accepted, reason === null);
    assert.equal(observed.rejection, reason);
    assert.equal(JSON.stringify({ result, observed }).includes("SYNTHETIC_ROLE_SECRET"), false);
    const port = result.stdout.events.find(event => event.type === "ready").port;
    const server = net.createServer(); server.listen(port, "127.0.0.1"); await once(server, "listening"); await new Promise(resolve => server.close(resolve));
  });
}

test("the row deadline reclaims an actual role and its descendant in the same process group", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pay-role-timeout-"));
  const env = await isolatedEnvironment(join(directory, "env"), { path: "/usr/bin:/bin" });
  const result = await runProcess({ command: [process.execPath, join(import.meta.dirname, "role-host.mjs"), "timeout", join(directory, "observed.json")], cwd: directory, env, expectedVersions: { node: process.versions.node }, timeoutMs: 1000 });
  assert.equal(result.status, "UNKNOWN"); assert.equal(result.reason, "TIMEOUT");
  assert.equal(result.cleanup.groupAbsent, true); assert.equal(result.cleanup.forced, true);
  const port = result.stdout.events.find(event => event.type === "ready").port;
  const server = net.createServer(); server.listen(port, "127.0.0.1"); await once(server, "listening"); await new Promise(resolve => server.close(resolve));
});

for (const scenario of ["warning-timeout", "warning-json", "warning-shape", "warning-buyer", "warning-facilitator", "warning-caller", "warning-x-merchant", "warning-ordinary", "warning-mpp-only", "warning-positive", "warning-altered", "warning-duplicate", "warning-appended-secret", "warning-stdout"]) {
  test(`real ${scenario} keeps the exact supported warning exception closed`, async () => {
    const accepted = ["warning-timeout", "warning-json", "warning-shape"].includes(scenario);
    const directory = await mkdtemp(join(tmpdir(), "pay-support-warning-"));
    const env = await isolatedEnvironment(join(directory, "env"), { path: "/usr/bin:/bin" });
    const run = await runProcess({ command: [process.execPath, join(import.meta.dirname, "role-host.mjs"), scenario, join(directory, "observed.json")], cwd: directory, env, expectedVersions: { node: process.versions.node }, timeoutMs: 3000 });
    assert.equal(run.status, "PASSED"); assert.equal(run.cleanup.groupAbsent, true);
    const observed = JSON.parse(await readFile(join(directory, "observed.json")));
    const reason = accepted ? null : scenario === "warning-stdout" ? "ROLE_STDOUT_PRESENT" : "ROLE_STDERR_PRESENT";
    assert.equal(observed.result.reason, reason); assert.equal(observed.rejection, reason); assert.equal(observed.accepted, accepted);
    assert.equal(observed.expectedSupportedWarning, accepted || scenario === "warning-stdout" ? 1 : 0);
    if (accepted) assert.deepEqual(observed.diagnostics.stderr, { bytes: 120, sha256: "a5646607702706fcadf29c9b0ec20dfe087f34d0d0203e7c862fa9a007693ed3" });
    assert.equal(JSON.stringify({ run, observed }).includes("SYNTHETIC_ROLE_SECRET"), false);
    const port = run.stdout.events.find(event => event.type === "ready").port;
    const probe = net.createServer(); probe.listen(port, "127.0.0.1"); await once(probe, "listening"); await new Promise(resolve => probe.close(resolve));
  });
}

// Actual timeout/descendant lifecycle with only the post-close syscall result
// injected. This is a deterministic error-accounting control, not an OS cause.
test("injected denied role cleanup probe retains TIMEOUT and the real reclaimed port", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pay-role-denied-probe-"));
  const env = await isolatedEnvironment(join(directory, "env"), { path: "/usr/bin:/bin" });
  const kill = process.kill.bind(process);
  t.mock.method(process, "kill", (pid, signal) => {
    if (pid < 0 && signal === 0)
      throw Object.assign(new Error("SYNTHETIC_ROLE_SECRET"), { code: "EPERM" });
    return kill(pid, signal);
  });
  const result = await runProcess({ command: [process.execPath, join(import.meta.dirname, "role-host.mjs"), "timeout", join(directory, "observed.json")], cwd: directory, env, expectedVersions: { node: process.versions.node }, timeoutMs: 1000 });
  assert.equal(result.status, "UNKNOWN"); assert.equal(result.reason, "TIMEOUT");
  assert.equal(result.cleanup.groupAbsent, false); assert.equal(result.cleanup.forced, true);
  assert.equal(result.diagnostics.closeObserved, true);
  assert.equal(result.diagnostics.cleanupState, "unknown");
  assert.deepEqual(result.diagnostics.cleanupErrors, [{ operation: "probe", code: "EPERM" }]);
  assert.equal(result.lifecycle.includes("closed"), false);
  assert.equal(JSON.stringify(result).includes("SYNTHETIC_ROLE_SECRET"), false);
  t.mock.restoreAll();
  assert.throws(() => kill(-result.pid, 0), { code: "ESRCH" });
  const port = result.stdout.events.find(event => event.type === "ready").port;
  const server = net.createServer(); server.listen(port, "127.0.0.1"); await once(server, "listening"); await new Promise(resolve => server.close(resolve));
});
