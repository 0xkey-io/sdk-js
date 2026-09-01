import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { assertVersions } from "./run.mjs";
import { redactOutput, validateEvent, sha256 } from "./redact.mjs";

export async function isolatedEnvironment(
  directory,
  { path, corepackHome } = {},
) {
  if (!isAbsolute(directory) || typeof path !== "string")
    throw new Error("ENVIRONMENT_REJECTED");
  for (const name of ["tmp", "cache", "config", "data"])
    await mkdir(join(directory, name), { recursive: true, mode: 0o700 });
  const user = join(directory, "empty-user.npmrc"),
    global = join(directory, "empty-global.npmrc");
  for (const file of [user, global]) {
    try {
      await writeFile(file, "", { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST" || (await readFile(file)).length)
        throw new Error("NPM_CONFIG_REJECTED");
    }
  }
  return Object.freeze({
    PATH: path,
    LANG: "C",
    LC_ALL: "C",
    CI: "true",
    TMPDIR: join(directory, "tmp"),
    XDG_CACHE_HOME: join(directory, "cache"),
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_DATA_HOME: join(directory, "data"),
    COREPACK_ENABLE_NETWORK: "0",
    ...(corepackHome ? { COREPACK_HOME: corepackHome } : {}),
    NPM_CONFIG_USERCONFIG: user,
    NPM_CONFIG_GLOBALCONFIG: global,
    NPM_CONFIG_CACHE: join(directory, "cache"),
    NPM_CONFIG_OFFLINE: "true",
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
  });
}

// Error messages and arbitrary error codes may contain fixture output. Keep only
// the errno vocabulary needed to distinguish absence from denied/unknown state.
const errno = (error) =>
  ["ESRCH", "EPERM", "EACCES"].includes(error?.code) ? error.code : "UNKNOWN";

// Trusted, repository-owned fixture processes only; this is not an OS sandbox.
// The child must announce versions and wait for the start message before I/O.
export async function runProcess({
  command,
  cwd,
  env,
  expectedVersions,
  timeoutMs = 10000,
  maxOutputBytes = 262144,
}) {
  if (
    !Array.isArray(command) ||
    !command.length ||
    !command.every((value) => typeof value === "string") ||
    !isAbsolute(command[0]) ||
    !isAbsolute(cwd) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60000 ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes < 1 ||
    maxOutputBytes > 4194304
  )
    throw new Error("PROCESS_OPTIONS_REJECTED");
  const permitted = new Set([
    "PATH",
    "LANG",
    "LC_ALL",
    "CI",
    "TMPDIR",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "COREPACK_HOME",
    "COREPACK_ENABLE_NETWORK",
    "NPM_CONFIG_USERCONFIG",
    "NPM_CONFIG_GLOBALCONFIG",
    "NPM_CONFIG_CACHE",
    "NPM_CONFIG_OFFLINE",
    "NPM_CONFIG_IGNORE_SCRIPTS",
    "NPM_CONFIG_UPDATE_NOTIFIER",
  ]);
  if (
    !env ||
    Object.keys(env).some((key) => !permitted.has(key)) ||
    env.COREPACK_ENABLE_NETWORK !== "0" ||
    env.NPM_CONFIG_OFFLINE !== "true" ||
    env.NPM_CONFIG_IGNORE_SCRIPTS !== "true" ||
    typeof env.NPM_CONFIG_USERCONFIG !== "string" ||
    typeof env.NPM_CONFIG_GLOBALCONFIG !== "string" ||
    env.NPM_CONFIG_USERCONFIG === env.NPM_CONFIG_GLOBALCONFIG
  )
    throw new Error("ENVIRONMENT_REJECTED");
  for (const key of ["NPM_CONFIG_USERCONFIG", "NPM_CONFIG_GLOBALCONFIG"])
    if (!isAbsolute(env[key]) || (await readFile(env[key])).length)
      throw new Error("NPM_CONFIG_REJECTED");
  const startedAt = new Date().toISOString(),
    start = performance.now();
  const child = spawn(command[0], command.slice(1), {
    cwd,
    env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lifecycle = [],
    chunks = [],
    errorChunks = [],
    timeline = [],
    cleanupErrors = [];
  let reason = null,
    length = 0,
    buffer = "",
    forced = false,
    observedVersions = {},
    exitObserved = false,
    closeObserved = false,
    stdioAbandoned = false,
    cleanupDeadline = null,
    cleanupTimer,
    settleClose,
    droppedEvents = 0;
  const record = (type, fields = {}) => {
    if (timeline.length < 128)
      timeline.push({ atMs: Math.round(performance.now() - start), type, ...fields });
    else droppedEvents++;
  };
  const cleanupError = (operation, code) => {
    if (!cleanupErrors.some((value) => value.operation === operation && value.code === code))
      cleanupErrors.push({ operation, code });
  };
  const probe = () => {
    if (!child.pid) return "absent";
    try {
      process.kill(-child.pid, 0);
      record("probe", { state: "present", code: null });
      return "present";
    } catch (error) {
      const code = errno(error), state = code === "ESRCH" ? "absent" : "unknown";
      record("probe", { state, code });
      if (state === "unknown") cleanupError("probe", code);
      return state;
    }
  };
  const stop = (code) => {
    reason ??= code;
    if (cleanupDeadline === null) {
      record("stop", { code });
      cleanupDeadline = performance.now() + 1000;
      cleanupTimer = setTimeout(() => {
        if (!closeObserved) {
          stdioAbandoned = true;
          record("close-unobserved");
          // A denied signal must return bounded UNKNOWN evidence, not hang.
          // Releasing local handles does not establish process/group cleanup.
          child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
          child.unref();
          settleClose({ exitCode: child.exitCode, signal: child.signalCode });
        }
      }, 1000);
    }
    // This is a conservative Node child-lifecycle guard, not an atomic OS start
    // identity guarantee. Never resignal or signal an exited/closed PID group.
    if (child.pid && !forced && !exitObserved && !closeObserved &&
        child.exitCode === null && child.signalCode === null) {
      forced = true;
      try {
        process.kill(-child.pid, "SIGKILL");
        record("signal", { code: null });
      } catch (error) {
        const code = errno(error);
        record("signal", { code });
        if (code !== "ESRCH") cleanupError("signal", code);
      }
    }
  };
  child.on("spawn", () => { lifecycle.push("spawned"); record("spawn"); });
  child.on("exit", () => { exitObserved = true; record("exit"); });
  child.stdin.on("error", () => {});
  child.stdout.on("data", (chunk) => {
    length += chunk.length;
    if (length > maxOutputBytes) {
      stop("OUTPUT_LIMIT");
      return;
    }
    chunks.push(chunk);
    buffer += chunk.toString("utf8");
    for (;;) {
      const end = buffer.indexOf("\n");
      if (end < 0) break;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (reason) continue;
      try {
        const event = validateEvent(JSON.parse(line));
        const last = lifecycle.at(-1);
        if (event.type === "versions" && last === "spawned") {
          assertVersions(expectedVersions, event.versions);
          observedVersions = event.versions;
          lifecycle.push("identified");
          child.stdin.end('{"type":"start"}\n');
        } else if (event.type === "ready" && last === "identified")
          lifecycle.push("ready");
        else if (
          event.type === "observation" &&
          ["ready", "observed"].includes(last)
        ) {
          if (last === "ready") lifecycle.push("observed");
        } else if (event.type === "result" && last === "observed")
          lifecycle.push("completed");
        else stop("CONTROL_ORDER");
      } catch (error) {
        stop(
          error.message === "VERSION_MISMATCH"
            ? "VERSION_MISMATCH"
            : "CONTROL_CORRUPT",
        );
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    length += chunk.length;
    if (length > maxOutputBytes) stop("OUTPUT_LIMIT");
    else errorChunks.push(chunk);
  });
  const timer = setTimeout(() => stop("TIMEOUT"), timeoutMs);
  const { exitCode, signal } = await new Promise((resolve) => {
    settleClose = resolve;
    child.on("error", () => {
      reason ??= "SPAWN_FAILED";
      record("spawn-error");
    });
    child.on("close", (exitCode, signal) => {
      closeObserved = true;
      record("close");
      resolve({ exitCode, signal });
    });
  });
  clearTimeout(timer);
  clearTimeout(cleanupTimer);
  const stderrBytes = Buffer.concat(errorChunks);
  if (buffer) reason ??= "CONTROL_TRUNCATED";
  if (!reason && exitCode !== 0) reason = "EXIT_NONZERO";
  if (!reason && stderrBytes.length) reason = "STDERR_PRESENT";
  if (!reason && !lifecycle.includes("completed"))
    reason = "CONTROL_INCOMPLETE";
  let cleanupState = probe();
  if (cleanupState === "present") reason ??= "PROCESS_LEAK";
  // Observations only after child exit/close: a numeric PGID is not renewed
  // authority to signal. EPERM may be transient but never proves absence.
  const observeUntil = cleanupDeadline ?? performance.now() + 1000;
  for (let attempt = 0;
    closeObserved && cleanupState !== "absent" && attempt < 50 && performance.now() < observeUntil;
    attempt++) {
    await delay(Math.min(20, Math.max(0, observeUntil - performance.now())));
    cleanupState = probe();
  }
  if (stdioAbandoned) cleanupState = "unknown";
  const groupAbsent = cleanupState === "absent";
  if (groupAbsent && lifecycle.length) lifecycle.push("closed");
  if (!groupAbsent || cleanupErrors.length) reason ??= "CLEANUP_FAILED";
  const status = !reason
    ? "PASSED"
    : reason === "SPAWN_FAILED"
      ? "BLOCKED"
      : [
            "VERSION_MISMATCH",
            "EXIT_NONZERO",
            "STDERR_PRESENT",
            "PROCESS_LEAK",
          ].includes(reason)
        ? "FAILED"
        : "UNKNOWN";
  return {
    status,
    reason,
    command: [...command],
    exitCode,
    signal,
    startedAt,
    durationMs: Math.round(performance.now() - start),
    pid: child.pid ?? null,
    observedVersions,
    lifecycle,
    stdout: redactOutput(Buffer.concat(chunks)),
    stderr: { bytes: stderrBytes.length, sha256: sha256(stderrBytes) },
    cleanup: { groupAbsent, forced },
    diagnostics: {
      cleanupState, cleanupErrors, closeObserved, stdioAbandoned,
      ownership: {
        pid: child.pid ?? null,
        expectedPgid: child.pid ?? null,
        basis: "node-child-lifecycle-guard",
        exitObserved,
      },
      timeline: timeline.map((event) => ({ ...event })), droppedEvents,
    },
  };
}
