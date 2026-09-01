import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, open, readFile, realpath, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

const execute = promisify(execFile);
const repository = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const templates = new URL("../../../internal/pay-conformance/fixtures/packed-consumer/", import.meta.url);
// Independently reviewed raw pins: inventory/template co-tampering is not a
// new approved graph. Keep these constants outside the private harness.
const pins = ["1f3543f2a003fc27902a0af42d9b36cee315f6d0d92a110f2f60a20d74595cac", "2e0e1a8025e0168efd5c48b86f316ba59edc61dc7bb3a11572355638b057eb65"];
export async function readFixedTemplates() {
  const bytes = await Promise.all(["package.template.json", "package-lock.template.json"].map(name => readFile(new URL(name, templates))));
  if (bytes.some((value, index) => sha256(value) !== pins[index])) reject("CONSUMER_TEMPLATE_INTEGRITY");
  const [manifest, lock] = bytes.map(value => JSON.parse(value));
  return { manifest, lock, bytes };
}

// Only explicit host incompatibility permits absence. An optional flag alone
// never excuses a missing platform-independent package or an unknown libc.
export function incompatibleOptional(record) {
  if (record.optional !== true) return false;
  const excludes = (list, current) => Array.isArray(list) && current &&
    (list.includes(`!${current}`) || (!list.includes("any") && list.some(value => !value.startsWith("!")) && !list.includes(current)));
  const libc = process.platform === "linux" && process.report.getReport().header.glibcVersionRuntime ? "glibc" : undefined;
  return Boolean(excludes(record.os, process.platform) || excludes(record.cpu, process.arch) || excludes(record.libc, libc));
}
const payName = "@0xkey-io/pay";
const payOwner = "node_modules/@0xkey-io/pay";

function reject(reason) { throw new Error(reason); }
function canonicalSyntax(path) {
  return typeof path === "string" && !/[\x00-\x1f\x7f]/.test(path) && isAbsolute(path) && resolve(path) === path;
}

function assertMetadata(packed, expected) {
  if (packed.name !== payName || packed.private !== false) reject("CONSUMER_MANIFEST_MISMATCH");
  for (const key of ["version", "license", "engines", "dependencies", "optionalDependencies", "peerDependencies", "peerDependenciesMeta", "bundledDependencies", "bundleDependencies", "os", "cpu"]) {
    if (!isDeepStrictEqual(packed[key], expected[key])) reject("CONSUMER_MANIFEST_MISMATCH");
  }
}

export async function verifySourceGraph(source, packageRoot) {
  const { lock } = await readFixedTemplates();
  const packed = structuredClone(source);
  packed.private = false;
  for (const [name, value] of Object.entries(packed.dependencies ?? {})) {
    if (value !== "workspace:*") continue;
    if (!name.startsWith("@0xkey-io/")) reject("CONSUMER_MANIFEST_MISMATCH");
    const sibling = JSON.parse(await readFile(join(packageRoot, "..", name.slice("@0xkey-io/".length), "package.json")));
    if (sibling.name !== name) reject("CONSUMER_MANIFEST_MISMATCH");
    packed.dependencies[name] = sibling.version;
  }
  assertMetadata(packed, lock.packages[payOwner]);
}

