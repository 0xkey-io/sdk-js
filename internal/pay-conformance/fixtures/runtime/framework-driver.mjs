import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyInventory } from "../../src/run.mjs";
import { verifyConsumer } from "../../src/consumer.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { hash, publicModule } from "./common.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sdk = fileURLToPath(new URL("../../../../", import.meta.url));
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const inventory = JSON.parse(await readFile(join(root, "fixtures/inventory.json")));
const emit = value => process.stdout.write(JSON.stringify(value) + "\n");

async function packageVersion(directory, name) {
  const require = createRequire(join(directory, "package.json"));
  const entryNames = { "@x402/core": "@x402/core/server", "@x402/evm": "@x402/evm/exact/server", "@x402/express": "@x402/express", "@x402/hono": "@x402/hono", "@x402/next": "@x402/next" };
  let entry;
  try { entry = require.resolve(`${name}/package.json`); }
  catch { entry = require.resolve(entryNames[name] ?? name); }
  let directoryName = dirname(entry);
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(join(directoryName, "package.json")));
      if (manifest.name === name) return manifest.version;
    } catch {}
    const parent = dirname(directoryName); assert.notEqual(parent, directoryName); directoryName = parent;
  }
}

async function runProbe(name, args, key) {
  const location = join(sdk, "packages/pay/scripts", name);
  const saved = { argv: process.argv, log: console.log, error: console.error, warn: console.warn, fetch: globalThis.fetch };
  const output = [], diagnostics = [];
  try {
    process.argv = [process.execPath, location, ...args];
    console.log = value => { assert.equal(typeof value, "string"); assert.ok(output.length < 64 && Buffer.byteLength(value) < 262144); output.push(JSON.parse(value)); };
    const captureDiagnostic = (...values) => {
      const value = values.map(String).join(" ");
      assert.match(value, /^Failed to fetch supported kinds from facilitator: FacilitatorResponseError: payment service is unavailable$/);
      assert.ok(diagnostics.length < 8); diagnostics.push({ bytes: Buffer.byteLength(value), sha256: hash(value) });
    };
    console.error = captureDiagnostic; console.warn = captureDiagnostic;
    await import(`${pathToFileURL(location).href}?framework-final=${encodeURIComponent(key)}`);
  } finally {
    process.argv = saved.argv; console.log = saved.log; console.error = saved.error; console.warn = saved.warn; globalThis.fetch = saved.fetch;
  }
  assert.ok(output.length > 0); return { output, diagnostics };
}

function safeInventory(rows) {
  return rows.flatMap(row => row.inventory ?? []).map(({ name, version, condition, entry, sha256 }) => ({ name, version, condition, entrySha256: sha256 ?? hash(entry) }));
}

async function linkPackage(project, name, source) {
  const destination = join(project, "node_modules", ...name.split("/"));
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await symlink(await realpath(source), destination, "dir");
}

async function manifestIdentity(directory, name, condition) {
  const require = createRequire(join(directory, "package.json"));
  let entry;
  try { entry = require.resolve(`${name}/package.json`); }
  catch { entry = require.resolve({ "@x402/core": "@x402/core/server", "@x402/evm": "@x402/evm/exact/server", "@x402/express": "@x402/express", "@x402/hono": "@x402/hono", "@x402/next": "@x402/next" }[name] ?? name); }
  let root = dirname(entry);
  for (;;) {
    try {
      const path = join(root, "package.json"), bytes = await readFile(path), manifest = JSON.parse(bytes);
      if (manifest.name === name) return { name, version: manifest.version, condition, entry: path, sha256: hash(bytes) };
    } catch {}
    const parent = dirname(root); assert.notEqual(parent, root); root = parent;
  }
}

async function exportIdentity(directory, name, condition) {
  const require = createRequire(join(directory, "package.json"));
  let root = dirname(require.resolve(name)), manifest;
  for (;;) {
    try { manifest = JSON.parse(await readFile(join(root, "package.json"))); } catch {}
    if (manifest?.name && (name === manifest.name || name.startsWith(manifest.name + "/"))) break;
    const parent = dirname(root); assert.notEqual(parent, root); root = parent;
  }
  const exported = manifest.exports?.["." + name.slice(manifest.name.length)];
  const selected = typeof exported === "string" ? exported : exported?.[condition];
  const entry = await realpath(join(root, typeof selected === "string" ? selected : selected.default));
  return { name, version: manifest.version, condition, entry, sha256: hash(await readFile(entry)) };
}

