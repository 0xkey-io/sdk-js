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
const mpp = input.fixture.startsWith("mppx-");
const cases = {
  "malformed-ambiguous-offer": ["header-invalid-base64", "header-invalid-json", ...mpp ? [] : ["unsupported-scheme"]],
  "unsupported-authorization": mpp ? ["session-intent", "non-evm-method"] : ["upto", "permit2"],
  ...mpp ? { "temporal-validity": ["expired-challenge"] } : {},
  "network-mismatch": ["other-base-network-offer", "unsupported-chain-offer"],
  "asset-mismatch": ["non-usdc-offer", "wrong-network-usdc"],
  "payee-mismatch": ["invalid-recipient-offer"],
  "amount-mismatch": ["above-ceiling", "negative", "non-integer-atomic", "malformed-price"],
};
const familyFilter = process.argv[3];
assert.ok(familyFilter === undefined || Object.hasOwn(cases, familyFilter));
// A buyer signing an invalid offer, or a counter that misses real successful
// calls, must fail these pre-sign refusals and fresh-operation calibrations.
for (const [family, caseIds] of Object.entries(cases).filter(([family]) => !familyFilter || familyFilter === family)) test(input.fixture + "-" + family + " partial initial-offer controls", async t => {
  const contract = matrix.rows.find(row => row.id === input.fixture + "-" + family), directory = join(input.evidence, contract.id);
  await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "offer-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
  await writeFile(join(directory, "offer.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED", "invalid initial offers must stop before signing; a fresh valid offer must exercise every measured hook");
  assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "offer-observations.json")));
  assert.equal(observed.scope, "offer-controls-slice"); assert.equal(observed.coverage, "partial"); assert.equal(observed.aggregateStatus, "BLOCKED");
  assert.equal(observed.stage, "development-only"); assert.equal(observed.artifactSha256, input.consumer.artifactSha256);
  await assert.rejects(access(join(directory, "observation.json")), { code: "ENOENT" });
  assert.deepEqual(observed.subcases.map(({ caseId, condition }) => [caseId, condition]), caseIds.flatMap(id => [[id, "import"], [id, "require"]]));
  for (const subcase of observed.subcases) await t.test(subcase.caseId + "/" + subcase.condition, () => {
    const [negative, positive] = subcase.buyers, c = subcase.counters;
    assert.equal(subcase.status, "PASSED"); assert.notEqual(negative.pid, positive.pid);
    assert.deepEqual(subcase.buyers.map(buyer => buyer.stage), ["negative", "positive"]);
    assert.equal(subcase.roles.length, 4); assert.equal(subcase.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === subcase.condition)), true);
    assert.equal(subcase.ports.length, 2); assert.equal(subcase.ports.every(port => port.rebound), true);
    assert.equal(subcase.tls.length, 2); assert.equal(subcase.tls.every(control => control.trusted && control.wrongCaRejected), true);
    assert.deepEqual([negative.counters.sign, negative.counters.save, negative.saveAttempts, negative.counters.signedSend, negative.counters.clear, negative.clearAttempts, negative.counters.rpc], [0, 0, 0, 0, 0, 0, 0]);
    const policy = ["other-base-network-offer", "unsupported-chain-offer", "non-usdc-offer", "wrong-network-usdc", "above-ceiling"].includes(subcase.caseId);
    const expired = subcase.caseId === "expired-challenge", unsupported = ["permit2", "session-intent", "non-evm-method"].includes(subcase.caseId);
    assert.deepEqual(negative.error, { code: expired ? "PAYMENT_SERVICE_UNAVAILABLE" : policy ? "PAYMENT_POLICY_DENIED" : unsupported ? "PAYMENT_OFFER_UNSUPPORTED" : "PAYMENT_CHALLENGE_INVALID", phase: expired ? "request" : policy ? "policy" : "challenge", retryable: expired });
    assert.equal(negative.status, 402); assert.equal(negative.pending, false); assert.equal(subcase.persistedAfterNegative, null);
    assert.equal(negative.credentialSha256, null); assert.equal(negative.recordSha256, null); assert.equal(negative.receiptSha256, null);
    const checkpoint = subcase.checkpoints[0];
    assert.deepEqual([checkpoint.merchant.counters.challenge, checkpoint.merchant.counters.handler, checkpoint.merchant.counters.applicationEffect, checkpoint.facilitator.counters.settle, checkpoint.facilitator.counters.economicEffect, checkpoint.facilitator.counters.rpc], [1, 0, 0, 0, 0, 0]);
    assert.deepEqual(checkpoint.merchant.received, []);
    assert.deepEqual([positive.counters.sign, positive.counters.save, positive.saveAttempts, positive.counters.signedSend, positive.counters.clear, positive.clearAttempts, positive.counters.rpc], [1, 1, 1, 1, 1, 1, 4]);
    assert.equal(positive.error, null); assert.equal(positive.status, 200); assert.equal(positive.pending, false); assert.equal(positive.receiptValid, true); assert.equal(subcase.persistedAfter, null);
    assert.deepEqual([c.sign, c.save, c.signedSend, c.clear, c.settle, c.handler, c.economicEffect, c.applicationEffect, c.rpc, c.verify, c.fulfillment, c.challenge], [1, 1, 1, 1, 1, 1, 1, 1, 4, 0, 0, 2]);
    assert.deepEqual(subcase.merchant.received, [positive.credentialSha256]);
    const events = positive.events.map(event => event.event);
    assert.ok(events.indexOf("sign") < events.indexOf("save") && events.indexOf("save") < events.indexOf("signedSend") && events.indexOf("signedSend") < events.indexOf("clear"));
    assert.deepEqual(subcase.facilitator.rpcReads.map(read => read.method).sort(), ["eth_chainId", "eth_getBlockByNumber", "eth_getTransactionByHash", "eth_getTransactionReceipt"].sort());
    const changes = subcase.merchant.offerChanges;
    assert.equal(changes.length, 2); assert.equal(changes[0].caseId, subcase.caseId); assert.equal(changes[0].stage, "negative"); assert.notEqual(changes[0].beforeSha256, changes[0].afterSha256);
    const mpp = input.fixture.startsWith("mppx-"), field = family === "network-mismatch" ? mpp ? "request.methodDetails.chainId" : "accepts.network" : family === "asset-mismatch" ? mpp ? "request.currency" : "accepts.asset" : family === "payee-mismatch" ? mpp ? "request.recipient" : "accepts.payTo" : family === "amount-mismatch" ? mpp ? "request.amount" : "accepts.amount" : mpp ? "request-encoding" : "header-encoding";
    const parameter = { "session-intent": "intent", "non-evm-method": "method", "expired-challenge": "expires" }[subcase.caseId];
    assert.equal(changes[0].field, parameter ? "challenge." + parameter : ["unsupported-scheme", "upto"].includes(subcase.caseId) ? "accepts.scheme" : subcase.caseId === "permit2" ? "accepts.extra.assetTransferMethod" : field);
    if (["unsupported-scheme", "upto", "permit2", "malformed-price", "session-intent", "non-evm-method", "expired-challenge"].includes(subcase.caseId)) for (const change of changes) {
      assert.match(change.unchangedBeforeSha256, /^[a-f0-9]{64}$/);
      assert.equal(change.unchangedBeforeSha256, change.unchangedAfterSha256);
      if (parameter) {
        assert.match(change.requestBeforeSha256, /^[a-f0-9]{64}$/);
        assert.equal(change.requestBeforeSha256, change.requestAfterSha256);
      }
    }
    assert.equal(changes[1].stage, "positive"); assert.equal(changes[1].field, "none"); assert.equal(changes[1].beforeSha256, changes[1].afterSha256);
    assert.equal(changes.every(change => change.envelopeBeforeSha256 === change.envelopeAfterSha256), true);
    const clearAt = BigInt(positive.events.find(event => event.event === "clear").atNs);
    assert.equal(subcase.facilitator.events.filter(event => event.event === "rpc").every(event => BigInt(event.atNs) < clearAt), true);
    assert.equal(subcase.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
  });
});