async function inputs(binding) {
  const { manifest: manifestTemplate, lock: lockTemplate, bytes: templateBytes } = await readFixedTemplates();
  if (!binding || !isDeepStrictEqual(Object.keys(binding).sort(), ["artifact", "artifactSha256", "directory"]) ||
      !canonicalSyntax(binding.directory) || !canonicalSyntax(binding.artifact) ||
      typeof binding.artifactSha256 !== "string" || !/^[a-f0-9]{64}$/.test(binding.artifactSha256) ||
      binding.directory === repository || binding.directory.startsWith(repository + sep)) reject("CONSUMER_BINDING_REJECTED");
  const stat = await lstat(binding.artifact);
  if (!stat.isFile() || stat.size > 50 * 1024 * 1024 || await realpath(binding.artifact) !== binding.artifact ||
      await realpath(dirname(binding.directory)) !== dirname(binding.directory)) reject("CONSUMER_BINDING_REJECTED");
  const bytes = await readFile(binding.artifact);
  if (sha256(bytes) !== binding.artifactSha256) reject("CONSUMER_ARTIFACT_MISMATCH");
  // This reads metadata only; the checked-pack contract remains a separate
  // prerequisite. No extraction into the checkout, install or resolver runs.
  const { stdout } = await execute("tar", ["-xOf", binding.artifact, "package/package.json"], { timeout: 5000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), LANG: "C", LC_ALL: "C" } });
  if (sha256(await readFile(binding.artifact)) !== binding.artifactSha256) reject("CONSUMER_ARTIFACT_MISMATCH");
  const packed = JSON.parse(stdout);
  assertMetadata(packed, lockTemplate.packages[payOwner]);
  const manifest = structuredClone(manifestTemplate);
  const lock = structuredClone(lockTemplate);
  // The entire mutable surface is these four fields. Never substitute text
  // globally or accept caller-supplied integrity/dependency selections.
  const reference = `file:${binding.artifact}`;
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  manifest.dependencies[payName] = reference;
  lock.packages[""].dependencies[payName] = reference;
  lock.packages[payOwner].resolved = reference;
  lock.packages[payOwner].integrity = integrity;
  return { manifest, lock, artifactManifestSha256: sha256(stdout), artifactSha256: binding.artifactSha256, artifactIntegrity: integrity, manifestTemplateSha256: sha256(templateBytes[0]), lockTemplateSha256: sha256(templateBytes[1]) };
}

async function observedOwners(directory, prefix = "node_modules") {
  const result = [];
  let entries;
  try { entries = await readdir(join(directory, prefix), { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return result; throw error; }
  for (const entry of entries) {
    if (entry.name === ".bin" || entry.name === ".package-lock.json") continue;
    const path = `${prefix}/${entry.name}`;
    if (!entry.isDirectory()) reject("CONSUMER_INSTALLED_OWNER_MISMATCH");
    if (entry.name.startsWith("@")) result.push(...await observedOwners(directory, path));
    else { result.push(path); result.push(...await observedOwners(directory, `${path}/node_modules`)); }
  }
  return result;
}

async function payloadFiles(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await payloadFiles(directory, path));
    else if (entry.isFile()) result.push(`package/${path}`);
    else reject("CONSUMER_INSTALLED_PAYLOAD_MISMATCH");
  }
  return result;
}