async function createFrameworkProject(input, directory, name) {
  const project = join(directory, name);
  await mkdir(join(project, "node_modules"), { recursive: true, mode: 0o700 });
  for (const packageName of ["@x402/core", "@x402/evm", "@x402/express", "@x402/hono", "@x402/next", "next", "react", "react-dom", "typescript", "viem", "zod", "express", "hono"])
    await linkPackage(project, packageName, join(input.native, "node_modules", ...packageName.split("/")));
  for (const packageName of ["@0xkey-io/pay", "@types/node", "@types/react"])
    await linkPackage(project, packageName, join(input.consumer.directory, "node_modules", ...packageName.split("/")));
  await writeFile(join(project, "package.json"), '{"name":"pay-framework-project","private":true,"type":"module"}\n', { flag: "wx", mode: 0o600 });
  return project;
}

async function runTypedRecipe(input, directory) {
  const project = await createFrameworkProject(input, directory, "typed-project");
  const examples = join(sdk, "packages/pay/docs/examples");
  for (const name of ["x402-upfront.ts", "x402-frameworks.ts"]) await copyFile(join(examples, name), join(project, name));
  await writeFile(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true }, include: ["*.ts"] }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const command = [join(project, "node_modules/typescript/bin/tsc"), "-p", join(project, "tsconfig.json")];
  const result = spawnSync(process.execPath, command, { cwd: project, env: { PATH: "/opt/homebrew/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C", TMPDIR: dirname(project) }, encoding: "utf8", timeout: 30000, maxBuffer: 262144 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr); assert.equal(result.signal, null); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
  const inventory = [];
  for (const name of ["@x402/core", "@x402/evm", "@x402/express", "@x402/hono", "@x402/next", "typescript"])
    inventory.push(await manifestIdentity(input.native, name, "typed-bundler"));
  for (const name of ["@0xkey-io/pay", "@types/node", "@types/react"])
    inventory.push(await manifestIdentity(input.consumer.directory, name, "typed-bundler"));
  return [{ inventory, compiler: { status: result.status, stdoutBytes: 0, stderrBytes: 0 }, sources: Object.fromEntries(await Promise.all(["x402-upfront.ts", "x402-frameworks.ts", "tsconfig.json"].map(async name => [name, hash(await readFile(join(project, name)))]))) }];
}

function external(command, cwd, timeout = 30000) {
  const env = { PATH: "/opt/homebrew/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C", TMPDIR: dirname(cwd), CI: "1", NEXT_TELEMETRY_DISABLED: "1", NPM_CONFIG_OFFLINE: "true", PNPM_CONFIG_OFFLINE: "true", COREPACK_ENABLE_NETWORK: "0" };
  const result = spawnSync(process.execPath, command, { cwd, env, encoding: "utf8", timeout, maxBuffer: 524288 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr); assert.equal(result.signal, null);
  return result;
}

async function fileInventory(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await fileInventory(root, relative));
    else {
      assert.equal(entry.isFile(), true); const path = join(root, relative), stat = await lstat(path), bytes = await readFile(path);
      assert.equal(stat.isFile(), true); result.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) });
    }
    assert.ok(result.length <= 2048);
  }
  return result;
}

