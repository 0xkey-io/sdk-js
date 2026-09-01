import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyInventory } from "../src/run.mjs";
import { verifyConsumer } from "../src/consumer.mjs";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const digest = (bytes, algorithm = "sha256", encoding = "hex") => createHash(algorithm).update(bytes).digest(encoding);
const json = async (file) => JSON.parse(await readFile(file));

test("template drift and explicit malformed bindings cannot turn verification into an unbound success", async () => {
  const copy = await mkdtemp(join(tmpdir(), "pay-template-drift-"));
  await cp(join(root, "fixtures"), join(copy, "fixtures"), { recursive: true });
  await cp(join(root, "licenses"), join(copy, "licenses"), { recursive: true });
  await writeFile(join(copy, "fixtures/packed-consumer/package-lock.template.json"), "{}");
  await assert.rejects(verifyInventory(copy), /INPUT_INTEGRITY_MISMATCH/);
});

test("an explicitly null consumer binding must be rejected, not treated as no binding", async () => {
  await assert.rejects(verifyInventory(root, { consumer: null }), /CONSUMER_BINDING_REJECTED/);
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "pay-consumer-slot-"));
  const manifest = await json(join(root, "fixtures/packed-consumer/package.template.json"));
  const lock = await json(join(root, "fixtures/packed-consumer/package-lock.template.json"));
  const pay = structuredClone(lock.packages["node_modules/@0xkey-io/pay"]);
  delete pay.resolved;
  delete pay.integrity;
  const packedManifest = { name: "@0xkey-io/pay", private: false, ...pay };
  const source = join(directory, "source");
  await mkdir(join(source, "package"), { recursive: true });
  await writeFile(join(source, "package/package.json"), JSON.stringify(packedManifest));
  const artifact = join(directory, "pay.tgz");
  await execute("tar", ["-czf", artifact, "-C", source, "package"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const bytes = await readFile(artifact);
  const consumer = join(directory, "consumer");
  await mkdir(consumer);
  manifest.dependencies["@0xkey-io/pay"] = `file:${artifact}`;
  lock.packages[""].dependencies["@0xkey-io/pay"] = `file:${artifact}`;
  lock.packages["node_modules/@0xkey-io/pay"].resolved = `file:${artifact}`;
  lock.packages["node_modules/@0xkey-io/pay"].integrity = `sha512-${digest(bytes, "sha512", "base64")}`;
  const save = async () => {
    await writeFile(join(consumer, "package.json"), JSON.stringify(manifest));
    await writeFile(join(consumer, "package-lock.json"), JSON.stringify(lock));
  };
  await save();
  return { directory, manifest, lock, save, artifact, consumer, packedManifest, source,
    binding: { directory: consumer, artifact, artifactSha256: digest(bytes) } };
}

test("installed-owner verification binds actual manifests and packed SDK payload before runtime I/O", async () => {
  const f = await fixture();
  for (const [path, locked] of Object.entries(f.lock.packages)) {
    if (!path) continue;
    const name = locked.name ?? path.split("node_modules/").at(-1);
    await mkdir(join(f.consumer, path), { recursive: true });
    const manifest = path === "node_modules/@0xkey-io/pay" ? f.packedManifest : { ...locked, name };
    await writeFile(join(f.consumer, path, "package.json"), JSON.stringify(manifest));
  }
  await verifyConsumer(f.binding, true);
  await writeFile(join(f.consumer, "node_modules/@0xkey-io/pay/package.json"), JSON.stringify({ ...f.packedManifest, description: "tampered installed payload" }));
  await assert.rejects(verifyConsumer(f.binding, true), /CONSUMER_INSTALLED_PAYLOAD_MISMATCH/);
});

test("requesting installed-owner verification cannot accept an uninstalled lock", async () => {
  const f = await fixture();
  await assert.rejects(verifyConsumer(f.binding, true), /CONSUMER_INSTALLED_OWNER_MISMATCH/);
});

test("materialized consumer accepts only the fixed public graph and byte-derived Pay slots", async () => {
  const f = await fixture();
  await verifyInventory(root, { consumer: f.binding });
  f.lock.packages["node_modules/viem"].version = "2.53.0";
  await f.save();
  await assert.rejects(verifyInventory(root, { consumer: f.binding }), /CONSUMER_GRAPH_MISMATCH/);
});

for (const [name, mutate] of [
  ["dependency edge", f => { f.manifest.dependencies.viem = "*"; }],
  ["transitive integrity", f => { f.lock.packages["node_modules/viem"].integrity = "sha512-invalid"; }],
  ["transitive resolved", f => { f.lock.packages["node_modules/viem"].resolved = "https://unowned.invalid/viem.tgz"; }],
  ["unknown metadata", f => { f.lock.packages["node_modules/@0xkey-io/pay"].hasInstallScript = true; }],
  ["slot path", f => { f.lock.packages["node_modules/@0xkey-io/pay"].resolved = "file:/different/pay.tgz"; }],
  ["slot integrity", f => { f.lock.packages["node_modules/@0xkey-io/pay"].integrity = "sha512-invalid"; }],
]) test(`consumer rejects ${name} drift before any install`, async () => {
  const f = await fixture();
  mutate(f);
  await f.save();
  await assert.rejects(verifyInventory(root, { consumer: f.binding }), /CONSUMER_GRAPH_MISMATCH/);
});

test("artifact identity, canonical path, and packed dependency metadata are not caller-selected slots", async () => {
  const f = await fixture();
  await assert.rejects(verifyInventory(root, { consumer: { ...f.binding, artifactSha256: "0".repeat(64) } }), /CONSUMER_ARTIFACT_MISMATCH/);
  await assert.rejects(verifyInventory(root, { consumer: { ...f.binding, integrity: "caller-supplied" } }), /CONSUMER_BINDING_REJECTED/);
  await symlink(f.artifact, join(f.directory, "link.tgz"));
  await assert.rejects(verifyInventory(root, { consumer: { ...f.binding, artifact: join(f.directory, "link.tgz") } }), /CONSUMER_BINDING_REJECTED/);
  f.packedManifest.peerDependencies.mppx = "0.8.17";
  await writeFile(join(f.source, "package/package.json"), JSON.stringify(f.packedManifest));
  const changed = join(f.directory, "changed.tgz");
  await execute("/usr/bin/tar", ["-czf", changed, "-C", f.source, "package"]);
  await assert.rejects(verifyInventory(root, { consumer: { ...f.binding, artifact: changed, artifactSha256: digest(await readFile(changed)) } }), /CONSUMER_MANIFEST_MISMATCH/);
});

test("CLI materializes only a new owned consumer with immutable exact inputs and no install", async () => {
  const f = await fixture();
  const input = { ...f.binding, directory: join(f.directory, "new-consumer") };
  const inputFile = join(f.directory, "input.json");
  await writeFile(inputFile, JSON.stringify(input));
  let outcome;
  try {
    const result = await execute(process.execPath, [join(root, "src/run.mjs"), "--prepare-consumer", inputFile]);
    outcome = { code: 0, ...result };
  } catch (error) { outcome = error; }
  assert.equal(outcome.code, 0, "the supported consumer preparation must succeed before an install can be attempted");
  assert.equal(outcome.stderr, "");
  const result = JSON.parse(outcome.stdout);
  assert.equal(result.status, "PREPARED");
  assert.equal(result.installed, false);
  assert.equal(result.artifactSha256, f.binding.artifactSha256);
  assert.deepEqual(await json(join(input.directory, "package.json")), f.manifest);
  assert.deepEqual(await json(join(input.directory, "package-lock.json")), f.lock);
  const before = await readFile(join(input.directory, "package-lock.json"));
  await assert.rejects(execute(process.execPath, [join(root, "src/run.mjs"), "--prepare-consumer", inputFile]), error => error.code === 1 && !error.stderr);
  assert.deepEqual(await readFile(join(input.directory, "package-lock.json")), before);
  await assert.rejects(readFile(join(input.directory, "node_modules/.package-lock.json")), { code: "ENOENT" });
});

// These controls must fail if templates become their own accepted baseline,
// or if installed graph verification overlooks additional/missing owners.
test("source pins reject template and inventory co-tampering independently of the harness", async () => {
  const f = await fixture();
  const copy = join(f.directory, "sdk-copy");
  const copiedRoot = join(copy, "internal/pay-conformance");
  await cp(join(root, "src"), join(copiedRoot, "src"), { recursive: true });
  await cp(join(root, "fixtures"), join(copiedRoot, "fixtures"), { recursive: true });
  await cp(resolve(root, "../../packages/pay/scripts"), join(copy, "packages/pay/scripts"), { recursive: true });
  const lockPath = join(copiedRoot, "fixtures/packed-consumer/package-lock.template.json");
  const altered = await json(lockPath);
  altered.packages["node_modules/viem"].version = "2.53.0";
  const bytes = JSON.stringify(altered, null, 2) + "\n";
  await writeFile(lockPath, bytes);
  const inventoryPath = join(copiedRoot, "fixtures/inventory.json");
  await writeFile(inventoryPath, (await readFile(inventoryPath, "utf8")).replace(digest(await readFile(join(root, "fixtures/packed-consumer/package-lock.template.json"))), digest(bytes)));
  f.lock.packages["node_modules/viem"].version = "2.53.0";
  await f.save();
  const isolated = await import(pathToFileURL(join(copiedRoot, "src/consumer.mjs")));
  await assert.rejects(isolated.verifyConsumer(f.binding), /CONSUMER_TEMPLATE_INTEGRITY/);
});

async function installedFixture() {
  const f = await fixture();
  for (const [path, locked] of Object.entries(f.lock.packages)) {
    if (!path) continue;
    await mkdir(join(f.consumer, path), { recursive: true });
    await writeFile(join(f.consumer, path, "package.json"), JSON.stringify(path === "node_modules/@0xkey-io/pay" ? f.packedManifest : { ...locked, name: locked.name ?? path.split("node_modules/").at(-1) }));
  }
  await verifyConsumer(f.binding, true);
  return f;
}

test("whole observed graph rejects an extra installed package owner", async () => {
  const f = await installedFixture();
  await mkdir(join(f.consumer, "node_modules/unlocked"));
  await writeFile(join(f.consumer, "node_modules/unlocked/package.json"), '{"name":"unlocked","version":"1.0.0"}');
  await assert.rejects(verifyConsumer(f.binding, true), /CONSUMER_INSTALLED_OWNER_MISMATCH/);
});

test("host-compatible optional owner cannot disappear from installed graph", async () => {
  const f = await installedFixture();
  await rm(join(f.consumer, "node_modules/@img/colour"), { recursive: true });
  await assert.rejects(verifyConsumer(f.binding, true), /CONSUMER_INSTALLED_OWNER_MISMATCH/);
});

test("exact installed Pay payload rejects extra files as well as mutated bytes", async () => {
  const f = await installedFixture();
  await writeFile(join(f.consumer, "node_modules/@0xkey-io/pay/unpacked.js"), "export const unexpected = true;\n");
  await assert.rejects(verifyConsumer(f.binding, true), /CONSUMER_INSTALLED_PAYLOAD_MISMATCH/);
});

test("release consumer rejects a newly owned destination inside the SDK checkout", async () => {
  const f = await fixture();
  const { materializeConsumer } = await import("../../../packages/pay/scripts/fixed-consumer.mjs");
  const parent = await mkdtemp(join(resolve(root, "../.."), "r111-owned-test-"));
  try {
    await assert.rejects(materializeConsumer({ ...f.binding, directory: join(parent, "consumer") }), /CONSUMER_BINDING_REJECTED/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("content-only cache performs actual fixed offline ci with isolated config and ordinary paths", { timeout: 60_000 }, async t => {
  const f = await fixture();
  const { materializeConsumer, verifyConsumer: verifyRelease } = await import("../../../packages/pay/scripts/fixed-consumer.mjs");
  const { prepareOfflineConsumer } = await import("../../../packages/pay/scripts/offline-consumer.mjs");
  assert.ok(process.env.PAY_ARTIFACT_NPM_CACHE, "this real offline test requires the explicitly provisioned fixed-graph cache");
  const cache = join(f.directory, "content-only-cache");
  // Copy only this frozen graph's available SRI blobs, never the unrelated
  // package history in a developer cache (which can be many gigabytes).
  for (const integrity of new Set(Object.values(f.lock.packages).map(value => value.integrity).filter(value => value?.startsWith("sha512-")))) {
    const hex = Buffer.from(integrity.slice(7), "base64").toString("hex");
    const relative = join("_cacache/content-v2/sha512", hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
    let bytes;
    try { bytes = await readFile(join(process.env.PAY_ARTIFACT_NPM_CACHE, relative)); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    await mkdir(join(cache, relative, ".."), { recursive: true });
    await writeFile(join(cache, relative), bytes);
  }
  await assert.rejects(readFile(join(cache, "_cacache/index-v5")), { code: "ENOENT" });
  const inputEnv = { ...process.env, PAY_ARTIFACT_NPM_CACHE: cache, npm_config_omit: "optional", NPM_CONFIG_LEGACY_PEER_DEPS: "true", npm_config_registry: "https://invalid.example", NODE_OPTIONS: "--require=not-a-module", NPM_TOKEN: "must-not-reach-child", HTTPS_PROXY: "https://invalid.example" };
  const preparation = await prepareOfflineConsumer(inputEnv);
  for (const key of ["npm_config_omit", "NPM_CONFIG_LEGACY_PEER_DEPS", "NODE_OPTIONS", "NPM_TOKEN", "HTTPS_PROXY"]) assert.equal(preparation.env[key], undefined);
  const paths = join(f.directory, "普通 paths");
  await mkdir(paths);
  const artifact = join(paths, "Pay artifact.tgz");
  await cp(f.artifact, artifact);
  const binding = { directory: join(paths, "new consumer"), artifact, artifactSha256: digest(await readFile(artifact)) };
  const before = await materializeConsumer(binding);
  await assert.rejects(materializeConsumer(binding), { code: "EEXIST" });
  const argv = [preparation.npm, "ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--strict-peer-deps"];
  const start = Date.now();
  let outcome;
  try { outcome = { code: 0, ...await execute(process.execPath, argv, { cwd: binding.directory, env: preparation.env, timeout: 45_000, maxBuffer: 2 * 1024 * 1024 }) }; }
  catch (error) { outcome = { code: error.code, signal: error.signal, stdout: error.stdout, stderr: error.stderr }; }
  const { stdout, stderr } = outcome;
  const evidence = join(f.directory, "actual-offline-install.json");
  await writeFile(evidence, JSON.stringify({ argv: [process.execPath, ...argv], cwd: binding.directory, env: preparation.env, ...outcome, elapsedMs: Date.now() - start, binding, preparation: preparation.identity, before }, null, 2));
  t.diagnostic(`retained actual offline install evidence: ${evidence}`);
  assert.equal(outcome.code, 0, JSON.stringify(outcome));
  const after = await verifyRelease(binding, true);
  assert.equal(after.packageCount, 358);
  assert.equal(after.manifestSha256, before.manifestSha256);
  assert.equal(after.lockSha256, before.lockSha256);
  assert.ok(after.installed.ownerCount > 300);
  for (const name of ["mppx", "@x402/core"]) {
    const ls = await execute(process.execPath, [preparation.npm, "ls", name, "--all", "--parseable"], { cwd: binding.directory, env: preparation.env });
    assert.equal(ls.stdout.trim().split("\n").length, 1);
  }
  await writeFile(join(f.directory, "verified-offline-install.json"), JSON.stringify({ after }, null, 2));
  // Each negative follows the successful real install and uses only this
  // test-owned cache copy. Optional with no explicit platform exclusion fails.
  for (const name of ["node_modules/viem", "node_modules/@img/colour"]) {
    const record = f.lock.packages[name];
    const hex = Buffer.from(record.integrity.slice(7), "base64").toString("hex");
    const path = join(cache, "_cacache/content-v2/sha512", hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
    const original = await readFile(path);
    await writeFile(path, Buffer.alloc(original.length, 0));
    await assert.rejects(prepareOfflineConsumer(inputEnv), /PAY_ARTIFACT_CACHE_INTEGRITY/);
    await rm(path);
    await assert.rejects(prepareOfflineConsumer(inputEnv), /PAY_ARTIFACT_CACHE_MISSING/);
    await writeFile(path, original);
  }
  const manifest = await readFile(join(binding.directory, "package.json"));
  await writeFile(join(binding.directory, "package.json"), Buffer.concat([manifest, Buffer.from("\n")]));
  assert.notEqual((await verifyRelease(binding, true)).manifestSha256, before.manifestSha256);
  await writeFile(join(binding.directory, "package.json"), manifest);
  await writeFile(artifact, Buffer.concat([await readFile(artifact), Buffer.from("changed")]));
  await assert.rejects(verifyRelease(binding, true), /CONSUMER_ARTIFACT_MISMATCH/);
});

test("installed dependency metadata drift cannot hide behind unchanged owner name and version", async () => {
  const f = await installedFixture();
  const path = join(f.consumer, "node_modules/viem/package.json");
  const value = await json(path);
  value.dependencies = { ...value.dependencies, unlocked: "*" };
  await writeFile(path, JSON.stringify(value));
  await assert.rejects(verifyConsumer(f.binding, true), /CONSUMER_INSTALLED_OWNER_MISMATCH/);
});

test("only pinned emnapi orphan may be absent when its sole wasm parent is absent and incompatible", async () => {
  const f = await installedFixture();
  await rm(join(f.consumer, "node_modules/@img/sharp-wasm32"), { recursive: true });
  await rm(join(f.consumer, "node_modules/@emnapi/runtime"), { recursive: true });
  await verifyConsumer(f.binding, true);
});
