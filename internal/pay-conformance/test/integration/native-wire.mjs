import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inputPath = process.argv[2], { input } = await readExecutionInput(inputPath);
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const cases = {
  "malformed-ambiguous-offer": ["both-credential-headers", "selected-malformed-credential"],
  "network-mismatch": ["credential-offer-chain-mismatch"],
  "asset-mismatch": ["credential-offer-asset-mismatch"],
  "payee-mismatch": ["credential-offer-recipient-mismatch"],
  "amount-mismatch": ["credential-offer-amount-mismatch"],
};
const familyFilter = process.argv[3]; assert.ok(familyFilter === undefined || Object.hasOwn(cases, familyFilter));
// Missing/reordered mutation, a dropped arrival, false effect zero, or a
// native-output/replay substitution must fail against actual role observations.
for (const [family, caseIds] of Object.entries(cases).filter(([family]) => !familyFilter || familyFilter === family)) test(input.fixture + "-" + family + " partial signed-wire controls", async t => {
  const contract = matrix.rows.find(row => row.id === input.fixture + "-" + family), directory = join(input.evidence, contract.id);
  await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "wire-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
  await writeFile(join(directory, "wire.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED", "mutate the first signed send, observe rejection before effect, then independently calibrate native success");
  assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "wire-observations.json")));
  assert.equal(observed.scope, "wire-controls-slice"); assert.equal(observed.coverage, "partial"); assert.equal(observed.aggregateStatus, "BLOCKED");
  assert.equal(observed.stage, "development-only"); assert.equal(observed.artifactSha256, input.consumer.artifactSha256);
  await assert.rejects(access(join(directory, "observation.json")), { code: "ENOENT" });
  assert.deepEqual(observed.subcases.map(({ caseId, condition }) => [caseId, condition]), caseIds.flatMap(id => [[id, "import"], [id, "require"]]));
  for (const s of observed.subcases) await t.test(s.caseId + "/" + s.condition, () => {
    const mpp = input.fixture.startsWith("mppx-"), ambiguous = s.caseId === "both-credential-headers", malformed = s.caseId === "selected-malformed-credential", challengeMutation = ["credential-offer-chain-mismatch", "credential-offer-asset-mismatch"].includes(s.caseId);
    const [negative, positive] = s.checkpoints;
    assert.equal(s.status, "PASSED"); assert.equal(s.sendOwner, "native-first-send-wire-mutator"); assert.equal(s.calibrationOwner, "fresh-native-buyer");
    assert.equal(s.roles.length, 4); assert.equal(s.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === s.condition)), true);
    assert.equal(s.ports.length, 2); assert.equal(s.ports.every(port => port.rebound), true); assert.equal(s.tls.length, 2); assert.equal(s.tls.every(value => value.trusted && value.wrongCaRejected), true);
    assert.notEqual(negative.buyer.pid, positive.buyer.pid);
    assert.deepEqual(s.checkpoints.map(c => c.buyer.stage), ["negative", "positive"]);
    assert.equal(negative.buyer.status, ambiguous || !mpp && !challengeMutation ? 400 : 402);
    assert.equal(negative.buyer.classification, ambiguous ? "AMBIGUOUS_PAYMENT_CREDENTIAL" : mpp ? malformed ? "malformed-credential" : challengeMutation ? "invalid-challenge" : "verification-failed" : challengeMutation ? "no-matching-requirements" : "PAYMENT_CREDENTIAL_INVALID");
    assert.equal(negative.buyer.challenge, !ambiguous && (mpp || challengeMutation)); assert.equal(negative.buyer.receiptSha256, null); assert.equal(negative.buyer.receiptValid, false);
    assert.equal(positive.buyer.status, 200); assert.equal(positive.buyer.classification, "paid"); assert.equal(positive.buyer.receiptValid, true);
    for (const c of s.checkpoints) {
      assert.deepEqual([c.buyer.counters.sign, c.buyer.counters.signedSend, c.buyer.counters.save, c.buyer.counters.clear, c.buyer.counters.rpc, c.buyer.wrapperCalls], [1, 1, 0, 0, 0, 1]);
      const positiveStage = c.buyer.stage === "positive";
      assert.deepEqual([c.merchant.counters.handler, c.merchant.counters.applicationEffect, c.facilitator.counters.settle, c.facilitator.counters.economicEffect, c.facilitator.counters.fulfillment, c.facilitator.counters.verify], positiveStage ? [1, 1, 1, 1, 1, mpp ? 0 : 1] : [0, 0, 0, 0, 0, 0]);
      const arrivals = c.merchant.wireArrivals.filter(a => a.stage === c.buyer.stage);
      assert.equal(arrivals.length, 2); assert.equal(arrivals[0].protocol, null); assert.equal(arrivals[1].protocol, !positiveStage && ambiguous ? "both" : mpp ? "mpp" : "x402");
      assert.equal(arrivals[1].credentialSha256, c.buyer.wire.transmittedSha256); assert.equal(arrivals[1].credentialHeadersSha256, c.buyer.wire.credentialHeadersSha256); assert.equal(arrivals[1].bodySha256, c.buyer.wire.bodySha256);
      for (const a of arrivals) assert.ok(BigInt(a.atNs) < BigInt(a.bodyReadAtNs) && BigInt(a.bodyReadAtNs) < BigInt(a.completedAtNs));
      assert.ok(BigInt(c.buyer.events.find(e => e.event === "sign").atNs) < BigInt(arrivals[1].atNs));
      assert.equal(c.buyer.wire.unchangedBeforeSha256, c.buyer.wire.unchangedAfterSha256);
      assert.equal(c.buyer.wire.envelopeBeforeSha256, c.buyer.wire.envelopeAfterSha256);
    }
    assert.equal(negative.buyer.wire.originalSha256 === negative.buyer.wire.transmittedSha256, ambiguous);
    assert.notEqual(negative.buyer.wire.originalHeadersSha256, negative.buyer.wire.transmittedHeadersSha256);
    assert.equal(positive.buyer.wire.originalSha256, positive.buyer.wire.transmittedSha256); assert.equal(positive.buyer.wire.originalHeadersSha256, positive.buyer.wire.transmittedHeadersSha256); assert.equal(positive.buyer.wire.field, "none");
    const arrivals = positive.facilitator.wirePrivateArrivals;
    assert.deepEqual(negative.facilitator.wirePrivateArrivals.map(a => a.operation), mpp ? [] : ["supported"]);
    assert.deepEqual(arrivals.filter(a => a.stage === "positive").map(a => a.operation), mpp ? ["charge", "fulfillment"] : ["verify", "charge", "fulfillment"]);
    for (const a of arrivals) {
      assert.ok(BigInt(a.atNs) < BigInt(a.bodyReadAtNs) && BigInt(a.bodyReadAtNs) < BigInt(a.stampMetadataValidatedAtNs) && BigInt(a.stampMetadataValidatedAtNs) < BigInt(a.completedAtNs));
      assert.equal(a.responseStatus, 200);
      assert.equal(a.authorizationValidatedAtNs !== null, ["verify", "charge"].includes(a.operation));
      if (a.authorizationValidatedAtNs !== null) assert.ok(BigInt(a.stampMetadataValidatedAtNs) < BigInt(a.authorizationValidatedAtNs) && BigInt(a.authorizationValidatedAtNs) < BigInt(a.completedAtNs));
    }
    assert.equal(s.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
  });
});
