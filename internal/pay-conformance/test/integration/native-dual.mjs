import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { createDecipheriv, createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const inputPath = process.argv[2], { input } = await readExecutionInput(inputPath);
const matrix = JSON.parse(await readFile(join(root, "matrix.json"))), hash = bytes => createHash("sha256").update(bytes).digest("hex");
const cases = ["dual-valid-offer-prefer-x402", "dual-valid-offer-prefer-mpp", "duplicate-incompatible-offers"];
// A stripped/bridged offer, wrong physical owner, ignored preference or
// opposite paid route must fail this actual packed client's native exchange.
test(input.fixture + " genuine dual offers", async t => {
  const contract = matrix.rows.find(row => row.id === input.fixture + "-malformed-ambiguous-offer"), directory = join(input.evidence, contract.id);
  await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "dual-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
  await writeFile(join(directory, "dual.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED", "both genuine native offers must reach public preference selection"); assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "dual-observations.json")));
  assert.equal(observed.scope, "dual-controls-slice"); assert.equal(observed.coverage, "partial"); assert.equal(observed.aggregateStatus, "BLOCKED");
  assert.equal(observed.artifactSha256, input.consumer.artifactSha256); assert.equal(observed.stage, "development-only");
  await assert.rejects(access(join(directory, "observation.json")), { code: "ENOENT" });
  assert.deepEqual(observed.subcases.map(s => [s.caseId, s.condition]), cases.flatMap(id => [[id, "import"], [id, "require"]]));
  for (const s of observed.subcases) await t.test(s.caseId + "/" + s.condition, async () => {
    const successful = s.buyers.at(-1), eventTime = name => BigInt(successful.events.find(event => event.event === name).atNs);
    assert.ok(eventTime("sign") < eventTime("save") && eventTime("save") < eventTime("signedSend"));
    assert.equal(successful.counters.rpc, 4); assert.equal(successful.counters.clear, 1); assert.equal(successful.receiptValid, true);
    assert.equal(s.facilitator.events.filter(event => event.event === "rpc").length, 4);
    assert.equal(s.facilitator.events.filter(event => event.event === "rpc").every(event => BigInt(event.atNs) < eventTime("clear")), true);
    if (s.caseId === "duplicate-incompatible-offers") {
      const own = input.fixture.startsWith("mppx-") ? "mpp" : "x402", [negative, positive] = s.buyers;
      assert.equal(s.status, "PASSED"); assert.equal(s.roles.length, 4); assert.notEqual(negative.pid, positive.pid);
      for (const [kind, name] of Object.entries({ generator: own === "mpp" ? "mppx/server" : "@x402/core/server", decoder: own === "mpp" ? "mppx" : "@x402/core/http" })) { assert.equal(s.owners.selected[kind].name, name); assert.ok(s.owners.selected[kind].entry.startsWith(input.native + "/node_modules/")); }
      assert.equal(s.owners.selected.generator.version, own === "mpp" ? input.fixture.slice(5) : input.fixture.slice(5) + ".0");
      assert.deepEqual(s.owners.receiptDecoder, s.owners.selected.decoder); assert.equal(positive.receiptOwner, "selected"); assert.equal(s.owners.auxiliary, undefined);
      assert.equal(s.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === s.condition)), true);
      assert.equal(s.diagnostics.every(role => !role.stdout.bytes && !role.stderr.bytes), true); assert.equal(s.ports.every(port => port.rebound), true);
      assert.deepEqual(negative.error, { code: "PAYMENT_CHALLENGE_INVALID", phase: "challenge", retryable: false });
      assert.equal(negative.pending, false); assert.equal(negative.saved, null); assert.equal(negative.saveAttempts, 0); assert.equal(negative.clearAttempts, 0);
      assert.deepEqual(Object.values(negative.counters), Array(13).fill(0)); assert.deepEqual(negative.sent, []);
      assert.equal(s.checkpoints[1].merchant.dualArrivals.length, 1); assert.equal(s.checkpoints[1].merchant.dualArrivals[0].protocol, null);
      for (const role of ["merchant", "facilitator"]) for (const key of ["settle", "handler", "economicEffect", "applicationEffect", "rpc"]) assert.equal(s.checkpoints[1][role].counters[key], 0);
      const duplicate = s.checkpoints[1].merchant.duplicate;
      assert.notEqual(duplicate.firstSha256, duplicate.secondSha256); assert.notEqual(duplicate.coalescedSha256, duplicate.firstSha256);
      assert.equal(duplicate.coalescedSha256, negative.offers[0][own + "Sha256"]);
      assert.equal(duplicate.envelopeBeforeSha256, duplicate.envelopeAfterSha256);
      assert.deepEqual(s.checkpoints[1].merchant.dualOffers.map(offer => [offer.protocol, offer.amount, offer.priceProfile]), [[own, "10000", "standard"], [own, "5000", "duplicate-second"]]);
      assert.equal(positive.error, null); assert.equal(positive.receiptValid, true); assert.equal(positive.pending, false); assert.equal(positive.selectedProtocol, own);
      assert.equal(positive.offers[0][own + "Sha256"], s.merchant.dualOffers.at(-1).headerSha256);
      assert.equal(positive.offers[0][(own === "mpp" ? "x402" : "mpp") + "Sha256"], null);
      assert.equal(s.merchant.dualOffers.at(-1).priceProfile, "standard"); assert.equal(s.merchant.dualOffers.at(-1).amount, "10000");
      assert.deepEqual(s.merchant.dualArrivals.map(value => value.protocol), [null, null, own]);
      assert.deepEqual([s.counters.sign, s.counters.save, s.counters.signedSend, s.counters.settle, s.counters.handler, s.counters.economicEffect, s.counters.applicationEffect, s.counters.clear, s.counters.rpc], [1, 1, 1, 1, 1, 1, 1, 1, 4]);
      const store = join(directory, s.caseId + "-" + s.condition, "durable"), bytes = await readFile(join(store, "dual-saved.aead")), key = await readFile(join(store, "storage.key"));
      assert.equal(hash(bytes), positive.saved.ciphertextSha256); assert.equal(hash(key), positive.saved.keySha256);
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12)); decipher.setAAD(Buffer.from("pay-conformance-v1")); decipher.setAuthTag(bytes.subarray(12, 28));
      const record = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
      const { requestDigest, ...unsigned } = record.payment; assert.equal(requestDigest, "0x" + hash(JSON.stringify(unsigned))); assert.equal(record.digest, requestDigest);
      assert.equal(record.payment.protocolId, own === "mpp" ? "mpp-evm-charge-v0" : "x402-exact-v2-eip3009");
      assert.equal(record.digest, "0x" + positive.saved.recordSha256); assert.equal(record.payment.network, "eip155:84532");
      assert.equal(hash(record.payment.headers.find(([name]) => name === (own === "mpp" ? "authorization" : "payment-signature"))[1]), positive.sent[0].credentialSha256);
      await assert.rejects(access(join(store, "pending.aead")), { code: "ENOENT" });
      return;
    }
    const selected = s.caseId.endsWith("-x402") ? "x402" : "mpp", opposite = selected === "x402" ? "mpp" : "x402", own = input.fixture.startsWith("mppx-") ? "mpp" : "x402";
    assert.equal(s.status, "PASSED"); assert.equal(s.roles.length, 3); assert.equal(s.buyers.length, 1);
    assert.equal(s.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === s.condition)), true);
    assert.equal(s.ports.length, 2); assert.equal(s.ports.every(port => port.rebound), true); assert.equal(s.tls.every(tls => tls.trusted && tls.wrongCaRejected), true);
    assert.equal(s.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
    const buyer = s.buyers[0]; assert.deepEqual(buyer.preference, [selected, opposite]); assert.equal(buyer.selectedProtocol, selected);
    assert.equal(buyer.error, null); assert.equal(buyer.pending, false); assert.equal(buyer.receiptValid, true); assert.equal(buyer.status, 200);
    assert.deepEqual([buyer.counters.sign, buyer.saveAttempts, buyer.counters.save, buyer.counters.signedSend, buyer.counters.rpc, buyer.counters.clear], [1, 1, 1, 1, 4, 1]);
    assert.equal(buyer.offers.length, 1); assert.ok(buyer.offers[0].x402Sha256); assert.ok(buyer.offers[0].mppSha256);
    assert.deepEqual(s.merchant.dualOffers.map(offer => offer.protocol), ["x402", "mpp"]);
    for (const offer of s.merchant.dualOffers) {
      assert.equal(offer.headerSha256, buyer.offers[0][offer.protocol + "Sha256"]); assert.equal(offer.urlSha256, buyer.offers[0].urlSha256);
      assert.equal(offer.amount, "10000"); assert.equal(offer.network, "eip155:84532"); assert.equal(offer.owner, offer.protocol === own ? "selected" : "auxiliary");
    }
    assert.equal(s.merchant.dualOffers[0].economicSha256, s.merchant.dualOffers[1].economicSha256);
    assert.equal(s.merchant.dualArrivals.length, 2); assert.deepEqual(buyer.sent.map(request => request.protocol), [selected]);
    for (const key of ["verify", "settle", "handler", "economicEffect", "applicationEffect"]) assert.equal(s.protocolCounters[opposite][key], 0);
    for (const key of ["settle", "handler", "economicEffect", "applicationEffect"]) assert.equal(s.protocolCounters[selected][key], 1);
    assert.equal(s.facilitator.protocolArrivals.every(arrival => arrival.wireProtocol === (arrival.path.startsWith("/dual-x402/") ? "x402" : "mpp")), true);
    for (const kind of ["generator", "decoder"]) {
      assert.ok(s.owners.selected[kind].entry.startsWith(input.native + "/node_modules/"));
      assert.ok(s.owners.auxiliary[kind].entry.startsWith(input.consumer.directory + "/node_modules/"));
    }
    assert.equal(s.owners.selected.generator.version, own === "mpp" ? input.fixture.slice(5) : input.fixture.slice(5) + ".0");
    assert.equal(s.owners.auxiliary.generator.version, own === "mpp" ? "2.23.0" : "0.8.19");
    assert.equal(s.owners.buyer.name, "@0xkey-io/pay/client"); assert.deepEqual(s.owners.receiptDecoder, (selected === own ? s.owners.selected : s.owners.auxiliary).decoder);
    assert.equal(buyer.receiptOwner, selected === own ? "selected" : "auxiliary");
    const saved = buyer.saved; assert.equal(saved.protocol, selected); assert.equal(saved.network, "eip155:84532");
    assert.equal(saved.credentialSha256, buyer.sent[0].credentialSha256); assert.equal(saved.recordSha256, buyer.sent[0].recordSha256);
    const store = join(directory, s.caseId + "-" + s.condition, "durable"), bytes = await readFile(join(store, "dual-saved.aead")), key = await readFile(join(store, "storage.key"));
    assert.equal(hash(bytes), saved.ciphertextSha256); assert.equal(hash(key), saved.keySha256);
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12)); decipher.setAAD(Buffer.from("pay-conformance-v1")); decipher.setAuthTag(bytes.subarray(12, 28));
    const record = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
    const { requestDigest, ...unsigned } = record.payment; assert.equal(requestDigest, "0x" + hash(JSON.stringify(unsigned))); assert.equal(record.digest, requestDigest);
    assert.equal(record.payment.network, saved.network); assert.equal(record.payment.protocolId, saved.protocolId); assert.equal(record.digest, "0x" + saved.recordSha256);
    assert.equal(hash(record.payment.headers.find(([name]) => name === (selected === "mpp" ? "authorization" : "payment-signature"))[1]), saved.credentialSha256);
    await assert.rejects(access(join(store, "pending.aead")), { code: "ENOENT" });
    assert.deepEqual([s.counters.sign, s.counters.save, s.counters.signedSend, s.counters.settle, s.counters.handler, s.counters.economicEffect, s.counters.applicationEffect, s.counters.clear, s.counters.rpc], [1, 1, 1, 1, 1, 1, 1, 1, 4]);
  });
});
