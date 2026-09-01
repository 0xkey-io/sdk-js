import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { currentStandardWireReceiptCases, resolveFinalStandardWireReceiptProfile } from "../../src/ipc.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inputPath = process.argv[2], { input } = await readExecutionInput(inputPath);
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const row = `${input.fixture}-standard-wire-receipt`, profile = resolveFinalStandardWireReceiptProfile(input.fixture, row, input.stage);
test(input.fixture + " final standard wire receipt", async t => {
  const contract = matrix.rows.find(item => item.id === row), directory = join(input.evidence, contract.id); await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "standard-wire-receipt-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
  await writeFile(join(directory, "standard-wire-receipt.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 }); assert.equal(run.status, "PASSED"); assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "observation.json"))); assert.equal(observed.coverage, "complete"); assert.equal(observed.aggregateStatus, "PASSED"); assert.equal(observed.artifactSha256, input.consumer.artifactSha256); assert.deepEqual(observed.catalog, currentStandardWireReceiptCases[profile.protocol]);
  assert.deepEqual(observed.receiptContract, { protocol: profile.protocol, owner: profile.owner, version: profile.version, privateEnvelopeExcluded: true, privatePaymentIdExcluded: true, directWrapperApplicable: profile.protocol === "mpp" });
  assert.deepEqual(observed.subcases.map(x => [x.caseId, x.condition]), profile.catalog.flatMap(id => [[id, "import"], [id, "require"]]));
  for (const s of observed.subcases) await t.test(`${s.caseId}/${s.condition}`, () => {
    assert.equal(s.status, "PASSED");
    if (s.caseId.startsWith("direct-wrapper-")) { assert.equal(profile.protocol, "mpp"); assert.equal(s.inventory.some(x => x.name === "mppx" && x.version === profile.version), true); assert.equal(s.bodyPreserved, true); assert.equal(s.callerUnmodified, true); assert.equal(s.receiptEmitted, s.caseId.endsWith("2xx-positive")); return; }
    assert.equal(s.underlyingCaseId, "handler-200"); assert.equal(s.checkpoints.length, 1); assert.equal(s.checkpoints[0].buyer.status, 200); assert.equal(s.checkpoints[0].buyer.receiptValid, true); assert.ok(s.checkpoints[0].buyer.receiptSha256); assert.equal(s.checkpoints[0].buyer.receiptFields.includes("paymentId"), false); assert.equal(s.checkpoints[0].buyer.receiptFields.some(key => /private|envelope|raw/i.test(key)), false);
    assert.equal(s.roles.some(role => role.inventory.some(entry => profile.protocol === "mpp" ? entry.name === "mppx" && entry.version === profile.version : entry.name.startsWith("@x402/") && entry.version === profile.version)), true);
    assert.equal(s.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === s.condition)), true); assert.equal(s.ports.every(x => x.rebound), true); assert.equal(s.tls.every(x => x.trusted && x.wrongCaRejected), true); assert.equal(s.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
  });
});
