import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { currentFulfillmentFailureCases, resolveFinalFulfillmentFailureProfile } from "../../src/ipc.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inputPath = process.argv[2], { input } = await readExecutionInput(inputPath);
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const row = `${input.fixture}-fulfillment-failure`;
const profile = resolveFinalFulfillmentFailureProfile(input.fixture, row, input.stage);
const caseIds = currentFulfillmentFailureCases;
test(input.fixture + " final fulfillment failure lifecycle", async t => {
  const contract = matrix.rows.find(item => item.id === row), directory = join(input.evidence, contract.id);
  await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "fulfillment-failure-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
  await writeFile(join(directory, "fulfillment-failure.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED", "native signed invocation and application-owned identical-request retry must expose actual fulfillment acknowledgement");
  assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "observation.json")));
  assert.equal(observed.scope, "fault"); assert.equal(observed.coverage, "complete"); assert.equal(observed.aggregateStatus, "PASSED");
  assert.equal(observed.stage, "final-7b"); assert.equal(observed.artifactSha256, input.consumer.artifactSha256);
  assert.deepEqual(observed.catalog, currentFulfillmentFailureCases);
  assert.deepEqual(observed.fulfillmentContract, { protocol: profile.protocol, owner: profile.owner, version: profile.version, acknowledgementStatus: 200, retryOwner: "application-same-process-captured-request" });
  assert.deepEqual(observed.subcases.map(({ caseId, condition }) => [caseId, condition]), caseIds.flatMap(id => [[id, "import"], [id, "require"]]));
  for (const s of observed.subcases) await t.test(s.caseId + "/" + s.condition, () => {
    const first = s.checkpoints[0], final = s.checkpoints[1], mpp = input.fixture.startsWith("mppx-");
    assert.equal(s.status, "PASSED"); assert.equal(s.roles.length, 3); assert.equal(s.checkpoints.length, 2);
    assert.equal(s.roles.some(role => role.inventory.some(entry => profile.protocol === "mpp" ? entry.name === "mppx" && entry.version === profile.version : entry.name.startsWith("@x402/") && entry.version === profile.version)), true);
    assert.equal(s.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === s.condition)), true);
    assert.equal(s.ports.length, 2); assert.equal(s.ports.every(port => port.rebound), true);
    assert.equal(s.tls.length, 2); assert.equal(s.tls.every(control => control.trusted && control.wrongCaRejected), true);
    assert.deepEqual(s.checkpoints.map(c => c.buyer.stage), ["first", "retry"]); assert.equal(new Set(s.checkpoints.map(c => c.buyer.pid)).size, 1);
    assert.equal(first.buyer.status, 503); assert.deepEqual(first.buyer.error, { code: "PAYMENT_STATUS_UNKNOWN", retryable: true }); assert.equal(first.buyer.retryAfter, "2");
    assert.equal(first.buyer.receiptValid, !mpp); assert.equal(first.buyer.receiptSha256 === null, mpp);
    assert.equal(final.buyer.status, 200); assert.equal(final.buyer.receiptValid, true); assert.equal(final.buyer.error, null);
    for (const [index, c] of s.checkpoints.entries()) {
      const sends = index + 1;
      assert.deepEqual([c.buyer.counters.sign, c.buyer.counters.signedSend, c.buyer.counters.save, c.buyer.counters.clear, c.buyer.counters.rpc, c.buyer.wrapperCalls], [1, sends, 0, 0, 0, 1]);
      assert.deepEqual([c.merchant.counters.handler, c.merchant.counters.applicationEffect, c.facilitator.counters.settle, c.facilitator.counters.economicEffect, c.facilitator.counters.fulfillment, c.facilitator.counters.verify], [sends, 1, sends, 1, sends, mpp ? 0 : sends]);
      assert.equal(c.merchant.redirectTargets, 0);
    }
    const c = s.counters; assert.deepEqual([c.sign, c.signedSend, c.settle, c.handler, c.applicationEffect, c.economicEffect, c.fulfillment, c.verify, c.save, c.clear, c.rpc, c.challenge], [1, 2, 2, 2, 1, 1, 2, mpp ? 0 : 2, 0, 0, 0, 1]);
    assert.equal(final.buyer.requests.length, 2); assert.deepEqual(final.buyer.requests[1], final.buyer.requests[0]); assert.deepEqual(final.merchant.received, Array(2).fill(final.buyer.requests[0].credentialSha256));
    const attempts = final.facilitator.fulfillmentAttempts, settlements = final.facilitator.settlementObservations, handlers = final.merchant.handlerObservations;
    assert.equal(attempts.length, 2); assert.equal(settlements.length, 2); assert.equal(handlers.length, 2);
    for (let i = 0; i < 2; i++) {
      const fault = i === 0, responseStatus = !fault ? 200 : ["fulfillment-disconnect", "fulfillment-timeout"].includes(s.caseId) ? null : s.caseId === "fulfillment-unexpected-2xx" ? 204 : 503;
      assert.equal(attempts[i].state, "FULFILLED"); assert.equal(attempts[i].failureCode, null); assert.equal(attempts[i].responseStatus, responseStatus); assert.equal(attempts[i].acknowledged, !fault);
      const delivery = final.merchant.fulfillmentObservations[i]; assert.equal(delivery.responseStatus, responseStatus); assert.equal(delivery.acknowledged, !fault);
      assert.equal(delivery.transportError, fault && s.caseId === "fulfillment-timeout" ? "ABORT_ERR" : fault && s.caseId === "fulfillment-disconnect" ? "ECONNRESET" : null);
      assert.ok(BigInt(delivery.startedAtNs) < BigInt(attempts[i].atNs) && BigInt(attempts[i].atNs) < BigInt(delivery.completedAtNs));
      if (fault && s.caseId === "fulfillment-timeout") { const ms = Number(BigInt(delivery.completedAtNs) - BigInt(delivery.startedAtNs)) / 1e6; assert.ok(ms >= 4500 && ms < 8000); }
      assert.equal(attempts[i].paymentIdSha256, handlers[i].paymentIdSha256); assert.equal(handlers[i].paymentIdSha256, settlements[i].paymentIdSha256); assert.equal(settlements[i].economicSha256, settlements[0].economicSha256); assert.equal(settlements[i].protocol, mpp ? "mpp" : "x402");
      assert.ok(BigInt(settlements[i].atNs) < BigInt(handlers[i].settlementAtNs) && BigInt(handlers[i].settlementAtNs) < BigInt(handlers[i].atNs) && BigInt(handlers[i].atNs) < BigInt(attempts[i].atNs));
    }
    assert.equal(s.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true); assert.equal(JSON.stringify(s).includes("SYNTHETIC_HANDLER_SECRET"), false);
  });
});
