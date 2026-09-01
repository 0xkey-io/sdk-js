import strictAssert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { verifyInventory } from "../../src/run.mjs";
import { verifyConsumer } from "../../src/consumer.mjs";
import { publicModule, counters, hash } from "./common.mjs";
import { initializeStore } from "./durable-store.mjs";
import { recoveryStages, receiptCases, offerCases, sellerCases, preflightCases, wireCases, currentX402UnsupportedAuthorizationCases, resolveFinalX402UnsupportedAuthorizationProfile, currentX402NetworkMismatchCases, resolveFinalX402NetworkMismatchProfile, currentX402AmountMismatchCases, resolveFinalX402AmountMismatchProfile, currentX402AssetMismatchCases, resolveFinalX402AssetMismatchProfile, currentX402PayeeMismatchCases, resolveFinalX402PayeeMismatchProfile, currentMppPayeeMismatchCases, resolveFinalMppPayeeMismatchProfile, currentMppAmountMismatchCases, resolveFinalMppAmountMismatchProfile, currentMppAssetMismatchCases, resolveFinalMppAssetMismatchProfile, currentMppNetworkMismatchCases, resolveFinalMppNetworkMismatchProfile, currentMppUnsupportedAuthorizationCases, resolveFinalMppUnsupportedAuthorizationProfile, resolveFinalSupportedFailureProfile, resolveFinalHandlerFailureProfile, resolveFinalFulfillmentFailureProfile, resolveFinalStandardWireReceiptProfile, resolveFinalMalformedAmbiguousOfferProfile, resolveFinalReceiptAbsentMalformedProfile, resolveFinalUnverifiedReceiptProfile, resolveFinalReceiptMismatchProfile, resolveFinalTemporalValidityProfile, resolveFinalReplayProfile, resolveFinalVerifySettleRejectionProfile, resolveFinalSettleUnknownProfile, resolveFinalProtocolFreezeProfile, resolveFinalRedactionProfile } from "../../src/ipc.mjs";
import { nativeScenario } from "./scenario.mjs";
import { runClaimSlice, runFreezeSlice, runReceiptSlice, runOfferSlice, runSellerSlice, runSupportedSlice, runPreflightSlice, runDualSlice, runRealmSlice, runWireSlice, runCurrentX402UnsupportedAuthorization, runCurrentX402NetworkMismatch, runCurrentX402AmountMismatch, runCurrentX402AssetMismatch, runCurrentX402PayeeMismatch, runCurrentMppPayeeMismatch, runCurrentMppAmountMismatch, runCurrentMppAssetMismatch, runCurrentMppNetworkMismatch, runCurrentMppUnsupportedAuthorization, runCurrentSupportedFailure, runCurrentHandlerFailure, runCurrentFulfillmentFailure, runCurrentStandardWireReceipt, runCurrentMalformedAmbiguousOffer, runCurrentReceiptAbsentMalformed, runCurrentUnverifiedReceipt, runCurrentReceiptMismatch, runCurrentTemporalValidity, runCurrentReplay, runCurrentVerifySettleRejection, runCurrentSettleUnknown, runCurrentProtocolFreeze, runCurrentRedaction } from "./faults.mjs";
import { runWireDecoderSlice } from "./wire-decoder.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inventory = JSON.parse(await readFile(join(root, "fixtures/inventory.json")));
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const emit = value => process.stdout.write(JSON.stringify(value) + "\n");
let assertionCount = 0;
const assert = Object.fromEntries(["equal", "ok", "deepEqual", "rejects", "doesNotMatch"].map(name => [name, (...args) => { assertionCount++; return strictAssert[name](...args); }]));

async function identifyFixture(input, contract) {
  const fixture = inventory.fixtures.find(item => item.id === contract.fixture);
  for (const file of fixture.inputs) assert.equal(hash(await readFile(join(input.native, basename(file.path)))), file.sha256, "STAGED_FIXTURE_INPUT");
  const observed = {};
  for (const name of Object.keys(contract.expectedVersions)) {
    const path = await realpath(join(input.native, "node_modules", name, "package.json"));
    const manifest = JSON.parse(await readFile(path));
    assert.equal(manifest.name, name); observed[name] = manifest.version;
  }
  assert.deepEqual(observed, contract.expectedVersions);
  return observed;
}

