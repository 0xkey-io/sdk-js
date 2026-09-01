import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { counters, hash } from "./common.mjs";
import { nativeScenario } from "./scenario.mjs";
import { wireDecoderCaseIds } from "../../src/ipc.mjs";

async function decoderPhase({ input, directory, caseId, condition, stage, assert, onReady }) {
  await mkdir(directory, { mode: 0o700 });
  const mpp = input.fixture.startsWith("mppx-"), positive = stage === "positive";
  const config = { condition, protocol: mpp ? "mpp" : "x402", payBuyer: false, native: input.native, pay: input.consumer.directory, certificates: input.certificates, wireDecoderCaseId: caseId, wireDecoderStage: stage };
  const scenario = nativeScenario({ config, assert }), { roles, ports, tlsControls, spawnRole } = scenario;
  let checkpoint = null, endpointSha256 = null, failure = null;
  let checkpointSha256 = null, checkpointSavedAtNs = null, closeStartedAtNs = null, cleanupStartedAtNs = null;
  const closures = [];
  try {
    const facilitator = await spawnRole("scripted-facilitator"), merchant = await spawnRole("merchant", { facilitator: facilitator.origin });
    endpointSha256 = hash(merchant.origin + "/paid");
    onReady(Number(new URL(merchant.origin).port)); await scenario.verifyTls([facilitator, merchant]);
    const buyer = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin });
    const bought = await buyer.take("wire-decoder-result"); assert.deepEqual(await buyer.close, { code: 0, signal: null, reason: null });
    merchant.send({ type: "snapshot" }); const merchantSnapshot = await merchant.take("snapshot");
    facilitator.send({ type: "snapshot" }); const facilitatorSnapshot = await facilitator.take("snapshot");
    // Persist independently before any assertion, shutdown or cleanup can fail.
    checkpoint = { buyer: { pid: buyer.child.pid, ...bought }, merchant: merchantSnapshot, facilitator: facilitatorSnapshot };
    const checkpointBytes = JSON.stringify({ caseId, condition, stage, endpointSha256, checkpoint, roles: roles.map(role => role.identity) }, null, 2) + "\n";
    const checkpointFile = await open(join(directory, "wire-decoder-checkpoint.json"), "wx", 0o600);
    try { await checkpointFile.writeFile(checkpointBytes); await checkpointFile.sync(); }
    finally { await checkpointFile.close(); }
    checkpointSha256 = hash(checkpointBytes); checkpointSavedAtNs = process.hrtime.bigint().toString();
    assert.equal(bought.caseId, caseId); assert.equal(bought.stage, stage);
    assert.deepEqual(merchantSnapshot.failures, []); assert.deepEqual(facilitatorSnapshot.failures, []);
    assert.equal(bought.status, positive ? 200 : 402); assert.equal(bought.classification, positive ? "paid" : mpp ? "malformed-credential" : "payment-required");
    assert.equal(bought.challenge, !positive); assert.equal(bought.receiptValid, positive); assert.equal(bought.receiptSha256 === null, !positive);
    assert.deepEqual([bought.counters.sign, bought.counters.signedSend, bought.counters.save, bought.counters.clear, bought.counters.rpc, bought.wrapperCalls], [1, 1, 0, 0, 0, 1]);
    assert.deepEqual([merchantSnapshot.counters.handler, merchantSnapshot.counters.applicationEffect, facilitatorSnapshot.counters.verify, facilitatorSnapshot.counters.settle, facilitatorSnapshot.counters.economicEffect, facilitatorSnapshot.counters.fulfillment], positive ? [1, 1, mpp ? 0 : 1, 1, 1, 1] : [0, 0, 0, 0, 0, 0]);
    const arrivals = merchantSnapshot.wireArrivals;
    assert.equal(arrivals.length, 2); assert.equal(arrivals[0].protocol, null); assert.equal(arrivals[1].protocol, config.protocol);
    assert.equal(arrivals[1].credentialSha256, bought.wire.transmittedSha256); assert.equal(arrivals[1].credentialHeadersSha256, bought.wire.credentialHeadersSha256); assert.equal(arrivals[1].bodySha256, bought.wire.bodyAfterSha256); assert.equal(arrivals[1].responseStatus, bought.status);
    for (const arrival of arrivals) assert.ok(arrival.stage === stage && BigInt(arrival.atNs) < BigInt(arrival.bodyReadAtNs) && BigInt(arrival.bodyReadAtNs) < BigInt(arrival.completedAtNs));
    assert.ok(BigInt(bought.events.find(event => event.event === "sign").atNs) < BigInt(arrivals[1].atNs));
    assert.equal(bought.wire.originalSha256 === bought.wire.transmittedSha256, positive); assert.equal(bought.wire.originalHeadersSha256 === bought.wire.transmittedHeadersSha256, positive);
    assert.equal(bought.wire.field, positive ? "none" : caseId === "credential-invalid-encoding" ? "selected-credential-encoding" : "selected-credential-json");
    if (!positive) assert.equal(bought.wire.transmittedSha256, hash(mpp ? "Payment " + (caseId === "credential-invalid-encoding" ? "%" : "ew") : caseId === "credential-invalid-encoding" ? "%" : "ew=="));
    for (const field of ["body", "binding", "noncredential"]) assert.equal(bought.wire[field + "BeforeSha256"], bought.wire[field + "AfterSha256"]);
    const privateArrivals = facilitatorSnapshot.wirePrivateArrivals;
    assert.deepEqual(privateArrivals.map(arrival => arrival.operation), mpp ? positive ? ["charge", "fulfillment"] : [] : positive ? ["supported", "verify", "charge", "fulfillment"] : ["supported"]);
    for (const arrival of privateArrivals) {
      assert.ok(arrival.stage === stage && BigInt(arrival.atNs) < BigInt(arrival.bodyReadAtNs) && BigInt(arrival.bodyReadAtNs) < BigInt(arrival.stampMetadataValidatedAtNs) && BigInt(arrival.stampMetadataValidatedAtNs) < BigInt(arrival.completedAtNs));
      assert.equal(arrival.responseStatus, 200); assert.equal(arrival.authorizationValidatedAtNs !== null, ["verify", "charge"].includes(arrival.operation));
      if (arrival.authorizationValidatedAtNs !== null) assert.ok(BigInt(arrival.stampMetadataValidatedAtNs) < BigInt(arrival.authorizationValidatedAtNs) && BigInt(arrival.authorizationValidatedAtNs) < BigInt(arrival.completedAtNs));
    }
    // HTTP/IPC completion does not order stderr delivery. Close both listeners
    // and wait for all role streams before permitting a fresh positive phase.
    const listeners = [merchant, facilitator];
    closeStartedAtNs = process.hrtime.bigint().toString();
    const acknowledgements = await Promise.allSettled(listeners.map(async role => { role.send({ type: "close" }); await role.take("closed"); }));
    for (const role of listeners) closures.push({ role: role.role, pid: role.child.pid, ...await role.close });
    if (acknowledgements.some(result => result.status === "rejected")) failure = hash("DECODER_CLOSE_ACK_FAILED");
  } catch (error) { failure ??= hash(String(error?.message)); }
  cleanupStartedAtNs = process.hrtime.bigint().toString();
  const diagnostics = await scenario.cleanup();
  const forbiddenOutput = diagnostics.some(role => role.stdout.bytes !== 0 || role.stderr.bytes !== 0);
  if (forbiddenOutput) failure ??= hash("UNEXPECTED_ROLE_OUTPUT");
  else if (closures.some(role => role.code !== 0 || role.signal !== null || role.reason !== null)) failure ??= hash("DECODER_ROLE_CLOSE_FAILED");
  const result = { caseId, condition, stage, status: failure ? "FAILED" : "PASSED", failure, forbiddenOutput, endpointSha256, checkpoint, checkpointSha256, checkpointSavedAtNs, closeStartedAtNs, cleanupStartedAtNs, roles: roles.map(role => role.identity), ports, tls: tlsControls, closures, diagnostics, roleFailures: roles.flatMap(role => role.failures) };
  await writeFile(join(directory, "wire-decoder.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return result;
}

export async function runWireDecoderSlice({ input, row, directory, assert, onReady, selection }) {
  const [caseId, condition] = selection.split("/");
  assert.ok(wireDecoderCaseIds.includes(caseId) && ["import", "require"].includes(condition) && selection === caseId + "/" + condition);
  assert.equal(row, input.fixture + "-malformed-ambiguous-offer");
  const phases = [];
  for (const stage of ["negative", "positive"]) {
    const phase = await decoderPhase({ input, directory: join(directory, caseId + "-" + condition + "-" + stage), caseId, condition, stage, assert, onReady });
    phases.push(phase);
    if (phase.status !== "PASSED") throw new Error("WIRE_DECODER_PHASE_FAILED");
  }
  assert.equal(new Set(phases.flatMap(phase => phase.roles.map(role => role.pid))).size, 6);
  const totals = counters();
  for (const phase of phases) for (const observation of Object.values(phase.checkpoint)) for (const key of Object.keys(totals)) totals[key] += observation.counters[key];
  return [{ caseId, condition, status: "PASSED", sendOwner: "native-first-send-wire-mutator", calibrationOwner: "fresh-native-phase", phases, counters: totals }];
}
