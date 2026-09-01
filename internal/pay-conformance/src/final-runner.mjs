import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readExecutionInput } from "./execution-input.mjs";
import { deleteRawOutput, sha256 } from "./redact.mjs";
import { writeReport } from "./report.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const fixtures = ["x402-2.23", "x402-2.22", "mppx-0.8.19", "mppx-0.8.17", "x402-framework-2.23", "x402-framework-2.22"];
const lifecycle = ["spawned", "identified", "ready", "observed", "completed", "closed"];

export function createFinal7bUnits(plan) {
  const units = [];
  for (const row of plan.rows) {
    const shared = ["native-direction"].includes(row.family);
    const key = shared ? `${row.integration}:${row.fixture}` : row.id;
    let unit = units.find(value => value.key === key);
    if (!unit) { unit = { key, fixture: row.fixture, integration: row.integration, rows: [] }; units.push(unit); }
    unit.rows.push(row.id);
  }
  assert.equal(units.length, 120, "FINAL_UNIT_COUNT");
  return Object.freeze(units.map(unit => Object.freeze({ ...unit, rows: Object.freeze(unit.rows) })));
}

export function integrationArguments(unit, inputPath) {
  const contract = matrix.rows.find(row => row.id === unit.rows[0]);
  assert.ok(contract && contract.fixture === unit.fixture, "FINAL_UNIT_CONTRACT");
  const args = [process.execPath, join(root, unit.integration), inputPath];
  if (["injection", "owner-control", "native-corpus"].includes(contract.family)) args.push(unit.rows[0]);
  return args;
}

async function runModule(command, cwd, env, timeoutMs) {
  const startedAt = new Date().toISOString(), start = performance.now();
  const child = spawn(command[0], command.slice(1), { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [], stderr = []; let bytes = 0, timedOut = false, outputLimit = false;
  const consume = target => chunk => { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) { outputLimit = true; try { process.kill(-child.pid, "SIGKILL"); } catch {} } else target.push(chunk); };
  child.stdout.on("data", consume(stdout)); child.stderr.on("data", consume(stderr));
  const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGKILL"); } catch {} }, timeoutMs);
  const closed = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
  clearTimeout(timer);
  let groupAbsent = false;
  try { process.kill(-child.pid, 0); } catch (error) { groupAbsent = error?.code === "ESRCH"; }
  const out = Buffer.concat(stdout), err = Buffer.concat(stderr);
  return { startedAt, durationMs: Math.round(performance.now() - start), exitCode: closed.code, signal: closed.signal, timedOut, outputLimit, groupAbsent, stdoutSha256: sha256(out), stderrSha256: sha256(err), stdoutBytes: out.length, stderrBytes: err.length };
}

export function finalOutputAllowed(parent, repository) {
  return parent !== repository && !parent.startsWith(repository + "/");
}

function driverCommand(contract, inputPath, directory) {
  const command = [process.execPath, join(root, contract.driver), inputPath, contract.id, directory];
  if (contract.family === "native-corpus") return [...command, "mpp-malformed-corpus-controls"];
  if (contract.family !== "fault") return command;
  const family = contract.id.slice(contract.fixture.length + 1), mpp = contract.fixture.startsWith("mppx-");
  const slices = {
    "malformed-ambiguous-offer": "malformed-ambiguous-offer-controls", "temporal-validity": "temporal-validity-controls",
    "network-mismatch": mpp ? "mpp-network-mismatch-controls" : "network-mismatch-controls",
    "asset-mismatch": mpp ? "mpp-asset-mismatch-controls" : "asset-mismatch-controls",
    "payee-mismatch": mpp ? "mpp-payee-mismatch-controls" : "payee-mismatch-controls",
    "amount-mismatch": mpp ? "mpp-amount-mismatch-controls" : "amount-mismatch-controls",
    "unsupported-authorization": mpp ? "mpp-authorization-controls" : "authorization-controls",
    replay: "replay-controls", "settle-unknown": "settle-unknown-controls", "verify-settle-rejection": "verify-settle-rejection-controls",
    "supported-failure": "supported-final-controls", "fulfillment-failure": "fulfillment-failure-controls",
    "receipt-absent-malformed": "receipt-absent-malformed-controls", "receipt-mismatch": "receipt-mismatch-controls",
    "unverified-receipt": "unverified-receipt-controls", "standard-wire-receipt": "standard-wire-receipt-controls",
    "handler-failure": "handler-failure-controls", redaction: "redaction-final-controls", "protocol-freeze": "protocol-freeze-final-controls",
  };
  assert.equal(typeof slices[family], "string", "FINAL_SLICE_MISSING"); return [...command, slices[family]];
}

export function recordedCommand(expected, observed) {
  assert.deepEqual(observed, expected, "FINAL_CHILD_COMMAND_MISMATCH");
  return [...observed];
}

const secretEvidenceName = name => name.endsWith(".key") || name.endsWith(".aead");

export async function sanitizeFinalEvidence(directory, expectedRoot = directory) {
  const removed = { secretFiles: 0, symbolicLinks: 0 };
  const rootStat = await lstat(directory);
  assert.equal(rootStat.isDirectory() && !rootStat.isSymbolicLink(), true, "FINAL_EVIDENCE_ROOT");
  const canonicalExpected = await realpath(expectedRoot), canonicalRoot = await realpath(directory);
  assert.equal(canonicalRoot === canonicalExpected || canonicalRoot.startsWith(canonicalExpected + "/"), true, "FINAL_EVIDENCE_ROOT");
  const contained = async path => assert.equal((await realpath(path)).startsWith(canonicalRoot + "/"), true, "FINAL_EVIDENCE_CONTAINMENT");
  const walk = async current => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        await deleteRawOutput(path); removed.symbolicLinks++;
      } else if (stat.isDirectory()) {
        await contained(path);
        await walk(path);
      } else if (stat.isFile() && secretEvidenceName(entry.name)) {
        await deleteRawOutput(path); removed.secretFiles++;
      } else assert.equal(stat.isFile(), true, "FINAL_EVIDENCE_SPECIAL");
    }
  };
  await walk(directory);
  const verify = async current => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name), stat = await lstat(path);
      assert.equal(stat.isSymbolicLink(), false, "FINAL_EVIDENCE_SYMLINK");
      assert.equal(secretEvidenceName(entry.name), false, "FINAL_EVIDENCE_SECRET");
      assert.equal(stat.isFile() || stat.isDirectory(), true, "FINAL_EVIDENCE_SPECIAL");
      if (stat.isDirectory()) {
        await contained(path);
        await verify(path);
      }
    }
  };
  await verify(directory);
  const record = { schemaVersion: "0xkey.pay.evidence-sanitization/v1", policy: "no-key-aead-or-symlink", removed };
  await writeFile(join(directory, "sanitization.json"), JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return record;
}

