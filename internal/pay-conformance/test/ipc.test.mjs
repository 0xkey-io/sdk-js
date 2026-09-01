import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { receive, counters } from "../fixtures/runtime/common.mjs";
import * as ipc from "../src/ipc.mjs";

async function deliver(message) {
  const pending = receive(); process.emit("message", message); return pending;
}
const hash = "1".repeat(64);
const digestText = value => createHash("sha256").update(value).digest("hex");
test("redaction final profiles bind protocol, callback and supervisor controls", () => {
  const expected=Object.freeze({protocol:Object.freeze(["credential-stamp-secret-key-receipt-body-sentinels"]),callback:Object.freeze(["r99-callback-provenance","r102-signer-provenance"]),supervisor:Object.freeze(["bad-ipc","coercible-control","stderr-secret","output-limit"])});
  assert.deepEqual(ipc.currentRedactionCases,expected);
  for(const [fixture,version,protocol] of [["x402-2.23","2.23.0","x402"],["x402-2.22","2.22.0","x402"],["mppx-0.8.19","0.8.19","mpp"],["mppx-0.8.17","0.8.17","mpp"]]){const profile=ipc.resolveFinalRedactionProfile(fixture,`${fixture}-redaction`,"final-7b");assert.deepEqual([profile.fixture,profile.version,profile.protocol,profile.catalog],[fixture,version,protocol,expected]);}
  assert.throws(()=>ipc.resolveFinalRedactionProfile("x402-2.23","x402-2.23-redaction","development-only"),/FINAL_REDACTION_PROFILE_REJECTED/);
});
test("redaction final dispatcher cannot fall through to generic process checks", async()=>{
  const [driver,faults,integration]=await Promise.all([readFile(new URL("../fixtures/runtime/driver.mjs",import.meta.url),"utf8"),readFile(new URL("../fixtures/runtime/faults.mjs",import.meta.url),"utf8"),readFile(new URL("./integration/native-redaction-final.mjs",import.meta.url),"utf8")]);
  assert.match(driver,/redaction-final-controls/);assert.match(driver,/resolveFinalRedactionProfile/);assert.match(driver,/runCurrentRedaction/);assert.match(faults,/export async function runCurrentRedaction/);assert.match(integration,/closes redaction across protocol, callback and supervisor boundaries/);
});
test("protocol-freeze final profiles bind every freeze, durability and provenance boundary", () => {
  const expected = Object.freeze({
    wire: Object.freeze(["other-protocol-shaped-nonce", "other-protocol-error-text", "coincident-fields", "opposite-challenge-after-signature"]),
    restart: Object.freeze(["redirect-before-payment", "redirect-after-payment", "changed-body-on-resume", "changed-request-binding", "old-v2-pending", "old-v3-binding", "durable-save-before-first-send-exit"]),
    claim: Object.freeze(["save-if-absent-false", "save-if-absent-throws"]),
    callback: Object.freeze(["callback-signing-provenance"]),
  });
  assert.deepEqual(ipc.currentProtocolFreezeCases, expected);
  for (const [fixture, version, protocol] of [["x402-2.23", "2.23.0", "x402"], ["x402-2.22", "2.22.0", "x402"], ["mppx-0.8.19", "0.8.19", "mpp"], ["mppx-0.8.17", "0.8.17", "mpp"]]) {
    const profile=ipc.resolveFinalProtocolFreezeProfile(fixture,`${fixture}-protocol-freeze`,"final-7b"); assert.deepEqual([profile.fixture,profile.version,profile.protocol,profile.catalog],[fixture,version,protocol,expected]);
  }
  assert.throws(()=>ipc.resolveFinalProtocolFreezeProfile("x402-2.23","x402-2.23-protocol-freeze","development-only"),/FINAL_PROTOCOL_FREEZE_PROFILE_REJECTED/);
});
test("protocol-freeze final dispatcher cannot fall through to partial freeze or claim slices", async () => {
  const [driver,faults,integration]=await Promise.all([readFile(new URL("../fixtures/runtime/driver.mjs",import.meta.url),"utf8"),readFile(new URL("../fixtures/runtime/faults.mjs",import.meta.url),"utf8"),readFile(new URL("./integration/native-protocol-freeze-final.mjs",import.meta.url),"utf8")]);
  assert.match(driver,/protocol-freeze-final-controls/);assert.match(driver,/resolveFinalProtocolFreezeProfile/);assert.match(driver,/runCurrentProtocolFreeze/);assert.match(faults,/export async function runCurrentProtocolFreeze/);assert.match(integration,/closes protocol freeze without fallback/);
});
test("settle-unknown final profiles bind the closed recovery and owner catalog", () => {
  const common = Object.freeze({
    buyer: Object.freeze(["accepted-503", "accepted-disconnect", "accepted-timeout", "signed-500", "signed-502", "signed-599", "verified-resume"]),
    seller: Object.freeze(["unknown-no-handler"]),
  });
  assert.deepEqual(ipc.currentSettleUnknownCases.x402, Object.freeze({ ...common, owner: Object.freeze(["facilitator-owner-unknown"]) }));
  assert.deepEqual(ipc.currentSettleUnknownCases.mpp, Object.freeze({ ...common, owner: Object.freeze(["default-current-same-owner", "configured-foreign-selected-owner", "wrong-owner-negative"]) }));
  for (const [fixture, version, protocol, owner] of [["x402-2.23", "2.23.0", "x402", "@x402/core@2.23.0"], ["x402-2.22", "2.22.0", "x402", "@x402/core@2.22.0"], ["mppx-0.8.19", "0.8.19", "mpp", "mppx@0.8.19"], ["mppx-0.8.17", "0.8.17", "mpp", "mppx@0.8.17"]]) {
    const profile = ipc.resolveFinalSettleUnknownProfile(fixture, `${fixture}-settle-unknown`, "final-7b");
    assert.deepEqual([profile.fixture, profile.version, profile.protocol, profile.owner, profile.catalog], [fixture, version, protocol, owner, ipc.currentSettleUnknownCases[protocol]]);
  }
  for (const invalid of [["x402-2.21", "x402-2.21-settle-unknown", "final-7b"], ["x402-2.23", "x402-2.23-verify-settle-rejection", "final-7b"], ["mppx-0.8.19", "mppx-0.8.19-settle-unknown", "development-only"]]) assert.throws(() => ipc.resolveFinalSettleUnknownProfile(...invalid), /FINAL_SETTLE_UNKNOWN_PROFILE_REJECTED/);
});
test("settle-unknown final dispatcher is isolated from the ordinary recovery row", async () => {
  const [driver, faults, integration] = await Promise.all([readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8"), readFile(new URL("../fixtures/runtime/faults.mjs", import.meta.url), "utf8"), readFile(new URL("./integration/native-settle-unknown-final.mjs", import.meta.url), "utf8")]);
  assert.match(driver, /settle-unknown-controls/); assert.match(driver, /resolveFinalSettleUnknownProfile/); assert.match(driver, /runCurrentSettleUnknown/);
  assert.match(faults, /export async function runCurrentSettleUnknown/); assert.match(integration, /closes durable unknown and physical owner boundaries/);
});
test("replay final profiles and role IPC stay closed", async () => {
  const expected = Object.freeze({ buyer: Object.freeze(["same-process-replay", "fresh-process-replay"]), seller: Object.freeze(["direct-caller-identical-credential-replay"]), owner: Object.freeze(["single-client-singleflight", "multi-client-atomic-claim"]) });
  assert.deepEqual(ipc.currentReplayCases, expected);
  for (const [fixture, version, protocol] of [["x402-2.23", "2.23.0", "x402"], ["x402-2.22", "2.22.0", "x402"], ["mppx-0.8.19", "0.8.19", "mpp"], ["mppx-0.8.17", "0.8.17", "mpp"]]) {
    const profile = ipc.resolveFinalReplayProfile(fixture, `${fixture}-replay`, "final-7b");
    assert.deepEqual([profile.fixture, profile.version, profile.protocol, profile.row], [fixture, version, protocol, `${fixture}-replay`]);
    const base = { condition: "import", protocol, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", replayFinal: true };
    for (const replayCaseId of expected.buyer) for (const replayStage of replayCaseId === "same-process-replay" ? ["initial"] : ["initial", "resume"]) {
      const config = { ...base, payBuyer: true, facilitator: "https://127.0.0.1:41001", merchant: "https://127.0.0.1:41002", store: "/owned/store", replayCaseId, replayStage };
      assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
    }
    const seller = { ...base, payBuyer: false, facilitator: "https://127.0.0.1:41001", merchant: "https://127.0.0.1:41002", replayCaseId: expected.seller[0], sellerCaseId: "handler-500" };
    assert.deepEqual(await deliver({ type: "identify", config: seller }), { type: "identify", config: seller });
    for (const caseId of expected.owner) {
      const config = { ...base, payBuyer: true, facilitator: "https://127.0.0.1:41001", merchant: "https://127.0.0.1:41002", store: "/owned/store", replayCaseId: caseId, caseId };
      assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
    }
  }
  const result = { type: "replay-result", caseId: "fresh-process-replay", stage: "first", counters: counters(), events: [], status: null, errorCode: "PAYMENT_RECEIPT_MISSING", pending: true, credentialSha256: hash, recordSha256: hash, receiptSha256: null, receiptValid: false };
  assert.deepEqual(await deliver(result), result);
  assert.deepEqual(await deliver({ type: "replay-proceed", caseId: "same-process-replay" }), { type: "replay-proceed", caseId: "same-process-replay" });
  await assert.rejects(deliver({ ...result, errorCode: "PAYMENT_STATUS_UNKNOWN" }), /IPC_MESSAGE_REJECTED/);
  await assert.rejects(deliver({ type: "identify", config: { condition: "import", protocol: "x402", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", replayFinal: true, replayCaseId: "fresh-process-replay", replayStage: "arbitrary", store: "/owned/store" } }), /IPC_MESSAGE_REJECTED/);
});
test("asset mismatch final profiles bind only the three asset paths", async () => {
  const x402Expected = Object.freeze({ offer: Object.freeze(["non-usdc-offer", "wrong-network-usdc"]), wire: Object.freeze(["credential-offer-asset-mismatch"]) });
  const mppExpected = Object.freeze({ offer: Object.freeze(["non-usdc-offer", "wrong-network-usdc", "wrong-decimals"]), wire: Object.freeze(["credential-offer-asset-mismatch"]) });
  assert.deepEqual(ipc.currentX402AssetMismatchCases, x402Expected);
  assert.deepEqual(ipc.currentMppAssetMismatchCases, mppExpected);
  for (const [fixture, version, protocol] of [["x402-2.23", "2.23.0", "x402"], ["x402-2.22", "2.22.0", "x402"], ["mppx-0.8.19", "0.8.19", "mpp"], ["mppx-0.8.17", "0.8.17", "mpp"]]) {
    const resolve = protocol === "x402" ? ipc.resolveFinalX402AssetMismatchProfile : ipc.resolveFinalMppAssetMismatchProfile;
    const profile = resolve(fixture, `${fixture}-asset-mismatch`, "final-7b");
    assert.deepEqual([profile.fixture, profile.version, profile.owner, profile.codecOwner, profile.row], [fixture, version, protocol === "x402" ? `@x402/evm@${version}` : `mppx@${version}`, protocol === "x402" ? `@x402/core@${version}` : `mppx@${version}`, `${fixture}-asset-mismatch`]);
  }
  for (const protocol of ["x402", "mpp"]) {
    const flag = protocol === "x402" ? "assetMismatchFinal" : "mppAssetMismatchFinal";
    const catalog = protocol === "x402" ? ipc.currentX402AssetMismatchCases : ipc.currentMppAssetMismatchCases;
    const base = { condition: "import", protocol, payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", [flag]: true };
    for (const [path, ids] of Object.entries(catalog)) for (const caseId of ids) for (const stage of ["negative", "positive"]) {
      const config = path === "offer" ? { ...base, offerCaseId: caseId, offerStage: stage } : { ...base, payBuyer: false, wireCaseId: caseId, wireStage: stage };
      assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
    }
    await assert.rejects(deliver({ type: "identify", config: { ...base, offerCaseId: "above-ceiling", offerStage: "negative" } }), /IPC_MESSAGE_REJECTED/);
  }
});
test("asset codec evidence rejects malformed, incomplete and directionless bindings", async () => {
  const wire = { field: "challenge.request.currency", originalSha256: hash, transmittedSha256: "2".repeat(64), originalHeadersSha256: hash, transmittedHeadersSha256: "2".repeat(64), credentialHeadersSha256: hash, bodySha256: hash, unchangedBeforeSha256: hash, unchangedAfterSha256: hash, envelopeBeforeSha256: hash, envelopeAfterSha256: hash, decodedAssetSha256: hash, codecOwner: "mppx@0.8.19", decoder: "Credential.deserialize", encoder: "Credential.serialize", challengeRemainderBeforeSha256: hash, challengeRemainderAfterSha256: hash, payloadBeforeSha256: hash, payloadAfterSha256: hash };
  const result = { type: "wire-result", caseId: "credential-offer-asset-mismatch", stage: "negative", counters: counters(), events: [], status: 402, classification: "invalid-challenge", responseSha256: hash, challenge: true, receiptSha256: null, receiptValid: false, wrapperCalls: 1, wire };
  assert.deepEqual(await deliver(result), result);
  for (const invalid of [{ decodedAssetSha256: "bad" }, { payloadBeforeSha256: undefined }, { payloadAfterSha256: undefined }, { transmittedSha256: hash }]) {
    const changed = { ...wire, ...invalid }; for (const key of Object.keys(changed)) if (changed[key] === undefined) delete changed[key];
    await assert.rejects(deliver({ ...result, wire: changed }), /IPC_MESSAGE_REJECTED/);
  }
  const change = { caseId: "wrong-decimals", stage: "negative", field: "request.methodDetails.decimals", beforeSha256: hash, afterSha256: "2".repeat(64), envelopeBeforeSha256: hash, envelopeAfterSha256: hash, unchangedBeforeSha256: hash, unchangedAfterSha256: hash, decodedAssetSha256: hash, decodedDecimals: 18, codecOwner: "mppx@0.8.19", decoder: "Challenge.fromResponse", encoder: "Challenge.serialize" };
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], offerChanges: [change] };
  assert.deepEqual(await deliver(snapshot), snapshot);
  for (const invalid of [{ decodedAssetSha256: "bad" }, { decodedDecimals: 6 }, { afterSha256: hash }]) await assert.rejects(deliver({ ...snapshot, offerChanges: [{ ...change, ...invalid }] }), /IPC_MESSAGE_REJECTED/);
});
test("receipt-mismatch final rows bind protocol-applicable closed catalogs", () => {
  const all = ["wrong-receipt-network", "wrong-receipt-transaction", "wrong-chain", "wrong-contract", "wrong-payer", "wrong-payee", "wrong-amount", "wrong-nonce", "wrong-validity", "wrong-call", "missing-transfer", "missing-authorization-used", "noncanonical-block", "failed-receipt", "transaction-hash-mismatch"];
  assert.deepEqual(ipc.currentReceiptMismatchCases.x402, Object.freeze(all));
  assert.deepEqual(ipc.currentReceiptMismatchCases.mpp, Object.freeze(all.slice(1)));
  for (const [fixture, version, protocol] of [["x402-2.23", "2.23.0", "x402"], ["x402-2.22", "2.22.0", "x402"], ["mppx-0.8.19", "0.8.19", "mpp"], ["mppx-0.8.17", "0.8.17", "mpp"]]) {
    const profile = ipc.resolveFinalReceiptMismatchProfile(fixture, `${fixture}-receipt-mismatch`, "final-7b");
    assert.deepEqual([profile.fixture, profile.version, profile.protocol, profile.row], [fixture, version, protocol, `${fixture}-receipt-mismatch`]);
    assert.equal(profile.catalog, ipc.currentReceiptMismatchCases[protocol]);
  }
  for (const invalid of [["x402-2.21", "x402-2.21-receipt-mismatch", "final-7b"], ["mppx-0.8.18", "mppx-0.8.18-receipt-mismatch", "final-7b"], ["x402-2.23", "x402-2.23-unverified-receipt", "final-7b"], ["mppx-0.8.19", "mppx-0.8.19-receipt-mismatch", "development-only"]]) assert.throws(() => ipc.resolveFinalReceiptMismatchProfile(...invalid), /FINAL_RECEIPT_MISMATCH_PROFILE_REJECTED/);
});
test("receipt-mismatch final IPC admits only protocol-applicable buyer cases", async () => {
  const x402 = { condition: "import", protocol: "x402", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", receiptMismatchFinal: true, receiptStage: "negative" };
  for (const receiptCaseId of ["wrong-receipt-network", "wrong-receipt-transaction", "wrong-chain", "wrong-contract", "wrong-payer", "wrong-payee", "wrong-amount", "wrong-nonce", "wrong-validity", "wrong-call", "missing-transfer", "missing-authorization-used", "noncanonical-block", "failed-receipt", "transaction-hash-mismatch"]) for (const receiptStage of ["negative", "proof"]) { const config={...x402,receiptCaseId,receiptStage}; assert.deepEqual(await deliver({type:"identify",config}),{type:"identify",config}); }
  const mpp={...x402,protocol:"mpp"}; for (const receiptCaseId of ["wrong-receipt-transaction", "wrong-chain", "wrong-contract", "wrong-payer", "wrong-payee", "wrong-amount", "wrong-nonce", "wrong-validity", "wrong-call", "missing-transfer", "missing-authorization-used", "noncanonical-block", "failed-receipt", "transaction-hash-mismatch"]) for (const receiptStage of ["negative", "proof"]) { const config={...mpp,receiptCaseId,receiptStage}; assert.deepEqual(await deliver({type:"identify",config}),{type:"identify",config}); }
  for (const config of [{...mpp,receiptCaseId:"wrong-receipt-network"},{...x402,receiptMismatchFinal:false,receiptCaseId:"wrong-chain"},{...x402,payBuyer:false,receiptCaseId:"wrong-chain"},{...x402,receiptCaseId:"wrong-chain",unverifiedReceiptFinal:true}]) await assert.rejects(deliver({type:"identify",config}),/IPC_MESSAGE_REJECTED/);
});
test("receipt-mismatch final dispatcher is isolated from the development receipt slice", async () => {
  const [driver, faults, integration] = await Promise.all([readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8"), readFile(new URL("../fixtures/runtime/faults.mjs", import.meta.url), "utf8"), readFile(new URL("./integration/native-receipt-mismatch-final.mjs", import.meta.url), "utf8")]);
  assert.match(driver, /receipt-mismatch-controls/); assert.match(driver, /resolveFinalReceiptMismatchProfile/); assert.match(driver, /runCurrentReceiptMismatch/);
  assert.match(faults, /export async function runCurrentReceiptMismatch/); assert.match(faults, /receiptMismatchFinal: true/);
  assert.match(integration, /const row = `\$\{input\.fixture\}-receipt-mismatch`/); assert.match(integration, /timeoutMs: 60000/);
});
test("unverified-receipt final rows bind one closed catalog to four profiles", () => {
  assert.deepEqual(ipc.currentUnverifiedReceiptCases, Object.freeze(["rpc-unavailable", "rpc-invalid-response", "audited-verifier-false", "audited-verifier-throws"]));
  for (const [fixture, version, protocol] of [["x402-2.23", "2.23.0", "x402"], ["x402-2.22", "2.22.0", "x402"], ["mppx-0.8.19", "0.8.19", "mpp"], ["mppx-0.8.17", "0.8.17", "mpp"]]) {
    const profile = ipc.resolveFinalUnverifiedReceiptProfile(fixture, `${fixture}-unverified-receipt`, "final-7b");
    assert.deepEqual([profile.fixture, profile.version, profile.protocol, profile.row], [fixture, version, protocol, `${fixture}-unverified-receipt`]);
    assert.equal(profile.catalog, ipc.currentUnverifiedReceiptCases);
  }
  for (const invalid of [["x402-2.21", "x402-2.21-unverified-receipt", "final-7b"], ["mppx-0.8.18", "mppx-0.8.18-unverified-receipt", "final-7b"], ["x402-2.23", "x402-2.23-receipt-mismatch", "final-7b"], ["mppx-0.8.19", "mppx-0.8.19-unverified-receipt", "development-only"]]) assert.throws(() => ipc.resolveFinalUnverifiedReceiptProfile(...invalid), /FINAL_UNVERIFIED_RECEIPT_PROFILE_REJECTED/);
});
test("unverified-receipt final IPC admits only its four buyer cases", async () => {
  const base = { condition: "import", protocol: "x402", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", unverifiedReceiptFinal: true, receiptStage: "negative" };
  for (const receiptCaseId of ["rpc-unavailable", "rpc-invalid-response", "audited-verifier-false", "audited-verifier-throws"]) for (const receiptStage of ["negative", "proof"]) {
    const config = { ...base, receiptCaseId, receiptStage }; assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
    const mpp = { ...config, protocol: "mpp" }; assert.deepEqual(await deliver({ type: "identify", config: mpp }), { type: "identify", config: mpp });
  }
  for (const invalid of [{ unverifiedReceiptFinal: false, receiptCaseId: "rpc-unavailable" }, { receiptCaseId: "absent" }, { payBuyer: false, receiptCaseId: "rpc-unavailable" }, { receiptCaseId: "rpc-unavailable", receiptAbsentMalformedFinal: true }]) await assert.rejects(deliver({ type: "identify", config: { ...base, ...invalid } }), /IPC_MESSAGE_REJECTED/);
});
test("unverified-receipt final dispatcher is isolated from the development receipt slice", async () => {
  const [driver, faults, integration] = await Promise.all([
    readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8"),
    readFile(new URL("../fixtures/runtime/faults.mjs", import.meta.url), "utf8"),
    readFile(new URL("./integration/native-unverified-receipt-final.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(driver, /unverified-receipt-controls/); assert.match(driver, /resolveFinalUnverifiedReceiptProfile/); assert.match(driver, /runCurrentUnverifiedReceipt/);
  assert.match(faults, /export async function runCurrentUnverifiedReceipt/); assert.match(faults, /unverifiedReceiptFinal: true/);
  assert.match(integration, /const row = `\$\{input\.fixture\}-unverified-receipt`/); assert.match(integration, /timeoutMs: 60000/);
});
test("receipt-absent-malformed final rows bind one closed catalog to four profiles", () => {
  assert.deepEqual(ipc.currentReceiptAbsentMalformedCases, Object.freeze(["absent", "invalid-base64", "invalid-json", "wrong-protocol-header", "malformed-required-field"]));
  for (const [fixture, version, protocol] of [["x402-2.23", "2.23.0", "x402"], ["x402-2.22", "2.22.0", "x402"], ["mppx-0.8.19", "0.8.19", "mpp"], ["mppx-0.8.17", "0.8.17", "mpp"]]) {
    const profile = ipc.resolveFinalReceiptAbsentMalformedProfile(fixture, `${fixture}-receipt-absent-malformed`, "final-7b");
    assert.deepEqual([profile.fixture, profile.version, profile.protocol, profile.row], [fixture, version, protocol, `${fixture}-receipt-absent-malformed`]);
    assert.equal(profile.catalog, ipc.currentReceiptAbsentMalformedCases);
  }
  for (const invalid of [["x402-2.21", "x402-2.21-receipt-absent-malformed", "final-7b"], ["mppx-0.8.18", "mppx-0.8.18-receipt-absent-malformed", "final-7b"], ["x402-2.23", "x402-2.23-receipt-mismatch", "final-7b"], ["mppx-0.8.19", "mppx-0.8.19-receipt-absent-malformed", "development-only"]]) assert.throws(() => ipc.resolveFinalReceiptAbsentMalformedProfile(...invalid), /FINAL_RECEIPT_ABSENT_MALFORMED_PROFILE_REJECTED/);
});
test("receipt-absent-malformed final IPC admits only its five buyer cases", async () => {
  const base = { condition: "import", protocol: "x402", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", receiptAbsentMalformedFinal: true, receiptStage: "negative" };
  for (const receiptCaseId of ["absent", "invalid-base64", "invalid-json", "wrong-protocol-header", "malformed-required-field"]) for (const receiptStage of ["negative", "proof"]) {
    const config = { ...base, receiptCaseId, receiptStage }; assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
    const mpp = { ...config, protocol: "mpp" }; assert.deepEqual(await deliver({ type: "identify", config: mpp }), { type: "identify", config: mpp });
  }
  for (const invalid of [{ receiptAbsentMalformedFinal: false, receiptCaseId: "absent" }, { receiptCaseId: "wrong-receipt-transaction" }, { payBuyer: false, receiptCaseId: "absent" }, { receiptCaseId: "absent", handlerFailureFinal: true }]) await assert.rejects(deliver({ type: "identify", config: { ...base, ...invalid } }), /IPC_MESSAGE_REJECTED/);
});
test("receipt-absent-malformed final dispatcher is isolated from the development receipt slice", async () => {
  const [driver, faults, integration] = await Promise.all([
    readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8"),
    readFile(new URL("../fixtures/runtime/faults.mjs", import.meta.url), "utf8"),
    readFile(new URL("./integration/native-receipt-absent-malformed-final.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(driver, /receipt-absent-malformed-controls/); assert.match(driver, /resolveFinalReceiptAbsentMalformedProfile/); assert.match(driver, /runCurrentReceiptAbsentMalformed/);
  assert.match(faults, /export async function runCurrentReceiptAbsentMalformed/); assert.match(faults, /receiptAbsentMalformedFinal: true/);
  assert.match(integration, /const row = `\$\{input\.fixture\}-receipt-absent-malformed`/); assert.match(integration, /timeoutMs: 60000/);
});
test("handler-failure final rows bind one closed catalog to four physical profiles", () => {
  assert.deepEqual(ipc.currentHandlerFailureCases, Object.freeze(["handler-throws", "handler-500", "handler-400", "handler-404", "handler-302", "handler-200", "fulfillment-failed-after-handler-failure"]));
  for (const [fixture, version, protocol] of [["x402-2.23", "2.23.0", "x402"], ["x402-2.22", "2.22.0", "x402"], ["mppx-0.8.19", "0.8.19", "mpp"], ["mppx-0.8.17", "0.8.17", "mpp"]]) {
    const profile = ipc.resolveFinalHandlerFailureProfile(fixture, `${fixture}-handler-failure`, "final-7b");
    assert.deepEqual([profile.fixture, profile.version, profile.protocol, profile.row], [fixture, version, protocol, `${fixture}-handler-failure`]);
    assert.equal(profile.catalog, ipc.currentHandlerFailureCases);
  }
  for (const invalid of [["x402-2.21", "x402-2.21-handler-failure", "final-7b"], ["mppx-0.8.18", "mppx-0.8.18-handler-failure", "final-7b"], ["x402-2.23", "x402-2.23-fulfillment-failure", "final-7b"], ["mppx-0.8.19", "mppx-0.8.19-handler-failure", "development-only"]]) assert.throws(() => ipc.resolveFinalHandlerFailureProfile(...invalid), /FINAL_HANDLER_FAILURE_PROFILE_REJECTED/);
});
test("handler-failure final IPC admits only its seven seller cases", async () => {
  const base = { condition: "import", protocol: "x402", payBuyer: false, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", handlerFailureFinal: true };
  for (const sellerCaseId of ["handler-throws", "handler-500", "handler-400", "handler-404", "handler-302", "handler-200", "fulfillment-failed-after-handler-failure"]) {
    const config = { ...base, sellerCaseId }; assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
    const mpp = { ...config, protocol: "mpp" }; assert.deepEqual(await deliver({ type: "identify", config: mpp }), { type: "identify", config: mpp });
  }
  for (const invalid of [{ handlerFailureFinal: false, sellerCaseId: "handler-500" }, { sellerCaseId: "fulfillment-http-503" }, { payBuyer: true, sellerCaseId: "handler-500" }, { sellerCaseId: "handler-500", supportedFailureFinal: true }]) await assert.rejects(deliver({ type: "identify", config: { ...base, ...invalid } }), /IPC_MESSAGE_REJECTED/);
});
test("handler-failure final dispatcher is isolated from the development seller slice", async () => {
  const [driver, faults, integration] = await Promise.all([
    readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8"),
    readFile(new URL("../fixtures/runtime/faults.mjs", import.meta.url), "utf8"),
    readFile(new URL("./integration/native-handler-failure-final.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(driver, /handler-failure-controls/); assert.match(driver, /resolveFinalHandlerFailureProfile/); assert.match(driver, /runCurrentHandlerFailure/);
  assert.match(faults, /export async function runCurrentHandlerFailure/); assert.match(faults, /handlerFailureFinal: true/);
  assert.match(integration, /const row = `\$\{input\.fixture\}-handler-failure`/); assert.match(integration, /timeoutMs: 60000/);
});
test("fulfillment-failure final rows bind one closed catalog to four physical profiles", () => {
  assert.deepEqual(ipc.currentFulfillmentFailureCases, Object.freeze(["fulfillment-http-503", "fulfillment-disconnect", "fulfillment-timeout", "fulfillment-unexpected-2xx"]));
  for (const [fixture, version, protocol] of [["x402-2.23", "2.23.0", "x402"], ["x402-2.22", "2.22.0", "x402"], ["mppx-0.8.19", "0.8.19", "mpp"], ["mppx-0.8.17", "0.8.17", "mpp"]]) {
    const profile = ipc.resolveFinalFulfillmentFailureProfile(fixture, `${fixture}-fulfillment-failure`, "final-7b");
    assert.deepEqual([profile.fixture, profile.version, profile.protocol, profile.row], [fixture, version, protocol, `${fixture}-fulfillment-failure`]);
    assert.equal(profile.catalog, ipc.currentFulfillmentFailureCases);
  }
  for (const invalid of [["x402-2.21", "x402-2.21-fulfillment-failure", "final-7b"], ["mppx-0.8.18", "mppx-0.8.18-fulfillment-failure", "final-7b"], ["x402-2.23", "x402-2.23-handler-failure", "final-7b"], ["mppx-0.8.19", "mppx-0.8.19-fulfillment-failure", "development-only"]]) assert.throws(() => ipc.resolveFinalFulfillmentFailureProfile(...invalid), /FINAL_FULFILLMENT_FAILURE_PROFILE_REJECTED/);
});
test("fulfillment-failure final IPC admits only its four seller cases", async () => {
  const base = { condition: "import", protocol: "x402", payBuyer: false, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", fulfillmentFailureFinal: true };
  for (const sellerCaseId of ["fulfillment-http-503", "fulfillment-disconnect", "fulfillment-timeout", "fulfillment-unexpected-2xx"]) {
    const config = { ...base, sellerCaseId }; assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
    const mpp = { ...config, protocol: "mpp" }; assert.deepEqual(await deliver({ type: "identify", config: mpp }), { type: "identify", config: mpp });
  }
  for (const invalid of [{ fulfillmentFailureFinal: false, sellerCaseId: "fulfillment-http-503" }, { sellerCaseId: "handler-500" }, { payBuyer: true, sellerCaseId: "fulfillment-http-503" }, { sellerCaseId: "fulfillment-http-503", handlerFailureFinal: true }]) await assert.rejects(deliver({ type: "identify", config: { ...base, ...invalid } }), /IPC_MESSAGE_REJECTED/);
});
test("fulfillment-failure final dispatcher is isolated from the development seller slice", async () => {
  const [driver, faults, integration] = await Promise.all([
    readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8"),
    readFile(new URL("../fixtures/runtime/faults.mjs", import.meta.url), "utf8"),
    readFile(new URL("./integration/native-fulfillment-failure-final.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(driver, /fulfillment-failure-controls/); assert.match(driver, /resolveFinalFulfillmentFailureProfile/); assert.match(driver, /runCurrentFulfillmentFailure/);
  assert.match(faults, /export async function runCurrentFulfillmentFailure/); assert.match(faults, /fulfillmentFailureFinal: true/);
  assert.match(integration, /const row = `\$\{input\.fixture\}-fulfillment-failure`/); assert.match(integration, /timeoutMs: 60000/);
});
test("standard-wire-receipt final rows bind protocol-specific catalogs to four physical owners", () => {
  assert.deepEqual(ipc.currentStandardWireReceiptCases, Object.freeze({
    x402: Object.freeze(["official-decoder-positive", "private-envelope-excluded", "private-payment-id-excluded"]),
    mpp: Object.freeze(["official-decoder-positive", "private-envelope-excluded", "private-payment-id-excluded", "direct-wrapper-2xx-positive", "direct-wrapper-non2xx-negative"]),
  }));
  for (const [fixture, version, protocol] of [["x402-2.23", "2.23.0", "x402"], ["x402-2.22", "2.22.0", "x402"], ["mppx-0.8.19", "0.8.19", "mpp"], ["mppx-0.8.17", "0.8.17", "mpp"]]) {
    const profile = ipc.resolveFinalStandardWireReceiptProfile(fixture, `${fixture}-standard-wire-receipt`, "final-7b");
    assert.deepEqual([profile.fixture, profile.version, profile.protocol, profile.row], [fixture, version, protocol, `${fixture}-standard-wire-receipt`]);
    assert.equal(profile.catalog, ipc.currentStandardWireReceiptCases[protocol]);
  }
  for (const invalid of [["x402-2.21", "x402-2.21-standard-wire-receipt", "final-7b"], ["mppx-0.8.18", "mppx-0.8.18-standard-wire-receipt", "final-7b"], ["x402-2.23", "x402-2.23-handler-failure", "final-7b"], ["mppx-0.8.19", "mppx-0.8.19-standard-wire-receipt", "development-only"]]) assert.throws(() => ipc.resolveFinalStandardWireReceiptProfile(...invalid), /FINAL_STANDARD_WIRE_RECEIPT_PROFILE_REJECTED/);
});
test("malformed-ambiguous-offer final rows bind the closed 7B aggregate and exclude the MPP corpus", () => {
  assert.deepEqual(ipc.currentMalformedAmbiguousOfferCases, Object.freeze({
    x402: Object.freeze({
      offer: Object.freeze(["header-invalid-base64", "header-invalid-json", "unsupported-scheme"]),
      preflight: Object.freeze(["request-body-read-failure", "body-not-replayable"]),
      dual: Object.freeze(["dual-valid-offer-prefer-x402", "dual-valid-offer-prefer-mpp", "duplicate-incompatible-offers"]),
      wire: Object.freeze(["both-credential-headers", "selected-malformed-credential"]),
      decoder: Object.freeze(["credential-invalid-encoding", "credential-invalid-json"]),
    }),
    mpp: Object.freeze({
      offer: Object.freeze(["header-invalid-base64", "header-invalid-json"]),
      preflight: Object.freeze(["request-body-read-failure", "body-not-replayable"]),
      dual: Object.freeze(["dual-valid-offer-prefer-x402", "dual-valid-offer-prefer-mpp", "duplicate-incompatible-offers"]),
      wire: Object.freeze(["both-credential-headers", "selected-malformed-credential"]),
      decoder: Object.freeze(["credential-invalid-encoding", "credential-invalid-json"]),
    }),
  }));
  for (const [fixture, version, protocol] of [["x402-2.23", "2.23.0", "x402"], ["x402-2.22", "2.22.0", "x402"], ["mppx-0.8.19", "0.8.19", "mpp"], ["mppx-0.8.17", "0.8.17", "mpp"]]) {
    const profile = ipc.resolveFinalMalformedAmbiguousOfferProfile(fixture, `${fixture}-malformed-ambiguous-offer`, "final-7b");
    assert.deepEqual([profile.fixture, profile.version, profile.protocol, profile.row], [fixture, version, protocol, `${fixture}-malformed-ambiguous-offer`]);
    assert.equal(profile.catalog, ipc.currentMalformedAmbiguousOfferCases[protocol]);
  }
  for (const invalid of [["x402-2.21", "x402-2.21-malformed-ambiguous-offer", "final-7b"], ["mppx-0.8.18", "mppx-0.8.18-malformed-ambiguous-offer", "final-7b"], ["x402-2.23", "x402-2.23-network-mismatch", "final-7b"], ["mppx-0.8.19", "mppx-0.8.19-malformed-ambiguous-offer", "development-only"]]) assert.throws(() => ipc.resolveFinalMalformedAmbiguousOfferProfile(...invalid), /FINAL_MALFORMED_AMBIGUOUS_OFFER_PROFILE_REJECTED/);
});
test("malformed-ambiguous-offer final dispatcher is isolated from development slices", async () => {
  const [driver, faults, integration] = await Promise.all([readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8"), readFile(new URL("../fixtures/runtime/faults.mjs", import.meta.url), "utf8"), readFile(new URL("./integration/native-malformed-ambiguous-offer-final.mjs", import.meta.url), "utf8")]);
  assert.match(driver, /malformed-ambiguous-offer-controls/); assert.match(driver, /resolveFinalMalformedAmbiguousOfferProfile/); assert.match(driver, /runCurrentMalformedAmbiguousOffer/);
  assert.match(faults, /export async function runCurrentMalformedAmbiguousOffer/); assert.match(integration, /malformed-ambiguous-offer-controls/);
});
test("MPP malformed corpus has a dedicated final dispatcher and redacted integration", async () => {
  const [driver, integration] = await Promise.all([readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8"), readFile(new URL("./integration/native-mpp-malformed-corpus-final.mjs", import.meta.url), "utf8")]);
  assert.match(driver, /mpp-malformed-corpus-controls/); assert.match(driver, /family === "native-corpus"/); assert.match(driver, /mpp-malformed-probe\.mjs/); assert.match(driver, /bodySha256/); assert.match(driver, /headersSha256/);
  assert.match(integration, /mpp-malformed-corpus-controls/); assert.match(integration, /104/); assert.doesNotMatch(integration, /observed\.body|observed\.headers/);
});
test("standard-wire-receipt seller IPC is exclusive and final dispatcher is present", async () => {
  const base = { condition: "import", protocol: "x402", payBuyer: false, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", standardWireReceiptFinal: true, standardReceiptCaseId: "official-decoder-positive", sellerCaseId: "handler-200" };
  assert.deepEqual(await deliver({ type: "identify", config: base }), { type: "identify", config: base });
  assert.deepEqual(await deliver({ type: "identify", config: { ...base, protocol: "mpp", standardReceiptCaseId: "private-envelope-excluded" } }), { type: "identify", config: { ...base, protocol: "mpp", standardReceiptCaseId: "private-envelope-excluded" } });
  for (const invalid of [{ standardWireReceiptFinal: false }, { sellerCaseId: "handler-500" }, { standardReceiptCaseId: "direct-wrapper-2xx-positive" }, { payBuyer: true }, { handlerFailureFinal: true }]) await assert.rejects(deliver({ type: "identify", config: { ...base, ...invalid } }), /IPC_MESSAGE_REJECTED/);
  const [driver, faults, integration] = await Promise.all([readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8"), readFile(new URL("../fixtures/runtime/faults.mjs", import.meta.url), "utf8"), readFile(new URL("./integration/native-standard-wire-receipt-final.mjs", import.meta.url), "utf8")]);
  assert.match(driver, /standard-wire-receipt-controls/); assert.match(driver, /runCurrentStandardWireReceipt/); assert.match(faults, /standardWireReceiptFinal: true/); assert.match(integration, /standard-wire-receipt-controls/);
});
test("supported-failure final rows bind one protocol catalog to four physical owners", () => {
  assert.deepEqual(ipc.currentSupportedFailureCases, Object.freeze({
    x402: Object.freeze({ seller: Object.freeze(["S-supported-timeout", "S-supported-invalid-json", "S-supported-invalid-shape"]), direct: Object.freeze(["X-supported-timeout", "X-supported-invalid-json", "X-supported-invalid-shape"]) }),
    mpp: Object.freeze({ seller: Object.freeze(["S-supported-timeout", "S-supported-invalid-json", "S-supported-invalid-shape", "S-mpp-only-nondependency-positive"]) }),
  }));
  for (const [fixture, version, protocol] of [["x402-2.23", "2.23.0", "x402"], ["x402-2.22", "2.22.0", "x402"], ["mppx-0.8.19", "0.8.19", "mpp"], ["mppx-0.8.17", "0.8.17", "mpp"]]) {
    const profile = ipc.resolveFinalSupportedFailureProfile(fixture, `${fixture}-supported-failure`, "final-7b");
    assert.deepEqual([profile.fixture, profile.version, profile.protocol, profile.row], [fixture, version, protocol, `${fixture}-supported-failure`]);
    assert.deepEqual(profile.catalog, ipc.currentSupportedFailureCases[protocol]);
  }
  for (const invalid of [["x402-2.21", "x402-2.21-supported-failure", "final-7b"], ["mppx-0.8.18", "mppx-0.8.18-supported-failure", "final-7b"], ["x402-2.23", "x402-2.23-network-mismatch", "final-7b"], ["mppx-0.8.19", "mppx-0.8.19-supported-failure", "development-only"]]) assert.throws(() => ipc.resolveFinalSupportedFailureProfile(...invalid), /FINAL_SUPPORTED_FAILURE_PROFILE_REJECTED/);
});
test("supported-failure final IPC admits only its protocol-specific controls", async () => {
  const base = { condition: "import", protocol: "x402", payBuyer: false, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", supportedFailureFinal: true };
  for (const supportCaseId of ["S-supported-timeout", "S-supported-invalid-json", "S-supported-invalid-shape", "X-supported-timeout", "X-supported-invalid-json", "X-supported-invalid-shape"]) for (const supportStage of ["negative", "positive"]) {
    const config = { ...base, supportCaseId, supportStage }; assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
  }
  for (const supportCaseId of ["S-supported-timeout", "S-supported-invalid-json", "S-supported-invalid-shape"]) for (const supportStage of ["negative", "positive"]) {
    const config = { ...base, protocol: "mpp", supportCaseId, supportStage }; assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
  }
  const mppOnly = { ...base, protocol: "mpp", supportCaseId: "S-mpp-only-nondependency-positive", supportStage: "positive" }; assert.deepEqual(await deliver({ type: "identify", config: mppOnly }), { type: "identify", config: mppOnly });
  for (const invalid of [{ supportedFailureFinal: false }, { protocol: "mpp", supportCaseId: "X-supported-timeout", supportStage: "negative" }, { supportCaseId: "S-mpp-only-nondependency-positive", supportStage: "positive" }, { protocol: "mpp", supportCaseId: "S-mpp-only-nondependency-positive", supportStage: "negative" }, { payBuyer: true, supportCaseId: "S-supported-timeout", supportStage: "negative" }, { supportCaseId: "S-supported-timeout", supportStage: "negative", wireCaseId: "credential-offer-chain-mismatch" }])
    await assert.rejects(deliver({ type: "identify", config: { ...base, ...invalid } }), /IPC_MESSAGE_REJECTED/);
});
test("x402 payee mismatch final rows bind one catalog to two explicit physical owners", () => {
  assert.deepEqual(ipc.currentX402PayeeMismatchCases, Object.freeze({
    offer: Object.freeze(["invalid-recipient-offer"]),
    wire: Object.freeze(["credential-offer-recipient-mismatch"]),
  }));
  const current = ipc.resolveFinalX402PayeeMismatchProfile(
    "x402-2.23",
    "x402-2.23-payee-mismatch",
    "final-7b",
  );
  const nminus1 = ipc.resolveFinalX402PayeeMismatchProfile(
    "x402-2.22",
    "x402-2.22-payee-mismatch",
    "final-7b",
  );
  assert.deepEqual(current, {
    fixture: "x402-2.23",
    row: "x402-2.23-payee-mismatch",
    version: "2.23.0",
    owner: "@x402/evm@2.23.0",
    codecOwner: "@x402/core@2.23.0",
    catalog: ipc.currentX402PayeeMismatchCases,
  });
  assert.deepEqual(nminus1, {
    fixture: "x402-2.22",
    row: "x402-2.22-payee-mismatch",
    version: "2.22.0",
    owner: "@x402/evm@2.22.0",
    codecOwner: "@x402/core@2.22.0",
    catalog: ipc.currentX402PayeeMismatchCases,
  });
  assert.equal(current.catalog, ipc.currentX402PayeeMismatchCases);
  assert.equal(nminus1.catalog, ipc.currentX402PayeeMismatchCases);
  for (const invalid of [
    ["x402-2.21", "x402-2.21-payee-mismatch", "final-7b"],
    ["mppx-0.8.19", "mppx-0.8.19-payee-mismatch", "final-7b"],
    ["x402-2.23", "x402-2.23-amount-mismatch", "final-7b"],
    ["x402-2.23", "x402-2.23-payee-mismatch", "development-only"],
  ]) assert.throws(
    () => ipc.resolveFinalX402PayeeMismatchProfile(...invalid),
    /FINAL_PAYEE_MISMATCH_PROFILE_REJECTED/,
  );
});
test("x402 2.23 payee mismatch final role admits only its two payee paths", async () => {
  const base = { condition: "import", protocol: "x402", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", payeeMismatchFinal: true };
  for (const config of [
    { ...base, offerCaseId: "invalid-recipient-offer", offerStage: "negative" },
    { ...base, offerCaseId: "invalid-recipient-offer", offerStage: "positive" },
    { ...base, payBuyer: false, wireCaseId: "credential-offer-recipient-mismatch", wireStage: "negative" },
    { ...base, payBuyer: false, wireCaseId: "credential-offer-recipient-mismatch", wireStage: "positive" },
  ]) assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
  for (const config of [
    { ...base, protocol: "mpp", offerCaseId: "invalid-recipient-offer", offerStage: "negative" },
    { ...base, offerCaseId: "above-ceiling", offerStage: "negative" },
    { ...base, payBuyer: false, wireCaseId: "credential-offer-amount-mismatch", wireStage: "negative" },
    { ...base },
    { ...base, payeeMismatchFinal: false, offerCaseId: "invalid-recipient-offer", offerStage: "negative" },
    { ...base, offerCaseId: "invalid-recipient-offer", offerStage: "negative", amountMismatchFinal: true },
  ]) await assert.rejects(deliver({ type: "identify", config }), /IPC_MESSAGE_REJECTED/);
});
test("mppx current and N-1 payee mismatch final rows bind one catalog to explicit physical owners", () => {
  assert.deepEqual(ipc.currentMppPayeeMismatchCases, Object.freeze({
    offer: Object.freeze(["invalid-recipient-offer"]),
    wire: Object.freeze(["credential-offer-recipient-mismatch"]),
  }));
  const current = ipc.resolveFinalMppPayeeMismatchProfile(
    "mppx-0.8.19",
    "mppx-0.8.19-payee-mismatch",
    "final-7b",
  );
  assert.deepEqual(current, {
    fixture: "mppx-0.8.19",
    row: "mppx-0.8.19-payee-mismatch",
    version: "0.8.19",
    owner: "mppx@0.8.19",
    codecOwner: "mppx@0.8.19",
    catalog: ipc.currentMppPayeeMismatchCases,
  });
  const nMinusOne = ipc.resolveFinalMppPayeeMismatchProfile(
    "mppx-0.8.17",
    "mppx-0.8.17-payee-mismatch",
    "final-7b",
  );
  assert.deepEqual(nMinusOne, {
    fixture: "mppx-0.8.17",
    row: "mppx-0.8.17-payee-mismatch",
    version: "0.8.17",
    owner: "mppx@0.8.17",
    codecOwner: "mppx@0.8.17",
    catalog: ipc.currentMppPayeeMismatchCases,
  });
  for (const invalid of [
    ["mppx-0.8.18", "mppx-0.8.18-payee-mismatch", "final-7b"],
    ["x402-2.23", "x402-2.23-payee-mismatch", "final-7b"],
    ["mppx-0.8.19", "mppx-0.8.19-network-mismatch", "final-7b"],
    ["mppx-0.8.19", "mppx-0.8.19-payee-mismatch", "development-only"],
  ]) assert.throws(
    () => ipc.resolveFinalMppPayeeMismatchProfile(...invalid),
    /FINAL_MPP_PAYEE_MISMATCH_PROFILE_REJECTED/,
  );
});
test("mppx 0.8.19 payee mismatch final role admits only its two payee paths", async () => {
  const base = { condition: "import", protocol: "mpp", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", mppPayeeMismatchFinal: true };
  for (const config of [
    { ...base, offerCaseId: "invalid-recipient-offer", offerStage: "negative" },
    { ...base, offerCaseId: "invalid-recipient-offer", offerStage: "positive" },
    { ...base, payBuyer: false, wireCaseId: "credential-offer-recipient-mismatch", wireStage: "negative" },
    { ...base, payBuyer: false, wireCaseId: "credential-offer-recipient-mismatch", wireStage: "positive" },
  ]) assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
  for (const config of [
    { ...base, protocol: "x402", offerCaseId: "invalid-recipient-offer", offerStage: "negative" },
    { ...base, offerCaseId: "above-ceiling", offerStage: "negative" },
    { ...base, payBuyer: false, wireCaseId: "credential-offer-amount-mismatch", wireStage: "negative" },
    { ...base },
    { ...base, mppPayeeMismatchFinal: false, offerCaseId: "invalid-recipient-offer", offerStage: "negative" },
    { ...base, offerCaseId: "invalid-recipient-offer", offerStage: "negative", mppNetworkMismatchFinal: true },
  ]) await assert.rejects(deliver({ type: "identify", config }), /IPC_MESSAGE_REJECTED/);
});
test("mppx current and N-1 amount mismatch final rows bind one catalog to explicit physical owners", () => {
  assert.deepEqual(ipc.currentMppAmountMismatchCases, Object.freeze({
    offer: Object.freeze(["above-ceiling", "negative", "non-integer-atomic", "malformed-price"]),
    wire: Object.freeze(["credential-offer-amount-mismatch"]),
  }));
  for (const [fixture, version] of [["mppx-0.8.19", "0.8.19"], ["mppx-0.8.17", "0.8.17"]]) {
    assert.deepEqual(ipc.resolveFinalMppAmountMismatchProfile(fixture, `${fixture}-amount-mismatch`, "final-7b"), {
      fixture,
      row: `${fixture}-amount-mismatch`,
      version,
      owner: `mppx@${version}`,
      codecOwner: `mppx@${version}`,
      catalog: ipc.currentMppAmountMismatchCases,
    });
  }
  for (const invalid of [
    ["mppx-0.8.18", "mppx-0.8.18-amount-mismatch", "final-7b"],
    ["x402-2.23", "x402-2.23-amount-mismatch", "final-7b"],
    ["mppx-0.8.19", "mppx-0.8.19-payee-mismatch", "final-7b"],
    ["mppx-0.8.19", "mppx-0.8.19-amount-mismatch", "development-only"],
  ]) assert.throws(() => ipc.resolveFinalMppAmountMismatchProfile(...invalid), /FINAL_MPP_AMOUNT_MISMATCH_PROFILE_REJECTED/);
});
test("MPP amount mismatch final role admits only its five amount paths", async () => {
  const base = { condition: "import", protocol: "mpp", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", mppAmountMismatchFinal: true };
  for (const caseId of ["above-ceiling", "negative", "non-integer-atomic", "malformed-price"]) for (const offerStage of ["negative", "positive"]) {
    const config = { ...base, offerCaseId: caseId, offerStage };
    assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
  }
  for (const wireStage of ["negative", "positive"]) {
    const config = { ...base, payBuyer: false, wireCaseId: "credential-offer-amount-mismatch", wireStage };
    assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
  }
  for (const config of [
    { ...base, protocol: "x402", offerCaseId: "above-ceiling", offerStage: "negative" },
    { ...base, offerCaseId: "invalid-recipient-offer", offerStage: "negative" },
    { ...base, payBuyer: false, wireCaseId: "credential-offer-recipient-mismatch", wireStage: "negative" },
    { ...base },
    { ...base, mppAmountMismatchFinal: false, offerCaseId: "above-ceiling", offerStage: "negative" },
    { ...base, offerCaseId: "above-ceiling", offerStage: "negative", mppPayeeMismatchFinal: true },
  ]) await assert.rejects(deliver({ type: "identify", config }), /IPC_MESSAGE_REJECTED/);
});
test("x402 amount mismatch final rows bind one catalog to two explicit physical owners", () => {
  assert.deepEqual(ipc.currentX402AmountMismatchCases, Object.freeze({
    offer: Object.freeze(["above-ceiling", "negative", "non-integer-atomic", "malformed-price"]),
    wire: Object.freeze(["credential-offer-amount-mismatch"]),
  }));
  const current = ipc.resolveFinalX402AmountMismatchProfile(
    "x402-2.23",
    "x402-2.23-amount-mismatch",
    "final-7b",
  );
  const nminus1 = ipc.resolveFinalX402AmountMismatchProfile(
    "x402-2.22",
    "x402-2.22-amount-mismatch",
    "final-7b",
  );
  assert.deepEqual(current, {
    fixture: "x402-2.23",
    row: "x402-2.23-amount-mismatch",
    version: "2.23.0",
    owner: "@x402/evm@2.23.0",
    codecOwner: "@x402/core@2.23.0",
    catalog: ipc.currentX402AmountMismatchCases,
  });
  assert.deepEqual(nminus1, {
    fixture: "x402-2.22",
    row: "x402-2.22-amount-mismatch",
    version: "2.22.0",
    owner: "@x402/evm@2.22.0",
    codecOwner: "@x402/core@2.22.0",
    catalog: ipc.currentX402AmountMismatchCases,
  });
  assert.equal(current.catalog, ipc.currentX402AmountMismatchCases);
  assert.equal(nminus1.catalog, ipc.currentX402AmountMismatchCases);
  for (const invalid of [
    ["x402-2.21", "x402-2.21-amount-mismatch", "final-7b"],
    ["mppx-0.8.19", "mppx-0.8.19-amount-mismatch", "final-7b"],
    ["x402-2.23", "x402-2.23-network-mismatch", "final-7b"],
    ["x402-2.23", "x402-2.23-amount-mismatch", "development-only"],
  ]) assert.throws(
    () => ipc.resolveFinalX402AmountMismatchProfile(...invalid),
    /FINAL_AMOUNT_MISMATCH_PROFILE_REJECTED/,
  );
});
test("x402 amount mismatch final role admits only its amount paths", async () => {
  const base = { condition: "import", protocol: "x402", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", amountMismatchFinal: true };
  for (const config of [
    { ...base, offerCaseId: "above-ceiling", offerStage: "negative" },
    { ...base, offerCaseId: "negative", offerStage: "positive" },
    { ...base, offerCaseId: "non-integer-atomic", offerStage: "negative" },
    { ...base, offerCaseId: "malformed-price", offerStage: "positive" },
    { ...base, payBuyer: false, wireCaseId: "credential-offer-amount-mismatch", wireStage: "negative" },
  ]) assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
  for (const config of [
    { ...base, protocol: "mpp", offerCaseId: "above-ceiling", offerStage: "negative" },
    { ...base, offerCaseId: "non-usdc-offer", offerStage: "negative" },
    { ...base, payBuyer: false, wireCaseId: "credential-offer-asset-mismatch", wireStage: "negative" },
    { ...base },
    { ...base, amountMismatchFinal: false, offerCaseId: "above-ceiling", offerStage: "negative" },
    { ...base, offerCaseId: "above-ceiling", offerStage: "negative", networkMismatchFinal: true },
  ]) await assert.rejects(deliver({ type: "identify", config }), /IPC_MESSAGE_REJECTED/);
});
test("x402 network mismatch final rows bind one complete path catalog to two explicit physical owners", () => {
  assert.deepEqual(ipc.currentX402NetworkMismatchCases, Object.freeze({
    offer: Object.freeze(["other-base-network-offer", "unsupported-chain-offer"]),
    wire: Object.freeze(["credential-offer-chain-mismatch"]),
    restart: Object.freeze(["pending-open-other-network"]),
  }));
  assert.equal(Object.isFrozen(ipc.currentX402NetworkMismatchCases), true);
  for (const path of ["offer", "wire", "restart"])
    assert.equal(Object.isFrozen(ipc.currentX402NetworkMismatchCases[path]), true);
  const current = ipc.resolveFinalX402NetworkMismatchProfile(
    "x402-2.23",
    "x402-2.23-network-mismatch",
    "final-7b",
  );
  const nminus1 = ipc.resolveFinalX402NetworkMismatchProfile(
    "x402-2.22",
    "x402-2.22-network-mismatch",
    "final-7b",
  );
  assert.deepEqual(current, {
    fixture: "x402-2.23",
    row: "x402-2.23-network-mismatch",
    version: "2.23.0",
    owner: "@x402/evm@2.23.0",
    codecOwner: "@x402/core@2.23.0",
    catalog: ipc.currentX402NetworkMismatchCases,
  });
  assert.deepEqual(nminus1, {
    fixture: "x402-2.22",
    row: "x402-2.22-network-mismatch",
    version: "2.22.0",
    owner: "@x402/evm@2.22.0",
    codecOwner: "@x402/core@2.22.0",
    catalog: ipc.currentX402NetworkMismatchCases,
  });
  assert.equal(current.catalog, ipc.currentX402NetworkMismatchCases);
  assert.equal(nminus1.catalog, ipc.currentX402NetworkMismatchCases);
  for (const invalid of [
    ["x402-2.21", "x402-2.21-network-mismatch", "final-7b"],
    ["x402-2.23", "x402-2.23-unsupported-authorization", "final-7b"],
    ["x402-2.23", "x402-2.23-network-mismatch", "development-only"],
  ]) assert.throws(
    () => ipc.resolveFinalX402NetworkMismatchProfile(...invalid),
    /FINAL_NETWORK_MISMATCH_PROFILE_REJECTED/,
  );
});
test("current x402 network mismatch final role profile admits only its three physical paths", async () => {
  const base = { condition: "import", protocol: "x402", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", networkMismatchFinal: true };
  const valid = [
    { ...base, offerCaseId: "other-base-network-offer", offerStage: "negative" },
    { ...base, offerCaseId: "unsupported-chain-offer", offerStage: "positive" },
    { ...base, payBuyer: false, wireCaseId: "credential-offer-chain-mismatch", wireStage: "negative" },
    { ...base, preflightCaseId: "pending-open-other-network", preflightStage: "capture" },
    { ...base, preflightCaseId: "pending-open-other-network", preflightStage: "incompatible" },
    { ...base, preflightCaseId: "pending-open-other-network", preflightStage: "resume" },
  ];
  for (const config of valid)
    assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
  for (const config of [
    { ...base, protocol: "mpp", offerCaseId: "other-base-network-offer", offerStage: "negative" },
    { ...base, offerCaseId: "above-ceiling", offerStage: "negative" },
    { ...base, payBuyer: false, wireCaseId: "credential-offer-asset-mismatch", wireStage: "negative" },
    { ...base, preflightCaseId: "request-body-read-failure", preflightStage: "negative" },
    { ...base },
    { ...base, networkMismatchFinal: false, offerCaseId: "other-base-network-offer", offerStage: "negative" },
  ]) await assert.rejects(deliver({ type: "identify", config }), /IPC_MESSAGE_REJECTED/);
});
test("final MPP network mismatch dispatch admits N and N-1 without changing the catalog", () => {
  assert.deepEqual(ipc.currentMppNetworkMismatchCases, Object.freeze({
    offer: Object.freeze(["other-base-network-offer", "unsupported-chain-offer"]),
    wire: Object.freeze(["credential-offer-chain-mismatch"]),
    restart: Object.freeze(["pending-open-other-network"]),
  }));
  assert.equal(Object.isFrozen(ipc.currentMppNetworkMismatchCases), true);
  for (const path of ["offer", "wire", "restart"])
    assert.equal(Object.isFrozen(ipc.currentMppNetworkMismatchCases[path]), true);
  const profile = ipc.resolveFinalMppNetworkMismatchProfile(
    "mppx-0.8.19",
    "mppx-0.8.19-network-mismatch",
    "final-7b",
  );
  assert.deepEqual(profile, {
    fixture: "mppx-0.8.19",
    row: "mppx-0.8.19-network-mismatch",
    version: "0.8.19",
    owner: "mppx@0.8.19",
    codecOwner: "mppx@0.8.19",
    catalog: ipc.currentMppNetworkMismatchCases,
  });
  assert.equal(profile.catalog, ipc.currentMppNetworkMismatchCases);
  const nminus1 = ipc.resolveFinalMppNetworkMismatchProfile(
    "mppx-0.8.17",
    "mppx-0.8.17-network-mismatch",
    "final-7b",
  );
  assert.deepEqual(nminus1, {
    fixture: "mppx-0.8.17",
    row: "mppx-0.8.17-network-mismatch",
    version: "0.8.17",
    owner: "mppx@0.8.17",
    codecOwner: "mppx@0.8.17",
    catalog: ipc.currentMppNetworkMismatchCases,
  });
  assert.equal(nminus1.catalog, ipc.currentMppNetworkMismatchCases);
  for (const invalid of [
    ["mppx-0.8.16", "mppx-0.8.16-network-mismatch", "final-7b"],
    ["mppx-0.8.19", "mppx-0.8.19-unsupported-authorization", "final-7b"],
    ["mppx-0.8.19", "mppx-0.8.19-network-mismatch", "development-only"],
    ["mppx-0.8.17", "mppx-0.8.19-network-mismatch", "final-7b"],
  ]) assert.throws(
    () => ipc.resolveFinalMppNetworkMismatchProfile(...invalid),
    /FINAL_MPP_NETWORK_MISMATCH_PROFILE_REJECTED/,
  );
});
test("mppx 0.8.19 dedicated network mismatch final role admits only its three physical paths", async () => {
  const base = { condition: "import", protocol: "mpp", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", mppNetworkMismatchFinal: true };
  const valid = [
    { ...base, offerCaseId: "other-base-network-offer", offerStage: "negative" },
    { ...base, offerCaseId: "unsupported-chain-offer", offerStage: "positive" },
    { ...base, payBuyer: false, wireCaseId: "credential-offer-chain-mismatch", wireStage: "negative" },
    { ...base, preflightCaseId: "pending-open-other-network", preflightStage: "capture" },
    { ...base, preflightCaseId: "pending-open-other-network", preflightStage: "incompatible" },
    { ...base, preflightCaseId: "pending-open-other-network", preflightStage: "resume" },
  ];
  for (const config of valid)
    assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
  for (const config of [
    { ...base, protocol: "x402", offerCaseId: "other-base-network-offer", offerStage: "negative" },
    { ...base, offerCaseId: "above-ceiling", offerStage: "negative" },
    { ...base, payBuyer: false, wireCaseId: "credential-offer-asset-mismatch", wireStage: "negative" },
    { ...base, preflightCaseId: "request-body-read-failure", preflightStage: "negative" },
    { ...base },
    { ...base, mppNetworkMismatchFinal: false, offerCaseId: "other-base-network-offer", offerStage: "negative" },
    { condition: "import", protocol: "mpp", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", networkMismatchFinal: true, offerCaseId: "other-base-network-offer", offerStage: "negative" },
    { ...base, offerCaseId: "other-base-network-offer", offerStage: "negative", mppAuthorizationOffer: true },
  ]) await assert.rejects(deliver({ type: "identify", config }), /IPC_MESSAGE_REJECTED/);
});
test("current x402 unsupported authorization final row has one exact closed catalog", () => {
  assert.deepEqual(ipc.currentX402UnsupportedAuthorizationCases, Object.freeze({
    offer: Object.freeze(["permit2", "upto", "unknown-required-extension"]),
    credential: Object.freeze(["permit2", "upto", "unknown-required-extension"]),
  }));
  assert.equal(Object.isFrozen(ipc.currentX402UnsupportedAuthorizationCases), true);
  assert.equal(Object.isFrozen(ipc.currentX402UnsupportedAuthorizationCases.offer), true);
  assert.equal(Object.isFrozen(ipc.currentX402UnsupportedAuthorizationCases.credential), true);
});
test("final x402 unsupported authorization dispatch admits N and N-1 without changing the catalog", async () => {
  assert.equal(typeof ipc.resolveFinalX402UnsupportedAuthorizationProfile, "function");
  const current = ipc.resolveFinalX402UnsupportedAuthorizationProfile(
    "x402-2.23",
    "x402-2.23-unsupported-authorization",
    "final-7b",
  );
  const nminus1 = ipc.resolveFinalX402UnsupportedAuthorizationProfile(
    "x402-2.22",
    "x402-2.22-unsupported-authorization",
    "final-7b",
  );
  assert.deepEqual(current, {
    fixture: "x402-2.23",
    row: "x402-2.23-unsupported-authorization",
    version: "2.23.0",
    owner: "@x402/evm@2.23.0",
    catalog: ipc.currentX402UnsupportedAuthorizationCases,
  });
  assert.deepEqual(nminus1, {
    fixture: "x402-2.22",
    row: "x402-2.22-unsupported-authorization",
    version: "2.22.0",
    owner: "@x402/evm@2.22.0",
    catalog: ipc.currentX402UnsupportedAuthorizationCases,
  });
  assert.equal(current.catalog, ipc.currentX402UnsupportedAuthorizationCases);
  assert.equal(nminus1.catalog, ipc.currentX402UnsupportedAuthorizationCases);
  const selector = { scheme: "exact", assetTransferMethod: "future-transfer", owner: nminus1.owner };
  const result = { type: "authorization-result", caseId: "unknown-required-extension", stage: "negative", counters: counters(), events: [], status: 402, classification: "no-matching-requirements", responseSha256: hash, challenge: true, receiptSha256: null, receiptValid: false, wrapperCalls: 1, targetSelector: { field: "accepts.extra.assetTransferMethod", valueSha256: hash, owner: nminus1.owner }, actualSelector: selector };
  assert.deepEqual(await deliver(result), result);
  for (const invalid of [
    ["x402-2.22", "x402-2.23-unsupported-authorization", "final-7b"],
    ["x402-2.23", "x402-2.22-unsupported-authorization", "final-7b"],
    ["x402-2.22", "x402-2.22-unsupported-authorization", "development-only"],
  ]) assert.throws(() => ipc.resolveFinalX402UnsupportedAuthorizationProfile(...invalid), /FINAL_AUTHORIZATION_PROFILE_REJECTED/);
});
test("current-only authorization case does not change the shared development catalog", () => {
  assert.deepEqual(ipc.offerCases["unsupported-authorization"], Object.freeze(["upto", "permit2", "session-intent", "non-evm-method"]));
  assert.equal(ipc.currentX402UnsupportedAuthorizationCases.offer.includes("unknown-required-extension"), true);
});
test("final MPP unsupported authorization dispatch admits N and N-1 without changing the catalog", async () => {
  assert.deepEqual(ipc.currentMppUnsupportedAuthorizationCases, Object.freeze({
    offer: Object.freeze(["session-intent", "non-evm-method"]),
    wire: Object.freeze(["unsupported-authorization-payload"]),
  }));
  const current = ipc.resolveFinalMppUnsupportedAuthorizationProfile(
    "mppx-0.8.19",
    "mppx-0.8.19-unsupported-authorization",
    "final-7b",
  );
  const nminus1 = ipc.resolveFinalMppUnsupportedAuthorizationProfile(
    "mppx-0.8.17",
    "mppx-0.8.17-unsupported-authorization",
    "final-7b",
  );
  assert.deepEqual(current, {
    fixture: "mppx-0.8.19",
    row: "mppx-0.8.19-unsupported-authorization",
    version: "0.8.19",
    owner: "mppx@0.8.19",
    catalog: ipc.currentMppUnsupportedAuthorizationCases,
  });
  assert.deepEqual(nminus1, {
    fixture: "mppx-0.8.17",
    row: "mppx-0.8.17-unsupported-authorization",
    version: "0.8.17",
    owner: "mppx@0.8.17",
    catalog: ipc.currentMppUnsupportedAuthorizationCases,
  });
  assert.equal(current.catalog, ipc.currentMppUnsupportedAuthorizationCases);
  assert.equal(nminus1.catalog, ipc.currentMppUnsupportedAuthorizationCases);
  for (const invalid of [
    ["mppx-0.8.17", "mppx-0.8.19-unsupported-authorization", "final-7b"],
    ["mppx-0.8.19", "mppx-0.8.17-unsupported-authorization", "final-7b"],
    ["mppx-0.8.17", "mppx-0.8.17-unsupported-authorization", "development-only"],
    ["mppx-0.8.19", "mppx-0.8.19-unsupported-authorization", "development-only"],
  ]) assert.throws(() => ipc.resolveFinalMppUnsupportedAuthorizationProfile(...invalid), /FINAL_MPP_AUTHORIZATION_PROFILE_REJECTED/);

  const config = { condition: "import", protocol: "mpp", payBuyer: false, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", mppAuthorizationCaseId: "unsupported-authorization-payload", mppAuthorizationStage: "negative" };
  assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
  for (const invalidConfig of [{ protocol: "x402" }, { payBuyer: true }, { mppAuthorizationCaseId: "arbitrary" }, { mppAuthorizationStage: "resume" }, { wireCaseId: "selected-malformed-credential", wireStage: "negative" }]) await assert.rejects(deliver({ type: "identify", config: { ...config, ...invalidConfig } }), /IPC_MESSAGE_REJECTED/);

  const selection = { protocol: "mpp", method: "evm", intent: "charge", authorization: "future-authorization", owner: "mppx@0.8.19", operation: "credential-decode", wireSha256: hash };
  const result = { type: "mpp-authorization-result", caseId: "unsupported-authorization-payload", stage: "negative", counters: counters(), events: [], status: 402, classification: "invalid-payload", responseSha256: hash, challenge: true, receiptSha256: null, receiptValid: false, wrapperCalls: 1, targetSelection: selection, actualSelection: null };
  assert.deepEqual(await deliver(result), result);
  const positive = { ...result, stage: "positive", status: 200, classification: "paid", challenge: false, receiptSha256: hash, receiptValid: true, targetSelection: null, actualSelection: { ...selection, authorization: "authorization" } };
  assert.deepEqual(await deliver(positive), positive);
  const nminus1Result = { ...result, targetSelection: { ...selection, owner: "mppx@0.8.17" } };
  assert.deepEqual(await deliver(nminus1Result), nminus1Result);
  const nminus1Positive = { ...positive, actualSelection: { ...positive.actualSelection, owner: "mppx@0.8.17" } };
  assert.deepEqual(await deliver(nminus1Positive), nminus1Positive);
  for (const invalidResult of [{ classification: "arbitrary" }, { targetSelection: { ...selection, payload: "secret" } }, { actualSelection: selection }, { cause: "secret" }]) await assert.rejects(deliver({ ...result, ...invalidResult }), /IPC_MESSAGE_REJECTED/);

  const offerSelection = { protocol: "mpp", method: "evm", intent: "session", authorization: null, owner: "mppx@0.8.19", operation: "challenge-decode", wireSha256: hash };
  const offer = { type: "offer-result", caseId: "session-intent", counters: counters(), events: [], status: 402, error: { code: "PAYMENT_OFFER_UNSUPPORTED", phase: "challenge", retryable: false }, pending: false, credentialSha256: null, recordSha256: null, saveAttempts: 0, clearAttempts: 0, receiptSha256: null, receiptValid: false, mppAuthorizationOffer: true, stage: "negative", targetSelection: offerSelection, actualSelection: null };
  assert.deepEqual(await deliver(offer), offer);
  const nminus1Offer = { ...offer, targetSelection: { ...offerSelection, owner: "mppx@0.8.17" } };
  assert.deepEqual(await deliver(nminus1Offer), nminus1Offer);
});
test("current MPP selection evidence cannot be backfilled from case IDs or pre-mutation expectations", async () => {
  const [buyer, faults] = await Promise.all([
    readFile(new URL("../fixtures/runtime/buyer.mjs", import.meta.url), "utf8"),
    readFile(new URL("../fixtures/runtime/faults.mjs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(faults, /const mppSelections = [^\n]*caseId/);
  assert.doesNotMatch(buyer, /mppAuthorizationTargetSelection = \{ \.\.\.selection, authorization: "future-authorization" \}/);

  const { selectionFromChallenge, selectionFromCredential } = await import("../fixtures/runtime/mpp-authorization-selection.mjs");
  const challengeHeader = "Payment challenge-boundary-bytes", credentialHeader = "Payment credential-boundary-bytes";
  const wire = {
    Challenge: { fromResponse(response) { assert.equal(response.headers.get("www-authenticate"), challengeHeader); return { method: "tempo-from-decoder", intent: "session-from-decoder" }; } },
    Credential: { deserialize(header) { assert.equal(header, credentialHeader); return { challenge: { method: "evm-from-decoder", intent: "charge-from-decoder" }, payload: { type: "future-from-decoder" } }; } },
  };
  const digest = value => createHash("sha256").update(value).digest("hex");
  assert.deepEqual(selectionFromChallenge(wire, new Response(null, { status: 402, headers: { "www-authenticate": challengeHeader } }), "mppx@0.8.19"), { protocol: "mpp", method: "tempo-from-decoder", intent: "session-from-decoder", authorization: null, owner: "mppx@0.8.19", operation: "challenge-decode", wireSha256: digest(challengeHeader) });
  assert.deepEqual(selectionFromCredential(wire, credentialHeader, "mppx@0.8.19"), { protocol: "mpp", method: "evm-from-decoder", intent: "charge-from-decoder", authorization: "future-from-decoder", owner: "mppx@0.8.19", operation: "credential-decode", wireSha256: digest(credentialHeader) });
});
test("current MPP final dispatcher is isolated from development offer and wire slices", async () => {
  const source = await readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8");
  assert.match(source, /resolveFinalMppUnsupportedAuthorizationProfile/);
  assert.match(source, /runCurrentMppUnsupportedAuthorization/);
  assert.match(source, /catalog: currentMppUnsupportedAuthorizationCases/);
  assert.match(source, /stage: input\.stage/);
});
test("supported-failure final dispatcher is isolated from its development slice", async () => {
  const [driver, faults, integration] = await Promise.all([
    readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8"),
    readFile(new URL("../fixtures/runtime/faults.mjs", import.meta.url), "utf8"),
    readFile(new URL("./integration/native-supported-final.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(driver, /supported-final-controls/); assert.match(driver, /resolveFinalSupportedFailureProfile/); assert.match(driver, /runCurrentSupportedFailure/);
  assert.match(faults, /export async function runCurrentSupportedFailure/); assert.match(faults, /supportedFailureFinal: true/);
  assert.doesNotMatch(faults, /runCurrentSupportedFailure[\s\S]{0,1800}runSupportedSlice/);
  assert.match(integration, /const row = `\$\{input\.fixture\}-supported-failure`/);
  assert.match(integration, /resolveFinalSupportedFailureProfile\(input\.fixture, row, input\.stage\)/);
  assert.match(integration, /supported-final-controls/);
  assert.match(integration, /timeoutMs: 60000/);
});
test("current x402 driver reuses the exported frozen catalog", async () => {
  const source = await readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8");
  assert.match(source, /import \{[^}]*currentX402UnsupportedAuthorizationCases[^}]*\} from "\.\.\/\.\.\/src\/ipc\.mjs";/);
  assert.match(source, /catalog: currentX402UnsupportedAuthorizationCases/);
  assert.doesNotMatch(source, /catalog: \{ offer: \["permit2", "upto", "unknown-required-extension"\]/);
});
test("x402 amount mismatch final dispatcher is isolated from other final families", async () => {
  const driver = await readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8");
  const faults = await readFile(new URL("../fixtures/runtime/faults.mjs", import.meta.url), "utf8");
  const merchant = await readFile(new URL("../fixtures/runtime/merchant.mjs", import.meta.url), "utf8");
  assert.match(driver, /amount-mismatch-controls/);
  assert.match(driver, /runCurrentX402AmountMismatch/);
  assert.match(driver, /resolveFinalX402AmountMismatchProfile/);
  assert.match(driver, /catalog: mpp \? currentMppAmountMismatchCases : currentX402AmountMismatchCases/);
  assert.match(faults, /export async function runCurrentX402AmountMismatch/);
  assert.match(faults, /amountMismatchFinal: true/);
  assert.doesNotMatch(faults, /runCurrentX402AmountMismatch[\s\S]{0,1800}networkMismatchFinal: true/);
  assert.match(merchant, /singleFieldCase = \[[^\]]*"above-ceiling"[^\]]*"negative"[^\]]*"non-integer-atomic"[^\]]*"malformed-price"[^\]]*\]/);
});
test("x402 payee mismatch final dispatcher is isolated from other final families", async () => {
  const driver = await readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8");
  const faults = await readFile(new URL("../fixtures/runtime/faults.mjs", import.meta.url), "utf8");
  const merchant = await readFile(new URL("../fixtures/runtime/merchant.mjs", import.meta.url), "utf8");
  assert.match(driver, /payee-mismatch-controls/);
  assert.match(driver, /runCurrentX402PayeeMismatch/);
  assert.match(driver, /resolveFinalX402PayeeMismatchProfile/);
  assert.match(driver, /catalog: mpp \? currentMppPayeeMismatchCases : currentX402PayeeMismatchCases/);
  assert.match(faults, /export async function runCurrentX402PayeeMismatch/);
  assert.match(faults, /payeeMismatchFinal: true/);
  assert.doesNotMatch(faults, /runCurrentX402PayeeMismatch[\s\S]{0,1800}amountMismatchFinal: true/);
  assert.match(merchant, /singleFieldCase = \[[^\]]*"invalid-recipient-offer"[^\]]*\]/);
});
test("mppx 0.8.19 payee mismatch dispatcher uses only official MPP codecs", async () => {
  const driver = await readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8");
  const faults = await readFile(new URL("../fixtures/runtime/faults.mjs", import.meta.url), "utf8");
  const buyer = await readFile(new URL("../fixtures/runtime/buyer.mjs", import.meta.url), "utf8");
  const merchant = await readFile(new URL("../fixtures/runtime/merchant.mjs", import.meta.url), "utf8");
  assert.match(driver, /mpp-payee-mismatch-controls/);
  assert.match(driver, /runCurrentMppPayeeMismatch/);
  assert.match(driver, /resolveFinalMppPayeeMismatchProfile/);
  assert.match(driver, /currentMppPayeeMismatchCases/);
  assert.match(faults, /export async function runCurrentMppPayeeMismatch/);
  assert.match(faults, /mppPayeeMismatchFinal: true/);
  assert.doesNotMatch(faults, /runCurrentMppPayeeMismatch[\s\S]{0,1800}mppNetworkMismatchFinal: true/);
  assert.match(buyer, /mppPayeeMismatchFinal[\s\S]{0,1800}Credential\.deserialize[\s\S]{0,1800}Credential\.serialize/);
  assert.match(merchant, /mppPayeeMismatchFinal[\s\S]{0,1800}Challenge\.fromResponse[\s\S]{0,800}Challenge\.serialize/);
});
test("MPP amount mismatch dispatcher is isolated and uses only official codecs", async () => {
  const [driver, faults, buyer, merchant, integration] = await Promise.all([
    readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8"),
    readFile(new URL("../fixtures/runtime/faults.mjs", import.meta.url), "utf8"),
    readFile(new URL("../fixtures/runtime/buyer.mjs", import.meta.url), "utf8"),
    readFile(new URL("../fixtures/runtime/merchant.mjs", import.meta.url), "utf8"),
    readFile(new URL("./integration/native-mpp-amount-mismatch.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(driver, /mpp-amount-mismatch-controls/);
  assert.match(driver, /runCurrentMppAmountMismatch/);
  assert.match(driver, /resolveFinalMppAmountMismatchProfile/);
  assert.match(driver, /currentMppAmountMismatchCases/);
  assert.match(faults, /export async function runCurrentMppAmountMismatch/);
  assert.match(faults, /mppAmountMismatchFinal: true/);
  assert.doesNotMatch(faults, /runCurrentMppAmountMismatch[\s\S]{0,1800}mppNetworkMismatchFinal: true/);
  assert.match(buyer, /mppAmountMismatchFinal[\s\S]{0,1800}Credential\.deserialize[\s\S]{0,1800}payload\.value[\s\S]{0,1800}Credential\.serialize/);
  assert.match(merchant, /mppAmountMismatchFinal[\s\S]{0,1800}Challenge\.fromResponse[\s\S]{0,1800}request\.amount[\s\S]{0,800}Challenge\.serialize/);
  assert.match(integration, /resolveFinalMppAmountMismatchProfile/);
  assert.match(integration, /currentMppAmountMismatchCases/);
});
test("current x402 credential controls are fixed native profiles", async () => {
  for (const authorizationCaseId of ipc.currentX402UnsupportedAuthorizationCases.credential) for (const condition of ["import", "require"]) for (const authorizationStage of ["negative", "positive"]) {
    const config = { condition, protocol: "x402", payBuyer: false, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", authorizationCaseId, authorizationStage };
    assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
    for (const invalid of [{ authorizationCaseId: "arbitrary" }, { authorizationStage: "resume" }, { protocol: "mpp" }, { payBuyer: true }, { offerCaseId: "permit2", offerStage: "negative" }, { store: "/owned/store" }, { mutator: "arbitrary" }]) await assert.rejects(deliver({ type: "identify", config: { ...config, ...invalid } }), /IPC_MESSAGE_REJECTED/);
  }
});
test("current x402 credential results retain only closed selector identities", async () => {
  const targetSelector = { field: "accepts.extra.assetTransferMethod", valueSha256: hash, owner: "@x402/evm@2.23.0" }, actualSelector = { scheme: "exact", assetTransferMethod: "future-transfer", owner: "@x402/evm@2.23.0" };
  const result = { type: "authorization-result", caseId: "unknown-required-extension", stage: "negative", counters: counters(), events: [], status: 402, classification: "no-matching-requirements", responseSha256: hash, challenge: true, receiptSha256: null, receiptValid: false, wrapperCalls: 1, targetSelector, actualSelector };
  assert.deepEqual(await deliver(result), result);
  const positive = { ...result, stage: "positive", status: 200, classification: "paid", challenge: false, receiptSha256: hash, receiptValid: true, targetSelector: null, actualSelector: { scheme: "exact", assetTransferMethod: "eip3009", owner: "@x402/evm@2.23.0" } }; assert.deepEqual(await deliver(positive), positive);
  for (const invalid of [{ classification: "Payment required" }, { targetSelector: { ...targetSelector, value: "future-transfer" } }, { actualSelector: { ...actualSelector, owner: "@x402/core@2.23.0" } }, { selector: targetSelector }, { caseId: "arbitrary" }, { cause: "SYNTHETIC_IPC_SECRET" }]) await assert.rejects(deliver({ ...result, ...invalid }), /IPC_MESSAGE_REJECTED/);
});
test("signed decoder profiles are closed and exclusive with accepted wire profiles", async () => {
  for (const wireDecoderCaseId of ["credential-invalid-encoding", "credential-invalid-json"]) {
    const config = { condition: "import", protocol: "x402", payBuyer: false, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", wireDecoderCaseId, wireDecoderStage: "negative" };
    for (const wireDecoderStage of ["negative", "positive"]) assert.deepEqual(await deliver({ type: "identify", config: { ...config, wireDecoderStage } }), { type: "identify", config: { ...config, wireDecoderStage } });
    for (const invalid of [{ wireDecoderCaseId: "selected-malformed-credential" }, { wireDecoderCaseId: [wireDecoderCaseId] }, { wireDecoderStage: "resume" }, { payBuyer: true }, { wireCaseId: "selected-malformed-credential", wireStage: "negative" }, { store: "/owned/store" }, { step: "proof" }, { caseId: "single-client-singleflight" }, { freezeCaseId: "old-v2-pending", freezeStage: "initial" }, { receiptCaseId: "absent", receiptStage: "negative" }, { offerCaseId: "above-ceiling", offerStage: "negative" }, { sellerCaseId: "handler-200" }, { supportCaseId: "S-supported-timeout", supportStage: "negative" }, { preflightCaseId: "request-body-read-failure", preflightStage: "negative" }, { dualCaseId: "dual-valid-offer-prefer-mpp", dualStage: "initial" }, { realmCaseId: "coincident-realm-x402", realmProfile: "billing" }, { billingRecovery: true }, { mutator: "arbitrary" }]) await assert.rejects(deliver({ type: "identify", config: { ...config, ...invalid } }), /IPC_MESSAGE_REJECTED/);
    const { wireDecoderStage, ...missing } = config; await assert.rejects(deliver({ type: "identify", config: missing }), /IPC_MESSAGE_REJECTED/);
  }
});
test("signed decoder results retain only replacement and unchanged-request digests", async () => {
  const wire = { field: "selected-credential-encoding", originalSha256: hash, transmittedSha256: hash, originalHeadersSha256: hash, transmittedHeadersSha256: hash, credentialHeadersSha256: hash, bodyBeforeSha256: hash, bodyAfterSha256: hash, bindingBeforeSha256: hash, bindingAfterSha256: hash, noncredentialBeforeSha256: hash, noncredentialAfterSha256: hash };
  const result = { type: "wire-decoder-result", caseId: "credential-invalid-encoding", stage: "negative", counters: counters(), events: [], status: 402, classification: "payment-required", responseSha256: hash, challenge: true, receiptSha256: null, receiptValid: false, wrapperCalls: 1, wire };
  assert.deepEqual(await deliver(result), result);
  for (const invalid of [{ caseId: "selected-malformed-credential" }, { wire: { ...wire, field: "payload" } }, { wire: { ...wire, credential: "SYNTHETIC_IPC_SECRET" } }, { wire: { ...wire, originalSha256: "raw" } }, { cause: "SYNTHETIC_IPC_SECRET" }, { classification: "No matching payment requirements" }, { wrapperCalls: 2 }]) await assert.rejects(deliver({ ...result, ...invalid }), /IPC_MESSAGE_REJECTED/);
});
test("signed wire profiles reject mixed recovery and arbitrary mutators", async () => {
  for (const wireCaseId of ["both-credential-headers", "selected-malformed-credential", "credential-offer-chain-mismatch", "credential-offer-asset-mismatch", "credential-offer-recipient-mismatch", "credential-offer-amount-mismatch"]) {
    const config = { condition: "import", protocol: "x402", payBuyer: false, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", wireCaseId, wireStage: "negative" };
    for (const wireStage of ["negative", "positive"]) assert.deepEqual(await deliver({ type: "identify", config: { ...config, wireStage } }), { type: "identify", config: { ...config, wireStage } });
    for (const invalid of [{ wireCaseId: [wireCaseId] }, { wireCaseId: "arbitrary" }, { wireStage: "resume" }, { payBuyer: true }, { store: "/owned/store" }, { step: "proof" }, { sellerCaseId: "handler-200" }, { supportCaseId: "S-supported-timeout", supportStage: "negative" }, { offerCaseId: "above-ceiling", offerStage: "negative" }, { realmCaseId: "coincident-realm-x402", realmProfile: "billing" }, { dualCaseId: "dual-valid-offer-prefer-mpp", dualStage: "initial" }, { caseId: "save-if-absent-false" }, { freezeCaseId: "old-v2-pending", freezeStage: "initial" }, { receiptCaseId: "absent", receiptStage: "negative" }, { preflightCaseId: "request-body-read-failure", preflightStage: "negative" }, { billingRecovery: true }, { mutator: "arbitrary" }]) await assert.rejects(deliver({ type: "identify", config: { ...config, ...invalid } }), /IPC_MESSAGE_REJECTED/);
    const { wireStage, ...missing } = config; await assert.rejects(deliver({ type: "identify", config: missing }), /IPC_MESSAGE_REJECTED/);
  }
});
test("signed wire results preserve native versus transmitted digests and preparse arrivals without raw bytes", async () => {
  const wire = { field: "payload", originalSha256: hash, transmittedSha256: hash, originalHeadersSha256: hash, transmittedHeadersSha256: hash, credentialHeadersSha256: hash, bodySha256: hash, unchangedBeforeSha256: hash, unchangedAfterSha256: hash, envelopeBeforeSha256: hash, envelopeAfterSha256: hash };
  const result = { type: "wire-result", caseId: "selected-malformed-credential", stage: "negative", counters: counters(), events: [], status: 400, classification: "PAYMENT_CREDENTIAL_INVALID", responseSha256: hash, challenge: false, receiptSha256: null, receiptValid: false, wrapperCalls: 1, wire };
  assert.deepEqual(await deliver(result), result);
  for (const invalid of [{ wire: { ...wire, credential: "SYNTHETIC_IPC_SECRET" } }, { wire: { ...wire, field: "arbitrary" } }, { wire: { ...wire, originalSha256: "raw" } }, { classification: "arbitrary" }, { cause: "SYNTHETIC_IPC_SECRET" }, { wrapperCalls: 2 }]) await assert.rejects(deliver({ ...result, ...invalid }), /IPC_MESSAGE_REJECTED/);
  const arrival = { stage: "negative", atNs: "1", bodyReadAtNs: null, protocol: "x402", credentialSha256: hash, credentialHeadersSha256: hash, bodySha256: null, responseStatus: null, completedAtNs: null };
  const privateArrival = { stage: "negative", operation: "verify", atNs: "2", bodyReadAtNs: null, stampMetadataValidatedAtNs: null, authorizationValidatedAtNs: null, responseStatus: null, completedAtNs: null };
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], wireArrivals: [arrival], wirePrivateArrivals: [privateArrival] };
  assert.deepEqual(await deliver(snapshot), snapshot);
  for (const invalid of [{ wireArrivals: [{ ...arrival, header: "SYNTHETIC_IPC_SECRET" }] }, { wirePrivateArrivals: [{ ...privateArrival, operation: "/secret" }] }, { wirePrivateArrivals: [{ ...privateArrival, stamp: "SYNTHETIC_IPC_SECRET" }] }, { wirePrivateArrivals: [{ ...privateArrival, atNs: 2 }] }, { wireArrivals: Array(5).fill(arrival) }, { wirePrivateArrivals: Array(9).fill(privateArrival) }]) await assert.rejects(deliver({ ...snapshot, ...invalid }), /IPC_MESSAGE_REJECTED/);
});
test("final x402 network mismatch retains only decoded network and official codec identity", async () => {
  const wire = { field: "accepted.network", originalSha256: hash, transmittedSha256: hash, originalHeadersSha256: hash, transmittedHeadersSha256: hash, credentialHeadersSha256: hash, bodySha256: hash, unchangedBeforeSha256: hash, unchangedAfterSha256: hash, envelopeBeforeSha256: hash, envelopeAfterSha256: hash, decodedNetwork: "eip155:8453", codecOwner: "@x402/core@2.23.0", decoder: "decodePaymentSignatureHeader", encoder: "encodePaymentSignatureHeader" };
  const result = { type: "wire-result", caseId: "credential-offer-chain-mismatch", stage: "negative", counters: counters(), events: [], status: 402, classification: "no-matching-requirements", responseSha256: hash, challenge: true, receiptSha256: null, receiptValid: false, wrapperCalls: 1, wire };
  for (const codecOwner of ["@x402/core@2.23.0", "@x402/core@2.22.0"]) {
    const versioned = { ...result, wire: { ...wire, codecOwner } };
    assert.deepEqual(await deliver(versioned), versioned);
  }
  for (const invalid of [{ decodedNetwork: "eip155:999" }, { codecOwner: "@x402/core@2.21.0" }, { decoder: "JSON.parse" }, { encoder: "Buffer.from" }, { raw: "SYNTHETIC_IPC_SECRET" }])
    await assert.rejects(deliver({ ...result, wire: { ...wire, ...invalid } }), /IPC_MESSAGE_REJECTED/);
  const change = { caseId: "other-base-network-offer", stage: "negative", field: "accepts.network", beforeSha256: hash, afterSha256: hash, envelopeBeforeSha256: hash, envelopeAfterSha256: hash, decodedNetwork: "eip155:8453", codecOwner: "@x402/core@2.23.0", decoder: "decodePaymentRequiredHeader", encoder: "encodePaymentRequiredHeader" };
  for (const codecOwner of ["@x402/core@2.23.0", "@x402/core@2.22.0"]) {
    const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], offerChanges: [{ ...change, codecOwner }] };
    assert.deepEqual(await deliver(snapshot), snapshot);
  }
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], offerChanges: [change] };
  for (const invalid of [{ decodedNetwork: "eip155:999" }, { codecOwner: "@x402/core@2.21.0" }, { decoder: "JSON.parse" }, { encoder: "Buffer.from" }, { raw: "SYNTHETIC_IPC_SECRET" }])
    await assert.rejects(deliver({ ...snapshot, offerChanges: [{ ...change, ...invalid }] }), /IPC_MESSAGE_REJECTED/);
});
test("final MPP network mismatch profiles bind source independently from the genuine challenge", async () => {
  const wire = {
    field: "credential.source", originalSha256: hash, transmittedSha256: "2".repeat(64), originalHeadersSha256: hash,
    transmittedHeadersSha256: "2".repeat(64), credentialHeadersSha256: hash, bodySha256: hash,
    unchangedBeforeSha256: hash, unchangedAfterSha256: hash, envelopeBeforeSha256: hash, envelopeAfterSha256: hash,
    decodedSourceNetwork: "eip155:8453", codecOwner: "mppx@0.8.19", decoder: "Credential.deserialize", encoder: "Credential.serialize",
    challengeBeforeSha256: hash, challengeAfterSha256: hash, payloadBeforeSha256: hash, payloadAfterSha256: hash,
  };
  const result = { type: "wire-result", caseId: "credential-offer-chain-mismatch", stage: "negative", counters: counters(), events: [], status: 402, classification: "verification-failed", responseSha256: hash, challenge: true, receiptSha256: null, receiptValid: false, wrapperCalls: 1, wire };
  for (const codecOwner of ["mppx@0.8.19", "mppx@0.8.17"]) {
    const versioned = { ...result, wire: { ...wire, codecOwner } };
    assert.deepEqual(await deliver(versioned), versioned);
  }
  const positiveWire = { ...wire, field: "none", originalSha256: hash, transmittedSha256: hash, originalHeadersSha256: hash, transmittedHeadersSha256: hash, decodedSourceNetwork: "eip155:84532" };
  const positive = { ...result, stage: "positive", status: 200, classification: "paid", challenge: false, receiptSha256: hash, receiptValid: true, wire: positiveWire };
  for (const codecOwner of ["mppx@0.8.19", "mppx@0.8.17"]) {
    const versioned = { ...positive, wire: { ...positiveWire, codecOwner } };
    assert.deepEqual(await deliver(versioned), versioned);
  }
  for (const invalid of [
    { decodedSourceNetwork: "eip155:1" },
    { codecOwner: "mppx@0.8.16" },
    { decoder: "JSON.parse" },
    { encoder: "Buffer.from" },
    { challengeAfterSha256: "2".repeat(64) },
    { payloadAfterSha256: "2".repeat(64) },
    { raw: "SYNTHETIC_IPC_SECRET" },
  ]) await assert.rejects(deliver({ ...result, wire: { ...wire, ...invalid } }), /IPC_MESSAGE_REJECTED/);
  await assert.rejects(deliver({ ...result, classification: "invalid-challenge" }), /IPC_MESSAGE_REJECTED/);

  const change = { caseId: "other-base-network-offer", stage: "negative", field: "request.methodDetails.chainId", beforeSha256: hash, afterSha256: "2".repeat(64), envelopeBeforeSha256: hash, envelopeAfterSha256: hash, decodedChainId: 8453, codecOwner: "mppx@0.8.19", decoder: "Challenge.fromResponse", encoder: "Challenge.serialize" };
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], offerChanges: [change] };
  for (const codecOwner of ["mppx@0.8.19", "mppx@0.8.17"]) {
    const versioned = { ...snapshot, offerChanges: [{ ...change, codecOwner }] };
    assert.deepEqual(await deliver(versioned), versioned);
  }
  const calibration = { ...change, caseId: "unsupported-chain-offer", stage: "positive", field: "none", beforeSha256: hash, afterSha256: hash, decodedChainId: 84532 };
  const unsupported = { ...change, caseId: "unsupported-chain-offer", decodedChainId: 1 };
  for (const codecOwner of ["mppx@0.8.19", "mppx@0.8.17"]) {
    for (const value of [calibration, unsupported]) {
      const versioned = { ...snapshot, offerChanges: [{ ...value, codecOwner }] };
      assert.deepEqual(await deliver(versioned), versioned);
    }
  }
  for (const invalid of [
    { decodedChainId: 999 },
    { codecOwner: "mppx@0.8.16" },
    { decoder: "JSON.parse" },
    { encoder: "Buffer.from" },
    { raw: "SYNTHETIC_IPC_SECRET" },
  ]) await assert.rejects(deliver({ ...snapshot, offerChanges: [{ ...change, ...invalid }] }), /IPC_MESSAGE_REJECTED/);
});
test("final MPP payee mismatch retains codec identity and only the recipient delta", async () => {
  const wire = {
    field: "payload.to", originalSha256: hash, transmittedSha256: "2".repeat(64), originalHeadersSha256: hash,
    transmittedHeadersSha256: "2".repeat(64), credentialHeadersSha256: hash, bodySha256: hash,
    unchangedBeforeSha256: hash, unchangedAfterSha256: hash, envelopeBeforeSha256: hash, envelopeAfterSha256: hash,
    decodedPayeeSha256: hash, codecOwner: "mppx@0.8.19", decoder: "Credential.deserialize", encoder: "Credential.serialize",
    challengeBeforeSha256: hash, challengeAfterSha256: hash, payloadRemainderBeforeSha256: hash, payloadRemainderAfterSha256: hash,
  };
  const result = { type: "wire-result", caseId: "credential-offer-recipient-mismatch", stage: "negative", counters: counters(), events: [], status: 402, classification: "verification-failed", responseSha256: hash, challenge: true, receiptSha256: null, receiptValid: false, wrapperCalls: 1, wire };
  for (const codecOwner of ["mppx@0.8.19", "mppx@0.8.17"]) assert.deepEqual(await deliver({ ...result, wire: { ...wire, codecOwner } }), { ...result, wire: { ...wire, codecOwner } });
  const positive = { ...result, stage: "positive", status: 200, classification: "paid", challenge: false, receiptSha256: hash, receiptValid: true, wire: { ...wire, field: "none", transmittedSha256: hash, transmittedHeadersSha256: hash } };
  for (const codecOwner of ["mppx@0.8.19", "mppx@0.8.17"]) assert.deepEqual(await deliver({ ...positive, wire: { ...positive.wire, codecOwner } }), { ...positive, wire: { ...positive.wire, codecOwner } });
  for (const invalid of [{ codecOwner: "mppx@0.8.18" }, { decoder: "JSON.parse" }, { encoder: "Buffer.from" }, { challengeAfterSha256: "2".repeat(64) }, { payloadRemainderAfterSha256: "2".repeat(64) }, { raw: "SYNTHETIC_IPC_SECRET" }])
    await assert.rejects(deliver({ ...result, wire: { ...wire, ...invalid } }), /IPC_MESSAGE_REJECTED/);
  const change = { caseId: "invalid-recipient-offer", stage: "negative", field: "request.recipient", beforeSha256: hash, afterSha256: "2".repeat(64), envelopeBeforeSha256: hash, envelopeAfterSha256: hash, unchangedBeforeSha256: hash, unchangedAfterSha256: hash, decodedPayeeSha256: hash, codecOwner: "mppx@0.8.19", decoder: "Challenge.fromResponse", encoder: "Challenge.serialize" };
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], offerChanges: [change] };
  for (const codecOwner of ["mppx@0.8.19", "mppx@0.8.17"]) assert.deepEqual(await deliver({ ...snapshot, offerChanges: [{ ...change, codecOwner }] }), { ...snapshot, offerChanges: [{ ...change, codecOwner }] });
  for (const invalid of [{ codecOwner: "mppx@0.8.18" }, { decoder: "JSON.parse" }, { encoder: "Buffer.from" }, { unchangedAfterSha256: "2".repeat(64) }, { envelopeAfterSha256: "2".repeat(64) }, { raw: "SYNTHETIC_IPC_SECRET" }])
    await assert.rejects(deliver({ ...snapshot, offerChanges: [{ ...change, ...invalid }] }), /IPC_MESSAGE_REJECTED/);
  const { unchangedBeforeSha256, unchangedAfterSha256, ...withoutTransmittedRemainderBinding } = change;
  await assert.rejects(deliver({ ...snapshot, offerChanges: [withoutTransmittedRemainderBinding] }), /IPC_MESSAGE_REJECTED/);
});
test("final MPP amount mismatch retains codec identity and only the atomic amount delta", async () => {
  const wire = {
    field: "payload.value", originalSha256: hash, transmittedSha256: "2".repeat(64), originalHeadersSha256: hash,
    transmittedHeadersSha256: "2".repeat(64), credentialHeadersSha256: hash, bodySha256: hash,
    unchangedBeforeSha256: hash, unchangedAfterSha256: hash, envelopeBeforeSha256: hash, envelopeAfterSha256: hash,
    decodedAmountSha256: digestText("10001"), codecOwner: "mppx@0.8.19", decoder: "Credential.deserialize", encoder: "Credential.serialize",
    challengeBeforeSha256: hash, challengeAfterSha256: hash, payloadRemainderBeforeSha256: hash, payloadRemainderAfterSha256: hash,
  };
  const result = { type: "wire-result", caseId: "credential-offer-amount-mismatch", stage: "negative", counters: counters(), events: [], status: 402, classification: "verification-failed", responseSha256: hash, challenge: true, receiptSha256: null, receiptValid: false, wrapperCalls: 1, wire };
  const positive = { ...result, stage: "positive", status: 200, classification: "paid", challenge: false, receiptSha256: hash, receiptValid: true, wire: { ...wire, field: "none", transmittedSha256: wire.originalSha256, transmittedHeadersSha256: hash, decodedAmountSha256: digestText("10000") } };
  for (const codecOwner of ["mppx@0.8.19", "mppx@0.8.17"]) {
    assert.deepEqual(await deliver({ ...result, wire: { ...wire, codecOwner } }), { ...result, wire: { ...wire, codecOwner } });
    assert.deepEqual(await deliver({ ...positive, wire: { ...positive.wire, codecOwner } }), { ...positive, wire: { ...positive.wire, codecOwner } });
  }
  for (const invalid of [{ codecOwner: "mppx@0.8.18" }, { decoder: "JSON.parse" }, { encoder: "Buffer.from" }, { decodedAmountSha256: digestText("10002") }, { transmittedSha256: wire.originalSha256 }, { challengeAfterSha256: "2".repeat(64) }, { payloadRemainderAfterSha256: "2".repeat(64) }, { raw: "SYNTHETIC_IPC_SECRET" }])
    await assert.rejects(deliver({ ...result, wire: { ...wire, ...invalid } }), /IPC_MESSAGE_REJECTED/);
  await assert.rejects(deliver({ ...positive, wire: { ...positive.wire, transmittedSha256: "2".repeat(64) } }), /IPC_MESSAGE_REJECTED/);
  const change = { caseId: "above-ceiling", stage: "negative", field: "request.amount", beforeSha256: hash, afterSha256: "2".repeat(64), envelopeBeforeSha256: hash, envelopeAfterSha256: hash, unchangedBeforeSha256: hash, unchangedAfterSha256: hash, decodedAmountSha256: digestText("100001"), codecOwner: "mppx@0.8.19", decoder: "Challenge.fromResponse", encoder: "Challenge.serialize" };
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], offerChanges: [change] };
  for (const codecOwner of ["mppx@0.8.19", "mppx@0.8.17"]) assert.deepEqual(await deliver({ ...snapshot, offerChanges: [{ ...change, codecOwner }] }), { ...snapshot, offerChanges: [{ ...change, codecOwner }] });
  for (const invalid of [{ codecOwner: "mppx@0.8.18" }, { decoder: "JSON.parse" }, { encoder: "Buffer.from" }, { decodedAmountSha256: digestText("100002") }, { afterSha256: hash }, { unchangedAfterSha256: "2".repeat(64) }, { envelopeAfterSha256: "2".repeat(64) }, { raw: "SYNTHETIC_IPC_SECRET" }])
    await assert.rejects(deliver({ ...snapshot, offerChanges: [{ ...change, ...invalid }] }), /IPC_MESSAGE_REJECTED/);
  const positiveChange = { ...change, stage: "positive", field: "none", afterSha256: change.beforeSha256, decodedAmountSha256: digestText("10000") };
  assert.deepEqual(await deliver({ ...snapshot, offerChanges: [positiveChange] }), { ...snapshot, offerChanges: [positiveChange] });
  await assert.rejects(deliver({ ...snapshot, offerChanges: [{ ...positiveChange, afterSha256: "2".repeat(64) }] }), /IPC_MESSAGE_REJECTED/);
});
test("billing recovery is one fixed native profile, never arbitrary realm configuration", async () => {
  const config = { condition: "import", protocol: "mpp", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", billingRecovery: true };
  for (const step of [undefined, "save-before-send-exit", "unknown", "timeout", "proof"]) {
    const message = { type: "identify", config: { ...config, ...(step ? { step } : {}) } };
    assert.deepEqual(await deliver(message), message);
    for (const invalid of [{ billingRecovery: false }, { billingRecovery: "billing" }, { protocol: "x402" }, { payBuyer: false }, { realmProfile: "billing" }, { caseId: "save-if-absent-false" }, { realm: "billing" }, { timeoutProfile: "arbitrary" }]) await assert.rejects(deliver({ ...message, config: { ...message.config, ...invalid } }), /IPC_MESSAGE_REJECTED/);
  }
});
test("native realm controls admit only literal profiles and MPP buyer isolation", async () => {
  for (const realmProfile of ["ordinary", "x402", "billing"]) {
    const message = { type: "identify", config: { condition: "import", protocol: "mpp", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", realmCaseId: "coincident-realm-x402", realmProfile } };
    assert.deepEqual(await deliver(message), message);
    for (const invalid of [{ realmProfile: [realmProfile] }, { realmProfile: "arbitrary" }, { realmCaseId: "arbitrary" }, { realm: "x402" }, { protocol: "x402" }, { payBuyer: false }, { dualCaseId: "dual-valid-offer-prefer-mpp", dualStage: "initial" }, { preflightCaseId: "request-body-read-failure", preflightStage: "negative" }, { step: "proof" }, { caseId: "save-if-absent-false" }, { freezeCaseId: "old-v2-pending", freezeStage: "initial" }, { receiptCaseId: "absent", receiptStage: "negative" }, { offerCaseId: "expired-challenge", offerStage: "negative" }, { sellerCaseId: "handler-200" }, { supportCaseId: "S-supported-timeout", supportStage: "negative" }, { timeoutProfile: "support-discovery-observer" }]) await assert.rejects(deliver({ ...message, config: { ...message.config, ...invalid } }), /IPC_MESSAGE_REJECTED/);
    const { realmProfile: omitted, ...withoutProfile } = message.config;
    await assert.rejects(deliver({ ...message, config: withoutProfile }), /IPC_MESSAGE_REJECTED/);
  }
});
test("native realm observations retain safe actual errors and authenticated record bindings", async () => {
  const saved = { protocol: "mpp", protocolId: "mpp-evm-charge-v0", network: "eip155:84532", credentialSha256: hash, recordSha256: hash, ciphertextSha256: hash, keySha256: hash, economicSha256: hash };
  const result = { type: "realm-result", profile: "ordinary", preference: ["mpp"], counters: counters(), events: [], status: 200, error: null, pending: false, saveAttempts: 1, clearAttempts: 1, saved, offers: [{ headerSha256: hash, urlSha256: hash, x402Present: false }], sent: [{ protocol: "mpp", credentialSha256: hash, recordSha256: hash }], receiptSha256: hash, receiptValid: true };
  assert.deepEqual(await deliver(result), result);
  const rejected = { ...result, profile: "x402", status: 402, error: { code: "PAYMENT_OFFER_UNSUPPORTED", phase: "challenge", retryable: false }, saveAttempts: 0, clearAttempts: 0, saved: null, sent: [], receiptSha256: null, receiptValid: false };
  assert.deepEqual(await deliver(rejected), rejected);
  for (const invalid of [{ error: {} }, { error: { ...rejected.error, cause: "SYNTHETIC_IPC_SECRET" } }, { error: { ...rejected.error, code: "arbitrary" } }, { preference: ["mpp", "x402"] }, { saved: { ...saved, key: "SYNTHETIC_IPC_SECRET" } }, { offers: [{ ...result.offers[0], header: "SYNTHETIC_IPC_SECRET" }] }, { sent: [{ ...result.sent[0], protocol: "x402" }] }, { saveAttempts: "1" }]) await assert.rejects(deliver({ ...result, ...invalid }), /IPC_MESSAGE_REJECTED/);
  const offer = { profile: "x402", realm: "x402", method: "evm", intent: "charge", amount: "10000", network: "eip155:84532", urlSha256: hash, headerSha256: hash, challengeSha256: hash, idSha256: hash, economicSha256: hash };
  const arrival = { atNs: "1", method: "GET", urlSha256: hash, protocol: null }, privateArrival = { atNs: "2", method: "POST", path: "/v1/settlements/charge", wireProtocol: "mpp" };
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], realmOffers: [offer], realmArrivals: [arrival], realmPrivateArrivals: [privateArrival] };
  assert.deepEqual(await deliver(snapshot), snapshot);
  for (const invalid of [{ realmOffers: [{ ...offer, realm: "arbitrary" }] }, { realmOffers: [{ ...offer, id: "SYNTHETIC_IPC_SECRET" }] }, { realmOffers: [{ ...offer, profile: "ordinary" }] }, { realmArrivals: 2 }, { realmArrivals: [{ ...arrival, atNs: 1 }] }, { realmPrivateArrivals: [{ ...privateArrival, path: "/arbitrary" }] }, { realmPrivateArrivals: [{ ...privateArrival, stamp: "SYNTHETIC_IPC_SECRET" }] }]) await assert.rejects(deliver({ ...snapshot, ...invalid }), /IPC_MESSAGE_REJECTED/);
});
test("pending network control admits only three fixed profiles and retains rejection instead of false pending", async () => {
  for (const preflightStage of ["capture", "incompatible", "resume"]) {
    const message = { type: "identify", config: { condition: "require", protocol: "mpp", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", preflightCaseId: "pending-open-other-network", preflightStage } };
    assert.deepEqual(await deliver(message), message);
    for (const invalid of [{ network: "eip155:8453" }, { preflightStage: "positive" }, { preflightCaseId: "request-body-read-failure" }, { timeoutProfile: "support-discovery-observer" }]) await assert.rejects(deliver({ ...message, config: { ...message.config, ...invalid } }), /IPC_MESSAGE_REJECTED/);
  }
  const error = { code: "PENDING_PAYMENT_CONFLICT", phase: "recovery", retryable: false };
  const result = { type: "preflight-result", caseId: "pending-open-other-network", stage: "incompatible", network: "eip155:8453", counters: counters(), events: [], status: null, error, pending: null, pendingError: error, saveAttempts: 0, clearAttempts: 0, credentialSha256: null, recordSha256: null, receiptSha256: null, receiptValid: false, input: null, transports: [], requests: [] };
  assert.deepEqual(await deliver(result), result);
  for (const invalid of [{ pending: false }, { network: "eip155:84532" }, { error: { ...error, retryable: true } }, { pendingError: { ...error, cause: "SYNTHETIC_IPC_SECRET" } }]) await assert.rejects(deliver({ ...result, ...invalid }), /IPC_MESSAGE_REJECTED/);
  const captured = { type: "preflight-prepared", counters: counters(), events: [], credentialSha256: hash, recordSha256: hash, saveAttempts: 1, requests: [{ method: "GET", urlSha256: hash, bodySha256: hash, headersSha256: hash, credentialSha256: null, signed: false }], transports: [{ startedAtNs: "1", completedAtNs: "2", status: 402, errorIdentity: false }], network: "eip155:84532" };
  assert.deepEqual(await deliver(captured), captured);
  for (const invalid of [{ credential: "SYNTHETIC_IPC_SECRET" }, { network: "eip155:8453" }, { saveAttempts: 2 }, { requests: [{ ...captured.requests[0], body: "SYNTHETIC_IPC_SECRET" }] }]) await assert.rejects(deliver({ ...captured, ...invalid }), /IPC_MESSAGE_REJECTED/);
});
test("Request preflight accepts only closed body inputs and stages", async () => {
  for (const preflightCaseId of ["request-body-read-failure", "body-not-replayable"]) {
    const message = { type: "identify", config: { condition: "import", protocol: "x402", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", preflightCaseId, preflightStage: "negative" } };
    assert.deepEqual(await deliver(message), message);
    for (const invalid of [{ preflightCaseId: [preflightCaseId] }, { preflightStage: "resume" }, { payBuyer: false }, { timeoutProfile: "support-discovery-observer" }, { freezeCaseId: "changed-body-on-resume" }, { body: "SYNTHETIC_IPC_SECRET" }]) await assert.rejects(deliver({ ...message, config: { ...message.config, ...invalid } }), /IPC_MESSAGE_REJECTED/);
  }
});
test("Request preflight timing and arrival evidence excludes raw input or error causes", async () => {
  const input = { method: "POST", bodyUsedBeforeCall: false, bodyLockedBeforeCall: false, bodySha256: null, createdAtNs: "1", callAtNs: "2", completedAtNs: "5", pullCount: 1, failedAtNs: "3" };
  const transport = { startedAtNs: "3", completedAtNs: "4", status: null, errorIdentity: true };
  const message = { type: "preflight-result", caseId: "request-body-read-failure", stage: "negative", network: "eip155:84532", counters: counters(), events: [], status: null, error: { code: "PAYMENT_SERVICE_UNAVAILABLE", phase: "request", retryable: true }, pending: false, pendingError: null, saveAttempts: 0, clearAttempts: 0, credentialSha256: null, recordSha256: null, receiptSha256: null, receiptValid: false, input, transports: [transport], requests: [] };
  assert.deepEqual(await deliver(message), message);
  for (const invalid of [{ input: { ...input, body: "SYNTHETIC_IPC_SECRET" } }, { input: { ...input, bodyUsedBeforeCall: "false" } }, { error: { ...message.error, cause: "SYNTHETIC_IPC_SECRET" } }, { transports: [{ ...transport, errorIdentity: "true" }] }, { requests: [{ method: "POST", body: "SYNTHETIC_IPC_SECRET" }] }]) await assert.rejects(deliver({ ...message, ...invalid }), /IPC_MESSAGE_REJECTED/);
  const arrival = { atNs: "1", method: "POST", urlSha256: hash, bodyReadAtNs: "2", bodySha256: hash, credentialSha256: null };
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], businessArrivals: [arrival] };
  assert.deepEqual(await deliver(snapshot), snapshot);
  assert.deepEqual(await deliver({ ...snapshot, businessArrivals: [{ ...arrival, bodyReadAtNs: null, bodySha256: null }] }), { ...snapshot, businessArrivals: [{ ...arrival, bodyReadAtNs: null, bodySha256: null }] });
  for (const invalid of [{ body: "SYNTHETIC_IPC_SECRET" }, { credential: "SYNTHETIC_IPC_SECRET" }, { atNs: 1 }, { bodySha256: "raw" }]) await assert.rejects(deliver({ ...snapshot, businessArrivals: [{ ...arrival, ...invalid }] }), /IPC_MESSAGE_REJECTED/);
});
test("direct supported calls cannot become a generic operation or MPP owner", async () => {
  for (const caseId of ["X-supported-timeout", "X-supported-invalid-json", "X-supported-invalid-shape"]) {
    const config = { condition: "require", protocol: "x402", payBuyer: false, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", supportCaseId: caseId, supportStage: "negative" };
    assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
    for (const change of [{ protocol: "mpp" }, { supportCaseId: "X-arbitrary" }, { supportCaseId: [caseId] }, { operation: "settle" }, { supportStage: "proof" }]) await assert.rejects(deliver({ type: "identify", config: { ...config, ...change } }), /IPC_MESSAGE_REJECTED/);
    const call = { type: "support-call", caseId, stage: "positive" }; assert.deepEqual(await deliver(call), call);
    for (const change of [{ stage: "resume" }, { caseId: "S-supported-timeout" }, { url: "https://example.com" }]) await assert.rejects(deliver({ ...call, ...change }), /IPC_MESSAGE_REJECTED/);
  }
});
test("direct supported results expose closed ownership metadata without private causes", async () => {
  const error = { nativeInstance: true, causeInstance: true, causeIdentity: true, causeDescriptor: { enumerable: false, writable: false, configurable: false }, code: "PAYMENT_SERVICE_UNAVAILABLE", phase: "request", retryable: true, errorSha256: hash, causeSha256: hash };
  const message = { type: "support-caller-result", caseId: "X-supported-invalid-json", stage: "negative", calls: 1, counters: counters(), events: [], error, result: null, supportTransports: [{ startedAtNs: "1", completedAtNs: "3", responseStatus: 200, transportError: null }] };
  assert.deepEqual(await deliver(message), message);
  for (const change of [{ cause: "SYNTHETIC_IPC_SECRET" }, { nativeInstance: false }, { causeDescriptor: { ...error.causeDescriptor, writable: true } }, { code: "UNCLASSIFIED" }, { phase: "settlement" }]) await assert.rejects(deliver({ ...message, error: { ...error, ...change } }), /IPC_MESSAGE_REJECTED/);
  const result = { kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }], extensions: [], signers: {} };
  const positive = { ...message, stage: "positive", calls: 2, error: null, result }; assert.deepEqual(await deliver(positive), positive);
  for (const change of [{ paymentId: "SYNTHETIC_IPC_SECRET" }, { kinds: "invalid" }, { signers: { secret: "SYNTHETIC_IPC_SECRET" } }]) await assert.rejects(deliver({ ...positive, result: { ...result, ...change } }), /IPC_MESSAGE_REJECTED/);
  await assert.rejects(deliver({ ...message, stage: "positive" }), /IPC_MESSAGE_REJECTED/);
});

test("final verify and settle rejection profiles are closed to the four native rows", async () => {
  const expected = {
    x402: {
      direct: ["verify-positive", "verify-4xx", "verify-failed-result", "settle-4xx", "settle-failed-result"],
      seller: ["settlement-rejected-no-handler"],
    },
    mpp: {
      seller: ["settlement-rejected-no-handler"],
      method: ["command-4xx", "command-failed-result", "owner-rejected"],
    },
  };
  assert.deepEqual(ipc.currentVerifySettleRejectionCases, expected);
  for (const fixture of ["x402-2.23", "x402-2.22", "mppx-0.8.19", "mppx-0.8.17"]) {
    const profile = ipc.resolveFinalVerifySettleRejectionProfile(fixture, `${fixture}-verify-settle-rejection`, "final-7b");
    const protocol = fixture.startsWith("x402-") ? "x402" : "mpp";
    assert.equal(profile.fixture, fixture);
    assert.equal(profile.protocol, protocol);
    assert.deepEqual(profile.catalog, expected[protocol]);
  }
  for (const invalid of [
    ["x402-2.21", "x402-2.21-verify-settle-rejection", "final-7b"],
    ["x402-2.23", "x402-2.23-settle-unknown", "final-7b"],
    ["mppx-0.8.19", "mppx-0.8.19-verify-settle-rejection", "development-only"],
  ]) assert.throws(() => ipc.resolveFinalVerifySettleRejectionProfile(...invalid), /FINAL_VERIFY_SETTLE_REJECTION_PROFILE_REJECTED/);
});

test("final verify and settle rejection has a dedicated driver slice", async () => {
  const driver = await readFile(new URL("../fixtures/runtime/driver.mjs", import.meta.url), "utf8");
  const faults = await readFile(new URL("../fixtures/runtime/faults.mjs", import.meta.url), "utf8");
  assert.match(driver, /verify-settle-rejection-controls/);
  assert.match(driver, /resolveFinalVerifySettleRejectionProfile/);
  assert.match(driver, /runCurrentVerifySettleRejection/);
  assert.match(faults, /export async function runCurrentVerifySettleRejection/);
});

test("settlement rejection final role cannot be widened to another seller fault", async () => {
  for (const protocol of ["x402", "mpp"]) {
    const ids = protocol === "x402" ? ["settlement-rejected-no-handler"] : ["settlement-rejected-no-handler", "command-4xx", "command-failed-result", "owner-rejected"];
    for (const verifySettleRejectionCaseId of ids) {
      const config = { condition: "import", protocol, payBuyer: false, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", sellerCaseId: "handler-200", verifySettleRejectionFinal: true, verifySettleRejectionCaseId };
      assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
      for (const change of [{ sellerCaseId: "handler-500" }, { verifySettleRejectionFinal: false }, { verifySettleRejectionCaseId: "arbitrary" }, { payBuyer: true }, { handlerFailureFinal: true }])
        await assert.rejects(deliver({ type: "identify", config: { ...config, ...change } }), /IPC_MESSAGE_REJECTED/);
    }
  }
});
test("supported seller roles accept only closed failures and native fresh-calibration stages", async () => {
  for (const supportCaseId of ["S-supported-timeout", "S-supported-invalid-json", "S-supported-invalid-shape", "S-mpp-only-nondependency-positive"]) {
    const message = { type: "identify", config: { condition: "import", protocol: "mpp", payBuyer: false, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", supportCaseId, supportStage: supportCaseId === "S-mpp-only-nondependency-positive" ? "positive" : "negative" } };
    assert.deepEqual(await deliver(message), message);
    for (const invalid of [{ supportCaseId: [supportCaseId] }, { supportStage: "resume" }, { payBuyer: true }, { sellerCaseId: "handler-200" }, { offerCaseId: "negative" }, { store: "/owned/store" }, { timeoutProfile: "support-discovery-observer" }]) await assert.rejects(deliver({ ...message, config: { ...message.config, ...invalid } }), /IPC_MESSAGE_REJECTED/);
    if (supportCaseId === "S-mpp-only-nondependency-positive") for (const invalid of [{ protocol: "x402" }, { supportStage: "negative" }]) await assert.rejects(deliver({ ...message, config: { ...message.config, ...invalid } }), /IPC_MESSAGE_REJECTED/);
  }
});
test("supported observations preserve native offers and actual discovery timing without payloads", async () => {
  const result = { type: "support-buyer-result", caseId: "S-supported-timeout", stage: "negative", counters: counters(), events: [], status: 502, error: { code: "PAYMENT_SERVICE_UNAVAILABLE", retryable: true }, retryAfter: "2", receiptSha256: null, receiptValid: false, wrapperCalls: 1, challenges: [], signedProtocols: [], selectedChallengeSha256: null };
  assert.deepEqual(await deliver(result), result);
  for (const invalid of [{ error: { ...result.error, cause: "SYNTHETIC_IPC_SECRET" } }, { selectedChallengeSha256: "private-id" }, { signedProtocols: ["tempo"] }, { challenges: [{ protocol: "mpp", headerSha256: hash, challengeIdSha256: hash, request: "SYNTHETIC_IPC_SECRET" }] }]) await assert.rejects(deliver({ ...result, ...invalid }), /IPC_MESSAGE_REJECTED/);
  const arrival = { atNs: "2", wireProtocol: "x402", responseStatus: null, responseKind: "timeout", responseSha256: null };
  const transport = { startedAtNs: "1", completedAtNs: "3", responseStatus: null, transportError: "ABORT_ERR" };
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], supportArrivals: [arrival], supportTransports: [transport] };
  assert.deepEqual(await deliver(snapshot), snapshot);
  for (const invalid of [{ supportArrivals: [{ ...arrival, wireProtocol: "mpp" }] }, { supportTransports: [{ ...transport, transportError: "SYNTHETIC_IPC_SECRET" }] }, { supportArrivals: [{ ...arrival, body: "SYNTHETIC_IPC_SECRET" }] }]) await assert.rejects(deliver({ ...snapshot, ...invalid }), /IPC_MESSAGE_REJECTED/);
});
test("MPP challenge parameters bind applicability and unchanged request bytes", async () => {
  for (const [offerCaseId, field] of [["session-intent", "challenge.intent"], ["non-evm-method", "challenge.method"], ["expired-challenge", "challenge.expires"]]) {
    const message = { type: "identify", config: { condition: "require", protocol: "mpp", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", offerCaseId, offerStage: "negative" } };
    assert.deepEqual(await deliver(message), message);
    for (const invalid of [{ protocol: "x402" }, { expires: "2000-01-01T00:00:00.000Z" }, { method: "tempo" }, { offerCaseId: [offerCaseId] }]) await assert.rejects(deliver({ ...message, config: { ...message.config, ...invalid } }), /IPC_MESSAGE_REJECTED/);
    const change = { caseId: offerCaseId, stage: "negative", field, beforeSha256: hash, afterSha256: hash, envelopeBeforeSha256: hash, envelopeAfterSha256: hash, unchangedBeforeSha256: hash, unchangedAfterSha256: hash, requestBeforeSha256: hash, requestAfterSha256: hash };
    const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], offerChanges: [change] };
    assert.deepEqual(await deliver(snapshot), snapshot);
    for (const invalid of [{ requestAfterSha256: null }, { requestBeforeSha256: "SYNTHETIC_IPC_SECRET" }, { field: "challenge.arbitrary" }, { hmac: "SYNTHETIC_IPC_SECRET" }]) await assert.rejects(deliver({ ...snapshot, offerChanges: [{ ...change, ...invalid }] }), /IPC_MESSAGE_REJECTED/);
  }
});
test("unsupported x402 offers and atomic-price mutations have a closed protocol catalog", async () => {
  for (const protocol of ["x402", "mpp"]) for (const offerCaseId of ["unsupported-scheme", "upto", "permit2", "malformed-price"]) {
    const message = { type: "identify", config: { condition: "import", protocol, payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", offerCaseId, offerStage: "negative" } };
    if (protocol === "mpp" && offerCaseId !== "malformed-price") await assert.rejects(deliver(message), /IPC_MESSAGE_REJECTED/);
    else {
      assert.deepEqual(await deliver(message), message);
      for (const invalid of [{ offerCaseId: [offerCaseId] }, { scheme: "arbitrary" }, { timeoutProfile: "seller-fulfillment-observer" }]) await assert.rejects(deliver({ ...message, config: { ...message.config, ...invalid } }), /IPC_MESSAGE_REJECTED/);
    }
  }
});
test("single-field offer evidence retains only normalized digests", async () => {
  for (const [caseId, field] of [["unsupported-scheme", "accepts.scheme"], ["upto", "accepts.scheme"], ["permit2", "accepts.extra.assetTransferMethod"], ["malformed-price", "request.amount"]]) {
    const change = { caseId, stage: "negative", field, beforeSha256: hash, afterSha256: hash, envelopeBeforeSha256: hash, envelopeAfterSha256: hash, unchangedBeforeSha256: hash, unchangedAfterSha256: hash };
    const message = { type: "snapshot", counters: counters(), failures: [], events: [], offerChanges: [change] };
    assert.deepEqual(await deliver(message), message);
    for (const invalid of [{ unchangedAfterSha256: null }, { unchangedBeforeSha256: "SYNTHETIC_IPC_SECRET" }, { request: "SYNTHETIC_IPC_SECRET" }]) await assert.rejects(deliver({ ...message, offerChanges: [{ ...change, ...invalid }] }), /IPC_MESSAGE_REJECTED/);
    const { unchangedAfterSha256, ...incomplete } = change;
    await assert.rejects(deliver({ ...message, offerChanges: [incomplete] }), /IPC_MESSAGE_REJECTED/);
  }
});
test("seller fulfillment controls preserve actual unknown responses and bounded delivery metadata", async () => {
  const config = { condition: "require", protocol: "mpp", payBuyer: false, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs" };
  for (const sellerCaseId of ["fulfillment-failed-after-handler-failure", "fulfillment-http-503", "fulfillment-disconnect", "fulfillment-timeout", "fulfillment-unexpected-2xx"]) assert.deepEqual(await deliver({ type: "identify", config: { ...config, sellerCaseId } }), { type: "identify", config: { ...config, sellerCaseId } });
  const result = { type: "seller-result", caseId: "fulfillment-timeout", stage: "first", counters: counters(), events: [], status: 503, error: { code: "PAYMENT_STATUS_UNKNOWN", retryable: true }, retryAfter: "2", receiptSha256: null, receiptValid: false, wrapperCalls: 1, requests: [{ method: "GET", urlSha256: hash, headersSha256: hash, bodySha256: hash, credentialSha256: hash }] };
  assert.deepEqual(await deliver(result), result);
  for (const error of [{ code: "PAYMENT_STATUS_UNKNOWN", retryable: false }, { code: "ARBITRARY", retryable: true }]) await assert.rejects(deliver({ ...result, error }), /IPC_MESSAGE_REJECTED/);
  for (const responseStatus of [null, 204, 503]) {
    const attempt = { state: "FULFILLED", failureCode: null, paymentIdSha256: hash, atNs: "2", responseStatus, acknowledged: false };
    const delivery = { startedAtNs: "1", completedAtNs: "3", responseStatus, acknowledged: false, transportError: responseStatus === null ? "ABORT_ERR" : null };
    const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], fulfillmentAttempts: [attempt], fulfillmentObservations: [delivery] };
    assert.deepEqual(await deliver(snapshot), snapshot);
    for (const change of [{ transportError: "SYNTHETIC_IPC_SECRET" }, { completedAtNs: 3 }, { acknowledged: "false" }, { body: "SYNTHETIC_IPC_SECRET" }]) await assert.rejects(deliver({ ...snapshot, fulfillmentObservations: [{ ...delivery, ...change }] }), /IPC_MESSAGE_REJECTED/);
    await assert.rejects(deliver({ ...snapshot, fulfillmentAttempts: [{ ...attempt, acknowledged: true }] }), /IPC_MESSAGE_REJECTED/);
  }
});
test("seller handler controls accept only native-buyer cases and application retry signals", async () => {
  const config = { condition: "import", protocol: "x402", payBuyer: false, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs" };
  for (const sellerCaseId of ["handler-throws", "handler-500", "handler-400", "handler-404", "handler-302", "handler-200"]) {
    const message = { type: "identify", config: { ...config, sellerCaseId } };
    assert.deepEqual(await deliver(message), message);
    for (const change of [{ sellerCaseId: [sellerCaseId] }, { payBuyer: true }, { step: "proof" }, { offerCaseId: "negative" }, { store: "/owned/store" }, { timeout: 10000 }, { credential: "SYNTHETIC_IPC_SECRET" }]) await assert.rejects(deliver({ ...message, config: { ...message.config, ...change } }), /IPC_MESSAGE_REJECTED/);
    const retry = { type: "seller-retry", caseId: sellerCaseId };
    if (sellerCaseId !== "handler-200") assert.deepEqual(await deliver(retry), retry);
    else await assert.rejects(deliver(retry), /IPC_MESSAGE_REJECTED/);
  }
});
test("seller checkpoints expose only actual signed-request digests and safe fulfillment decisions", async () => {
  const request = { method: "GET", urlSha256: hash, headersSha256: hash, bodySha256: hash, credentialSha256: hash };
  const result = { type: "seller-result", caseId: "handler-throws", stage: "first", counters: counters(), events: [], status: 500, error: { code: "HANDLER_ERROR", retryable: false }, retryAfter: null, receiptSha256: hash, receiptValid: true, wrapperCalls: 1, requests: [request] };
  assert.deepEqual(await deliver(result), result);
  for (const change of [{ stage: "resume" }, { wrapperCalls: "1" }, { retryAfter: "3" }, { error: { ...result.error, cause: "SYNTHETIC_IPC_SECRET" } }, { requests: [{ ...request, headers: "SYNTHETIC_IPC_SECRET" }] }]) await assert.rejects(deliver({ ...result, ...change }), /IPC_MESSAGE_REJECTED/);
  const attempt = { state: "FAILED", failureCode: "HANDLER_ERROR", paymentIdSha256: hash, atNs: "3", responseStatus: 200, acknowledged: true };
  const settlement = { protocol: "x402", paymentIdSha256: hash, economicSha256: hash, atNs: "1" };
  const handler = { protocol: "x402", paymentIdSha256: hash, settlementAtNs: "1", atNs: "2", responseStatus: null, receiptInjected: false };
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], fulfillmentAttempts: [attempt], settlementObservations: [settlement], handlerObservations: [handler], redirectTargets: 0 };
  assert.deepEqual(await deliver(snapshot), snapshot);
  for (const change of [{ fulfillmentAttempts: [{ ...attempt, paymentId: "SYNTHETIC_IPC_SECRET" }] }, { fulfillmentAttempts: [{ ...attempt, state: "SUCCESS" }] }, { handlerObservations: [{ ...handler, receiptInjected: "false" }] }, { settlementObservations: [{ ...settlement, economicSha256: "SYNTHETIC_IPC_SECRET" }] }]) await assert.rejects(deliver({ ...snapshot, ...change }), /IPC_MESSAGE_REJECTED/);
});
test("initial-offer roles accept only closed pre-sign cases and fresh calibration stages", async () => {
  const config = { condition: "import", protocol: "x402", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs" };
  for (const offerCaseId of ["header-invalid-base64", "header-invalid-json"]) for (const offerStage of ["negative", "positive"]) {
    const message = { type: "identify", config: { ...config, offerCaseId, offerStage } };
    assert.deepEqual(await deliver(message), message);
    for (const change of [{ offerCaseId: [offerCaseId] }, { offerStage: "proof" }, { caseId: "single-client-singleflight" }, { receiptCaseId: "absent", receiptStage: "negative" }, { freezeCaseId: "old-v2-pending", freezeStage: "capture" }, { step: "proof" }, { payBuyer: false }, { maxAmount: "$99" }, { offer: "SYNTHETIC_IPC_SECRET" }]) await assert.rejects(deliver({ ...message, config: { ...message.config, ...change } }), /IPC_MESSAGE_REJECTED/);
  }
});
test("initial-offer observations expose actual attempt counts and digest-only wire changes", async () => {
  const result = { type: "offer-result", caseId: "header-invalid-base64", counters: counters(), events: [], status: 402, error: { code: "PAYMENT_CHALLENGE_INVALID", phase: "challenge", retryable: false }, pending: false, credentialSha256: null, recordSha256: null, saveAttempts: 0, clearAttempts: 0, receiptSha256: null, receiptValid: false };
  assert.deepEqual(await deliver(result), result);
  for (const change of [{ caseId: "arbitrary" }, { saveAttempts: "0" }, { clearAttempts: -1 }, { error: { ...result.error, cause: "SYNTHETIC_IPC_SECRET" } }, { error: { ...result.error, phase: "arbitrary" } }, { credentialSha256: "SYNTHETIC_IPC_SECRET" }]) await assert.rejects(deliver({ ...result, ...change }), /IPC_MESSAGE_REJECTED/);
  const change = { caseId: "header-invalid-base64", stage: "negative", field: "request-encoding", beforeSha256: hash, afterSha256: hash, envelopeBeforeSha256: hash, envelopeAfterSha256: hash };
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], offerChanges: [change] };
  assert.deepEqual(await deliver(snapshot), snapshot);
  for (const invalid of [{ field: "arbitrary" }, { stage: "proof" }, { header: "SYNTHETIC_IPC_SECRET" }, { envelopeAfterSha256: "SYNTHETIC_IPC_SECRET" }]) await assert.rejects(deliver({ ...snapshot, offerChanges: [{ ...change, ...invalid }] }), /IPC_MESSAGE_REJECTED/);
});
test("x402 authorization-offer observations separate the rejected target from the transmitted selector", async () => {
  const base = { type: "offer-result", authorizationOffer: true, caseId: "unknown-required-extension", counters: counters(), events: [], status: 402, error: { code: "PAYMENT_OFFER_UNSUPPORTED", phase: "challenge", retryable: false }, pending: false, credentialSha256: null, recordSha256: null, saveAttempts: 0, clearAttempts: 0, receiptSha256: null, receiptValid: false };
  const targetSelector = { field: "accepts.extra.assetTransferMethod", valueSha256: hash, owner: "@x402/evm@2.22.0" };
  const negative = { ...base, stage: "negative", targetSelector, actualSelector: null };
  assert.deepEqual(await deliver(negative), negative);
  const positive = { ...base, stage: "positive", status: 200, error: null, credentialSha256: hash, recordSha256: hash, saveAttempts: 1, clearAttempts: 1, receiptSha256: hash, receiptValid: true, targetSelector: null, actualSelector: { scheme: "exact", assetTransferMethod: "eip3009", owner: "@x402/evm@2.22.0" } };
  assert.deepEqual(await deliver(positive), positive);
  for (const invalid of [
    { actualSelector: { ...positive.actualSelector, owner: "@x402/core@2.22.0" } },
    { actualSelector: { ...positive.actualSelector, scheme: "upto" } },
    { actualSelector: { ...positive.actualSelector, assetTransferMethod: "permit2" } },
    { targetSelector },
    { selector: positive.actualSelector },
  ]) await assert.rejects(deliver({ ...positive, ...invalid }), /IPC_MESSAGE_REJECTED/);
});
test("structured offer mutations retain only declared network, asset, payee and amount fields", async () => {
  const config = { condition: "import", protocol: "mpp", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", offerStage: "negative" };
  for (const offerCaseId of ["other-base-network-offer", "unsupported-chain-offer", "non-usdc-offer", "wrong-network-usdc", "invalid-recipient-offer", "above-ceiling", "negative", "non-integer-atomic"]) assert.deepEqual(await deliver({ type: "identify", config: { ...config, offerCaseId } }), { type: "identify", config: { ...config, offerCaseId } });
  for (const field of ["request.methodDetails.chainId", "accepts.network", "request.currency", "accepts.asset", "request.recipient", "accepts.payTo", "request.amount", "accepts.amount"]) {
    const change = { caseId: "other-base-network-offer", stage: "negative", field, beforeSha256: hash, afterSha256: hash, envelopeBeforeSha256: hash, envelopeAfterSha256: hash };
    const message = { type: "snapshot", counters: counters(), failures: [], events: [], offerChanges: [change] };
    assert.deepEqual(await deliver(message), message);
    await assert.rejects(deliver({ ...message, offerChanges: [{ ...change, value: "SYNTHETIC_IPC_SECRET" }] }), /IPC_MESSAGE_REJECTED/);
  }
});
test("receipt controls accept only the closed buyer cases and mutually exclusive stages", async () => {
  const config = { condition: "import", protocol: "x402", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs" };
  for (const receiptCaseId of ["absent", "invalid-base64", "invalid-json", "wrong-protocol-header", "malformed-required-field"]) for (const receiptStage of ["negative", "proof"]) {
    const message = { type: "identify", config: { ...config, receiptCaseId, receiptStage } };
    assert.deepEqual(await deliver(message), message);
    for (const change of [{ receiptCaseId: [receiptCaseId] }, { receiptStage: "arbitrary" }, { caseId: "single-client-singleflight" }, { freezeCaseId: "old-v2-pending", freezeStage: "capture" }, { step: "proof" }, { payBuyer: false }, { receipt: "SYNTHETIC_IPC_SECRET" }]) await assert.rejects(deliver({ ...message, config: { ...message.config, ...change } }), /IPC_MESSAGE_REJECTED/);
  }
});
test("receipt verdicts preserve public provenance and hashes without cause or wire payload", async () => {
  const result = { type: "receipt-result", caseId: "absent", counters: counters(), events: [], status: 200, error: { code: "PAYMENT_RECEIPT_MISSING", phase: "receipt", retryable: false }, pending: true, credentialSha256: hash, recordSha256: hash, sentCiphertextSha256: hash, clearAttempts: 0, receiptSha256: null, receiptValid: false };
  assert.deepEqual(await deliver(result), result);
  for (const change of [{ caseId: "arbitrary" }, { error: { ...result.error, cause: "SYNTHETIC_IPC_SECRET" } }, { error: { ...result.error, phase: "arbitrary" } }, { error: { ...result.error, retryable: "false" } }, { pending: "true" }, { sentCiphertextSha256: "SYNTHETIC_IPC_SECRET" }, { clearAttempts: -1 }]) await assert.rejects(deliver({ ...result, ...change }), /IPC_MESSAGE_REJECTED/);
  const read = { method: "eth_chainId", stage: "proof", resultSha256: hash };
  const change = { caseId: "absent", stage: "negative", field: "header-value", beforeSha256: hash, afterSha256: null };
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], rpcReads: [read], receiptChanges: [change] };
  assert.deepEqual(await deliver(snapshot), snapshot);
  for (const invalid of [{ rpcReads: [{ ...read, result: "SYNTHETIC_IPC_SECRET" }] }, { rpcReads: [{ ...read, method: "arbitrary" }] }, { receiptChanges: [{ ...change, field: "arbitrary" }] }, { receiptChanges: [{ ...change, receipt: "SYNTHETIC_IPC_SECRET" }] }]) await assert.rejects(deliver({ ...snapshot, ...invalid }), /IPC_MESSAGE_REJECTED/);
});
test("economic-proof controls bind protocol applicability and expose only fixed changed fields", async () => {
  const config = { condition: "import", protocol: "x402", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", receiptStage: "negative" };
  for (const receiptCaseId of ["wrong-receipt-network", "wrong-receipt-transaction", "wrong-chain", "wrong-contract", "wrong-payer", "wrong-payee", "wrong-amount", "wrong-nonce", "wrong-validity", "wrong-call", "missing-transfer", "missing-authorization-used", "noncanonical-block", "failed-receipt", "transaction-hash-mismatch"]) {
    assert.deepEqual(await deliver({ type: "identify", config: { ...config, receiptCaseId } }), { type: "identify", config: { ...config, receiptCaseId } });
  }
  await assert.rejects(deliver({ type: "identify", config: { ...config, protocol: "mpp", receiptCaseId: "wrong-receipt-network" } }), /IPC_MESSAGE_REJECTED/);
  const read = { method: "eth_getTransactionByHash", stage: "negative", resultSha256: hash, originalResultSha256: hash, paramsSha256: hash, field: "transaction.input.validBefore" };
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], rpcReads: [read] };
  assert.deepEqual(await deliver(snapshot), snapshot);
  for (const change of [{ field: "arbitrary" }, { input: "SYNTHETIC_IPC_SECRET" }, { paramsSha256: "SYNTHETIC_IPC_SECRET" }]) await assert.rejects(deliver({ ...snapshot, rpcReads: [{ ...read, ...change }] }), /IPC_MESSAGE_REJECTED/);
});
test("unverified controls distinguish non-RPC verifier decisions from RPC response failures", async () => {
  const config = { condition: "import", protocol: "x402", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", receiptStage: "negative" };
  for (const receiptCaseId of ["rpc-unavailable", "rpc-invalid-response", "audited-verifier-false", "audited-verifier-throws"]) assert.deepEqual(await deliver({ type: "identify", config: { ...config, receiptCaseId } }), { type: "identify", config: { ...config, receiptCaseId } });
  const result = { type: "receipt-result", caseId: "audited-verifier-throws", counters: counters(), events: [], status: 200, error: { code: "PAYMENT_RECEIPT_UNVERIFIED", phase: "receipt", retryable: true }, pending: true, credentialSha256: hash, recordSha256: hash, sentCiphertextSha256: hash, clearAttempts: 0, receiptSha256: hash, receiptValid: true, verifierCalls: [{ decision: "throws", inputSha256: hash }] };
  assert.deepEqual(await deliver(result), result);
  for (const change of [{ decision: "arbitrary" }, { inputSha256: "SYNTHETIC_IPC_SECRET" }, { cause: "SYNTHETIC_IPC_SECRET" }]) await assert.rejects(deliver({ ...result, verifierCalls: [{ ...result.verifierCalls[0], ...change }] }), /IPC_MESSAGE_REJECTED/);
  const read = { method: "eth_chainId", stage: "negative", resultSha256: hash, originalResultSha256: hash, paramsSha256: hash, field: "response.status", responseStatus: 503 };
  assert.deepEqual(await deliver({ type: "snapshot", counters: counters(), failures: [], events: [], rpcReads: [read] }), { type: "snapshot", counters: counters(), failures: [], events: [], rpcReads: [read] });
  await assert.rejects(deliver({ type: "snapshot", counters: counters(), failures: [], events: [], rpcReads: [{ ...read, responseStatus: "503" }] }), /IPC_MESSAGE_REJECTED/);
});
test("frozen-request roles accept only approved cases and stages, never plugins or claim combinations", async () => {
  const config = { condition: "import", protocol: "x402", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs" };
  for (const freezeCaseId of ["old-v2-pending", "old-v3-binding", "changed-body-on-resume", "changed-request-binding", "opposite-challenge-after-signature", "redirect-before-payment", "redirect-after-payment"]) {
    for (const freezeStage of ["initial", "capture", "resume"]) {
      const message = { type: "identify", config: { ...config, freezeCaseId, freezeStage } };
      assert.deepEqual(await deliver(message), message);
      for (const change of [{ freezeCaseId: [freezeCaseId] }, { freezeStage: "arbitrary" }, { caseId: "single-client-singleflight" }, { step: "proof" }, { payBuyer: false }, { credential: "SYNTHETIC_IPC_SECRET" }]) await assert.rejects(deliver({ ...message, config: { ...message.config, ...change } }), /IPC_MESSAGE_REJECTED/);
    }
  }
});
test("frozen-request outcomes retain only measured closed metadata and digests", async () => {
  const request = { signed: true, redirect: "manual", status: 302, credentialSha256: hash, protocol: "x402", network: "eip155:84532", bodySha256: hash, method: "GET" };
  const result = { type: "freeze-result", caseId: "redirect-after-payment", counters: counters(), events: [], status: 302, errorCode: "PAYMENT_POLICY_DENIED", pending: true, pendingError: null, credentialSha256: hash, recordSha256: hash, requests: [request] };
  assert.deepEqual(await deliver(result), result);
  for (const change of [{ caseId: "arbitrary" }, { errorCode: "SYNTHETIC_IPC_SECRET" }, { pending: "true" }, { requests: [{ ...request, body: "SYNTHETIC_IPC_SECRET" }] }, { requests: [{ ...request, network: "eip155:1" }] }]) await assert.rejects(deliver({ ...result, ...change }), /IPC_MESSAGE_REJECTED/);
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], received: [], redirectTargets: 0, offers: [{ protocol: "mpp", headerSha256: hash }], requestBodies: [hash] };
  assert.deepEqual(await deliver(snapshot), snapshot);
  await assert.rejects(deliver({ ...snapshot, offers: [{ protocol: "mpp", headerSha256: hash, header: "SYNTHETIC_IPC_SECRET" }] }), /IPC_MESSAGE_REJECTED/);
});
test("auxiliary unsigned discovery retains actual closed wire protocols, not a provider label", async () => {
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], supportedProtocols: ["x402"] };
  assert.deepEqual(await deliver(snapshot), snapshot);
  for (const supportedProtocols of [["SYNTHETIC_IPC_SECRET"], [false], "x402"]) await assert.rejects(deliver({ ...snapshot, supportedProtocols }), /IPC_MESSAGE_REJECTED/);
});
for (const [label, message] of [
  ["array discriminator", { type: ["snapshot"], counters: { credential: "SYNTHETIC_IPC_SECRET" } }],
  ["prototype discriminator", { type: "toString" }],
  ["unknown metadata", { type: "ready", port: 42, credential: "SYNTHETIC_IPC_SECRET" }],
  ["unknown counter", { type: "snapshot", counters: { ...counters(), credential: "SYNTHETIC_IPC_SECRET" }, failures: [], events: [] }],
  ["negative count", { type: "snapshot", counters: { ...counters(), sign: -1 }, failures: [], events: [] }],
  ["malformed digest", { type: "failure", messageSha256: "SYNTHETIC_IPC_SECRET" }],
  ["unknown failure detail", { type: "failure", messageSha256: hash, raw: "SYNTHETIC_IPC_SECRET" }],
  ["unknown event", { type: "snapshot", counters: counters(), failures: [], events: [{ event: "SYNTHETIC_IPC_SECRET", atNs: "1" }] }],
  ["oversized IPC", { type: "failure", messageSha256: "a".repeat(131073) }],
]) test(`private role IPC rejects ${label} without retaining its payload`, async () => {
  await assert.rejects(deliver(message), error => error.message === "IPC_MESSAGE_REJECTED" && !JSON.stringify(error).includes("SYNTHETIC_IPC_SECRET"));
});

test("closed ordinary role controls and numeric observations are retained", async () => {
  for (const message of [
    { type: "start" }, { type: "close" }, { type: "snapshot" },
    { type: "ready", port: 42 },
    { type: "snapshot", counters: counters(), failures: [], events: [] },
    { type: "closed", counters: counters(), failures: [], events: [], received: [hash] },
    { type: "failure", messageSha256: hash },
    { type: "completed", counters: counters(), events: [], status: 200, credentialSha256: hash, receiptSha256: hash, receiptValid: true },
  ]) assert.deepEqual(await deliver(message), message);
});

test("physical scoped pnpm owners remain valid metadata in import and require controls", async () => {
  const entry = "/owned/node_modules/.pnpm/@x402+core@2.23.0/node_modules/@x402/core/dist/index.mjs";
  for (const condition of ["require", "import"]) {
    const message = { type: "identified", pid: 42, inventory: [{ name: "@x402/core/server", version: "2.23.0", condition, entry, sha256: hash, resolution: condition === "require" ? "native-bare-require" : "native-import-meta.resolve-equality", ...(condition === "import" ? { nativeResolution: "file://" + entry } : {}) }] };
    assert.deepEqual(await deliver(message), message);
  }
});

test("expected dependency failures retain only a closed owner, stage and digest", async () => {
  const error = { owner: "x402-facilitator", step: "unknown", messageSha256: hash };
  const message = { type: "snapshot", counters: counters(), failures: [], events: [], dependencyErrors: [error] };
  assert.deepEqual(await deliver(message), message);
  for (const invalid of [{ ...error, owner: ["x402-facilitator"] }, { ...error, step: "SYNTHETIC_IPC_SECRET" }, { ...error, raw: "SYNTHETIC_IPC_SECRET" }, { ...error, messageSha256: "SYNTHETIC_IPC_SECRET" }]) {
    await assert.rejects(deliver({ ...message, dependencyErrors: [invalid] }), /IPC_MESSAGE_REJECTED/);
  }
});

test("durable preparation announcement is hash-only and rejects arbitrary private records", async () => {
  const message = { type: "prepared", counters: counters(), events: [], credentialSha256: hash, recordSha256: hash };
  assert.deepEqual(await deliver(message), message);
  await assert.rejects(deliver({ ...message, record: { credential: "SYNTHETIC_IPC_SECRET" } }), /IPC_MESSAGE_REJECTED/);
  await assert.rejects(deliver({ ...message, type: ["prepared"] }), /IPC_MESSAGE_REJECTED/);
});

test("claim barriers retain closed case IDs and reject unbound or secret-bearing controls", async () => {
  const caseId = "multi-client-atomic-claim";
  const ready = { type: "claim-ready", caseId, counters: counters(), saveAttempts: 1, candidateCredentialSha256: hash, candidateRecordSha256: hash };
  for (const message of [ready, { type: "claim-release", caseId }, { type: "claim-proceed", caseId }]) {
    assert.deepEqual(await deliver(message), message);
    await assert.rejects(deliver({ ...message, caseId: [caseId] }), /IPC_MESSAGE_REJECTED/);
    await assert.rejects(deliver({ ...message, credential: "SYNTHETIC_IPC_SECRET" }), /IPC_MESSAGE_REJECTED/);
    await assert.rejects(deliver({ ...message, caseId: "arbitrary-plugin" }), /IPC_MESSAGE_REJECTED/);
  }
  await assert.rejects(deliver({ ...ready, saveAttempts: -1 }), /IPC_MESSAGE_REJECTED/);
});

test("only the four approved Pay-buyer claim configurations cross the private role boundary", async () => {
  const config = { condition: "import", protocol: "x402", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs" };
  for (const caseId of ["single-client-singleflight", "multi-client-atomic-claim", "save-if-absent-false", "save-if-absent-throws"]) {
    const message = { type: "identify", config: { ...config, caseId } };
    assert.deepEqual(await deliver(message), message);
    for (const change of [{ caseId: [caseId] }, { caseId: "arbitrary-plugin" }, { payBuyer: false }, { step: "proof" }, { callback: "SYNTHETIC_IPC_SECRET" }]) {
      await assert.rejects(deliver({ ...message, config: { ...message.config, ...change } }), /IPC_MESSAGE_REJECTED/);
    }
  }
});

test("claim decisions distinguish a real occupied slot from a thrown storage failure", async () => {
  for (const [saveOutcome, storageError] of [["saved", null], ["occupied", null], ["threw", "EEXIST"], ["threw", "CONTROLLED_THROW"]]) {
    const message = { type: "claim-decided", caseId: "multi-client-atomic-claim", saveOutcome, storageError };
    assert.deepEqual(await deliver(message), message);
    await assert.rejects(deliver({ ...message, storageError: "SYNTHETIC_IPC_SECRET" }), /IPC_MESSAGE_REJECTED/);
  }
  await assert.rejects(deliver({ type: "claim-decided", caseId: "save-if-absent-false", saveOutcome: "occupied", storageError: "EEXIST" }), /IPC_MESSAGE_REJECTED/);
});

test("duplicate controls retain exact rejection and physical header digests without widening dual preference", async () => {
  for (const dualStage of ["negative", "positive"]) {
    const config = { condition: "import", protocol: "mpp", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", dualCaseId: "duplicate-incompatible-offers", dualStage };
    assert.deepEqual(await deliver({ type: "identify", config }), { type: "identify", config });
    await assert.rejects(deliver({ type: "identify", config: { ...config, dualStage: "initial" } }), /IPC_MESSAGE_REJECTED/);
  }
  const result = { type: "dual-result", caseId: "duplicate-incompatible-offers", stage: "negative", preference: ["mpp"], counters: counters(), events: [], status: 402, error: { code: "PAYMENT_CHALLENGE_INVALID", phase: "challenge", retryable: false }, pending: false, saveAttempts: 0, clearAttempts: 0, selectedProtocol: null, saved: null, offers: [{ x402Sha256: null, mppSha256: hash, urlSha256: hash }], sent: [], receiptSha256: null, receiptValid: false, receiptOwner: null };
  assert.deepEqual(await deliver(result), result);
  for (const change of [{ error: { ...result.error, code: "PAYMENT_POLICY_DENIED" } }, { error: { ...result.error, cause: "SYNTHETIC_IPC_SECRET" } }, { preference: ["mpp", "x402"] }]) await assert.rejects(deliver({ ...result, ...change }), /IPC_MESSAGE_REJECTED/);
  const duplicate = { protocol: "mpp", firstSha256: hash, secondSha256: hash, coalescedSha256: hash, envelopeBeforeSha256: hash, envelopeAfterSha256: hash };
  const offer = { protocol: "mpp", owner: "selected", priceProfile: "duplicate-second", urlSha256: hash, headerSha256: hash, decodedSha256: hash, amount: "5000", network: "eip155:84532", economicSha256: hash };
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], duplicate, dualOffers: [offer] };
  assert.deepEqual(await deliver(snapshot), snapshot);
  for (const change of [{ duplicate: { ...duplicate, raw: "SYNTHETIC_IPC_SECRET" } }, { dualOffers: [{ ...offer, amount: "10000" }] }, { duplicate: { ...duplicate, firstSha256: false } }]) await assert.rejects(deliver({ ...snapshot, ...change }), /IPC_MESSAGE_REJECTED/);
});

test("dual offer roles accept only fixed preference cases without cross-slice configuration", async () => {
  const base = { condition: "import", protocol: "x402", payBuyer: true, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs" };
  for (const dualCaseId of ["dual-valid-offer-prefer-x402", "dual-valid-offer-prefer-mpp"]) {
    const message = { type: "identify", config: { ...base, dualCaseId, dualStage: "initial" } };
    assert.deepEqual(await deliver(message), message);
    for (const change of [{ dualCaseId: [dualCaseId] }, { dualCaseId: "arbitrary" }, { dualStage: "positive" }, { payBuyer: false }, { preflightCaseId: "request-body-read-failure", preflightStage: "negative" }, { offerCaseId: "negative", offerStage: "negative" }, { price: "$0.005" }, { step: "proof" }]) await assert.rejects(deliver({ ...message, config: { ...message.config, ...change } }), /IPC_MESSAGE_REJECTED/);
  }
});
test("dual results and native protocol arrivals retain closed hashes and measured counts only", async () => {
  const saved = { protocol: "mpp", protocolId: "mpp-evm-charge-v0", network: "eip155:84532", credentialSha256: hash, recordSha256: hash, ciphertextSha256: hash, keySha256: hash };
  const message = { type: "dual-result", caseId: "dual-valid-offer-prefer-mpp", stage: "initial", preference: ["mpp", "x402"], counters: counters(), events: [], status: 200, error: null, pending: false, saveAttempts: 1, clearAttempts: 1, selectedProtocol: "mpp", saved, offers: [{ x402Sha256: hash, mppSha256: hash, urlSha256: hash }], sent: [{ protocol: "mpp", credentialSha256: hash, recordSha256: hash }], receiptSha256: hash, receiptValid: true, receiptOwner: "auxiliary" };
  assert.deepEqual(await deliver(message), message);
  for (const change of [{ preference: ["x402", "mpp"] }, { selectedProtocol: "arbitrary" }, { saved: { ...saved, credential: "SYNTHETIC_IPC_SECRET" } }, { offers: [{ ...message.offers[0], header: "SYNTHETIC_IPC_SECRET" }] }, { receiptOwner: "arbitrary" }]) await assert.rejects(deliver({ ...message, ...change }), /IPC_MESSAGE_REJECTED/);
  const offer = { protocol: "x402", owner: "selected", priceProfile: "standard", urlSha256: hash, headerSha256: hash, decodedSha256: hash, amount: "10000", network: "eip155:84532", economicSha256: hash };
  const arrival = { path: "/dual-x402/supported", method: "GET", atNs: "1", wireProtocol: "x402" };
  const merchantArrival = { atNs: "1", method: "GET", urlSha256: hash, protocol: null };
  const snapshot = { type: "snapshot", counters: counters(), failures: [], events: [], dualOffers: [offer], dualArrivals: [merchantArrival], protocolCounters: { x402: counters(), mpp: counters() }, protocolArrivals: [arrival] };
  assert.deepEqual(await deliver(snapshot), snapshot);
  for (const change of [{ dualOffers: [{ ...offer, priceProfile: 0.005 }] }, { protocolArrivals: [{ ...arrival, path: "/arbitrary" }] }, { protocolArrivals: [{ ...arrival, wireProtocol: "mpp" }] }, { protocolArrivals: [{ ...arrival, stamp: "SYNTHETIC_IPC_SECRET" }] }, { protocolCounters: { x402: counters(), mpp: { ...counters(), settle: "1" } } }]) await assert.rejects(deliver({ ...snapshot, ...change }), /IPC_MESSAGE_REJECTED/);
  for (const dualArrivals of [2, [{ ...merchantArrival, protocol: "arbitrary" }], [{ ...merchantArrival, header: "SYNTHETIC_IPC_SECRET" }], [{ ...merchantArrival, atNs: 1 }]]) await assert.rejects(deliver({ ...snapshot, dualArrivals }), /IPC_MESSAGE_REJECTED/);
});

test("claim results retain actual bounded call verdicts, not arbitrary callback error fields", async () => {
  const message = { type: "claim-result", caseId: "single-client-singleflight", counters: counters(), events: [], saveAttempts: 1, saveOutcome: "saved", storageError: null, candidateCredentialSha256: hash, candidateRecordSha256: hash, calls: [{ status: 200, errorCode: null }, { status: null, errorCode: "PAYMENT_IN_PROGRESS" }], pending: false, status: 200, receiptSha256: hash, receiptValid: true };
  assert.deepEqual(await deliver(message), message);
  for (const change of [{ calls: [{ status: null, errorCode: "SYNTHETIC_IPC_SECRET" }] }, { calls: [{ status: null, errorCode: "PENDING_PAYMENT_CLAIMED", cause: "SYNTHETIC_IPC_SECRET" }] }, { candidateCredentialSha256: "SYNTHETIC_IPC_SECRET" }, { saveAttempts: -1 }, { pending: [false] }]) {
    await assert.rejects(deliver({ ...message, ...change }), /IPC_MESSAGE_REJECTED/);
  }
});

test("temporal validity final profiles and role controls are closed", async () => {
  for (const [fixture, version, protocol] of [["x402-2.23", "2.23.0", "x402"], ["x402-2.22", "2.22.0", "x402"], ["mppx-0.8.19", "0.8.19", "mpp"], ["mppx-0.8.17", "0.8.17", "mpp"]]) {
    const profile = ipc.resolveFinalTemporalValidityProfile(fixture, `${fixture}-temporal-validity`, "final-7b"); assert.deepEqual([profile.version, profile.protocol, profile.catalog], [version, protocol, ipc.currentTemporalValidityCases[protocol]]);
    const wire = { type: "identify", config: { condition: "import", protocol, payBuyer: false, native: "/owned/native", pay: "/owned/pay", certificates: "/owned/certs", temporalValidityFinal: true, wireCaseId: "expired-authorization", wireStage: "negative" } };
    assert.deepEqual(await deliver(wire), wire); await assert.rejects(deliver({ ...wire, config: { ...wire.config, wireCaseId: "credential-offer-amount-mismatch" } }), /IPC_MESSAGE_REJECTED/);
    if (protocol === "mpp") { const offer = { type: "identify", config: { ...wire.config, payBuyer: true, offerCaseId: "expired-challenge", offerStage: "negative" } }; delete offer.config.wireCaseId; delete offer.config.wireStage; assert.deepEqual(await deliver(offer), offer); }
  }
  assert.throws(() => ipc.resolveFinalTemporalValidityProfile("x402-2.23", "x402-2.23-replay", "final-7b"), /FINAL_TEMPORAL_VALIDITY_PROFILE_REJECTED/);
});
