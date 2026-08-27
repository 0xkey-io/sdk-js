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

const groupPresent = (pid) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
};
const killGroup = (pid) => {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
};

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
    errorChunks = [];
  let reason = null,
    length = 0,
    buffer = "",
    forced = false,
    observedVersions = {};
  const stop = (code) => {
    reason ??= code;
    if (child.pid) {
      forced = true;
      killGroup(child.pid);
    }
  };
  child.on("spawn", () => lifecycle.push("spawned"));
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
    child.on("error", () => {
      reason ??= "SPAWN_FAILED";
    });
    child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  clearTimeout(timer);
  if (child.pid && groupPresent(child.pid)) {
    stop("PROCESS_LEAK");
  }
  for (
    let attempt = 0;
    child.pid && groupPresent(child.pid) && attempt < 50;
    attempt++
  )
    await delay(20);
  const groupAbsent = !child.pid || !groupPresent(child.pid);
  if (groupAbsent && lifecycle.length) lifecycle.push("closed");
  if (!groupAbsent) reason ??= "CLEANUP_FAILED";
  if (buffer) reason ??= "CONTROL_TRUNCATED";
  const stderrBytes = Buffer.concat(errorChunks);
  if (!reason && exitCode !== 0) reason = "EXIT_NONZERO";
  if (!reason && stderrBytes.length) reason = "STDERR_PRESENT";
  if (!reason && !lifecycle.includes("completed"))
    reason = "CONTROL_INCOMPLETE";
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
  };
}
