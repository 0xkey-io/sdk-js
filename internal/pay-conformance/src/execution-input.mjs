import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./redact.mjs";

const fixtures = new Set(["x402-2.23", "x402-2.22", "mppx-0.8.19", "mppx-0.8.17", "x402-framework-2.23", "x402-framework-2.22"]);
const repository = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
const reject = () => { throw new Error("EXECUTION_INPUT_REJECTED"); };
const path = value => typeof value === "string" && value.length <= 4096 && /^\/[A-Za-z0-9.@+_/-]+$/.test(value) && resolve(value) === value;
function record(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) reject();
}

export function validateExecutionInput(value) {
  try {
    record(value, ["stage", "fixture", "native", "certificates", "corepack", "evidence", "consumer"]);
    if (!["development-only", "final-7b"].includes(value.stage) || !fixtures.has(value.fixture)) reject();
    for (const key of ["native", "certificates", "corepack", "evidence"]) if (!path(value[key])) reject();
    record(value.consumer, ["directory", "artifact", "artifactSha256"]);
    if (!path(value.consumer.directory) || !path(value.consumer.artifact) || typeof value.consumer.artifactSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.consumer.artifactSha256)) reject();
    return structuredClone(value);
  } catch { reject(); }
}

export async function readExecutionInput(inputPath) {
  try {
    if (!path(inputPath) || await realpath(inputPath) !== inputPath) reject();
    const stat = await lstat(inputPath);
    if (!stat.isFile() || stat.size > 32768) reject();
    const bytes = await readFile(inputPath);
    if (bytes.length > 32768) reject();
    const input = validateExecutionInput(JSON.parse(bytes));
    const overlap = (a, b) => a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
    if ([input.native, input.certificates, input.corepack, input.consumer.directory, input.consumer.artifact].some(location => overlap(input.evidence, location)) || overlap(input.native, input.consumer.directory)) reject();
    for (const location of [input.native, input.certificates, input.corepack, input.evidence, input.consumer.directory]) {
      if (location === repository || location.startsWith(repository + "/") || await realpath(location) !== location || !(await lstat(location)).isDirectory()) reject();
    }
    return { input, inputSha256: sha256(bytes) };
  } catch { reject(); }
}
