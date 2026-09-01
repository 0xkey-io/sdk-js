import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { currentHandlerFailureCases, resolveFinalHandlerFailureProfile } from "../../src/ipc.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inputPath = process.argv[2], { input } = await readExecutionInput(inputPath);
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const row = `${input.fixture}-handler-failure`;
const profile = resolveFinalHandlerFailureProfile(input.fixture, row, input.stage);
const caseIds = currentHandlerFailureCases;
test(input.fixture + " final handler failure lifecycle", async t => {
  const contract = matrix.rows.find(item => item.id === row), directory = join(input.evidence, contract.id);
  await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "handler-failure-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
  await writeFile(join(directory, "handler-failure.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED", "native signed invocation and application-owned identical-request retry must expose actual seller fulfillment");
  assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "observation.json")));
  assert.equal(observed.scope, "fault"); assert.equal(observed.coverage, "complete"); assert.equal(observed.aggregateStatus, "PASSED");
  assert.equal(observed.stage, "final-7b"); assert.equal(observed.artifactSha256, input.consumer.artifactSha256);
  assert.deepEqual(observed.catalog, currentHandlerFailureCases);
  assert.deepEqual(observed.handlerContract, { protocol: profile.protocol, owner: profile.owner, version: profile.version, retryOwner: "application-same-process-captured-request" });
  assert.deepEqual(observed.subcases.map(({ caseId, condition }) => [caseId, condition]), caseIds.flatMap(id => [[id, "import"], [id, "require"]]));
  for (const s of observed.subcases) await t.test(s.caseId + "/" + s.condition, () => {
    const first = s.checkpoints[0], final = s.checkpoints.at(-1), n = s.caseId === "handler-200" ? 1 : 2, mpp = input.fixture.startsWith("mppx-");
    assert.equal(s.status, "PASSED"); assert.equal(s.roles.length, 3); assert.equal(s.checkpoints.length, n);
    assert.equal(s.roles.some(role => role.inventory.some(entry => profile.protocol === "mpp" ? entry.name === "mppx" && entry.version === profile.version : entry.name.startsWith("@x402/") && entry.version === profile.version)), true, "the final row must physically load its declared dependency version");
    assert.equal(s.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === s.condition)), true);
    assert.equal(s.ports.length, 2); assert.equal(s.ports.every(port => port.rebound), true);
    assert.equal(s.tls.length, 2); assert.equal(s.tls.every(control => control.trusted && control.wrongCaRejected), true);
    assert.deepEqual(s.checkpoints.map(c => c.buyer.stage), n === 1 ? ["first"] : ["first", "retry"]);
    assert.equal(new Set(s.checkpoints.map(c => c.buyer.pid)).size, 1);
    const fulfillmentFault = s.caseId.startsWith("fulfillment-");
    const expected = fulfillmentFault ? 503 : { "handler-throws": 500, "handler-500": 500, "handler-400": 400, "handler-404": 404, "handler-302": 302, "handler-200": 200 }[s.caseId];
    assert.equal(first.buyer.status, expected);
    assert.deepEqual(first.buyer.error, fulfillmentFault ? { code: "PAYMENT_STATUS_UNKNOWN", retryable: true } : s.caseId === "handler-throws" ? { code: "HANDLER_ERROR", retryable: false } : null);
    assert.equal(first.buyer.retryAfter, fulfillmentFault ? "2" : null);
    assert.equal(first.buyer.receiptValid, !mpp || expected === 200);
    assert.equal(first.buyer.receiptSha256 === null, mpp && expected !== 200);
    assert.equal(final.buyer.status, 200); assert.equal(final.buyer.receiptValid, true); assert.equal(final.buyer.error, null);
    for (const [index, c] of s.checkpoints.entries()) {
      const sends = index + 1;
      assert.deepEqual([c.buyer.counters.sign, c.buyer.counters.signedSend, c.buyer.counters.save, c.buyer.counters.clear, c.buyer.counters.rpc, c.buyer.wrapperCalls], [1, sends, 0, 0, 0, 1]);
      assert.deepEqual([c.merchant.counters.handler, c.merchant.counters.applicationEffect, c.facilitator.counters.settle, c.facilitator.counters.economicEffect, c.facilitator.counters.fulfillment, c.facilitator.counters.verify], [sends, 1, sends, 1, sends, mpp ? 0 : sends]);
      assert.equal(c.merchant.redirectTargets, 0);
    }
    const c = s.counters;
    assert.deepEqual([c.sign, c.signedSend, c.settle, c.handler, c.applicationEffect, c.economicEffect, c.fulfillment, c.verify, c.save, c.clear, c.rpc, c.challenge], [1, n, n, n, 1, 1, n, mpp ? 0 : n, 0, 0, 0, 1]);
    assert.equal(final.buyer.requests.length, n);
    for (const request of final.buyer.requests) assert.deepEqual(request, final.buyer.requests[0]);
    assert.deepEqual(final.merchant.received, Array(n).fill(final.buyer.requests[0].credentialSha256));
    const attempts = final.facilitator.fulfillmentAttempts, settlements = final.facilitator.settlementObservations, handlers = final.merchant.handlerObservations;
    assert.equal(attempts.length, n); assert.equal(settlements.length, n); assert.equal(handlers.length, n);
    for (let i = 0; i < n; i++) {
      const failed = i === 0 && ["handler-throws", "handler-500", "fulfillment-failed-after-handler-failure"].includes(s.caseId);
      assert.equal(attempts[i].state, failed ? "FAILED" : "FULFILLED"); assert.equal(attempts[i].failureCode, failed ? "HANDLER_ERROR" : null);
      const fault = i === 0 && fulfillmentFault;
      const responseStatus = !fault ? 200 : ["fulfillment-disconnect", "fulfillment-timeout"].includes(s.caseId) ? null : s.caseId === "fulfillment-unexpected-2xx" ? 204 : 503;
      assert.equal(attempts[i].responseStatus, responseStatus); assert.equal(attempts[i].acknowledged, !fault);
      const delivery = final.merchant.fulfillmentObservations[i];
      assert.equal(delivery.responseStatus, responseStatus); assert.equal(delivery.acknowledged, !fault);
      assert.equal(delivery.transportError, fault && s.caseId === "fulfillment-timeout" ? "ABORT_ERR" : fault && s.caseId === "fulfillment-disconnect" ? "ECONNRESET" : null);
      assert.ok(BigInt(delivery.startedAtNs) < BigInt(attempts[i].atNs) && BigInt(attempts[i].atNs) < BigInt(delivery.completedAtNs));
      if (fault && s.caseId === "fulfillment-timeout") {
        const elapsedMs = Number(BigInt(delivery.completedAtNs) - BigInt(delivery.startedAtNs)) / 1e6;
        assert.ok(elapsedMs >= 4500 && elapsedMs < 8000);
      }
      assert.equal(attempts[i].paymentIdSha256, handlers[i].paymentIdSha256); assert.equal(handlers[i].paymentIdSha256, settlements[i].paymentIdSha256);
      assert.equal(settlements[i].economicSha256, settlements[0].economicSha256); assert.equal(settlements[i].protocol, mpp ? "mpp" : "x402");
      assert.ok(BigInt(settlements[i].atNs) < BigInt(handlers[i].settlementAtNs) && BigInt(handlers[i].settlementAtNs) < BigInt(handlers[i].atNs) && BigInt(handlers[i].atNs) < BigInt(attempts[i].atNs));
    }
    assert.equal(s.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
    assert.equal(JSON.stringify(s).includes("SYNTHETIC_HANDLER_SECRET"), false);
  });
});