async function runNextBuild(input, directory, condition) {
  const project = await createFrameworkProject(input, directory, `next-${condition}-project`);
  const examples = join(sdk, "packages/pay/docs/examples"), fixtures = join(sdk, "packages/pay/scripts/fixtures/x402-next");
  await mkdir(join(project, "app/paid"), { recursive: true, mode: 0o700 });
  if (condition === "import") {
    await copyFile(join(examples, "x402-upfront.ts"), join(project, "x402-upfront.ts"));
    await copyFile(join(fixtures, "route.ts"), join(project, "app/paid/route.ts"));
  } else {
    await copyFile(join(fixtures, "x402-upfront-require.js"), join(project, "x402-upfront-require.js"));
    await copyFile(join(fixtures, "route-require.js"), join(project, "app/paid/route.js"));
  }
  await writeFile(join(project, "next.config.mjs"), "export default { turbopack: { root: process.cwd() } };\n", { flag: "wx", mode: 0o600 });
  await writeFile(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true }, include: ["**/*.ts", "**/*.js"] }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const preflight = external([join(sdk, "packages/pay/scripts/x402-next-preflight.mjs"), project], project);
  assert.equal(preflight.stderr, ""); const preflightData = JSON.parse(preflight.stdout);
  const initialTsconfigSha256 = hash(await readFile(join(project, "tsconfig.json")));
  const build = external([join(project, "node_modules/next/dist/bin/next"), "build", "--webpack"], project, 45000);
  assert.ok(Buffer.byteLength(build.stdout) + Buffer.byteLength(build.stderr) < 524288);
  const probe = external([join(sdk, "packages/pay/scripts/x402-next-probe.mjs"), project], project, 45000);
  assert.equal(probe.stderr, ""); const output = probe.stdout.trim().split("\n").map(line => JSON.parse(line)); assert.equal(output.length, 2);
  const [matrixResult, lifecycle] = output; const warnings = lifecycle.stderr.trim().split("\n").filter(Boolean);
  assert.equal(warnings.length, 4); for (const warning of warnings) assert.equal(warning, "Failed to fetch supported kinds from facilitator: FacilitatorResponseError: payment service is unavailable");
  const diagnostics = warnings.map(value => ({ bytes: Buffer.byteLength(value), sha256: hash(value) }));
  const selected = [await exportIdentity(input.native, "@x402/core/server", condition), await exportIdentity(input.native, "@x402/next", condition)];
  const inventory = [...selected, ...matrixResult.inventory];
  const safeLifecycle = { closed: lifecycle.closed, childExitCode: lifecycle.child.code, stdoutSha256: lifecycle.stdoutSha256, stderrSha256: lifecycle.stderrSha256, bytes: lifecycle.bytes };
  const serverFiles = await fileInventory(join(project, ".next/server"));
  assert.ok(serverFiles.length > 0 && serverFiles.some(value => value.path === "app/paid/route.js"));
  const sourceNames = condition === "import" ? ["x402-upfront.ts", "app/paid/route.ts", "next.config.mjs"] : ["x402-upfront-require.js", "app/paid/route.js", "next.config.mjs"];
  const sourceSha256 = Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, hash(await readFile(join(project, name)))])));
  const observations = [{ inventory, rows: matrixResult.rows, buildId: matrixResult.buildId, condition, preflight: { missing: preflightData.missing, offline: preflightData.offline }, build: { stdoutSha256: hash(build.stdout), stderrSha256: hash(build.stderr), initialTsconfigSha256, finalTsconfigSha256: hash(await readFile(join(project, "tsconfig.json"))), sourceSha256, serverFiles, serverFilesSha256: hash(JSON.stringify(serverFiles)) }, lifecycle: safeLifecycle }];
  return { observations, diagnostics, details: { condition, preflight: observations[0].preflight, build: observations[0].build, lifecycle: observations[0].lifecycle } };
}