export async function runNativeDirection(fixture) {
  const [inputPath, row, directory, slice, selection] = process.argv.slice(2);
  assert.ok(process.argv.length <= (slice === "wire-decoder-controls" ? 7 : 6) && (slice === undefined || ["redaction-final-controls", "protocol-freeze-final-controls", "settle-unknown-controls", "verify-settle-rejection-controls", "replay-controls", "temporal-validity-controls", "authorization-controls", "mpp-authorization-controls", "network-mismatch-controls", "mpp-network-mismatch-controls", "amount-mismatch-controls", "mpp-amount-mismatch-controls", "asset-mismatch-controls", "mpp-asset-mismatch-controls", "payee-mismatch-controls", "mpp-payee-mismatch-controls", "supported-final-controls", "handler-failure-controls", "fulfillment-failure-controls", "standard-wire-receipt-controls", "malformed-ambiguous-offer-controls", "mpp-malformed-corpus-controls", "receipt-absent-malformed-controls", "unverified-receipt-controls", "receipt-mismatch-controls", "wire-decoder-controls", "claim-controls", "freeze-controls", "receipt-controls", "offer-controls", "seller-controls", "supported-controls", "preflight-controls", "dual-controls", "realm-controls", "billing-controls", "billing-recovery", "wire-controls"].includes(slice)));
  const authorizationSlice = slice === "authorization-controls";
  const redactionFinalSlice = slice === "redaction-final-controls";
  const protocolFreezeFinalSlice = slice === "protocol-freeze-final-controls";
  const settleUnknownSlice = slice === "settle-unknown-controls";
  const verifySettleRejectionSlice = slice === "verify-settle-rejection-controls";
  const mppAuthorizationSlice = slice === "mpp-authorization-controls";
  const networkMismatchSlice = slice === "network-mismatch-controls";
  const mppNetworkMismatchSlice = slice === "mpp-network-mismatch-controls";
  const amountMismatchSlice = slice === "amount-mismatch-controls";
  const mppAmountMismatchSlice = slice === "mpp-amount-mismatch-controls";
  const assetMismatchSlice = slice === "asset-mismatch-controls";
  const mppAssetMismatchSlice = slice === "mpp-asset-mismatch-controls";
  const payeeMismatchSlice = slice === "payee-mismatch-controls";
  const mppPayeeMismatchSlice = slice === "mpp-payee-mismatch-controls";
  const wireDecoderSlice = slice === "wire-decoder-controls";
  if (wireDecoderSlice) assert.ok(["credential-invalid-encoding/import", "credential-invalid-encoding/require", "credential-invalid-json/import", "credential-invalid-json/require"].includes(selection));
  const wireSlice = slice === "wire-controls";
  const realmSlice = slice === "realm-controls" || slice === "billing-controls";
  const dualSlice = slice === "dual-controls";
  const claimSlice = slice === "claim-controls";
  const freezeSlice = slice === "freeze-controls";
  const receiptSlice = slice === "receipt-controls";
  const offerSlice = slice === "offer-controls";
  const sellerSlice = slice === "seller-controls";
  const supportedSlice = slice === "supported-controls";
  const supportedFinalSlice = slice === "supported-final-controls";
  const handlerFailureSlice = slice === "handler-failure-controls";
  const fulfillmentFailureSlice = slice === "fulfillment-failure-controls";
  const standardWireReceiptSlice = slice === "standard-wire-receipt-controls";
  const malformedAmbiguousOfferSlice = slice === "malformed-ambiguous-offer-controls";
  const mppMalformedCorpusSlice = slice === "mpp-malformed-corpus-controls";
  const receiptAbsentMalformedSlice = slice === "receipt-absent-malformed-controls";
  const unverifiedReceiptSlice = slice === "unverified-receipt-controls";
  const receiptMismatchSlice = slice === "receipt-mismatch-controls";
  const temporalValiditySlice = slice === "temporal-validity-controls";
  const replaySlice = slice === "replay-controls";
  const preflightSlice = slice === "preflight-controls";
  const { input, inputSha256 } = await readExecutionInput(inputPath);
  const redactionProfile = redactionFinalSlice ? resolveFinalRedactionProfile(fixture, row, input.stage) : null;
  const protocolFreezeProfile = protocolFreezeFinalSlice ? resolveFinalProtocolFreezeProfile(fixture, row, input.stage) : null;
  const settleUnknownProfile = settleUnknownSlice ? resolveFinalSettleUnknownProfile(fixture, row, input.stage) : null;
  const verifySettleRejectionProfile = verifySettleRejectionSlice ? resolveFinalVerifySettleRejectionProfile(fixture, row, input.stage) : null;
  const authorizationProfile = authorizationSlice ? resolveFinalX402UnsupportedAuthorizationProfile(fixture, row, input.stage) : null;
  const mppAuthorizationProfile = mppAuthorizationSlice ? resolveFinalMppUnsupportedAuthorizationProfile(fixture, row, input.stage) : null;
  const networkMismatchProfile = networkMismatchSlice ? resolveFinalX402NetworkMismatchProfile(fixture, row, input.stage) : mppNetworkMismatchSlice ? resolveFinalMppNetworkMismatchProfile(fixture, row, input.stage) : null;
  const amountMismatchProfile = amountMismatchSlice ? resolveFinalX402AmountMismatchProfile(fixture, row, input.stage) : mppAmountMismatchSlice ? resolveFinalMppAmountMismatchProfile(fixture, row, input.stage) : null;
  const assetMismatchProfile = assetMismatchSlice ? resolveFinalX402AssetMismatchProfile(fixture, row, input.stage) : mppAssetMismatchSlice ? resolveFinalMppAssetMismatchProfile(fixture, row, input.stage) : null;
  const payeeMismatchProfile = payeeMismatchSlice ? resolveFinalX402PayeeMismatchProfile(fixture, row, input.stage) : mppPayeeMismatchSlice ? resolveFinalMppPayeeMismatchProfile(fixture, row, input.stage) : null;
  const supportedFailureProfile = supportedFinalSlice ? resolveFinalSupportedFailureProfile(fixture, row, input.stage) : null;
  const handlerFailureProfile = handlerFailureSlice ? resolveFinalHandlerFailureProfile(fixture, row, input.stage) : null;
  const fulfillmentFailureProfile = fulfillmentFailureSlice ? resolveFinalFulfillmentFailureProfile(fixture, row, input.stage) : null;
  const standardWireReceiptProfile = standardWireReceiptSlice ? resolveFinalStandardWireReceiptProfile(fixture, row, input.stage) : null;
  const malformedAmbiguousOfferProfile = malformedAmbiguousOfferSlice ? resolveFinalMalformedAmbiguousOfferProfile(fixture, row, input.stage) : null;
  const receiptAbsentMalformedProfile = receiptAbsentMalformedSlice ? resolveFinalReceiptAbsentMalformedProfile(fixture, row, input.stage) : null;
  const unverifiedReceiptProfile = unverifiedReceiptSlice ? resolveFinalUnverifiedReceiptProfile(fixture, row, input.stage) : null;
  const receiptMismatchProfile = receiptMismatchSlice ? resolveFinalReceiptMismatchProfile(fixture, row, input.stage) : null;
  const temporalValidityProfile = temporalValiditySlice ? resolveFinalTemporalValidityProfile(fixture, row, input.stage) : null;
  const replayProfile = replaySlice ? resolveFinalReplayProfile(fixture, row, input.stage) : null;
  if (slice === "billing-recovery" && input.stage !== "development-only") throw new Error("BILLING_RECOVERY_REJECTED");
  const contract = matrix.rows.find(item => item.id === row && item.fixture === fixture && (redactionFinalSlice ? item.family === "fault" && row === redactionProfile.row : protocolFreezeFinalSlice ? item.family === "fault" && row === protocolFreezeProfile.row : settleUnknownSlice ? item.family === "fault" && row === settleUnknownProfile.row : verifySettleRejectionSlice ? item.family === "fault" && row === verifySettleRejectionProfile.row : mppMalformedCorpusSlice ? item.family === "native-corpus" && fixture.startsWith("mppx-") && row === `${fixture}-malformed-wire-${row.endsWith("-import") ? "import" : "require"}` : replaySlice ? item.family === "fault" && row === replayProfile.row : temporalValiditySlice ? item.family === "fault" && row === temporalValidityProfile.row : receiptMismatchSlice ? item.family === "fault" && row === receiptMismatchProfile.row : unverifiedReceiptSlice ? item.family === "fault" && row === unverifiedReceiptProfile.row : receiptAbsentMalformedSlice ? item.family === "fault" && row === receiptAbsentMalformedProfile.row : malformedAmbiguousOfferSlice ? item.family === "fault" && row === malformedAmbiguousOfferProfile.row : standardWireReceiptSlice ? item.family === "fault" && row === standardWireReceiptProfile.row : fulfillmentFailureSlice ? item.family === "fault" && row === fulfillmentFailureProfile.row : handlerFailureSlice ? item.family === "fault" && row === handlerFailureProfile.row : supportedFinalSlice ? item.family === "fault" && row === supportedFailureProfile.row : networkMismatchSlice || mppNetworkMismatchSlice ? item.family === "fault" && row === networkMismatchProfile.row : amountMismatchSlice || mppAmountMismatchSlice ? item.family === "fault" && row === amountMismatchProfile.row : assetMismatchSlice || mppAssetMismatchSlice ? item.family === "fault" && row === assetMismatchProfile.row : payeeMismatchSlice || mppPayeeMismatchSlice ? item.family === "fault" && row === payeeMismatchProfile.row : authorizationSlice ? item.family === "fault" && row === authorizationProfile.row : mppAuthorizationSlice ? item.family === "fault" && row === mppAuthorizationProfile.row : wireDecoderSlice ? item.family === "fault" && row === fixture + "-malformed-ambiguous-offer" : wireSlice ? item.family === "fault" && Object.keys(wireCases).some(family => row === fixture + "-" + family) : realmSlice ? item.family === "fault" && fixture.startsWith("mppx-") && row === fixture + "-protocol-freeze" : dualSlice ? item.family === "fault" && row === fixture + "-malformed-ambiguous-offer" : preflightSlice ? item.family === "fault" && Object.keys(preflightCases).some(family => row === fixture + "-" + family) : supportedSlice ? item.family === "fault" && row === fixture + "-supported-failure" : sellerSlice || offerSlice || receiptSlice ? item.family === "fault" && Object.keys(sellerSlice ? sellerCases : offerSlice ? offerCases : receiptCases).some(family => row === fixture + "-" + family) : freezeSlice ? item.family === "fault" && row === fixture + "-protocol-freeze" : claimSlice ? item.family === "fault" && [fixture + "-replay", fixture + "-protocol-freeze"].includes(row) : ["native-direction", "recovery"].includes(item.family)));
  assert.ok(contract); assert.equal(input.fixture, fixture);
  if (slice === "billing-recovery") assert.ok(contract.family === "recovery" && fixture.startsWith("mppx-"));
  if (claimSlice || freezeSlice || receiptSlice || offerSlice || sellerSlice || supportedSlice || preflightSlice || dualSlice || realmSlice || wireSlice || wireDecoderSlice) assert.equal(input.stage, "development-only");
  assert.equal(directory, join(input.evidence, contract.id));
  assert.equal(await realpath(directory), directory);
  await verifyInventory(root);
  const consumerIdentity = await verifyConsumer(input.consumer, true);
  const expectedVersions = await identifyFixture(input, contract);
  const payInventory = []; await publicModule(input.consumer.directory, "@0xkey-io/pay/client", contract.family === "recovery" || row.endsWith("-import") ? "import" : "require", payInventory);
  assert.equal(payInventory[0].version, "1.0.0-rc.1");
  emit({ type: "versions", versions: expectedVersions });
  let start = ""; for await (const chunk of process.stdin) { start += chunk; assert.ok(start.length < 256); }
  assert.deepEqual(JSON.parse(start), { type: "start" });
  if (mppMalformedCorpusSlice) {
    assert.equal(input.stage, "final-7b");
    const condition = row.endsWith("-import") ? "import" : "require", version = fixture.slice("mppx-".length);
    const sentinel = createServer(); await new Promise((resolveReady, reject) => { sentinel.once("error", reject); sentinel.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolveReady); });
    const readyPort = sentinel.address().port; emit({ type: "ready", port: readyPort }); await new Promise((resolveClose, reject) => sentinel.close(error => error ? reject(error) : resolveClose()));
    const probe = fileURLToPath(new URL("../../../../packages/pay/scripts/mpp-malformed-probe.mjs", import.meta.url));
    const savedArgv = process.argv, savedLog = console.log, captured = [];
    try {
      process.argv = [process.execPath, probe, input.consumer.directory, input.native, version, condition];
      console.log = value => { assert.ok(typeof value === "string" && captured.length < 256); captured.push(value); };
      await import(new URL("../../../../packages/pay/scripts/mpp-malformed-probe.mjs?final-corpus=" + encodeURIComponent(row), import.meta.url));
    } finally { process.argv = savedArgv; console.log = savedLog; }
    const raw = JSON.parse(captured.at(-1)); assert.deepEqual([raw.version, raw.condition, raw.passed, raw.rows.length], [version, condition, 104, 104]);
    assert.equal(raw.inventory.some(entry => entry.name === "mppx" && entry.version === version && entry.condition === condition), true);
    const rows = raw.rows.map(value => {
      let publicType = null; try { const body = JSON.parse(value.body); publicType = typeof body.type === "string" && body.type.startsWith("https://paymentauth.org/problems/") ? body.type.slice("https://paymentauth.org/problems/".length) : null; } catch {}
      const headers = value.headers ?? null, body = value.body ?? null;
      return { profile: value.profile, label: value.label, status: value.status ?? null, publicType, headerNames: Object.keys(headers ?? {}).map(name => name.toLowerCase()).sort(), headersSha256: hash(headers === null ? "absent" : JSON.stringify(headers)), bodySha256: hash(body === null ? "absent" : body), counters: value.counters };
    });
    const inventoryEvidence = raw.inventory.map(entry => ({ name: entry.name, version: entry.version, condition: entry.condition, entrySha256: hash(entry.entry) }));
    const observation = { row, scope: "native-corpus", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, corpus: { owner: "0xkey-local-regression", version, condition, source: "packages/pay/scripts/mpp-malformed-probe.mjs", rawOutputRetained: false }, inventory: inventoryEvidence, counts: raw.counts, tupleCount: rows.length, rows };
    const bytes = JSON.stringify(observation, null, 2) + "\n"; assert.doesNotMatch(bytes, /01234567890123456789012345678901|raw-input-sentinel|rawInputSentinel|dGhpcyBpcyBnYXJiYWdl|22222222-2222-4222-8222-222222222222/);
    await writeFile(join(directory, "observation.json"), bytes, { flag: "wx", mode: 0o600 });
    const totals = counters(); totals.sign = raw.counts.signing; totals.settle = raw.counts.settle; totals.handler = raw.counts.handler; totals.fulfillment = raw.counts.fulfillment;
    const { supported, ...controlCounters } = totals; emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (redactionFinalSlice) {
    assert.equal(input.stage,"final-7b");let ready=false;const subcases=await runCurrentRedaction({input,row,directory,assert,profile:redactionProfile,onReady(port){if(!ready){emit({type:"ready",port});ready=true;}}});
    const order=new Map(Object.entries(redactionProfile.catalog).flatMap(([path,ids],pathIndex)=>ids.flatMap((caseId,caseIndex)=>["import","require"].map((condition,conditionIndex)=>[`${path}/${caseId}/${condition}`,pathIndex*100+caseIndex*2+conditionIndex]))));subcases.sort((a,b)=>order.get(`${a.path}/${a.caseId}/${a.condition}`)-order.get(`${b.path}/${b.caseId}/${b.condition}`));
    const observation={row,scope:"fault",coverage:"complete",aggregateStatus:"PASSED",stage:input.stage,inputSha256,artifactSha256:input.consumer.artifactSha256,consumerIdentity,catalog:redactionProfile.catalog,redactionContract:{protocol:redactionProfile.protocol,version:redactionProfile.version,rawOutputRetained:false,allowlistedMetadataOnly:true,negativeControlsExecuted:true},subcases};const bytes=JSON.stringify(observation,null,2)+"\n";assert.doesNotMatch(bytes,/credential-sentinel-7b|stamp-sentinel-7b|secret-key-sentinel-7b|receipt-sentinel-7b|body-sentinel-7b|unique-private-sentinel-7a|synthetic-discriminator-secret-7a/);await writeFile(join(directory,"observation.json"),bytes,{flag:"wx",mode:0o600});const totals=counters();for(const subcase of subcases)for(const key of Object.keys(totals))totals[key]+=subcase.counters[key];const{supported,...controlCounters}=totals;emit({type:"observation",counters:controlCounters});emit({type:"result",assertions:assertionCount});return;
  }
  if (protocolFreezeFinalSlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const subcases = await runCurrentProtocolFreeze({ input, row, directory, assert, profile: protocolFreezeProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const order = new Map(Object.entries(protocolFreezeProfile.catalog).flatMap(([path, ids], pathIndex) => ids.flatMap((caseId, caseIndex) => ["import", "require"].map((condition, conditionIndex) => [`${path}/${caseId}/${condition}`, pathIndex * 100 + caseIndex * 2 + conditionIndex]))));
    subcases.sort((a,b)=>order.get(`${a.path}/${a.caseId}/${a.condition}`)-order.get(`${b.path}/${b.caseId}/${b.condition}`));
    const observation={row,scope:"fault",coverage:"complete",aggregateStatus:"PASSED",stage:input.stage,inputSha256,artifactSha256:input.consumer.artifactSha256,consumerIdentity,catalog:protocolFreezeProfile.catalog,freezeContract:{protocol:protocolFreezeProfile.protocol,version:protocolFreezeProfile.version,noPostSignFallback:true,redirectDestinationRequests:0,authenticatedRestartBinding:true},subcases};
    await writeFile(join(directory,"observation.json"),JSON.stringify(observation,null,2)+"\n",{flag:"wx",mode:0o600});const totals=counters();for(const subcase of subcases)for(const key of Object.keys(totals))totals[key]+=subcase.counters[key];const {supported,...controlCounters}=totals;emit({type:"observation",counters:controlCounters});emit({type:"result",assertions:assertionCount});return;
  }
  if (settleUnknownSlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const subcases = await runCurrentSettleUnknown({ input, row, directory, assert, profile: settleUnknownProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const order = new Map(Object.entries(settleUnknownProfile.catalog).flatMap(([path, ids], pathIndex) => ids.flatMap((caseId, caseIndex) => ["import", "require"].map((condition, conditionIndex) => [`${path}/${caseId}/${condition}`, pathIndex * 100 + caseIndex * 2 + conditionIndex]))));
    subcases.sort((a, b) => order.get(`${a.path}/${a.caseId}/${a.condition}`) - order.get(`${b.path}/${b.caseId}/${b.condition}`));
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: settleUnknownProfile.catalog, unknownContract: { protocol: settleUnknownProfile.protocol, owner: settleUnknownProfile.owner, version: settleUnknownProfile.version, credentialStable: true, noClearBeforeVerifiedResume: true, sellerHandlerOnUnknown: false }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key]; const { supported, ...controlCounters } = totals;
    emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (verifySettleRejectionSlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const subcases = await runCurrentVerifySettleRejection({ input, row, directory, assert, profile: verifySettleRejectionProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: verifySettleRejectionProfile.catalog, rejectionContract: { protocol: verifySettleRejectionProfile.protocol, owner: verifySettleRejectionProfile.owner, version: verifySettleRejectionProfile.version, handlerOnRejectedSettlement: false }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key]; const { supported, ...controlCounters } = totals;
    emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (replaySlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const subcases = await runCurrentReplay({ input, row, directory, assert, profile: replayProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: replayProfile.catalog, replayContract: { protocol: replayProfile.protocol, owner: replayProfile.owner, version: replayProfile.version, credentialStable: true, economicEffectOnce: true, applicationEffectOnce: true, servicesDatabaseUniquenessProven: false }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key]; const { supported, ...controlCounters } = totals;
    emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (temporalValiditySlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const subcases = await runCurrentTemporalValidity({ input, row, directory, assert, profile: temporalValidityProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: temporalValidityProfile.catalog, temporalContract: { protocol: temporalValidityProfile.protocol, owner: temporalValidityProfile.owner, version: temporalValidityProfile.version, canonicalResignedWire: true, settlementBeforeRejection: false }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key]; const { supported, ...controlCounters } = totals;
    emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (receiptAbsentMalformedSlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const subcases = await runCurrentReceiptAbsentMalformed({ input, row, directory, assert, profile: receiptAbsentMalformedProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: receiptAbsentMalformedProfile.catalog, receiptContract: { protocol: receiptAbsentMalformedProfile.protocol, owner: receiptAbsentMalformedProfile.owner, version: receiptAbsentMalformedProfile.version, failurePending: true, proofRpcCalls: 4, proofBeforeClear: true }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key]; const { supported, ...controlCounters } = totals;
    emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (unverifiedReceiptSlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const subcases = await runCurrentUnverifiedReceipt({ input, row, directory, assert, profile: unverifiedReceiptProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: unverifiedReceiptProfile.catalog, receiptContract: { protocol: unverifiedReceiptProfile.protocol, owner: unverifiedReceiptProfile.owner, version: unverifiedReceiptProfile.version, failurePending: true, proofRpcCalls: 4, proofBeforeClear: true, auditedVerifierCases: 2 }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key]; const { supported, ...controlCounters } = totals;
    emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (receiptMismatchSlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const subcases = await runCurrentReceiptMismatch({ input, row, directory, assert, profile: receiptMismatchProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: receiptMismatchProfile.catalog, receiptContract: { protocol: receiptMismatchProfile.protocol, owner: receiptMismatchProfile.owner, version: receiptMismatchProfile.version, failurePending: true, proofRpcCalls: 4, proofBeforeClear: true, x402NetworkCaseApplicable: receiptMismatchProfile.protocol === "x402" }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key]; const { supported, ...controlCounters } = totals;
    emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (handlerFailureSlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const subcases = await runCurrentHandlerFailure({ input, row, directory, assert, profile: handlerFailureProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: handlerFailureProfile.catalog, handlerContract: { protocol: handlerFailureProfile.protocol, owner: handlerFailureProfile.owner, version: handlerFailureProfile.version, retryOwner: "application-same-process-captured-request" }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key]; const { supported, ...controlCounters } = totals;
    emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (fulfillmentFailureSlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const subcases = await runCurrentFulfillmentFailure({ input, row, directory, assert, profile: fulfillmentFailureProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: fulfillmentFailureProfile.catalog, fulfillmentContract: { protocol: fulfillmentFailureProfile.protocol, owner: fulfillmentFailureProfile.owner, version: fulfillmentFailureProfile.version, acknowledgementStatus: 200, retryOwner: "application-same-process-captured-request" }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key]; const { supported, ...controlCounters } = totals;
    emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (standardWireReceiptSlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const subcases = await runCurrentStandardWireReceipt({ input, row, directory, assert, profile: standardWireReceiptProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: standardWireReceiptProfile.catalog, receiptContract: { protocol: standardWireReceiptProfile.protocol, owner: standardWireReceiptProfile.owner, version: standardWireReceiptProfile.version, privateEnvelopeExcluded: true, privatePaymentIdExcluded: true, directWrapperApplicable: standardWireReceiptProfile.protocol === "mpp" }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) if (subcase.counters) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key]; const { supported, ...controlCounters } = totals;
    emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (malformedAmbiguousOfferSlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const subcases = await runCurrentMalformedAmbiguousOffer({ input, row, directory, assert, profile: malformedAmbiguousOfferProfile, runDecoder: runWireDecoderSlice, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: malformedAmbiguousOfferProfile.catalog, malformedOfferContract: { protocol: malformedAmbiguousOfferProfile.protocol, owner: malformedAmbiguousOfferProfile.owner, version: malformedAmbiguousOfferProfile.version, corpusExcluded: malformedAmbiguousOfferProfile.protocol === "mpp" }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key]; const { supported, ...controlCounters } = totals;
    emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (supportedFinalSlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const subcases = await runCurrentSupportedFailure({ input, row, directory, assert, profile: supportedFailureProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: supportedFailureProfile.catalog, supportContract: { protocol: supportedFailureProfile.protocol, owner: supportedFailureProfile.owner, version: supportedFailureProfile.version, dependencyProtocol: "x402", mppOnlyNondependency: supportedFailureProfile.protocol === "mpp" }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key]; const { supported, ...controlCounters } = totals;
    emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (networkMismatchSlice || mppNetworkMismatchSlice) {
    assert.equal(input.stage, "final-7b");
    const mpp = mppNetworkMismatchSlice, catalog = mpp ? currentMppNetworkMismatchCases : currentX402NetworkMismatchCases;
    let ready = false;
    const runNetworkMismatch = mpp ? runCurrentMppNetworkMismatch : runCurrentX402NetworkMismatch;
    const subcases = await runNetworkMismatch({ input, row, directory, assert, profile: networkMismatchProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog, networkContract: { owner: networkMismatchProfile.owner, version: networkMismatchProfile.version, offerCodecOwner: networkMismatchProfile.codecOwner, original: "eip155:84532", incompatible: "eip155:8453", unsupported: "eip155:1", wireField: mpp ? "credential.source" : "accepted.network" }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key];
    const { supported, ...controlCounters } = totals; emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (amountMismatchSlice || mppAmountMismatchSlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const mpp = mppAmountMismatchSlice, runAmountMismatch = mpp ? runCurrentMppAmountMismatch : runCurrentX402AmountMismatch;
    const subcases = await runAmountMismatch({ input, row, directory, assert, profile: amountMismatchProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: mpp ? currentMppAmountMismatchCases : currentX402AmountMismatchCases, amountContract: { owner: amountMismatchProfile.owner, version: amountMismatchProfile.version, codecOwner: amountMismatchProfile.codecOwner, offerField: mpp ? "request.amount" : "accepts.amount", wireField: mpp ? "payload.value" : "payload.authorization.value" }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key]; const { supported, ...controlCounters } = totals;
    emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (assetMismatchSlice || mppAssetMismatchSlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const mpp = mppAssetMismatchSlice, runAssetMismatch = mpp ? runCurrentMppAssetMismatch : runCurrentX402AssetMismatch;
    const subcases = await runAssetMismatch({ input, row, directory, assert, profile: assetMismatchProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: mpp ? currentMppAssetMismatchCases : currentX402AssetMismatchCases, assetContract: { owner: assetMismatchProfile.owner, version: assetMismatchProfile.version, codecOwner: assetMismatchProfile.codecOwner, offerField: mpp ? "request.currency" : "accepts.asset", offerDecimalsField: mpp ? "request.methodDetails.decimals" : null, wireField: mpp ? "challenge.request.currency" : "accepted.asset" }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key]; const { supported, ...controlCounters } = totals;
    emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (payeeMismatchSlice || mppPayeeMismatchSlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const mpp = mppPayeeMismatchSlice, runPayeeMismatch = mpp ? runCurrentMppPayeeMismatch : runCurrentX402PayeeMismatch;
    const subcases = await runPayeeMismatch({ input, row, directory, assert, profile: payeeMismatchProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: mpp ? currentMppPayeeMismatchCases : currentX402PayeeMismatchCases, payeeContract: { owner: payeeMismatchProfile.owner, version: payeeMismatchProfile.version, codecOwner: payeeMismatchProfile.codecOwner, offerField: mpp ? "request.recipient" : "accepts.payTo", wireField: mpp ? "payload.to" : "payload.authorization.to", offerBoundary: "invalid-address-syntax-only; no independent payee allowlist" }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key]; const { supported, ...controlCounters } = totals;
    emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (authorizationSlice) {
    assert.equal(input.stage, "final-7b");
    let ready = false;
    const subcases = await runCurrentX402UnsupportedAuthorization({ input, row, directory, assert, profile: authorizationProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: currentX402UnsupportedAuthorizationCases, selectorContract: { owner: "@x402/evm", version: authorizationProfile.version, unknownCaseId: "unknown-required-extension", field: "accepts[].extra.assetTransferMethod", value: "future-transfer", boundary: "required authorization selector; not PaymentRequired.extensions or JSON Schema required" }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key];
    const { supported, ...controlCounters } = totals; emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (mppAuthorizationSlice) {
    assert.equal(input.stage, "final-7b"); let ready = false;
    const subcases = await runCurrentMppUnsupportedAuthorization({ input, row, directory, assert, profile: mppAuthorizationProfile, onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
    const observation = { row, scope: "fault", coverage: "complete", aggregateStatus: "PASSED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, catalog: currentMppUnsupportedAuthorizationCases, selectionContract: { protocol: "mpp", owner: mppAuthorizationProfile.owner, version: mppAuthorizationProfile.version, method: "evm", intent: "charge", positiveAuthorization: "authorization", negativeAuthorization: "future-authorization" }, subcases };
    await writeFile(join(directory, "observation.json"), JSON.stringify(observation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const totals = counters(); for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key]; const { supported, ...controlCounters } = totals;
    emit({ type: "observation", counters: controlCounters }); emit({ type: "result", assertions: assertionCount }); return;
  }
  if (claimSlice || freezeSlice || receiptSlice || offerSlice || sellerSlice || supportedSlice || preflightSlice || dualSlice || realmSlice || wireSlice || wireDecoderSlice) {
    const label = wireDecoderSlice ? "wire-decoder" : wireSlice ? "wire" : realmSlice ? "realm" : dualSlice ? "dual" : preflightSlice ? "preflight" : supportedSlice ? "supported" : sellerSlice ? "seller" : offerSlice ? "offer" : receiptSlice ? "receipt" : freezeSlice ? "freeze" : "claim";
    const binding = { row, scope: label + "-controls-slice", coverage: "partial", aggregateStatus: "BLOCKED", stage: input.stage, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity };
    let ready = false;
    try {
      const subcases = await (wireDecoderSlice ? runWireDecoderSlice : wireSlice ? runWireSlice : realmSlice ? runRealmSlice : dualSlice ? runDualSlice : preflightSlice ? runPreflightSlice : supportedSlice ? runSupportedSlice : sellerSlice ? runSellerSlice : offerSlice ? runOfferSlice : receiptSlice ? runReceiptSlice : freezeSlice ? runFreezeSlice : runClaimSlice)({ input, row, directory, assert, selection, billingOnly: slice === "billing-controls", onReady(port) { if (!ready) { emit({ type: "ready", port }); ready = true; } } });
      await writeFile(join(directory, label + "-observations.json"), JSON.stringify({ ...binding, subcases }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      const totals = counters();
      for (const subcase of subcases) for (const key of Object.keys(totals)) totals[key] += subcase.counters[key];
      const { supported, ...controlCounters } = totals;
      emit({ type: "observation", counters: controlCounters });
      emit({ type: "result", assertions: assertionCount });
    } catch (error) {
      await writeFile(join(directory, label + "-slice-failure.json"), JSON.stringify({ ...binding, failure: hash(String(error?.message)) }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      process.exitCode = 1;
    }
    return;
  }
  let evidence, failure, roleObservations;
  const stages = [], recovering = contract.family === "recovery";
  const config = { condition: recovering || row.endsWith("-import") ? "import" : "require", protocol: fixture.startsWith("mppx-") ? "mpp" : "x402", payBuyer: recovering || row.includes("pay-buyer-to-official"), native: input.native, pay: input.consumer.directory, certificates: input.certificates, ...(slice === "billing-recovery" ? { billingRecovery: true } : {}) };
  const recoveryBinding = recovering ? { row, scope: contract.family, stage: input.stage, profile: config.billingRecovery ? "billing" : "ordinary" } : {};
  const scenario = nativeScenario({ config, assert });
  const { roles, ports, tlsControls, spawnRole } = scenario;
  try {
    const facilitator = await spawnRole("scripted-facilitator");
    const merchant = await spawnRole("merchant", { facilitator: facilitator.origin });
    emit({ type: "ready", port: Number(new URL(merchant.origin).port) });
    await scenario.verifyTls([facilitator, merchant]);
    const store = join(directory, "durable"); initializeStore(store);
    const keySha256 = hash(await readFile(join(store, "storage.key")));
    let bought, buyerCounts = counters(), buyerEvents = [];
    for (const step of recovering ? recoveryStages : [undefined]) {
      if (step) for (const role of [facilitator, merchant]) { role.send({ type: "configure", step }); assert.equal((await role.take("configured")).step, step); }
      const buyer = await spawnRole("buyer", { facilitator: facilitator.origin, merchant: merchant.origin, store, ...(step ? { step } : {}) });
      let termination;
      if (step === "save-before-send-exit") {
        bought = await buyer.take("prepared");
        assert.deepEqual([bought.counters.sign, bought.counters.save, bought.counters.signedSend, bought.counters.clear], [1, 1, 0, 0]);
        buyer.child.kill("SIGKILL"); termination = await buyer.close;
        assert.deepEqual(termination, { code: null, signal: "SIGKILL", reason: "ROLE_EXIT_NONZERO" });
      } else {
        bought = await buyer.take("completed");
        assert.deepEqual(await buyer.close, { code: 0, signal: null, reason: null });
      }
      for (const key of Object.keys(buyerCounts)) buyerCounts[key] += bought.counters[key];
      buyerEvents.push(...bought.events);
      if (step) {
        let ciphertextSha256 = null;
        try { ciphertextSha256 = hash(await readFile(join(store, "pending.aead"))); } catch (error) { assert.equal(error.code, "ENOENT"); }
        stages.push({ name: step, pid: buyer.child.pid, ...bought, ciphertextSha256, ...(termination ? { termination } : {}) });
        assert.equal(hash(await readFile(join(store, "storage.key"))), keySha256);
        assert.equal(bought.counters.sign, step === "save-before-send-exit" ? 1 : 0);
        assert.equal(bought.counters.save, step === "save-before-send-exit" ? 1 : 0);
        assert.equal(bought.counters.clear, step === "proof" ? 1 : 0);
        assert.equal(bought.credentialSha256, stages[0].credentialSha256);
        assert.equal(ciphertextSha256, step === "proof" ? null : stages[0].ciphertextSha256);
      }
    }
    const snapshots = [];
    for (const role of [merchant, facilitator]) { role.send({ type: "snapshot" }); const snapshot = await role.take("snapshot"); snapshots.push(snapshot); }
    roleObservations = { merchant: snapshots[0], facilitator: snapshots[1] };
    for (const snapshot of snapshots) assert.deepEqual(snapshot.failures, []);
    const totals = counters();
    const buyerAggregate = { counters: buyerCounts, events: buyerEvents };
    roleObservations = { buyer: buyerAggregate, merchant: snapshots[0], facilitator: snapshots[1] };
    for (const snapshot of [buyerAggregate, ...snapshots]) for (const key of Object.keys(totals)) { assert.ok(Number.isSafeInteger(snapshot.counters[key]) && snapshot.counters[key] >= 0); totals[key] += snapshot.counters[key]; }
    // Buyer dispatch and facilitator receive observe the same four RPCs. Keep
    // both role observations, but the matrix counts received calls once.
    assert.equal(buyerCounts.rpc, snapshots[1].counters.rpc);
    totals.rpc = snapshots[1].counters.rpc;
    assert.deepEqual(snapshots[0].received, Array(recovering ? 10 : 1).fill(bought.credentialSha256));
    assert.equal(bought.receiptValid, true);
    if (!recovering) {
      assert.deepEqual([totals.sign, totals.signedSend, totals.settle, totals.economicEffect, totals.handler, totals.applicationEffect, totals.challenge], [1, 1, 1, 1, 1, 1, 1]);
      assert.deepEqual([totals.save, totals.clear, totals.rpc, totals.fulfillment], config.payBuyer ? [1, 1, 4, 0] : [0, 0, 0, 1]);
    } else assert.deepEqual([totals.sign, totals.save, totals.clear, totals.signedSend, totals.settle, totals.economicEffect, totals.handler, totals.applicationEffect, totals.challenge], [1, 1, 1, 10, 10, 1, 6, 1, 1]);
    await scenario.closeRoles([merchant, facilitator]);
    const events = [buyerAggregate, ...snapshots].flatMap(item => item.events).sort((a, b) => BigInt(a.atNs) < BigInt(b.atNs) ? -1 : 1);
    const first = event => events.findIndex(item => item.event === event);
    const saveBeforeSend = !config.payBuyer || first("sign") < first("save") && first("save") < first("signedSend");
    const proofBeforeClear = !config.payBuyer || events.filter(event => event.event === "rpc").every(event => BigInt(event.atNs) < BigInt(events[first("clear")].atNs));
    assert.equal(saveBeforeSend, true); assert.equal(proofBeforeClear, true);
    evidence = { row, scope: contract.family, stage: input.stage, ...recoveryBinding, inputSha256, artifactSha256: input.consumer.artifactSha256, consumerIdentity, status: bought.status, counters: totals, credentialSha256: bought.credentialSha256, receiptSha256: bought.receiptSha256, receiptValid: bought.receiptValid, events, roles: roles.map(role => role.identity), ports, tls: tlsControls, roleObservations, ...(recovering ? { stages, keySha256, saveBeforeSend, proofBeforeClear } : {}) };
  } catch (error) { failure = hash(String(error?.message)); }
  finally {
    const diagnostics = await scenario.cleanup();
    if (diagnostics.some(item => item.stdout.bytes || item.stderr.bytes)) failure ??= hash("UNEXPECTED_ROLE_OUTPUT");
    if (evidence && !failure) {
      await writeFile(join(directory, "observation.json"), JSON.stringify({ ...evidence, diagnostics }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      const { supported, ...controlCounters } = evidence.counters;
      emit({ type: "observation", counters: controlCounters, digests: { credentialSha256: evidence.credentialSha256, receiptSha256: evidence.receiptSha256 } });
      emit({ type: "result", assertions: assertionCount });
    } else {
      await writeFile(join(directory, "failure.json"), JSON.stringify({ ...recoveryBinding, failure, diagnostics, ports, roleObservations, stages, roleFailures: roles.flatMap(role => role.failures) }, null, 2) + "\n", { flag: "wx", mode: 0o600 }); process.exitCode = 1;
    }
  }
}
