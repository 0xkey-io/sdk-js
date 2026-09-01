import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { currentX402NetworkMismatchCases, resolveFinalX402NetworkMismatchProfile, currentMppNetworkMismatchCases, resolveFinalMppNetworkMismatchProfile } from "../../src/ipc.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [inputPath] = process.argv.slice(2); assert.equal(process.argv.length, 3);
const { input } = await readExecutionInput(inputPath); assert.equal(input.stage, "final-7b");
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const row = `${input.fixture}-network-mismatch`;
const mpp = input.fixture.startsWith("mppx-");
const profile = (mpp ? resolveFinalMppNetworkMismatchProfile : resolveFinalX402NetworkMismatchProfile)(input.fixture, row, input.stage);
const catalog = mpp ? currentMppNetworkMismatchCases : currentX402NetworkMismatchCases;

test(`${input.fixture} network mismatch is complete before final-7b admission`, async () => {
  const contract = matrix.rows.find(candidate => candidate.id === row); assert.ok(contract);
  const directory = join(input.evidence, contract.id); await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, mpp ? "mpp-network-mismatch-controls" : "network-mismatch-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000, maxOutputBytes: 4194304 });
  await writeFile(join(directory, "network-mismatch.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED"); assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "observation.json")));
  assert.deepEqual([observed.scope, observed.coverage, observed.aggregateStatus, observed.stage], ["fault", "complete", "PASSED", "final-7b"]);
  assert.equal(observed.artifactSha256, input.consumer.artifactSha256);
  assert.deepEqual(observed.catalog, catalog);
  assert.deepEqual(observed.networkContract, { owner: profile.owner, version: profile.version, offerCodecOwner: profile.codecOwner, original: "eip155:84532", incompatible: "eip155:8453", unsupported: "eip155:1", wireField: mpp ? "credential.source" : "accepted.network" });
  const expected = Object.entries(catalog).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(observed.subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(observed.subcases.length, 8);
  for (const subcase of observed.subcases) {
    assert.equal(subcase.status, "PASSED");
    assert.equal(subcase.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === subcase.condition)), true);
    assert.equal(subcase.roles.some(role => role.inventory.some(entry => entry.name === (mpp ? "mppx" : "@x402/evm/exact/client") && entry.version === profile.version)), true);
    assert.equal(subcase.ports.every(port => port.rebound), true); assert.equal(subcase.tls.every(value => value.trusted && value.wrongCaRejected), true);
    assert.equal(subcase.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
    if (subcase.path === "offer") {
      const [negative, positive] = subcase.buyers, [failed] = subcase.checkpoints;
      assert.notEqual(negative.pid, positive.pid); assert.deepEqual(subcase.buyers.map(value => value.stage), ["negative", "positive"]);
      assert.deepEqual([negative.counters.sign, negative.counters.save, negative.counters.signedSend, negative.counters.clear, negative.counters.rpc], [0, 0, 0, 0, 0]);
      assert.deepEqual([failed.merchant.counters.handler, failed.merchant.counters.applicationEffect, failed.facilitator.counters.verify, failed.facilitator.counters.settle, failed.facilitator.counters.economicEffect, failed.facilitator.counters.fulfillment, failed.facilitator.counters.rpc, failed.merchant.redirectTargets], [0, 0, 0, 0, 0, 0, 0, 0]);
      assert.deepEqual([positive.counters.sign, positive.counters.save, positive.counters.signedSend, positive.counters.clear, positive.counters.rpc, positive.status, positive.receiptValid], [1, 1, 1, 1, 4, 200, true]);
      const [changed, calibration] = subcase.merchant.offerChanges;
      assert.deepEqual(
        [changed.field, mpp ? `eip155:${changed.decodedChainId}` : changed.decodedNetwork, changed.codecOwner, changed.decoder, changed.encoder],
        [mpp ? "request.methodDetails.chainId" : "accepts.network", subcase.caseId === "other-base-network-offer" ? "eip155:8453" : "eip155:1", profile.codecOwner, mpp ? "Challenge.fromResponse" : "decodePaymentRequiredHeader", mpp ? "Challenge.serialize" : "encodePaymentRequiredHeader"],
      );
      assert.deepEqual(
        [calibration.field, mpp ? `eip155:${calibration.decodedChainId}` : calibration.decodedNetwork, calibration.codecOwner, calibration.decoder, calibration.encoder],
        ["none", "eip155:84532", profile.codecOwner, mpp ? "Challenge.fromResponse" : "decodePaymentRequiredHeader", mpp ? "Challenge.serialize" : "encodePaymentRequiredHeader"],
      );
    } else if (subcase.path === "wire") {
      const [negative, positive] = subcase.checkpoints;
      assert.notEqual(negative.buyer.pid, positive.buyer.pid);
      assert.deepEqual([negative.buyer.counters.sign, negative.buyer.counters.signedSend, negative.buyer.status, negative.buyer.classification], [1, 1, 402, mpp ? "verification-failed" : "no-matching-requirements"]);
      assert.deepEqual([negative.merchant.counters.handler, negative.merchant.counters.applicationEffect, negative.facilitator.counters.verify, negative.facilitator.counters.settle, negative.facilitator.counters.economicEffect, negative.facilitator.counters.fulfillment], [0, 0, 0, 0, 0, 0]);
      assert.deepEqual(
        [negative.buyer.wire.field, mpp ? negative.buyer.wire.decodedSourceNetwork : negative.buyer.wire.decodedNetwork, negative.buyer.wire.codecOwner, negative.buyer.wire.decoder, negative.buyer.wire.encoder],
        [mpp ? "credential.source" : "accepted.network", "eip155:8453", profile.codecOwner, mpp ? "Credential.deserialize" : "decodePaymentSignatureHeader", mpp ? "Credential.serialize" : "encodePaymentSignatureHeader"],
      );
      assert.notEqual(negative.buyer.wire.originalSha256, negative.buyer.wire.transmittedSha256); assert.notEqual(negative.buyer.wire.originalHeadersSha256, negative.buyer.wire.transmittedHeadersSha256);
      assert.equal(negative.buyer.wire.unchangedBeforeSha256, negative.buyer.wire.unchangedAfterSha256); assert.equal(negative.buyer.wire.envelopeBeforeSha256, negative.buyer.wire.envelopeAfterSha256);
      if (mpp) {
        assert.equal(negative.buyer.wire.challengeBeforeSha256, negative.buyer.wire.challengeAfterSha256);
        assert.equal(negative.buyer.wire.payloadBeforeSha256, negative.buyer.wire.payloadAfterSha256);
      }
      assert.deepEqual([positive.buyer.counters.sign, positive.buyer.counters.signedSend, positive.buyer.status, positive.buyer.receiptValid, mpp ? positive.buyer.wire.decodedSourceNetwork : positive.buyer.wire.decodedNetwork], [1, 1, 200, true, "eip155:84532"]);
    } else {
      const [capture, incompatible, resumed] = subcase.buyers;
      assert.equal(new Set(subcase.buyers.map(value => value.pid)).size, 3); assert.deepEqual(subcase.buyers.map(value => value.stage), ["capture", "incompatible", "resume"]);
      assert.deepEqual([capture.counters.sign, capture.counters.save, capture.counters.signedSend, capture.counters.rpc, capture.counters.clear], [1, 1, 0, 0, 0]);
      assert.deepEqual(incompatible.error, { code: "PENDING_PAYMENT_CONFLICT", phase: "recovery", retryable: false }); assert.deepEqual(Object.values(incompatible.counters), Array(13).fill(0));
      assert.deepEqual([incompatible.network, incompatible.saveAttempts, incompatible.clearAttempts, incompatible.transports.length, incompatible.requests.length], ["eip155:8453", 0, 0, 0, 0]);
      assert.deepEqual(subcase.persistedAfterConflict, subcase.persistedBeforeConflict); assert.deepEqual(subcase.checkpoints[2], subcase.checkpoints[1]);
      assert.equal(resumed.network, "eip155:84532"); assert.equal(resumed.credentialSha256, capture.credentialSha256); assert.deepEqual([resumed.counters.sign, resumed.counters.signedSend, resumed.counters.rpc, resumed.counters.clear, resumed.status, resumed.receiptValid], [0, 1, 4, 1, 200, true]);
      assert.equal(subcase.persistedAfter, null);
    }
  }
});