export async function runFrameworkRow(fixture) {
  const [inputPath, row, directory] = process.argv.slice(2);
  const { input, inputSha256 } = await readExecutionInput(inputPath);
  assert.equal(input.stage, "final-7b"); assert.equal(input.fixture, fixture);
  const contract = matrix.rows.find(value => value.fixture === fixture && value.id === row);
  assert.ok(contract && ["injection", "owner-control"].includes(contract.family));
  assert.equal(directory, join(input.evidence, row)); assert.equal(await realpath(directory), directory);
  await verifyInventory(root); const consumerIdentity = await verifyConsumer(input.consumer, true);
  const fixed = inventory.fixtures.find(value => value.id === fixture);
  for (const file of fixed.inputs) assert.equal(hash(await readFile(join(input.native, basename(file.path)))), file.sha256);
  const versions = {}; for (const name of Object.keys(contract.expectedVersions)) versions[name] = await packageVersion(input.native, name);
  assert.deepEqual(versions, contract.expectedVersions); emit({ type: "versions", versions });
  let start = ""; for await (const chunk of process.stdin) { start += chunk; assert.ok(start.length < 256); } assert.deepEqual(JSON.parse(start), { type: "start" });
  const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening"); const port = listener.address().port; emit({ type: "ready", port }); await new Promise(resolve => listener.close(resolve));

  const suffix = row.slice(fixture.length + 1); let profile, counters = { verify: 0, settle: 0, handler: 0 }, observations, diagnostics = [], details;
  const injection = /^(resource|http|express|hono)-(import|require)-upfront-injection$/.exec(suffix);
  if (injection) {
    const [, surface, condition] = injection;
    if (["resource", "http"].includes(surface)) {
      ({ output: observations, diagnostics } = await runProbe("x402-owner-probe.mjs", [input.consumer.directory, input.native, condition, condition, "configured", "safe"], row));
      const matrixResult = observations.at(-1).matrix; counters.verify = matrixResult.filter(value => value.operation === "verify").length; counters.settle = matrixResult.filter(value => value.operation === "settle").length; profile = { surface, condition, ownerMode: "configured" };
    } else {
      ({ output: observations, diagnostics } = await runProbe("x402-framework-probe.mjs", [input.consumer.directory, input.native, condition, surface, "configured", input.certificates], row));
      assert.equal(diagnostics.length, 4);
      const rows = observations[0].rows; counters.settle = rows.reduce((sum, value) => sum + value.counts.settle, 0); counters.handler = rows.reduce((sum, value) => sum + value.counts.handler, 0); profile = { surface, condition, ownerMode: "configured" };
    }
  } else if ((/^next-build-(import|require)-upfront-injection$/).test(suffix)) {
    const condition = suffix.split("-")[2]; ({ observations, diagnostics, details } = await runNextBuild(input, directory, condition));
    const rows = observations[0].rows; counters.settle = rows.reduce((sum, value) => sum + value.counts.settle, 0); counters.handler = rows.reduce((sum, value) => sum + value.counts.handler, 0); profile = { surface: "next-build", condition, ownerMode: "configured" };
  } else if (["default-authorization-rejection", "wrong-owner-rejection", "mixed-condition-configured", "direct-verify-faults"].includes(suffix)) {
    const configurations = {
      "default-authorization-rejection": ["import", "import", "omitted", "unsafe"],
      "wrong-owner-rejection": ["import", "require", "wrong-producer", "unsafe"],
      "mixed-condition-configured": ["import", "require", "configured", "safe"],
      "direct-verify-faults": ["import", "import", "configured", "safe"],
    };
    const configuration = configurations[suffix];
    ({ output: observations, diagnostics } = await runProbe("x402-owner-probe.mjs", [input.consumer.directory, input.native, ...configuration], row));
    const matrixResult = observations.at(-1).matrix; counters.verify = matrixResult.filter(value => value.operation === "verify").length; counters.settle = matrixResult.filter(value => value.operation === "settle").length; profile = { surface: "owner-control", ownerMode: configuration[2], expected: configuration[3] };
  } else if (suffix === "next-native-esm-import-rejection") {
    const loaded = [];
    let rejected = false;
    try { await publicModule(input.native, "@x402/next", "import", loaded); }
    catch (error) { rejected = error?.code === "ERR_MODULE_NOT_FOUND" && /next\/server/.test(String(error?.message)); }
    assert.equal(rejected, true); observations = [{ rejection: "ERR_MODULE_NOT_FOUND", target: "next/server", inventory: loaded }]; profile = { surface: "next-native-esm", expected: "rejected" };
  } else if (suffix === "typed-public-recipe") {
    observations = await runTypedRecipe(input, directory); profile = { surface: "typed-public-recipe", moduleResolution: "Bundler", strict: true };
  } else throw new Error("FRAMEWORK_ROW_NOT_IMPLEMENTED");

  const observation = { row, scope: contract.family, coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, profile, versions, inventory: safeInventory(observations), observationSha256: hash(JSON.stringify(observations)), expectedDiagnostics: diagnostics, counters, ...(details ? { details } : {}) };
  await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  emit({ type: "observation", counters }); emit({ type: "result", assertions: 1 });
}
