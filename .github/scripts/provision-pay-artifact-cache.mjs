import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

import {
  prepareOfflineConsumer,
  safeArtifactPath,
} from "../../packages/pay/scripts/offline-consumer.mjs";
import { readFixedTemplates } from "../../packages/pay/scripts/fixed-consumer.mjs";

const execute = promisify(execFile);
const registryPrefix = "https://registry.npmjs.org/";
const cache = process.env.PAY_ARTIFACT_NPM_CACHE;

if (
  !cache ||
  !isAbsolute(cache) ||
  resolve(cache) !== cache ||
  safeArtifactPath(cache) !== cache ||
  !(await lstat(cache)).isDirectory() ||
  (await realpath(cache)) !== cache
) {
  throw new Error("PAY_ARTIFACT_CACHE_PROVISION_PATH");
}

for (const key of ["NPM_CONFIG_USERCONFIG", "NPM_CONFIG_GLOBALCONFIG"]) {
  const path = process.env[key];
  if (
    !path ||
    !isAbsolute(path) ||
    resolve(path) !== path ||
    !(await lstat(path)).isFile() ||
    (await readFile(path)).length !== 0
  ) {
    throw new Error("PAY_ARTIFACT_CACHE_PROVISION_CONFIG");
  }
}

try {
  const ready = await prepareOfflineConsumer();
  console.log(
    `Pay artifact cache already complete: ${ready.identity.cacheContent.length} entries`,
  );
  process.exit(0);
} catch (error) {
  if (
    !/PAY_ARTIFACT_CACHE_(?:MISSING|INTEGRITY)/.test(String(error?.message))
  ) {
    throw error;
  }
}

const { lock } = await readFixedTemplates();
const urls = new Set();
for (const [owner, record] of Object.entries(lock.packages)) {
  if (!owner || owner === "node_modules/@0xkey-io/pay") continue;
  if (
    typeof record.resolved !== "string" ||
    !record.resolved.startsWith(registryPrefix) ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(record.integrity ?? "")
  ) {
    throw new Error("PAY_ARTIFACT_CACHE_PROVISION_GRAPH");
  }
  urls.add(record.resolved);
}
if (urls.size !== 310)
  throw new Error("PAY_ARTIFACT_CACHE_PROVISION_INVENTORY");

const childEnv = {};
for (const key of ["PATH", "LANG", "LC_ALL", "SystemRoot", "SYSTEMROOT"]) {
  if (process.env[key]) childEnv[key] = process.env[key];
}
Object.assign(childEnv, {
  NPM_CONFIG_USERCONFIG: process.env.NPM_CONFIG_USERCONFIG,
  NPM_CONFIG_GLOBALCONFIG: process.env.NPM_CONFIG_GLOBALCONFIG,
  npm_config_cache: cache,
  npm_config_registry: registryPrefix,
  npm_config_update_notifier: "false",
  npm_config_audit: "false",
  npm_config_fund: "false",
});

const queue = [...urls];
async function worker() {
  for (;;) {
    const url = queue.pop();
    if (!url) return;
    await execute(
      "npm",
      ["cache", "add", "--cache", cache, "--prefer-online", "--", url],
      { env: childEnv, timeout: 120_000, maxBuffer: 1024 * 1024 },
    );
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()));

const ready = await prepareOfflineConsumer();
console.log(
  `Pay artifact cache provisioned and verified: ${ready.identity.cacheContent.length} entries`,
);
