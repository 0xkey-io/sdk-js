import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
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
