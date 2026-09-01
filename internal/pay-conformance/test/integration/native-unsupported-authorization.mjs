import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { currentX402UnsupportedAuthorizationCases, resolveFinalX402UnsupportedAuthorizationProfile } from "../../src/ipc.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [inputPath] = process.argv.slice(2); assert.equal(process.argv.length, 3);
const { input } = await readExecutionInput(inputPath); assert.equal(input.stage, "final-7b");
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const row = `${input.fixture}-unsupported-authorization`;
const profile = resolveFinalX402UnsupportedAuthorizationProfile(input.fixture, row, input.stage);

test(`${input.fixture} unsupported authorization is complete before final-7b admission`, async () => {
  const contract = matrix.rows.find(candidate => candidate.id === row); assert.ok(contract);
  const directory = join(input.evidence, contract.id); await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "authorization-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000, maxOutputBytes: 4194304 });
  await writeFile(join(directory, "authorization.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED"); assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "observation.json")));
  assert.deepEqual([observed.scope, observed.coverage, observed.aggregateStatus, observed.stage], ["fault", "complete", "PASSED", "final-7b"]);
  assert.equal(observed.artifactSha256, input.consumer.artifactSha256);
  assert.deepEqual(observed.catalog, currentX402UnsupportedAuthorizationCases);
  assert.deepEqual(observed.selectorContract, { owner: "@x402/evm", version: profile.version, unknownCaseId: "unknown-required-extension", field: "accepts[].extra.assetTransferMethod", value: "future-transfer", boundary: "required authorization selector; not PaymentRequired.extensions or JSON Schema required" });
  const expected = Object.entries(currentX402UnsupportedAuthorizationCases).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(observed.subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(observed.subcases.length, 12);
  for (const subcase of observed.subcases) {
    assert.equal(subcase.status, "PASSED"); assert.equal(subcase.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === subcase.condition)), true);
    assert.equal(subcase.ports.every(port => port.rebound), true); assert.equal(subcase.tls.every(value => value.trusted && value.wrongCaRejected), true);
    if (subcase.path === "offer") {
      const [negative, positive] = subcase.buyers;
      const targetValue = subcase.caseId === "upto" ? "upto" : subcase.caseId === "permit2" ? "permit2" : "future-transfer";
      assert.deepEqual([negative.authorizationOffer, negative.stage, negative.targetSelector, negative.actualSelector], [true, "negative", { field: subcase.caseId === "upto" ? "accepts.scheme" : "accepts.extra.assetTransferMethod", valueSha256: createHash("sha256").update(targetValue).digest("hex"), owner: profile.owner }, null]);
      assert.deepEqual([positive.authorizationOffer, positive.stage, positive.targetSelector, positive.actualSelector], [true, "positive", null, { scheme: "exact", assetTransferMethod: "eip3009", owner: profile.owner }]);
      assert.equal(Object.hasOwn(negative, "selector") || Object.hasOwn(positive, "selector"), false);
      assert.deepEqual([negative.counters.sign, negative.counters.signedSend, negative.counters.save, negative.counters.clear], [0, 0, 0, 0]);
      assert.deepEqual([positive.counters.sign, positive.counters.signedSend, positive.counters.save, positive.counters.clear], [1, 1, 1, 1]);
      assert.deepEqual([subcase.checkpoints[0].merchant.counters.handler, subcase.checkpoints[0].merchant.counters.applicationEffect, subcase.checkpoints[0].facilitator.counters.settle, subcase.checkpoints[0].facilitator.counters.economicEffect], [0, 0, 0, 0]);
      assert.equal(subcase.checkpoints[0].merchant.redirectTargets, 0);
    } else {
      const [negative, positive] = subcase.checkpoints.map(value => value.buyer);
      const targetValue = subcase.caseId === "upto" ? "upto" : subcase.caseId === "permit2" ? "permit2" : "future-transfer";
      const expectedNegativeActual = { scheme: subcase.caseId === "upto" ? "upto" : "exact", assetTransferMethod: subcase.caseId === "permit2" ? "permit2" : subcase.caseId === "unknown-required-extension" ? "future-transfer" : "eip3009", owner: profile.owner };
      assert.deepEqual(negative.targetSelector, { field: subcase.caseId === "upto" ? "accepts.scheme" : "accepts.extra.assetTransferMethod", valueSha256: createHash("sha256").update(targetValue).digest("hex"), owner: profile.owner });
      assert.deepEqual(negative.actualSelector, expectedNegativeActual); assert.equal(Object.hasOwn(negative, "selector"), false);
      assert.equal(positive.targetSelector, null); assert.deepEqual(positive.actualSelector, { scheme: "exact", assetTransferMethod: "eip3009", owner: profile.owner }); assert.equal(Object.hasOwn(positive, "selector"), false);
      assert.deepEqual([negative.counters.sign, negative.status, negative.classification, negative.receiptSha256, negative.receiptValid], [0, 402, "no-matching-requirements", null, false]);
      assert.deepEqual([positive.counters.sign, positive.status, positive.classification, positive.receiptValid], [1, 200, "paid", true]);
      const failed = subcase.checkpoints[0];
      assert.deepEqual([failed.merchant.counters.handler, failed.merchant.counters.applicationEffect, failed.facilitator.counters.verify, failed.facilitator.counters.settle, failed.facilitator.counters.economicEffect, failed.facilitator.counters.fulfillment], [0, 0, 0, 0, 0, 0]);
      assert.equal(failed.merchant.redirectTargets, 0);
    }
  }
});
