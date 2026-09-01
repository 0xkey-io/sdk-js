import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDecipheriv } from "node:crypto";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { verifyConsumer } from "../../src/consumer.mjs";
import { verifyInventory } from "../../src/run.mjs";
import { nativeScenario } from "../../fixtures/runtime/scenario.mjs";
import { initializeStore } from "../../fixtures/runtime/durable-store.mjs";
import { hash } from "../../fixtures/runtime/common.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [inputPath, directory] = process.argv.slice(2);
const { input, inputSha256 } = await readExecutionInput(inputPath);
assert.equal(input.stage, "development-only");
assert.equal(directory, join(input.evidence, "capture-lifetime"));
assert.equal(await realpath(directory), directory);
await verifyInventory(root);
const consumerIdentity = await verifyConsumer(input.consumer, true);
const inventory = JSON.parse(await readFile(join(root, "fixtures/inventory.json")));
const fixture = inventory.fixtures.find(item => item.id === input.fixture);
for (const file of fixture.inputs) assert.equal(hash(await readFile(join(input.native, basename(file.path)))), file.sha256);
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const contract = matrix.rows.find(row => row.fixture === input.fixture && row.family === "recovery");
const versions = {};
for (const name of Object.keys(contract.expectedVersions)) {
  const manifest = JSON.parse(await readFile(join(input.native, "node_modules", name, "package.json")));
  assert.equal(manifest.name, name); versions[name] = manifest.version;
}
assert.deepEqual(versions, contract.expectedVersions);
const sourceFiles = [fileURLToPath(import.meta.url), join(import.meta.dirname, "native-capture-lifetime.mjs"), ...["buyer", "scenario", "common", "durable-store", "merchant", "scripted-facilitator"].map(name => join(root, "fixtures/runtime", name + ".mjs"))];
const sources = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, hash(await readFile(path))])));
const emit = value => process.stdout.write(JSON.stringify(value) + "\n");
emit({ type: "versions", versions });
let start = "";
for await (const chunk of process.stdin) { start += chunk; assert.ok(start.length < 256); }
assert.deepEqual(JSON.parse(start), { type: "start" });
const config = { condition: "import", protocol: input.fixture.startsWith("mppx-") ? "mpp" : "x402", payBuyer: true, native: input.native, pay: input.consumer.directory, certificates: input.certificates };
const scenario = nativeScenario({ config, assert });
const observed = { inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, sources, failure: null, aliveUntilKill: false, killAtNs: null };
try {
  const facilitator = await scenario.spawnRole("scripted-facilitator");
  const merchant = await scenario.spawnRole("merchant", { facilitator: facilitator.origin });
  emit({ type: "ready", port: Number(new URL(merchant.origin).port) });
  await scenario.verifyTls([facilitator, merchant]);
  const store = join(directory, "durable"); initializeStore(store);
  const step = "save-before-send-exit";
  for (const role of [facilitator, merchant]) { role.send({ type: "configure", step }); assert.equal((await role.take("configured")).step, step); }
  const buyer = await scenario.spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin, store, step });
  let termination;
  buyer.close.then(value => { termination = value; });
  observed.prepared = await buyer.take("prepared");
  observed.preparedAtNs = process.hrtime.bigint().toString();
  assert.deepEqual([observed.prepared.counters.sign, observed.prepared.counters.save, observed.prepared.counters.signedSend, observed.prepared.counters.clear], [1, 1, 0, 0]);
  const bytes = await readFile(join(store, "pending.aead")), key = await readFile(join(store, "storage.key"));
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from("pay-conformance-v1")); decipher.setAuthTag(bytes.subarray(12, 28));
  const record = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
  observed.recordSha256 = record.digest.slice(2);
  observed.credentialSha256 = hash(record.payment.headers.find(([name]) => name === (config.protocol === "mpp" ? "authorization" : "payment-signature"))[1]);
  observed.ciphertextBefore = hash(bytes); observed.keySha256 = hash(key);
  // Close the owned HTTPS listeners and all their connections. The observation
  // timer lives only in this supervisor, never in the actual captured buyer.
  await scenario.closeRoles([merchant, facilitator]);
  observed.drainedAtNs = process.hrtime.bigint().toString();
  await delay(1000);
  observed.aliveUntilKill = termination === undefined && buyer.child.exitCode === null && buyer.child.signalCode === null;
  if (observed.aliveUntilKill) { observed.killAtNs = process.hrtime.bigint().toString(); buyer.child.kill("SIGKILL"); }
  observed.termination = await buyer.close;
  observed.ciphertextAfter = hash(await readFile(join(store, "pending.aead")));
} catch (error) { observed.failure = hash(String(error?.message)); }
finally {
  observed.diagnostics = await scenario.cleanup();
  observed.ports = scenario.ports; observed.tls = scenario.tlsControls;
  observed.roles = scenario.roles.map(role => {
    let absentAfterCleanup = false;
    try { process.kill(role.child.pid, 0); } catch (error) { assert.equal(error.code, "ESRCH"); absentAfterCleanup = true; }
    return { ...role.identity, absentAfterCleanup };
  });
  await writeFile(join(directory, "lifetime.json"), JSON.stringify(observed, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
assert.equal(observed.failure, null);
assert.equal(observed.aliveUntilKill, true, "CAPTURE_EXITED_BEFORE_SUPERVISOR_KILL");
assert.deepEqual(observed.termination, { code: null, signal: "SIGKILL", reason: "ROLE_EXIT_NONZERO" });
assert.equal(observed.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
const { supported, ...counts } = observed.prepared.counters;
emit({ type: "observation", counters: counts });
emit({ type: "result", assertions: 1 });