export async function sanitizeFinalEvidenceRoot(evidenceRoot) {
  const record = await sanitizeFinalEvidence(evidenceRoot, evidenceRoot);
  const path = join(evidenceRoot, "sanitization.json");
  assert.equal((await realpath(path)).startsWith((await realpath(evidenceRoot)) + "/"), true, "FINAL_EVIDENCE_ROOT_RECORD");
  return record;
}

async function bindCertificates(config, inputs, evidenceRoot) {
  const names = ["ca.pem", "wrong-ca.pem", "server.pem", "loopback-ca-v2.pem", "unrelated-ca-v2.pem", "loopback-server-v2.pem"];
  validateCertificateConfig(config.certificateSha256, names);
  const roots = new Set(Object.values(inputs).map(value => value.input.certificates));
  assert.equal(roots.size, 1, "FINAL_CERTIFICATE_ROOT");
  const certificateRoot = [...roots][0], destination = join(evidenceRoot, "environment", "certificates");
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const bound = await readCertificateBytes(certificateRoot, config.certificateSha256, "FINAL_CERTIFICATE_HASH");
  for (const name of names) {
    await writeFile(join(destination, name), bound[name], { flag: "wx", mode: 0o600 });
  }
  await verifyCertificateHashes(destination, config.certificateSha256, "FINAL_CERTIFICATE_COPY");
  const keyPairs = [["server.key", "server.pem"], ["loopback-server-v2.key", "loopback-server-v2.pem"]];
  for (const [keyName, certificateName] of keyPairs) {
    await verifyCertificateKeyPair(certificateRoot, keyName, certificateName);
  }
  return async () => {
    await verifyCertificateHashes(certificateRoot, config.certificateSha256, "FINAL_CERTIFICATE_MUTATED");
    for (const [keyName, certificateName] of keyPairs)
      await verifyCertificateKeyPair(certificateRoot, keyName, certificateName);
  };
}

export function validateCertificateConfig(value, names = ["ca.pem", "wrong-ca.pem", "server.pem", "loopback-ca-v2.pem", "unrelated-ca-v2.pem", "loopback-server-v2.pem"]) {
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype, "FINAL_CERTIFICATE_CONFIG");
  assert.deepEqual(Object.keys(value).sort(), [...names].sort(), "FINAL_CERTIFICATE_CONFIG");
  assert.equal(Object.values(value).every(digest => typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest)), true, "FINAL_CERTIFICATE_CONFIG");
}

export async function verifyCertificateHashes(directory, expected, reason) {
  await readCertificateBytes(directory, expected, reason);
}