async function installedConsumer(binding, lock) {
  const owners = [], absentOptionalOwners = [];
  // The pinned graph has exactly one incoming edge to @emnapi/runtime:
  // @img/sharp-wasm32.dependencies. This is an installed-only exception;
  // preflight still requires its cache bytes. No generic optional waiver.
  const wasmOwner = "node_modules/@img/sharp-wasm32";
  let absentWasm = false;
  try { await lstat(join(binding.directory, wasmOwner)); }
  catch (error) { if (error.code === "ENOENT") absentWasm = true; else throw error; }

  for (const [relative, expected] of Object.entries(lock.packages)) {
    if (!relative) continue;
    const path = join(binding.directory, relative, "package.json");
    let bytes;
    try {
      if (!(await lstat(path)).isFile() || !(await realpath(path)).startsWith(binding.directory + sep)) reject("CONSUMER_INSTALLED_OWNER_MISMATCH");
      bytes = await readFile(path);
    } catch (error) {
      if (error.code === "ENOENT" && (incompatibleOptional(expected) || (relative === "node_modules/@emnapi/runtime" && absentWasm && incompatibleOptional(lock.packages[wasmOwner])))) { absentOptionalOwners.push(relative); continue; }
      reject("CONSUMER_INSTALLED_OWNER_MISMATCH");
    }
    const manifest = JSON.parse(bytes), name = expected.name ?? relative.split("node_modules/").at(-1);
    if (manifest.name !== name || manifest.version !== expected.version) reject("CONSUMER_INSTALLED_OWNER_MISMATCH");
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "peerDependenciesMeta", "engines", "os", "cpu"]) {
      // npm omits empty maps from its lock records.
      const normalize = value => value && !Array.isArray(value) && Object.keys(value).length === 0 ? undefined : value;
      if (!isDeepStrictEqual(normalize(manifest[field]), normalize(expected[field]))) reject("CONSUMER_INSTALLED_OWNER_MISMATCH");
    }
    owners.push({ path: relative, name, version: manifest.version, manifestSha256: sha256(bytes) });
  }
  const observed = await observedOwners(binding.directory);
  if (!isDeepStrictEqual(observed.sort(), owners.map(owner => owner.path).sort())) reject("CONSUMER_INSTALLED_OWNER_MISMATCH");
  const options = { timeout: 5000, maxBuffer: 2 * 1024 * 1024, encoding: "buffer", env: { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), LANG: "C", LC_ALL: "C" } };
  const listed = (await execute("tar", ["-tzf", binding.artifact], options)).stdout.toString("utf8").trim().split("\n").filter(name => !name.endsWith("/"));
  if (listed.length > 1024 || new Set(listed).size !== listed.length) reject("CONSUMER_INSTALLED_PAYLOAD_MISMATCH");
  if (!isDeepStrictEqual((await payloadFiles(join(binding.directory, payOwner))).sort(), [...listed].sort())) reject("CONSUMER_INSTALLED_PAYLOAD_MISMATCH");
  const payload = [];
  for (const name of listed) {
    if (!/^package\/[A-Za-z0-9._/-]+$/.test(name) || name.split("/").some(part => part === ".." || part === ".")) reject("CONSUMER_INSTALLED_PAYLOAD_MISMATCH");
    const path = join(binding.directory, payOwner, name.slice("package/".length));
    if (!(await lstat(path)).isFile() || await realpath(path) !== path) reject("CONSUMER_INSTALLED_PAYLOAD_MISMATCH");
    const packed = (await execute("tar", ["-xOf", binding.artifact, name], options)).stdout;
    const digest = sha256(packed);
    if (sha256(await readFile(path)) !== digest) reject("CONSUMER_INSTALLED_PAYLOAD_MISMATCH");
    payload.push({ path: name, sha256: digest });
  }
  if (sha256(await readFile(binding.artifact)) !== binding.artifactSha256) reject("CONSUMER_ARTIFACT_MISMATCH");
  return { ownerCount: owners.length, owners, absentOptionalOwners, payload, payloadManifestSha256: sha256(JSON.stringify(payload)) };
}

export async function verifyConsumer(binding, installed = false) {
  if (typeof installed !== "boolean") reject("CONSUMER_BINDING_REJECTED");
  const expected = await inputs(binding);
  if (await realpath(binding.directory) !== binding.directory) reject("CONSUMER_BINDING_REJECTED");
  const paths = ["package.json", "package-lock.json"].map(name => join(binding.directory, name));
  for (const path of paths) if (!(await lstat(path)).isFile()) reject("CONSUMER_BINDING_REJECTED");
  const [manifestBytes, lockBytes] = await Promise.all(paths.map(path => readFile(path)));
  if (!isDeepStrictEqual(JSON.parse(manifestBytes), expected.manifest) || !isDeepStrictEqual(JSON.parse(lockBytes), expected.lock)) reject("CONSUMER_GRAPH_MISMATCH");
  const { manifest, lock, ...identity } = expected;
  const observed = installed ? await installedConsumer(binding, lock) : undefined;
  // npm ci must not update either input. Repeat this verifier after install
  // and compare these byte hashes with the preparation identity.
  if (sha256(await readFile(paths[0])) !== sha256(manifestBytes) || sha256(await readFile(paths[1])) !== sha256(lockBytes)) reject("CONSUMER_GRAPH_MISMATCH");
  return { ...identity, manifestSha256: sha256(manifestBytes), lockSha256: sha256(lockBytes), packageCount: Object.keys(lock.packages).length, ...(observed ? { installed: observed } : {}) };
}

export async function materializeConsumer(binding) {
  const { manifest, lock } = await inputs(binding);
  await mkdir(binding.directory, { mode: 0o700 }); // No recursive/existing destination.
  for (const [name, data] of [["package.json", manifest], ["package-lock.json", lock]]) {
    const file = await open(join(binding.directory, name), "wx", 0o600);
    try { await file.writeFile(JSON.stringify(data, null, 2) + "\n"); await file.sync(); }
    finally { await file.close(); }
  }
  if (process.platform !== "win32") {
    const directory = await open(binding.directory, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }
  return verifyConsumer(binding);
}
