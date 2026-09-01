import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { once } from "node:events";
import { isolatedEnvironment, runProcess } from "../src/process.mjs";

const directory = await mkdtemp(join(tmpdir(), "pay-conformance-process-"));
const env = await isolatedEnvironment(directory, { path: "/usr/bin:/bin" });
const options = (scenario) => ({
  command: [process.execPath, join(import.meta.dirname, "child.mjs"), scenario],
  cwd: directory,
  env,
  expectedVersions: { node: process.versions.node },
  timeoutMs: 500,
  maxOutputBytes: 4096,
});

test("child configuration ignores ambient auth and pins separate empty npm configs", async () => {
  assert.equal(Object.hasOwn(env, "HOME"), false);
  assert.equal(Object.hasOwn(env, "NODE_OPTIONS"), false);
  assert.equal(Object.hasOwn(env, "HTTP_PROXY"), false);
  assert.equal(env.COREPACK_ENABLE_NETWORK, "0");
  assert.notEqual(env.NPM_CONFIG_USERCONFIG, env.NPM_CONFIG_GLOBALCONFIG);
  assert.equal(await readFile(env.NPM_CONFIG_USERCONFIG, "utf8"), "");
  assert.equal(await readFile(env.NPM_CONFIG_GLOBALCONFIG, "utf8"), "");
});

test("process preflight rejects online or ambient execution configuration before spawn", async () => {
  for (const change of [
    { NPM_CONFIG_OFFLINE: "false" },
    { NPM_CONFIG_IGNORE_SCRIPTS: "false" },
    { NODE_OPTIONS: "--require=ambient.cjs" },
    { HOME: "/unowned" },
    { NPM_CONFIG_USERCONFIG: undefined },
  ]) {
    await assert.rejects(
      runProcess({ ...options("success"), env: { ...env, ...change } }),
      { message: "ENVIRONMENT_REJECTED" },
    );
  }
});

test("missing executable is a prerequisite blocker, not a protocol failure", async () => {
  const result = await runProcess({
    ...options("success"),
    command: [join(directory, "absent-node")],
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "SPAWN_FAILED");
  assert.equal(result.pid, null);
});

test("output limits terminate the actual process and never accept a partial control stream", async () => {
  const result = await runProcess({
    ...options("success"),
    maxOutputBytes: 20,
  });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reason, "OUTPUT_LIMIT");
  assert.equal(result.cleanup.groupAbsent, true);
});

test("valid JSONL lifecycle completes and nonzero failures do not pass", async () => {
  const success = await runProcess(options("success"));
  assert.equal(success.status, "PASSED");
  assert.deepEqual(success.command, options("success").command);
  assert.deepEqual(success.lifecycle, [
    "spawned",
    "identified",
    "ready",
    "observed",
    "completed",
    "closed",
  ]);
  assert.equal(success.cleanup.groupAbsent, true);
  assert.equal((await runProcess(options("failure"))).status, "FAILED");
});

test("wrong versions stop before ready; corrupt or reordered control events cannot pass", async () => {
  const mismatch = await runProcess(options("wrong-version"));
  assert.equal(mismatch.status, "FAILED");
  assert.equal(mismatch.lifecycle.includes("ready"), false);
  for (const scenario of ["raw-output", "duplicate-version"]) {
    const result = await runProcess(options(scenario));
    assert.equal(result.status, "UNKNOWN");
    assert.equal(
      JSON.stringify(result).includes("unique-private-sentinel-7a"),
      false,
    );
  }
});

test("stderr is hash-only evidence and never a silently clean pass", async () => {
  const result = await runProcess(options("stderr"));
  assert.equal(result.status, "FAILED");
  assert.equal(
    JSON.stringify(result).includes("unique-private-sentinel-7a"),
    false,
  );
  assert.equal(result.stderr.bytes, 27);
});

for (const kind of ["versions", "ready", "observation", "result"]) {
  test(`rejected coercible ${kind} control cannot leak through process diagnostics`, async () => {
    const result = await runProcess(options(`coercible-${kind}`));
    assert.equal(result.status, "UNKNOWN");
    assert.equal(
      JSON.stringify(result).includes("synthetic-discriminator-secret-7a"),
      false,
    );
    assert.equal(result.reason, "CONTROL_CORRUPT");
    assert.equal(result.stdout.discardedLines, 1);
    assert.deepEqual(
      result.stdout.events.map((event) => event.type),
      ["versions", "ready"],
    );
    assert.equal(result.cleanup.groupAbsent, true);
    assert.equal(result.cleanup.forced, true);
  });
}

test("deadline kills the entire child group and its actual listening grandchild", async () => {
  const result = await runProcess(options("timeout-tree"));
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reason, "TIMEOUT");
  assert.equal(result.cleanup.groupAbsent, true);
  assert.equal(result.cleanup.forced, true);
  const port = result.stdout.events.find(
    (event) => event.type === "ready",
  ).port;
  const probe = net.createServer();
  probe.listen(port, "127.0.0.1");
  await once(probe, "listening");
  await new Promise((done) => probe.close(done));
});

