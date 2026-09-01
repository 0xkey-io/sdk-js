// Release-only preparation. No registry client/resolver or cache acquisition.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readFixedTemplates, incompatibleOptional } from "./fixed-consumer.mjs";
const execute = promisify(execFile);
const fail = code => { throw new Error(code); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export function safeArtifactPath(value) {
  if (typeof value !== "string" || !value || /[\x00-\x1f\x7f]/.test(value)) fail("PAY_ARTIFACT_PATH_REJECTED");
  return resolve(value);
}

async function executable(name, env) {
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const path = join(directory, process.platform === "win32" ? `${name}.cmd` : name);
    try { await access(path, constants.X_OK); return await realpath(path); }
    catch (error) { if (!["ENOENT", "EACCES"].includes(error.code)) throw error; }
  }
  fail("PAY_ARTIFACT_TOOL_REQUIRED");
}

export async function prepareOfflineConsumer(environment = process.env) {
  const templates = await readFixedTemplates();
  const cacheInput = environment.PAY_ARTIFACT_NPM_CACHE;
  if (!cacheInput) fail("PAY_ARTIFACT_CACHE_REQUIRED");
  safeArtifactPath(cacheInput);
  let cache;
  try { cache = await realpath(cacheInput); if (!(await lstat(cache)).isDirectory()) fail("PAY_ARTIFACT_CACHE_MISSING"); }
  catch { fail("PAY_ARTIFACT_CACHE_MISSING"); }
  const configs = [];
  for (const suffix of ["USERCONFIG", "GLOBALCONFIG"]) {
    const upper = environment[`NPM_CONFIG_${suffix}`], lower = environment[`npm_config_${suffix.toLowerCase()}`];
    const input = upper ?? lower;
    if (!input || (upper && lower && upper !== lower)) fail("PAY_ARTIFACT_CONFIG_REJECTED");
    safeArtifactPath(input);
    try {
      if (!(await lstat(input)).isFile() || (await readFile(input)).length !== 0) fail("PAY_ARTIFACT_CONFIG_REJECTED");
      configs.push(await realpath(input));
    } catch { fail("PAY_ARTIFACT_CONFIG_REJECTED"); }
  }
  // The install sees no inherited npm resolver options, credentials, proxy,
  // NODE_OPTIONS or arbitrary account config. Build retains its tool/Corepack
  // context. HOME/home/CODEX_HOME are never reassigned or inspected.
  const env = {};
  for (const key of ["PATH", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP", "SystemRoot", "SYSTEMROOT", "COMSPEC", "PATHEXT", "COREPACK_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME"]) {
    if (environment[key]) env[key] = environment[key];
  }
  Object.assign(env, {
    COREPACK_ENABLE_NETWORK: "0", npm_config_cache: cache,
    npm_config_userconfig: configs[0], npm_config_globalconfig: configs[1],
    npm_config_offline: "true", npm_config_ignore_scripts: "true",
    npm_config_update_notifier: "false", npm_config_audit: "false", npm_config_fund: "false", npm_config_strict_peer_deps: "true",
    npm_config_registry: "https://registry.npmjs.org/", NEXT_TELEMETRY_DISABLED: "1",
  });
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12)) fail("PAY_ARTIFACT_NODE_REJECTED");
  const npm = await executable("npm", env);
  const npmRoot = resolve(dirname(npm), "..");
  const npmManifest = JSON.parse(await readFile(join(npmRoot, "package.json")));
  // These are separate known contexts, not a publisher readiness claim.
  if (npmManifest.name !== "npm" || !["11.4.2", "11.5.1"].includes(npmManifest.version)) fail("PAY_ARTIFACT_NPM_REJECTED");
  const options = { cwd: fileURLToPath(new URL("../../../", import.meta.url)), env, timeout: 10_000, maxBuffer: 1024 * 1024 };
  const npmVersion = (await execute(process.execPath, [npm, "--version"], options)).stdout.trim();
  if (npmVersion !== npmManifest.version) fail("PAY_ARTIFACT_NPM_REJECTED");
  const pnpm = await executable("pnpm", env);
  const pnpmVersion = (await execute(pnpm, ["--version"], options)).stdout.trim();
  if (pnpmVersion !== "10.6.3") fail("PAY_ARTIFACT_PNPM_REJECTED");
  await execute("tar", ["--version"], options);
  const require = createRequire(join(npmRoot, "package.json"));
  const cacache = require("cacache");
  // npm's bundled pacote reads resolved+integrity locks through this exact
  // byDigest stream. It verifies SRI while reading; hasContent/cache ls do not.
  const checked = new Map(), absentOptionalOwners = [];
  for (const [owner, record] of Object.entries(templates.lock.packages)) {
    if (!owner || owner === "node_modules/@0xkey-io/pay") continue;
    if (incompatibleOptional(record)) { absentOptionalOwners.push(owner); continue; }
    if (checked.has(record.integrity)) continue;
    if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(record.integrity ?? "")) fail("PAY_ARTIFACT_CACHE_INTEGRITY");
    const stream = cacache.get.stream.byDigest(join(cache, "_cacache"), record.integrity);
    const timer = setTimeout(() => stream.destroy(new Error("cache read deadline")), 5000);
    let size = 0;
    const digest = createHash("sha256");
    try {
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > 100 * 1024 * 1024) fail("PAY_ARTIFACT_CACHE_INTEGRITY");
        digest.update(chunk);
      }
    } catch (error) {
      if (error.code === "ENOENT") fail("PAY_ARTIFACT_CACHE_MISSING");
      fail("PAY_ARTIFACT_CACHE_INTEGRITY");
    } finally { clearTimeout(timer); stream.destroy(); }
    checked.set(record.integrity, { integrity: record.integrity, size, sha256: digest.digest("hex") });
  }
  return { npm, env, identity: {
    node: process.versions.node, nodeExecutable: process.execPath, npm: npmVersion, npmExecutable: npm,
    npmManifestSha256: hash(await readFile(join(npmRoot, "package.json"))), pnpm: pnpmVersion,    platform: process.platform, arch: process.arch, cache, configs,
    cacheContent: [...checked.values()], absentOptionalOwners,
    manifestTemplateSha256: hash(templates.bytes[0]), lockTemplateSha256: hash(templates.bytes[1]),
  } };
}
