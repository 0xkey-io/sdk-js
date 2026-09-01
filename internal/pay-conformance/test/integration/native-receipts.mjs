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
  "receipt-absent-malformed": ["absent", "invalid-base64", "invalid-json", "wrong-protocol-header", "malformed-required-field"],
  "receipt-mismatch": [...(mpp ? [] : ["wrong-receipt-network"]), "wrong-receipt-transaction", "wrong-chain", "wrong-contract", "wrong-payer", "wrong-payee", "wrong-amount", "wrong-nonce", "wrong-validity", "wrong-call", "missing-transfer", "missing-authorization-used", "noncanonical-block", "failed-receipt", "transaction-hash-mismatch"],
  "unverified-receipt": ["rpc-unavailable", "rpc-invalid-response", "audited-verifier-false", "audited-verifier-throws"],
};
const familyFilter = process.argv[3];
assert.ok(familyFilter === undefined || Object.hasOwn(cases, familyFilter));
// Removing public receipt validation or clearing before full proof must fail
// these assertions, even if the native seller and private effect both succeed.
for (const [family, caseIds] of Object.entries(cases).filter(([family]) => !familyFilter || familyFilter === family)) test(input.fixture + "-" + family + " partial buyer controls", async t => {
  const contract = matrix.rows.find(row => row.id === input.fixture + "-" + family);
  const directory = join(input.evidence, contract.id);
  await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "receipt-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
  await writeFile(join(directory, "receipt.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED", "real native receipts must fail closed then recover through a fresh public buyer with matching full proof");
  assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "receipt-observations.json")));
  assert.equal(observed.scope, "receipt-controls-slice"); assert.equal(observed.coverage, "partial"); assert.equal(observed.aggregateStatus, "BLOCKED");
  assert.equal(observed.stage, "development-only"); assert.equal(observed.artifactSha256, input.consumer.artifactSha256);
  await assert.rejects(access(join(directory, "observation.json")), { code: "ENOENT" });
  assert.deepEqual(observed.subcases.map(({ caseId, condition }) => [caseId, condition]), caseIds.flatMap(id => [[id, "import"], [id, "require"]]));
  for (const subcase of observed.subcases) await t.test(subcase.caseId + "/" + subcase.condition, () => {
    const c = subcase.counters, [negative, positive] = subcase.buyers;
    assert.equal(subcase.status, "PASSED");
    assert.equal(subcase.ports.length, 2); assert.equal(subcase.ports.every(port => port.rebound), true);
    assert.equal(subcase.tls.length, 2); assert.equal(subcase.tls.every(control => control.trusted && control.wrongCaRejected), true);
    assert.equal(subcase.roles.length, 4); assert.equal(subcase.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === subcase.condition)), true);
    assert.notEqual(negative.pid, positive.pid);
    assert.deepEqual([c.sign, c.save, c.signedSend, c.clear, c.settle, c.handler, c.economicEffect, c.applicationEffect, c.verify, c.fulfillment, c.challenge], [1, 1, 2, 1, 2, 2, 1, 1, 0, 0, 1]);
    assert.deepEqual([negative.counters.sign, negative.counters.save, negative.counters.signedSend, negative.counters.clear, negative.clearAttempts], [1, 1, 1, 0, 0]);
    assert.deepEqual([positive.counters.sign, positive.counters.save, positive.counters.signedSend, positive.counters.clear, positive.clearAttempts, positive.counters.rpc], [0, 0, 1, 1, 1, 4]);
    assert.equal(negative.pending, true); assert.equal(positive.pending, false); assert.equal(positive.error, null); assert.equal(positive.status, 200);
    const initialEvents = negative.events.map(event => event.event);
    assert.ok(initialEvents.indexOf("sign") < initialEvents.indexOf("save") && initialEvents.indexOf("save") < initialEvents.indexOf("signedSend"));
    if (family === "receipt-absent-malformed") {
      const missing = subcase.caseId === "absent";
      assert.deepEqual(negative.error, { code: missing ? "PAYMENT_RECEIPT_MISSING" : "PAYMENT_SERVICE_UNAVAILABLE", phase: missing ? "receipt" : "request", retryable: !missing });
      assert.equal(negative.counters.rpc, 0);
    } else if (family === "receipt-mismatch") {
      assert.deepEqual(negative.error, { code: "PAYMENT_RECEIPT_MISMATCH", phase: "receipt", retryable: false });
      const early = ["wrong-receipt-transaction", "wrong-chain", "wrong-contract", "failed-receipt", "transaction-hash-mismatch"].includes(subcase.caseId);
      assert.equal(negative.counters.rpc, subcase.caseId === "wrong-receipt-network" ? 0 : early ? 3 : 4);
    } else {
      const callback = subcase.caseId.startsWith("audited-");
      assert.deepEqual(negative.error, { code: subcase.caseId === "audited-verifier-false" ? "PAYMENT_RECEIPT_MISMATCH" : "PAYMENT_RECEIPT_UNVERIFIED", phase: "receipt", retryable: subcase.caseId !== "audited-verifier-false" });
      assert.equal(negative.counters.rpc, callback ? 0 : 3);
      assert.equal(negative.verifierCalls.length, callback ? 1 : 0);
      if (callback) assert.equal(negative.verifierCalls[0].decision, subcase.caseId === "audited-verifier-false" ? "false" : "throws");
      assert.deepEqual(positive.verifierCalls, []);
    }
    assert.equal(subcase.persistedAtFailure.ciphertextSha256, negative.sentCiphertextSha256);
    assert.equal(subcase.persistedAtFailure.ciphertextSha256, positive.sentCiphertextSha256);
    assert.equal(subcase.persistedAfter, null);
    assert.equal(positive.credentialSha256, negative.credentialSha256);
    assert.equal(positive.recordSha256, negative.recordSha256);
    assert.deepEqual(subcase.merchant.received, [negative.credentialSha256, negative.credentialSha256]);
    const reads = subcase.facilitator.rpcReads;
    assert.deepEqual(reads.filter(read => read.stage === "proof").map(read => read.method).sort(), ["eth_chainId", "eth_getBlockByNumber", "eth_getTransactionByHash", "eth_getTransactionReceipt"].sort());
    assert.equal(reads.filter(read => read.stage === "negative").length, negative.counters.rpc);
    if (family === "receipt-mismatch") {
      const fields = { "wrong-chain": "chainId", "wrong-contract": "transaction.to", "wrong-payer": "transaction.input.from", "wrong-payee": "transaction.input.to", "wrong-amount": "transaction.input.value", "wrong-nonce": "transaction.input.nonce", "wrong-validity": "transaction.input.validBefore", "wrong-call": "transaction.input", "missing-transfer": "receipt.logs.Transfer", "missing-authorization-used": "receipt.logs.AuthorizationUsed", "noncanonical-block": "block.hash", "failed-receipt": "receipt.status", "transaction-hash-mismatch": "transaction.hash" };
      assert.deepEqual(reads.filter(read => read.field !== "none").map(read => read.field), fields[subcase.caseId] ? [fields[subcase.caseId]] : []);
      assert.equal(reads.filter(read => read.stage === "proof").every(read => read.field === "none" && read.originalResultSha256 === read.resultSha256), true);
    }
    assert.equal(subcase.merchant.receiptChanges.length, 2);
    assert.equal(subcase.merchant.receiptChanges[0].caseId, subcase.caseId);
    assert.equal(subcase.merchant.receiptChanges[1].beforeSha256, subcase.merchant.receiptChanges[1].afterSha256);
    const clearAt = BigInt(positive.events.find(event => event.event === "clear").atNs);
    assert.equal(subcase.facilitator.events.filter(event => event.event === "rpc").slice(-4).every(event => BigInt(event.atNs) < clearAt), true);
    assert.equal(subcase.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
  });
});
