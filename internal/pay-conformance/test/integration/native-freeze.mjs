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
const caseIds = ["old-v2-pending", "old-v3-binding", "changed-body-on-resume", "changed-request-binding", "opposite-challenge-after-signature", "redirect-before-payment", "redirect-after-payment"];
const contract = matrix.rows.find(row => row.id === input.fixture + "-protocol-freeze");
test(contract.id + " partial frozen-request controls", async t => {
  const directory = join(input.evidence, contract.id);
  await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "freeze-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
  await writeFile(join(directory, "freeze.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED", "the public client must execute every frozen-request control without promoting the aggregate family");
  assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "freeze-observations.json")));
  assert.equal(observed.row, contract.id);
  assert.equal(observed.scope, "freeze-controls-slice");
  assert.equal(observed.coverage, "partial");
  assert.equal(observed.aggregateStatus, "BLOCKED");
  assert.equal(observed.stage, "development-only");
  assert.equal(observed.artifactSha256, input.consumer.artifactSha256);
  await assert.rejects(access(join(directory, "observation.json")), { code: "ENOENT" });
  assert.deepEqual(observed.subcases.map(({ caseId, condition }) => [caseId, condition]), caseIds.flatMap(id => [[id, "import"], [id, "require"]]));
  for (const subcase of observed.subcases) await t.test(subcase.caseId + "/" + subcase.condition, () => {
    const c = subcase.counters, invalid = caseIds.indexOf(subcase.caseId) < 4, before = subcase.caseId === "redirect-before-payment";
    assert.equal(subcase.status, "PASSED");
    assert.equal(subcase.ports.length, 2);
    assert.equal(subcase.ports.every(port => port.rebound), true);
    assert.equal(subcase.tls.length, 2);
    assert.equal(subcase.tls.every(control => control.trusted && control.wrongCaRejected), true);
    assert.equal(subcase.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === subcase.condition)), true);
    assert.equal(subcase.buyers.length, before ? 1 : 2);
    assert.equal(new Set(subcase.buyers.map(buyer => buyer.pid)).size, subcase.buyers.length);
    assert.deepEqual([c.sign, c.save, c.signedSend, c.clear, c.settle, c.handler, c.economicEffect], [before ? 0 : 1, before ? 0 : 1, invalid || before ? 0 : 2, 0, 0, 0, 0]);
    assert.equal(subcase.merchant.redirectTargets, 0);
    assert.deepEqual(subcase.facilitator.supportedProtocols, !input.fixture.startsWith("mppx-") || subcase.caseId === "opposite-challenge-after-signature" ? ["x402"] : []);
    assert.equal(subcase.buyers.flatMap(buyer => buyer.requests ?? []).every(request => request.redirect === "manual"), true);
    if (invalid) {
      const final = subcase.buyers.at(-1), version = subcase.caseId.startsWith("old-");
      assert.equal(final.errorCode, version ? "PENDING_PAYMENT_VERSION_UNSUPPORTED" : "PENDING_PAYMENT_CORRUPT");
      assert.equal(final.pendingError, final.errorCode);
      assert.equal(final.counters.sign, 0); assert.equal(final.counters.signedSend, 0);
      assert.equal(subcase.mutation.aeadAuthenticated, true);
      assert.equal(subcase.mutation.checksumRecomputed, subcase.caseId === "changed-request-binding");
      assert.equal(subcase.mutation.boundary, version ? "version" : subcase.caseId === "changed-body-on-resume" ? "unkeyed-checksum" : "protocol-economic-binding");
      assert.deepEqual(subcase.persistedAfter, subcase.persistedBeforeResume);
      assert.notEqual(subcase.original.ciphertextSha256, subcase.persistedAfter.ciphertextSha256);
    } else if (before) {
      assert.equal(subcase.buyers[0].errorCode, "PAYMENT_POLICY_DENIED");
      assert.equal(subcase.buyers[0].pending, false);
      assert.equal(subcase.persistedAfter, null);
    } else {
      assert.equal(subcase.buyers.every(buyer => buyer.pending === true), true);
      assert.equal(subcase.buyers[1].counters.sign, 0);
      assert.deepEqual(subcase.persistedAfter, subcase.original);
      assert.deepEqual(subcase.merchant.received, [subcase.original.credentialSha256, subcase.original.credentialSha256]);
      if (subcase.caseId === "redirect-after-payment") assert.equal(subcase.buyers.every(buyer => buyer.errorCode === "PAYMENT_POLICY_DENIED"), true);
      else {
        const opposite = input.fixture.startsWith("mppx-") ? "x402" : "mpp";
        assert.equal(subcase.merchant.offers.filter(offer => offer.protocol === opposite).length, 2);
        assert.equal(subcase.buyers[1].status, 402);
        assert.equal(subcase.buyers[1].errorCode, null);
        assert.ok(subcase.roles.find(role => role.role === "merchant").inventory.some(entry => entry.name === "@0xkey-io/pay/server"));
      }
    }
    assert.equal(subcase.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
  });
});