async function readNoFollowRegular(directory, name) {
  const rootStat = await lstat(directory);
  assert.equal(rootStat.isDirectory() && !rootStat.isSymbolicLink(), true, "FINAL_CERTIFICATE_ROOT");
  const canonicalRoot = await realpath(directory), path = join(directory, name);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    assert.equal(stat.isFile() && stat.size <= 1048576, true, "FINAL_CERTIFICATE_FILE");
    assert.equal((await realpath(path)).startsWith(canonicalRoot + "/"), true, "FINAL_CERTIFICATE_CONTAINMENT");
    return await handle.readFile();
  } catch (error) {
    if (error?.code === "ELOOP") throw new Error("FINAL_CERTIFICATE_FILE");
    throw error;
  } finally { await handle?.close(); }
}

async function readCertificateBytes(directory, expected, reason) {
  const result = {};
  for (const [name, digest] of Object.entries(expected)) {
    const bytes = await readNoFollowRegular(directory, name);
    assert.equal(sha256(bytes), digest, reason); result[name] = bytes;
  }
  return result;
}

export function verifyPrivateKeyPair(privateKey, publicKey) {
  const derived = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const expected = publicKey.export({ type: "spki", format: "der" });
  assert.equal(sha256(derived), sha256(expected), "FINAL_CERTIFICATE_KEY_PAIR");
}

async function verifyCertificateKeyPair(directory, keyName, certificateName) {
  const key = createPrivateKey(await readNoFollowRegular(directory, keyName));
  const certificate = new X509Certificate(await readNoFollowRegular(directory, certificateName));
  verifyPrivateKeyPair(key, certificate.publicKey);
}

async function rowEvidence(evidenceRoot, inputPath, input, contract, controllerPath) {
  const directory = join(evidenceRoot, contract.id), names = await readdir(directory);
  const processNames = names.filter(name => name.endsWith("process.json"));
  assert.equal(processNames.length, 1, "FINAL_PROCESS_EVIDENCE");
  const processPath = join(directory, processNames[0]), observationPath = join(directory, "observation.json");
  const processResult = JSON.parse(await readFile(processPath)), observed = JSON.parse(await readFile(observationPath));
  assert.equal(processResult.status, "PASSED", "FINAL_ROW_FAILED");
  assert.equal(processResult.cleanup.groupAbsent, true, "FINAL_ROW_CLEANUP");
  assert.deepEqual(processResult.lifecycle, lifecycle, "FINAL_ROW_LIFECYCLE");
  assert.deepEqual(processResult.observedVersions, contract.expectedVersions, "FINAL_ROW_VERSION");
  assert.equal(observed.artifactSha256, input.consumer.artifactSha256, "FINAL_ROW_ARTIFACT");
  const evidence = [];
  for (const name of names.filter(name => ["observation.json", "execution-binding.json", "execution-input.json", "sanitization.json"].includes(name) || name.endsWith("process.json")).sort()) {
    const path = join(directory, name); evidence.push({ path: relative(evidenceRoot, path), sha256: sha256(await readFile(path)) });
  }
  evidence.push({ path: relative(evidenceRoot, controllerPath), sha256: sha256(await readFile(controllerPath)) });
  const command = recordedCommand(driverCommand(contract, inputPath, directory), processResult.command);
  return { id: contract.id, requirement: contract.requirement, status: "PASSED", expectedVersions: structuredClone(contract.expectedVersions), observedVersions: processResult.observedVersions, sourceSnapshots: structuredClone(contract.sourceSnapshots), command, exitCode: processResult.exitCode, startedAt: processResult.startedAt, durationMs: processResult.durationMs, network: "loopback_no_chain", externalMutations: false, artifactSha256: input.consumer.artifactSha256, stdoutSha256: processResult.stdout.sha256, stderrSha256: processResult.stderr.sha256, evidence, blocker: null, lifecycle: processResult.lifecycle };
}

function deferredRow(contract) {
  if (contract.capabilityEvidence) return { id: contract.id, requirement: contract.requirement, status: "NOT_APPLICABLE", expectedVersions: structuredClone(contract.expectedVersions), observedVersions: {}, sourceSnapshots: structuredClone(contract.sourceSnapshots), command: [], exitCode: null, startedAt: null, durationMs: 0, network: "loopback_no_chain", externalMutations: false, artifactSha256: null, stdoutSha256: null, stderrSha256: null, evidence: [structuredClone(contract.capabilityEvidence)], blocker: null, lifecycle: [] };
  const external = contract.owner === "external-operator";
  return { id: contract.id, requirement: contract.requirement, status: "BLOCKED", expectedVersions: structuredClone(contract.expectedVersions), observedVersions: {}, sourceSnapshots: structuredClone(contract.sourceSnapshots), command: [], exitCode: null, startedAt: null, durationMs: 0, network: "loopback_no_chain", externalMutations: false, artifactSha256: null, stdoutSha256: null, stderrSha256: null, evidence: [], blocker: { probe: external ? "authorized-environment-absent" : "final-7c-not-executed", expected: contract.driver, observed: "not-executed", owner: contract.owner, remediation: external ? "authorized-operator-required" : "execute-applicable-final-7c" }, lifecycle: [] };
}