// Injection exercises supervisor error accounting; it does not reproduce an OS
// denial's cause. The child executes its real control stream and exits normally.
test("injected denied post-close probe preserves real child evidence without a false pass", async (t) => {
  const kill = process.kill.bind(process);
  t.mock.method(process, "kill", (pid, signal) => {
    if (pid < 0 && signal === 0)
      throw Object.assign(new Error("SYNTHETIC_PROBE_SECRET"), { code: "EPERM" });
    return kill(pid, signal);
  });
  const result = await runProcess(options("success"));
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reason, "CLEANUP_FAILED");
  assert.equal(result.exitCode, 0);
  assert.equal(result.cleanup.groupAbsent, false);
  assert.equal(result.cleanup.forced, false);
  assert.equal(result.diagnostics.cleanupState, "unknown");
  assert.deepEqual(result.diagnostics.cleanupErrors, [{ operation: "probe", code: "EPERM" }]);
  assert.equal(result.lifecycle.includes("completed"), true);
  assert.equal(result.lifecycle.includes("closed"), false);
  assert.equal(result.stdout.events.at(-1).type, "result");
  assert.equal(JSON.stringify(result).includes("SYNTHETIC_PROBE_SECRET"), false);
  // Observe the actual fixture group independently after restoring real syscall.
  t.mock.restoreAll();
  assert.throws(() => kill(-result.pid, 0), { code: "ESRCH" });
});

test("injected transient probe denial stays visible after real absence is observed", async (t) => {
  const kill = process.kill.bind(process);
  for (const [scenario, status, reason, exitCode] of [
    ["success", "UNKNOWN", "CLEANUP_FAILED", 0],
    ["failure", "FAILED", "EXIT_NONZERO", 3],
  ]) {
    let denied = false;
    t.mock.method(process, "kill", (pid, signal) => {
      if (pid < 0 && signal === 0 && !denied) {
        denied = true;
        throw Object.assign(new Error("SYNTHETIC_PROBE_SECRET"), { code: "EPERM" });
      }
      return kill(pid, signal);
    });
    const result = await runProcess(options(scenario));
    assert.equal(result.status, status);
    assert.equal(result.reason, reason);
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.cleanup.groupAbsent, true);
    assert.equal(result.diagnostics.cleanupState, "absent");
    assert.deepEqual(result.diagnostics.cleanupErrors, [{ operation: "probe", code: "EPERM" }]);
    assert.equal(JSON.stringify(result).includes("SYNTHETIC_PROBE_SECRET"), false);
    t.mock.restoreAll();
  }
});

// Only SIGKILL is fault-injected. The real owned child/listening descendant live
// until test teardown; this does not claim to reproduce Darwin permission state.
test("injected denied SIGKILL returns bounded evidence without a supervisor resignal", async (t) => {
  const spawn = childProcess.spawn, kill = process.kill.bind(process);
  let child, signals = 0, teardownTimer, port;
  t.mock.method(childProcess, "spawn", (...args) => {
    child = spawn(...args);
    return child;
  });
  syncBuiltinESMExports();
  const teardown = () => {
    if (child?.pid && child.exitCode === null && child.signalCode === null)
      kill(-child.pid, "SIGKILL");
  };
  t.mock.method(process, "kill", (pid, signal) => {
    if (pid === -child?.pid && signal === "SIGKILL") {
      signals++;
      teardownTimer ??= setTimeout(teardown, 1500);
      throw Object.assign(new Error("SYNTHETIC_SIGNAL_SECRET"), { code: "EPERM" });
    }
    return kill(pid, signal);
  });
  try {
    const result = await runProcess(options("timeout-tree"));
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reason, "TIMEOUT");
    assert.equal(result.cleanup.groupAbsent, false);
    assert.equal(result.cleanup.forced, true);
    assert.equal(result.diagnostics.closeObserved, false);
    assert.equal(result.diagnostics.stdioAbandoned, true);
    assert.deepEqual(result.diagnostics.cleanupErrors, [{ operation: "signal", code: "EPERM" }]);
    assert.equal(result.stdout.events.some(event => event.type === "ready"), true);
    assert.equal(result.lifecycle.includes("closed"), false);
    assert.equal(signals, 1, "supervisor must not retry a denied signal");
    assert.equal(JSON.stringify(result).includes("SYNTHETIC_SIGNAL_SECRET"), false);
    port = result.stdout.events.find(event => event.type === "ready").port;
    const probe = net.createServer();
    probe.listen(port, "127.0.0.1");
    await assert.rejects(once(probe, "listening"), { code: "EADDRINUSE" });
  } finally {
    clearTimeout(teardownTimer);
    t.mock.restoreAll(); syncBuiltinESMExports();
    const closed = child && child.exitCode === null && child.signalCode === null ? once(child, "close") : null;
    teardown();
    if (closed) await closed;
  }
  const rebound = net.createServer(); rebound.listen(port, "127.0.0.1");
  await once(rebound, "listening"); await new Promise(done => rebound.close(done));
});

test("an observed group after child close is not authority to signal the numeric PGID", async (t) => {
  const kill = process.kill.bind(process);
  let present = false, signals = 0;
  t.mock.method(process, "kill", (pid, signal) => {
    if (pid < 0 && signal === 0 && !present) {
      present = true;
      return true; // Injection: the already closed fixture's numeric group is present.
    }
    if (pid < 0 && signal !== 0) signals++;
    return kill(pid, signal);
  });
  const result = await runProcess(options("success"));
  assert.equal(result.status, "FAILED");
  assert.equal(result.reason, "PROCESS_LEAK");
  assert.equal(result.cleanup.groupAbsent, true);
  assert.equal(result.cleanup.forced, false);
  assert.equal(signals, 0);
});
