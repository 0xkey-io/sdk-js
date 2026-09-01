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
const cases = { replay: ["single-client-singleflight", "multi-client-atomic-claim"], "protocol-freeze": ["save-if-absent-false", "save-if-absent-throws"] };
for (const [family, caseIds] of Object.entries(cases)) {
  const contract = matrix.rows.find(row => row.id === input.fixture + "-" + family);
  assert.equal(contract.family, "fault");
  test(contract.id + " partial claim-controls slice", async t => {
    const directory = join(input.evidence, contract.id);
    await mkdir(directory, { mode: 0o700 });
    const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
    const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "claim-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
    await writeFile(join(directory, "slice.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    assert.equal(run.status, "PASSED", "the bounded claim slice must execute its real public-client controls; this is not an aggregate row pass");
    assert.equal(run.cleanup.groupAbsent, true);
    const observed = JSON.parse(await readFile(join(directory, "claim-observations.json")));
    assert.equal(observed.row, contract.id);
    assert.equal(observed.scope, "claim-controls-slice");
    assert.equal(observed.coverage, "partial");
    assert.equal(observed.aggregateStatus, "BLOCKED");
    assert.equal(observed.stage, "development-only");
    assert.equal(observed.artifactSha256, input.consumer.artifactSha256);
    await assert.rejects(access(join(directory, "observation.json")), { code: "ENOENT" });
    const expected = caseIds.flatMap(caseId => ["import", "require"].map(condition => ({ caseId, condition })));
    assert.deepEqual(observed.subcases.map(({ caseId, condition }) => ({ caseId, condition })), expected);
    for (const subcase of observed.subcases) await t.test(subcase.caseId + "/" + subcase.condition, () => {
      assert.equal(subcase.status, "PASSED");
      assert.equal(subcase.ports.length, 2);
      assert.equal(subcase.ports.every(port => port.rebound), true);
      assert.equal(subcase.tls.length, 2);
      assert.equal(subcase.tls.every(control => control.trusted && control.wrongCaRejected), true);
      assert.equal(subcase.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === subcase.condition)), true);
      const race = subcase.caseId === "multi-client-atomic-claim", single = subcase.caseId === "single-client-singleflight";
      assert.equal(new Set(subcase.roles.map(role => role.pid)).size, race ? 4 : 3);
      assert.equal(subcase.buyers.length, race ? 2 : 1);
      assert.equal(subcase.claimWindows.length, race ? 2 : 1);
      for (const window of subcase.claimWindows) {
        assert.equal(window.counters.signedSend, 0);
        assert.equal(window.counters.sign, 1);
        assert.equal(window.saveAttempts, 1);
      }
      assert.equal(subcase.barrierReleasedAfterAllReady, true);
      const c = subcase.counters;
      assert.equal(c.sign, race ? 2 : 1);
      assert.equal(subcase.saveAttempts, race ? 2 : 1);
      assert.equal(c.save, race || single ? 1 : 0);
      assert.equal(c.signedSend, race || single ? 1 : 0);
      assert.equal(c.settle, race || single ? 1 : 0);
      assert.equal(c.handler, race || single ? 1 : 0);
      assert.equal(c.economicEffect, race || single ? 1 : 0);
      assert.equal(c.applicationEffect, race || single ? 1 : 0);
      assert.equal(c.clear, single ? 1 : 0);
      assert.equal(subcase.storeKind, race || single ? "atomic-aead" : "callback-control");
      if (single) {
        assert.deepEqual(subcase.buyers[0].calls, [{ status: 200, errorCode: null }, { status: null, errorCode: "PAYMENT_IN_PROGRESS" }]);
        assert.equal(subcase.persistedBeforeSend.credentialSha256, subcase.buyers[0].candidateCredentialSha256);
        assert.equal(subcase.persistedAfter, null);
        assert.equal(subcase.buyers[0].pending, false);
        assert.deepEqual(subcase.received, [subcase.buyers[0].candidateCredentialSha256]);
      } else if (race) {
        const winner = subcase.buyers.find(buyer => buyer.saveOutcome === "saved"), loser = subcase.buyers.find(buyer => buyer.saveOutcome !== "saved");
        assert.ok(winner && loser);
        assert.notEqual(winner.candidateCredentialSha256, loser.candidateCredentialSha256);
        assert.notEqual(winner.candidateRecordSha256, loser.candidateRecordSha256);
        assert.deepEqual(subcase.received, [winner.candidateCredentialSha256]);
        assert.equal(subcase.persistedBeforeSend.credentialSha256, winner.candidateCredentialSha256);
        assert.equal(subcase.persistedBeforeSend.recordSha256, winner.candidateRecordSha256);
        assert.deepEqual(subcase.persistedAfter, subcase.persistedBeforeSend);
        assert.deepEqual(winner.calls, [{ status: null, errorCode: "PAYMENT_RECEIPT_MISSING" }]);
        assert.deepEqual(loser.calls, [{ status: null, errorCode: loser.saveOutcome === "occupied" ? "PENDING_PAYMENT_CLAIMED" : "PAYMENT_SERVICE_UNAVAILABLE" }]);
        assert.equal(loser.storageError, loser.saveOutcome === "occupied" ? null : "EEXIST");
        assert.equal(loser.counters.signedSend, 0);
        assert.equal(subcase.buyers.every(buyer => buyer.pending), true);
      } else {
        const throwing = subcase.caseId === "save-if-absent-throws", buyer = subcase.buyers[0];
        assert.equal(buyer.saveOutcome, throwing ? "threw" : "occupied");
        assert.equal(buyer.storageError, throwing ? "CONTROLLED_THROW" : null);
        assert.deepEqual(buyer.calls, [{ status: null, errorCode: throwing ? "PAYMENT_SERVICE_UNAVAILABLE" : "PENDING_PAYMENT_CLAIMED" }]);
        assert.equal(buyer.pending, true);
        assert.equal(subcase.persistedBeforeSend, null);
        assert.equal(subcase.persistedAfter, null);
        assert.deepEqual(subcase.received, []);
      }
      assert.equal(subcase.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
    });
  });
}