export async function executeFinal7b({ plan, configPath, outputPath }) {
  if (!isAbsolute(configPath) || !isAbsolute(outputPath)) throw new Error("FINAL_PATH_REJECTED");
  const config = JSON.parse(await readFile(configPath));
  assert.deepEqual(Object.keys(config).sort(), ["certificateSha256", "inputs"], "FINAL_CONFIG_REJECTED");
  assert.deepEqual(Object.keys(config.inputs).sort(), [...fixtures].sort(), "FINAL_CONFIG_REJECTED");
  const inputs = {};
  for (const fixture of fixtures) inputs[fixture] = await readExecutionInput(config.inputs[fixture]);
  const evidenceRoots = new Set(Object.values(inputs).map(value => value.input.evidence));
  const artifacts = new Set(Object.values(inputs).map(value => value.input.consumer.artifactSha256));
  assert.equal(evidenceRoots.size, 1, "FINAL_EVIDENCE_MISMATCH"); assert.equal(artifacts.size, 1, "FINAL_ARTIFACT_MISMATCH");
  const evidenceRoot = [...evidenceRoots][0]; await mkdir(join(evidenceRoot, "controller"), { mode: 0o700 });
  const verifyCertificatesUnchanged = await bindCertificates(config, inputs, evidenceRoot);
  const outputParent = await realpath(dirname(outputPath)), repository = await realpath(resolve(root, "../.."));
  assert.equal(outputParent, dirname(outputPath), "FINAL_OUTPUT_PARENT");
  assert.equal(finalOutputAllowed(outputParent, repository), true, "FINAL_OUTPUT_REPOSITORY");
  const completed = new Map();
  for (const unit of createFinal7bUnits(plan)) {
    const inputPath = config.inputs[unit.fixture], args = integrationArguments(unit, inputPath);
    const environment = { PATH: "/opt/homebrew/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C", CI: "true", COREPACK_ENABLE_NETWORK: "0" };
    const supervision = await runModule(args, evidenceRoot, environment, unit.integration.includes("native-directions") ? 180000 : 90000);
    const controllerPath = join(evidenceRoot, "controller", unit.rows[0] + ".json");
    await writeFile(controllerPath, JSON.stringify({ unit, command: args, supervision }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    assert.deepEqual([supervision.exitCode, supervision.signal, supervision.timedOut, supervision.outputLimit, supervision.groupAbsent], [0, null, false, false, true], "FINAL_UNIT_FAILED");
    for (const id of unit.rows) {
      const contract = matrix.rows.find(row => row.id === id);
      await sanitizeFinalEvidence(join(evidenceRoot, contract.id), evidenceRoot);
      completed.set(id, await rowEvidence(evidenceRoot, inputPath, inputs[unit.fixture].input, contract, controllerPath));
    }
  }
  assert.equal(completed.size, 132, "FINAL_ROW_COUNT");
  await verifyCertificatesUnchanged();
  const capabilityEvidence = new Map(matrix.rows.filter(row => row.capabilityEvidence).map(row => [row.capabilityEvidence.path, row.capabilityEvidence]));
  for (const item of capabilityEvidence.values()) {
    const source = join(root, item.path), destination = join(evidenceRoot, item.path);
    assert.equal(sha256(await readFile(source)), item.sha256, "FINAL_CAPABILITY_SOURCE");
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 }); await writeFile(destination, await readFile(source), { flag: "wx", mode: 0o600 });
    assert.equal(sha256(await readFile(destination)), item.sha256, "FINAL_CAPABILITY_COPY");
  }
  await sanitizeFinalEvidenceRoot(evidenceRoot);
  const report = { schemaVersion: "0xkey.pay.conformance/v1", phase: "7B", releaseDecision: "not_approved", matrixSha256: sha256(JSON.stringify(matrix)), rows: matrix.rows.map(contract => completed.get(contract.id) ?? deferredRow(contract)) };
  const reportSha256 = await writeReport(outputPath, report, matrix, evidenceRoot);
  return { status: "PASSED", phase: "7B", rows: completed.size, artifactSha256: [...artifacts][0], reportSha256, releaseDecision: "not_approved" };
}
