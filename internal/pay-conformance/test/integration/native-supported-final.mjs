import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { resolveFinalSupportedFailureProfile } from "../../src/ipc.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inputPath = process.argv[2], { input } = await readExecutionInput(inputPath);
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const row = `${input.fixture}-supported-failure`;
const profile = resolveFinalSupportedFailureProfile(input.fixture, row, input.stage);
const contract = matrix.rows.find(item => item.id === row);
const cases = Object.values(profile.catalog).flat();

test(input.fixture + " final supported discovery boundaries", async t => {
  assert.ok(contract); assert.equal(contract.id, profile.row); assert.equal(input.stage, "final-7b");
  const directory = join(input.evidence, contract.id);
  await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "supported-final-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
  await writeFile(join(directory, "supported-final.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED", "real discovery failures must stop before signing and retain their native/public boundary");
  assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "observation.json")));
  assert.equal(observed.scope, "fault"); assert.equal(observed.coverage, "complete"); assert.equal(observed.aggregateStatus, "PASSED");
  assert.equal(observed.stage, "final-7b"); assert.equal(observed.artifactSha256, input.consumer.artifactSha256);
  assert.deepEqual(observed.catalog, profile.catalog);
  assert.deepEqual(observed.supportContract, { protocol: profile.protocol, owner: profile.owner, version: profile.version, dependencyProtocol: "x402", mppOnlyNondependency: profile.protocol === "mpp" });
  assert.deepEqual(observed.subcases.map(({ caseId, condition }) => [caseId, condition]), cases.flatMap(id => [[id, "import"], [id, "require"]]));
  for (const s of observed.subcases) await t.test(s.caseId + "/" + s.condition, () => {
    assert.equal(s.status, "PASSED");
    assert.equal(s.roles.some(role => role.inventory.some(entry => profile.protocol === "mpp" ? entry.name === "mppx" && entry.version === profile.version : entry.name.startsWith("@x402/") && entry.version === profile.version)), true, "the final row must physically load its declared dependency version");
    if (s.caseId.startsWith("X-")) {
      assert.equal(s.direction, "X"); assert.equal(s.roles.length, 2); assert.equal(s.checkpoints.length, 2);
      assert.deepEqual(s.roles.map(role => role.role), ["scripted-facilitator", "supported-caller"]);
      assert.equal(s.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === s.condition)), true);
      assert.equal(s.ports.length, 1); assert.equal(s.ports[0].rebound, true);
      assert.equal(s.tls.length, 1); assert.deepEqual([s.tls[0].trusted, s.tls[0].wrongCaRejected], [true, true]);
      assert.equal(new Set(s.checkpoints.map(c => c.caller.pid)).size, 1);
      for (const [i, c] of s.checkpoints.entries()) {
        const positive = i === 1;
        assert.equal(c.caller.stage, positive ? "positive" : "negative"); assert.equal(c.caller.calls, i + 1);
        assert.deepEqual(Object.values(c.caller.counters), Array(13).fill(0));
        assert.equal(c.facilitator.counters.supported, i + 1);
        assert.equal(Object.entries(c.facilitator.counters).every(([k, n]) => k === "supported" || n === 0), true);
        if (positive) { assert.equal(c.caller.error, null); assert.deepEqual(c.caller.result, { kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }], extensions: [], signers: {} }); }
        else {
          assert.equal(c.caller.result, null); const error = c.caller.error;
          assert.deepEqual([error.nativeInstance, error.causeInstance, error.causeIdentity, error.code, error.phase, error.retryable], [true, true, true, "PAYMENT_SERVICE_UNAVAILABLE", "request", true]);
          assert.deepEqual(error.causeDescriptor, { enumerable: false, writable: false, configurable: false });
          for (const name of ["errorSha256", "causeSha256"]) assert.match(error[name], /^[a-f0-9]{64}$/);
        }
        const arrival = c.facilitator.supportArrivals[i], delivery = c.caller.supportTransports[i], timeout = i === 0 && s.caseId === "X-supported-timeout";
        assert.equal(c.facilitator.supportArrivals.length, i + 1); assert.equal(c.caller.supportTransports.length, i + 1);
        assert.equal(arrival.wireProtocol, "x402"); assert.equal(arrival.responseStatus, timeout ? null : 200);
        assert.equal(delivery.responseStatus, arrival.responseStatus); assert.equal(delivery.transportError, timeout ? "ABORT_ERR" : null);
        assert.ok(BigInt(delivery.startedAtNs) < BigInt(arrival.atNs) && BigInt(arrival.atNs) < BigInt(delivery.completedAtNs));
        if (timeout) { const ms = Number(BigInt(delivery.completedAtNs) - BigInt(delivery.startedAtNs)) / 1e6; assert.ok(ms >= 4500 && ms < 8000); }
      }
      assert.equal(s.counters.supported, 2); assert.equal(Object.entries(s.counters).every(([k, n]) => k === "supported" || n === 0), true);
      assert.equal(s.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0 && role.expectedSupportedWarning === undefined), true);
      return;
    }
    assert.equal(s.direction, "S");
    const nondependency = s.caseId === "S-mpp-only-nondependency-positive", n = nondependency ? 1 : 2;
    if (!nondependency) assert.equal(s.roles.find(role => role.role === "merchant").inventory.some(entry => entry.name === "@x402/core/server" && entry.entry.startsWith(input.consumer.directory + "/node_modules/")), true, "native warning owner must be identified before I/O");
    assert.equal(s.roles.length, n + 2); assert.equal(s.checkpoints.length, n);
    assert.equal(s.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === s.condition)), true);
    assert.equal(s.ports.length, 2); assert.equal(s.ports.every(port => port.rebound), true);
    assert.equal(s.tls.length, 2); assert.equal(s.tls.every(control => control.trusted && control.wrongCaRejected), true);
    assert.deepEqual(s.checkpoints.map(c => c.buyer.stage), nondependency ? ["positive"] : ["negative", "positive"]);
    assert.equal(new Set(s.checkpoints.map(c => c.buyer.pid)).size, n);
    for (const c of s.checkpoints) {
      assert.deepEqual(c.warning, nondependency ? { count: 0, bytes: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" } : { count: 1, bytes: 120, sha256: "a5646607702706fcadf29c9b0ec20dfe087f34d0d0203e7c862fa9a007693ed3" });
      const positive = c.buyer.stage === "positive", value = positive ? 1 : 0;
      assert.equal(c.buyer.status, positive ? 200 : 502);
      assert.deepEqual(c.buyer.error, positive ? null : { code: "PAYMENT_SERVICE_UNAVAILABLE", retryable: true });
      assert.equal(c.buyer.retryAfter, positive ? null : "2");
      assert.deepEqual([c.buyer.counters.sign, c.buyer.counters.signedSend, c.buyer.counters.save, c.buyer.counters.clear, c.buyer.counters.rpc, c.buyer.wrapperCalls], [value, value, 0, 0, 0, 1]);
      assert.deepEqual([c.merchant.counters.handler, c.merchant.counters.applicationEffect, c.facilitator.counters.settle, c.facilitator.counters.economicEffect, c.facilitator.counters.fulfillment, c.facilitator.counters.verify], [value, value, value, value, value, profile.protocol === "mpp" ? 0 : value]);
      assert.equal(c.facilitator.counters.supported, nondependency ? 0 : positive ? 2 : 1);
      assert.equal(c.buyer.receiptValid, positive); assert.equal(c.buyer.receiptSha256 === null, !positive);
      assert.deepEqual(c.buyer.signedProtocols, positive ? [profile.protocol] : []);
      assert.deepEqual(c.buyer.challenges.map(o => o.protocol).sort(), positive ? nondependency ? ["mpp"] : profile.protocol === "mpp" ? ["mpp", "x402"] : ["x402"] : []);
      if (profile.protocol === "mpp" && positive) assert.equal(c.buyer.selectedChallengeSha256, c.buyer.challenges.find(o => o.protocol === "mpp").challengeIdSha256);
      if (!positive) assert.deepEqual(c.merchant.received, []);
    }
    const final = s.checkpoints.at(-1), arrivals = final.facilitator.supportArrivals, deliveries = final.merchant.supportTransports;
    assert.equal(arrivals.length, nondependency ? 0 : 2); assert.equal(deliveries.length, arrivals.length);
    for (const [i, arrival] of arrivals.entries()) {
      const delivery = deliveries[i], timeout = i === 0 && s.caseId === "S-supported-timeout";
      assert.equal(arrival.wireProtocol, "x402"); assert.equal(arrival.responseStatus, timeout ? null : 200);
      assert.equal(delivery.responseStatus, arrival.responseStatus); assert.equal(delivery.transportError, timeout ? "ABORT_ERR" : null);
      assert.ok(BigInt(delivery.startedAtNs) < BigInt(arrival.atNs) && BigInt(arrival.atNs) < BigInt(delivery.completedAtNs));
      if (timeout) { const elapsed = Number(BigInt(delivery.completedAtNs) - BigInt(delivery.startedAtNs)) / 1e6; assert.ok(elapsed >= 4500 && elapsed < 8000); }
    }
    for (const role of s.diagnostics) {
      assert.equal(role.stdout.bytes, 0);
      if (role.role === "merchant" && !nondependency) { assert.equal(role.expectedSupportedWarning, 1); assert.deepEqual(role.stderr, { bytes: 120, sha256: "a5646607702706fcadf29c9b0ec20dfe087f34d0d0203e7c862fa9a007693ed3" }); }
      else { assert.equal(role.stderr.bytes, 0); assert.equal(role.expectedSupportedWarning, undefined); }
    }
  });
});
