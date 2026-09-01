import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";

export const recoveryStages = Object.freeze(["save-before-send-exit", "unknown", "disconnect", "timeout", "rejected", "missing", "malformed", "mismatch", "rpc-unavailable", "rpc-mismatch", "proof"]);
export const settleUnknownSteps = Object.freeze(["settle-unknown-capture", "accepted-503", "accepted-disconnect", "accepted-timeout", "signed-500", "signed-502", "signed-599", "verified-resume"]);
export const dualCaseIds = Object.freeze(["dual-valid-offer-prefer-x402", "dual-valid-offer-prefer-mpp", "duplicate-incompatible-offers"]);
export const claimCaseIds = Object.freeze(["single-client-singleflight", "multi-client-atomic-claim", "save-if-absent-false", "save-if-absent-throws"]);
export const currentReplayCases = Object.freeze({
  buyer: Object.freeze(["same-process-replay", "fresh-process-replay"]),
  seller: Object.freeze(["direct-caller-identical-credential-replay"]),
  owner: Object.freeze(["single-client-singleflight", "multi-client-atomic-claim"]),
});
export const currentVerifySettleRejectionCases = Object.freeze({
  x402: Object.freeze({
    direct: Object.freeze(["verify-positive", "verify-4xx", "verify-failed-result", "settle-4xx", "settle-failed-result"]),
    seller: Object.freeze(["settlement-rejected-no-handler"]),
  }),
  mpp: Object.freeze({
    seller: Object.freeze(["settlement-rejected-no-handler"]),
    method: Object.freeze(["command-4xx", "command-failed-result", "owner-rejected"]),
  }),
});
const settleUnknownCommonCases = Object.freeze({
  buyer: Object.freeze(["accepted-503", "accepted-disconnect", "accepted-timeout", "signed-500", "signed-502", "signed-599", "verified-resume"]),
  seller: Object.freeze(["unknown-no-handler"]),
});
export const currentSettleUnknownCases = Object.freeze({
  x402: Object.freeze({ ...settleUnknownCommonCases, owner: Object.freeze(["facilitator-owner-unknown"]) }),
  mpp: Object.freeze({ ...settleUnknownCommonCases, owner: Object.freeze(["default-current-same-owner", "configured-foreign-selected-owner", "wrong-owner-negative"]) }),
});
const finalSettleUnknownProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0", "x402", "@x402/core@2.23.0"],
  ["x402-2.22", "2.22.0", "x402", "@x402/core@2.22.0"],
  ["mppx-0.8.19", "0.8.19", "mpp", "mppx@0.8.19"],
  ["mppx-0.8.17", "0.8.17", "mpp", "mppx@0.8.17"],
].map(([fixture, version, protocol, owner]) => [fixture, Object.freeze({ fixture, row: `${fixture}-settle-unknown`, version, protocol, owner, catalog: currentSettleUnknownCases[protocol] })])));
export function resolveFinalSettleUnknownProfile(fixture, row, stage) {
  const profile = finalSettleUnknownProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_SETTLE_UNKNOWN_PROFILE_REJECTED");
  return profile;
}
const finalVerifySettleRejectionProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0", "x402", "@x402/core@2.23.0"],
  ["x402-2.22", "2.22.0", "x402", "@x402/core@2.22.0"],
  ["mppx-0.8.19", "0.8.19", "mpp", "mppx@0.8.19"],
  ["mppx-0.8.17", "0.8.17", "mpp", "mppx@0.8.17"],
].map(([fixture, version, protocol, owner]) => [fixture, Object.freeze({ fixture, row: `${fixture}-verify-settle-rejection`, version, protocol, owner, catalog: currentVerifySettleRejectionCases[protocol] })])));
export function resolveFinalVerifySettleRejectionProfile(fixture, row, stage) {
  const profile = finalVerifySettleRejectionProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_VERIFY_SETTLE_REJECTION_PROFILE_REJECTED");
  return profile;
}
const finalReplayProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0", "x402", "@x402/core@2.23.0"],
  ["x402-2.22", "2.22.0", "x402", "@x402/core@2.22.0"],
  ["mppx-0.8.19", "0.8.19", "mpp", "mppx@0.8.19"],
  ["mppx-0.8.17", "0.8.17", "mpp", "mppx@0.8.17"],
].map(([fixture, version, protocol, owner]) => [fixture, Object.freeze({ fixture, row: `${fixture}-replay`, version, protocol, owner, catalog: currentReplayCases })])));
export function resolveFinalReplayProfile(fixture, row, stage) {
  const profile = finalReplayProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_REPLAY_PROFILE_REJECTED");
  return profile;
}
export const freezeCaseIds = Object.freeze(["old-v2-pending", "old-v3-binding", "changed-body-on-resume", "changed-request-binding", "opposite-challenge-after-signature", "redirect-before-payment", "redirect-after-payment"]);
export const currentProtocolFreezeCases = Object.freeze({
  wire: Object.freeze(["other-protocol-shaped-nonce", "other-protocol-error-text", "coincident-fields", "opposite-challenge-after-signature"]),
  restart: Object.freeze(["redirect-before-payment", "redirect-after-payment", "changed-body-on-resume", "changed-request-binding", "old-v2-pending", "old-v3-binding", "durable-save-before-first-send-exit"]),
  claim: Object.freeze(["save-if-absent-false", "save-if-absent-throws"]),
  callback: Object.freeze(["callback-signing-provenance"]),
});
const finalProtocolShapeCaseIds = currentProtocolFreezeCases.wire.filter(caseId => caseId !== "opposite-challenge-after-signature");
const finalProtocolFreezeProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0", "x402"], ["x402-2.22", "2.22.0", "x402"], ["mppx-0.8.19", "0.8.19", "mpp"], ["mppx-0.8.17", "0.8.17", "mpp"],
].map(([fixture,version,protocol])=>[fixture,Object.freeze({fixture,row:`${fixture}-protocol-freeze`,version,protocol,catalog:currentProtocolFreezeCases})])));
export function resolveFinalProtocolFreezeProfile(fixture,row,stage){const profile=finalProtocolFreezeProfiles[fixture];if(!profile||row!==profile.row||stage!=="final-7b")throw new Error("FINAL_PROTOCOL_FREEZE_PROFILE_REJECTED");return profile;}
export const currentRedactionCases=Object.freeze({
  protocol:Object.freeze(["credential-stamp-secret-key-receipt-body-sentinels"]),
  callback:Object.freeze(["r99-callback-provenance","r102-signer-provenance"]),
  supervisor:Object.freeze(["bad-ipc","coercible-control","stderr-secret","output-limit"]),
});
const finalRedactionProfiles=Object.freeze(Object.fromEntries([
  ["x402-2.23","2.23.0","x402"],["x402-2.22","2.22.0","x402"],["mppx-0.8.19","0.8.19","mpp"],["mppx-0.8.17","0.8.17","mpp"],
].map(([fixture,version,protocol])=>[fixture,Object.freeze({fixture,row:`${fixture}-redaction`,version,protocol,catalog:currentRedactionCases})])));
export function resolveFinalRedactionProfile(fixture,row,stage){const profile=finalRedactionProfiles[fixture];if(!profile||row!==profile.row||stage!=="final-7b")throw new Error("FINAL_REDACTION_PROFILE_REJECTED");return profile;}
export const preflightCases = Object.freeze({ "malformed-ambiguous-offer": Object.freeze(["request-body-read-failure", "body-not-replayable"]), "network-mismatch": Object.freeze(["pending-open-other-network"]) });
const preflightCaseIds = Object.values(preflightCases).flat();
export const receiptCases = Object.freeze({
  "receipt-absent-malformed": Object.freeze(["absent", "invalid-base64", "invalid-json", "wrong-protocol-header", "malformed-required-field"]),
  "receipt-mismatch": Object.freeze(["wrong-receipt-network", "wrong-receipt-transaction", "wrong-chain", "wrong-contract", "wrong-payer", "wrong-payee", "wrong-amount", "wrong-nonce", "wrong-validity", "wrong-call", "missing-transfer", "missing-authorization-used", "noncanonical-block", "failed-receipt", "transaction-hash-mismatch"]),
  "unverified-receipt": Object.freeze(["rpc-unavailable", "rpc-invalid-response", "audited-verifier-false", "audited-verifier-throws"]),
});
export const currentReceiptAbsentMalformedCases = receiptCases["receipt-absent-malformed"];
export const currentUnverifiedReceiptCases = receiptCases["unverified-receipt"];
export const currentReceiptMismatchCases = Object.freeze({
  x402: receiptCases["receipt-mismatch"],
  mpp: Object.freeze(receiptCases["receipt-mismatch"].filter(caseId => caseId !== "wrong-receipt-network")),
});
const finalReceiptAbsentMalformedProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0", "x402", "@x402/core@2.23.0"],
  ["x402-2.22", "2.22.0", "x402", "@x402/core@2.22.0"],
  ["mppx-0.8.19", "0.8.19", "mpp", "mppx@0.8.19"],
  ["mppx-0.8.17", "0.8.17", "mpp", "mppx@0.8.17"],
].map(([fixture, version, protocol, owner]) => [fixture, Object.freeze({ fixture, row: `${fixture}-receipt-absent-malformed`, version, protocol, owner, catalog: currentReceiptAbsentMalformedCases })])));
export function resolveFinalReceiptAbsentMalformedProfile(fixture, row, stage) {
  const profile = finalReceiptAbsentMalformedProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_RECEIPT_ABSENT_MALFORMED_PROFILE_REJECTED");
  return profile;
}
const finalUnverifiedReceiptProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0", "x402", "@x402/core@2.23.0"],
  ["x402-2.22", "2.22.0", "x402", "@x402/core@2.22.0"],
  ["mppx-0.8.19", "0.8.19", "mpp", "mppx@0.8.19"],
  ["mppx-0.8.17", "0.8.17", "mpp", "mppx@0.8.17"],
].map(([fixture, version, protocol, owner]) => [fixture, Object.freeze({ fixture, row: `${fixture}-unverified-receipt`, version, protocol, owner, catalog: currentUnverifiedReceiptCases })])));
export function resolveFinalUnverifiedReceiptProfile(fixture, row, stage) {
  const profile = finalUnverifiedReceiptProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_UNVERIFIED_RECEIPT_PROFILE_REJECTED");
  return profile;
}
const finalReceiptMismatchProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0", "x402", "@x402/core@2.23.0"], ["x402-2.22", "2.22.0", "x402", "@x402/core@2.22.0"],
  ["mppx-0.8.19", "0.8.19", "mpp", "mppx@0.8.19"], ["mppx-0.8.17", "0.8.17", "mpp", "mppx@0.8.17"],
].map(([fixture, version, protocol, owner]) => [fixture, Object.freeze({ fixture, row: `${fixture}-receipt-mismatch`, version, protocol, owner, catalog: currentReceiptMismatchCases[protocol] })])));
export function resolveFinalReceiptMismatchProfile(fixture, row, stage) {
  const profile = finalReceiptMismatchProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_RECEIPT_MISMATCH_PROFILE_REJECTED");
  return profile;
}
const receiptCaseIds = Object.values(receiptCases).flat();
export const offerCases = Object.freeze({
  "malformed-ambiguous-offer": Object.freeze(["header-invalid-base64", "header-invalid-json", "unsupported-scheme"]),
  "unsupported-authorization": Object.freeze(["upto", "permit2", "session-intent", "non-evm-method"]),
  "temporal-validity": Object.freeze(["expired-challenge"]),
  "network-mismatch": Object.freeze(["other-base-network-offer", "unsupported-chain-offer"]),
  "asset-mismatch": Object.freeze(["non-usdc-offer", "wrong-network-usdc"]),
  "payee-mismatch": Object.freeze(["invalid-recipient-offer"]),
  "amount-mismatch": Object.freeze(["above-ceiling", "negative", "non-integer-atomic", "malformed-price"]),
});
const offerCaseIds = Object.values(offerCases).flat();
export const offerCaseProtocols = Object.freeze({ "unsupported-scheme": "x402", upto: "x402", permit2: "x402", "session-intent": "mpp", "non-evm-method": "mpp", "expired-challenge": "mpp" });
const malformedAmbiguousCommon = Object.freeze({
  preflight: preflightCases["malformed-ambiguous-offer"],
  dual: dualCaseIds,
  wire: Object.freeze(["both-credential-headers", "selected-malformed-credential"]),
  decoder: Object.freeze(["credential-invalid-encoding", "credential-invalid-json"]),
});
export const currentMalformedAmbiguousOfferCases = Object.freeze({
  x402: Object.freeze({ offer: offerCases["malformed-ambiguous-offer"], ...malformedAmbiguousCommon }),
  mpp: Object.freeze({ offer: Object.freeze(offerCases["malformed-ambiguous-offer"].filter(caseId => offerCaseProtocols[caseId] !== "x402")), ...malformedAmbiguousCommon }),
});
const finalMalformedAmbiguousOfferProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0", "x402", "@x402/core@2.23.0"],
  ["x402-2.22", "2.22.0", "x402", "@x402/core@2.22.0"],
  ["mppx-0.8.19", "0.8.19", "mpp", "mppx@0.8.19"],
  ["mppx-0.8.17", "0.8.17", "mpp", "mppx@0.8.17"],
].map(([fixture, version, protocol, owner]) => [fixture, Object.freeze({ fixture, row: `${fixture}-malformed-ambiguous-offer`, version, protocol, owner, catalog: currentMalformedAmbiguousOfferCases[protocol] })])));
export function resolveFinalMalformedAmbiguousOfferProfile(fixture, row, stage) {
  const profile = finalMalformedAmbiguousOfferProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_MALFORMED_AMBIGUOUS_OFFER_PROFILE_REJECTED");
  return profile;
}
export const currentX402UnsupportedAuthorizationCases = Object.freeze({
  offer: Object.freeze(["permit2", "upto", "unknown-required-extension"]),
  credential: Object.freeze(["permit2", "upto", "unknown-required-extension"]),
});
const currentX402UnsupportedAuthorizationCaseIds = Object.values(currentX402UnsupportedAuthorizationCases).flat();
const finalX402UnsupportedAuthorizationProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0"],
  ["x402-2.22", "2.22.0"],
].map(([fixture, version]) => [fixture, Object.freeze({
  fixture,
  row: `${fixture}-unsupported-authorization`,
  version,
  owner: `@x402/evm@${version}`,
  catalog: currentX402UnsupportedAuthorizationCases,
})])));
export function resolveFinalX402UnsupportedAuthorizationProfile(fixture, row, stage) {
  const profile = finalX402UnsupportedAuthorizationProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_AUTHORIZATION_PROFILE_REJECTED");
  return profile;
}
export const currentX402NetworkMismatchCases = Object.freeze({
  offer: Object.freeze(["other-base-network-offer", "unsupported-chain-offer"]),
  wire: Object.freeze(["credential-offer-chain-mismatch"]),
  restart: Object.freeze(["pending-open-other-network"]),
});
export const currentTemporalValidityCases = Object.freeze({
  x402: Object.freeze({
    wire: Object.freeze(["expired-authorization", "future-authorization", "inverted-validity-window"]),
  }),
  mpp: Object.freeze({
    offer: Object.freeze(["expired-challenge"]),
    wire: Object.freeze(["expired-authorization", "future-authorization", "inverted-validity-window"]),
  }),
});
const finalTemporalValidityProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0", "x402", "@x402/evm@2.23.0"],
  ["x402-2.22", "2.22.0", "x402", "@x402/evm@2.22.0"],
  ["mppx-0.8.19", "0.8.19", "mpp", "mppx@0.8.19"],
  ["mppx-0.8.17", "0.8.17", "mpp", "mppx@0.8.17"],
].map(([fixture, version, protocol, owner]) => [fixture, Object.freeze({ fixture, row: `${fixture}-temporal-validity`, version, protocol, owner, catalog: currentTemporalValidityCases[protocol] })])));
export function resolveFinalTemporalValidityProfile(fixture, row, stage) {
  const profile = finalTemporalValidityProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_TEMPORAL_VALIDITY_PROFILE_REJECTED");
  return profile;
}
const finalX402NetworkMismatchProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0"],
  ["x402-2.22", "2.22.0"],
].map(([fixture, version]) => [fixture, Object.freeze({
  fixture,
  row: `${fixture}-network-mismatch`,
  version,
  owner: `@x402/evm@${version}`,
  codecOwner: `@x402/core@${version}`,
  catalog: currentX402NetworkMismatchCases,
})])));
const finalX402NetworkMismatchCodecOwners = new Set(Object.values(finalX402NetworkMismatchProfiles).map(profile => profile.codecOwner));
export function resolveFinalX402NetworkMismatchProfile(fixture, row, stage) {
  const profile = finalX402NetworkMismatchProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_NETWORK_MISMATCH_PROFILE_REJECTED");
  return profile;
}
export const currentX402AmountMismatchCases = Object.freeze({
  offer: Object.freeze(["above-ceiling", "negative", "non-integer-atomic", "malformed-price"]),
  wire: Object.freeze(["credential-offer-amount-mismatch"]),
});
const finalX402AmountMismatchProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0"],
  ["x402-2.22", "2.22.0"],
].map(([fixture, version]) => [fixture, Object.freeze({
  fixture,
  row: `${fixture}-amount-mismatch`,
  version,
  owner: `@x402/evm@${version}`,
  codecOwner: `@x402/core@${version}`,
  catalog: currentX402AmountMismatchCases,
})])));
export function resolveFinalX402AmountMismatchProfile(fixture, row, stage) {
  const profile = finalX402AmountMismatchProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_AMOUNT_MISMATCH_PROFILE_REJECTED");
  return profile;
}
export const currentX402AssetMismatchCases = Object.freeze({
  offer: Object.freeze(["non-usdc-offer", "wrong-network-usdc"]),
  wire: Object.freeze(["credential-offer-asset-mismatch"]),
});
const finalX402AssetMismatchProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0"], ["x402-2.22", "2.22.0"],
].map(([fixture, version]) => [fixture, Object.freeze({ fixture, row: `${fixture}-asset-mismatch`, version, owner: `@x402/evm@${version}`, codecOwner: `@x402/core@${version}`, catalog: currentX402AssetMismatchCases })])));
const finalX402AssetMismatchOwners = new Set(Object.values(finalX402AssetMismatchProfiles).map(profile => profile.codecOwner));
export function resolveFinalX402AssetMismatchProfile(fixture, row, stage) {
  const profile = finalX402AssetMismatchProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_ASSET_MISMATCH_PROFILE_REJECTED");
  return profile;
}
export const currentX402PayeeMismatchCases = Object.freeze({
  offer: Object.freeze(["invalid-recipient-offer"]),
  wire: Object.freeze(["credential-offer-recipient-mismatch"]),
});
const finalX402PayeeMismatchProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0"],
  ["x402-2.22", "2.22.0"],
].map(([fixture, version]) => [fixture, Object.freeze({
  fixture,
  row: `${fixture}-payee-mismatch`,
  version,
  owner: `@x402/evm@${version}`,
  codecOwner: `@x402/core@${version}`,
  catalog: currentX402PayeeMismatchCases,
})])));
export function resolveFinalX402PayeeMismatchProfile(fixture, row, stage) {
  const profile = finalX402PayeeMismatchProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_PAYEE_MISMATCH_PROFILE_REJECTED");
  return profile;
}
export const currentMppPayeeMismatchCases = Object.freeze({
  offer: Object.freeze(["invalid-recipient-offer"]),
  wire: Object.freeze(["credential-offer-recipient-mismatch"]),
});
const finalMppPayeeMismatchProfiles = Object.freeze(Object.fromEntries([
  ["mppx-0.8.19", "0.8.19"],
  ["mppx-0.8.17", "0.8.17"],
].map(([fixture, version]) => [fixture, Object.freeze({
  fixture,
  row: `${fixture}-payee-mismatch`,
  version,
  owner: `mppx@${version}`,
  codecOwner: `mppx@${version}`,
  catalog: currentMppPayeeMismatchCases,
})])));
const finalMppPayeeMismatchOwners = new Set(Object.values(finalMppPayeeMismatchProfiles).map(profile => profile.codecOwner));
export function resolveFinalMppPayeeMismatchProfile(fixture, row, stage) {
  const profile = finalMppPayeeMismatchProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_MPP_PAYEE_MISMATCH_PROFILE_REJECTED");
  return profile;
}
export const currentMppAmountMismatchCases = Object.freeze({
  offer: Object.freeze(["above-ceiling", "negative", "non-integer-atomic", "malformed-price"]),
  wire: Object.freeze(["credential-offer-amount-mismatch"]),
});
const finalMppAmountDigests = Object.freeze({
  "above-ceiling": "97c489b6c1231ecd9fac99df40e60cec000a70a057d5971fb520c578da8e8841",
  negative: "1bad6b8cf97131fceab8543e81f7757195fbb1d36b376ee994ad1cf17699c464",
  "non-integer-atomic": "9f29a130438b81170b92a42650f9a94291ecad60bd47af2a3886e75f7f728725",
  "malformed-price": "ad737d4c5ef07a4b1a2fde6838ab62cb34a048d1527f3b70b9510807eb9e7df3",
  "credential-offer-amount-mismatch": "e443169117a184f91186b401133b20be670c7c0896f9886075e5d9b81e9d076b",
  positive: "39e5b4830d4d9c14db7368a95b65d5463ea3d09520373723430c03a5a453b5df",
});
const finalMppAmountMismatchProfiles = Object.freeze(Object.fromEntries([
  ["mppx-0.8.19", "0.8.19"],
  ["mppx-0.8.17", "0.8.17"],
].map(([fixture, version]) => [fixture, Object.freeze({
  fixture,
  row: `${fixture}-amount-mismatch`,
  version,
  owner: `mppx@${version}`,
  codecOwner: `mppx@${version}`,
  catalog: currentMppAmountMismatchCases,
})])));
const finalMppAmountMismatchOwners = new Set(Object.values(finalMppAmountMismatchProfiles).map(profile => profile.codecOwner));
export function resolveFinalMppAmountMismatchProfile(fixture, row, stage) {
  const profile = finalMppAmountMismatchProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_MPP_AMOUNT_MISMATCH_PROFILE_REJECTED");
  return profile;
}
export const currentMppAssetMismatchCases = Object.freeze({
  offer: Object.freeze(["non-usdc-offer", "wrong-network-usdc", "wrong-decimals"]),
  wire: Object.freeze(["credential-offer-asset-mismatch"]),
});
const finalMppAssetMismatchProfiles = Object.freeze(Object.fromEntries([
  ["mppx-0.8.19", "0.8.19"], ["mppx-0.8.17", "0.8.17"],
].map(([fixture, version]) => [fixture, Object.freeze({ fixture, row: `${fixture}-asset-mismatch`, version, owner: `mppx@${version}`, codecOwner: `mppx@${version}`, catalog: currentMppAssetMismatchCases })])));
const finalMppAssetMismatchOwners = new Set(Object.values(finalMppAssetMismatchProfiles).map(profile => profile.codecOwner));
export function resolveFinalMppAssetMismatchProfile(fixture, row, stage) {
  const profile = finalMppAssetMismatchProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_MPP_ASSET_MISMATCH_PROFILE_REJECTED");
  return profile;
}
export const currentSupportedFailureCases = Object.freeze({
  x402: Object.freeze({
    seller: Object.freeze(["S-supported-timeout", "S-supported-invalid-json", "S-supported-invalid-shape"]),
    direct: Object.freeze(["X-supported-timeout", "X-supported-invalid-json", "X-supported-invalid-shape"]),
  }),
  mpp: Object.freeze({
    seller: Object.freeze(["S-supported-timeout", "S-supported-invalid-json", "S-supported-invalid-shape", "S-mpp-only-nondependency-positive"]),
  }),
});
const finalSupportedFailureProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0", "x402", "@x402/core@2.23.0"],
  ["x402-2.22", "2.22.0", "x402", "@x402/core@2.22.0"],
  ["mppx-0.8.19", "0.8.19", "mpp", "mppx@0.8.19"],
  ["mppx-0.8.17", "0.8.17", "mpp", "mppx@0.8.17"],
].map(([fixture, version, protocol, owner]) => [fixture, Object.freeze({ fixture, row: `${fixture}-supported-failure`, version, protocol, owner, catalog: currentSupportedFailureCases[protocol] })])));
export function resolveFinalSupportedFailureProfile(fixture, row, stage) {
  const profile = finalSupportedFailureProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_SUPPORTED_FAILURE_PROFILE_REJECTED");
  return profile;
}
export const currentMppNetworkMismatchCases = Object.freeze({
  offer: Object.freeze(["other-base-network-offer", "unsupported-chain-offer"]),
  wire: Object.freeze(["credential-offer-chain-mismatch"]),
  restart: Object.freeze(["pending-open-other-network"]),
});
const finalMppNetworkMismatchProfiles = Object.freeze(Object.fromEntries([
  ["mppx-0.8.19", "0.8.19"],
  ["mppx-0.8.17", "0.8.17"],
].map(([fixture, version]) => [fixture, Object.freeze({
    fixture,
    row: `${fixture}-network-mismatch`,
    version,
    owner: `mppx@${version}`,
    codecOwner: `mppx@${version}`,
    catalog: currentMppNetworkMismatchCases,
  })])));
const finalMppNetworkMismatchCodecOwners = new Set(Object.values(finalMppNetworkMismatchProfiles).map(profile => profile.codecOwner));
export function resolveFinalMppNetworkMismatchProfile(fixture, row, stage) {
  const profile = finalMppNetworkMismatchProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_MPP_NETWORK_MISMATCH_PROFILE_REJECTED");
  return profile;
}
export const currentMppUnsupportedAuthorizationCases = Object.freeze({
  offer: Object.freeze(["session-intent", "non-evm-method"]),
  wire: Object.freeze(["unsupported-authorization-payload"]),
});
const finalMppUnsupportedAuthorizationProfiles = Object.freeze(Object.fromEntries([
  ["mppx-0.8.19", "0.8.19"],
  ["mppx-0.8.17", "0.8.17"],
].map(([fixture, version]) => [fixture, Object.freeze({
  fixture,
  row: `${fixture}-unsupported-authorization`,
  version,
  owner: `mppx@${version}`,
  catalog: currentMppUnsupportedAuthorizationCases,
})])));
const finalMppUnsupportedAuthorizationOwners = Object.freeze(Object.values(finalMppUnsupportedAuthorizationProfiles).map(profile => profile.owner));
export function resolveFinalMppUnsupportedAuthorizationProfile(fixture, row, stage) {
  const profile = finalMppUnsupportedAuthorizationProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_MPP_AUTHORIZATION_PROFILE_REJECTED");
  return profile;
}
export const sellerCases = Object.freeze({
  "handler-failure": Object.freeze(["handler-throws", "handler-500", "handler-400", "handler-404", "handler-302", "handler-200", "fulfillment-failed-after-handler-failure"]),
  "fulfillment-failure": Object.freeze(["fulfillment-http-503", "fulfillment-disconnect", "fulfillment-timeout", "fulfillment-unexpected-2xx"]),
});
export const currentHandlerFailureCases = sellerCases["handler-failure"];
const finalHandlerFailureProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0", "x402", "@x402/core@2.23.0"],
  ["x402-2.22", "2.22.0", "x402", "@x402/core@2.22.0"],
  ["mppx-0.8.19", "0.8.19", "mpp", "mppx@0.8.19"],
  ["mppx-0.8.17", "0.8.17", "mpp", "mppx@0.8.17"],
].map(([fixture, version, protocol, owner]) => [fixture, Object.freeze({ fixture, row: `${fixture}-handler-failure`, version, protocol, owner, catalog: currentHandlerFailureCases })])));
export function resolveFinalHandlerFailureProfile(fixture, row, stage) {
  const profile = finalHandlerFailureProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_HANDLER_FAILURE_PROFILE_REJECTED");
  return profile;
}
export const currentFulfillmentFailureCases = sellerCases["fulfillment-failure"];
const finalFulfillmentFailureProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0", "x402", "@x402/core@2.23.0"],
  ["x402-2.22", "2.22.0", "x402", "@x402/core@2.22.0"],
  ["mppx-0.8.19", "0.8.19", "mpp", "mppx@0.8.19"],
  ["mppx-0.8.17", "0.8.17", "mpp", "mppx@0.8.17"],
].map(([fixture, version, protocol, owner]) => [fixture, Object.freeze({ fixture, row: `${fixture}-fulfillment-failure`, version, protocol, owner, catalog: currentFulfillmentFailureCases })])));
export function resolveFinalFulfillmentFailureProfile(fixture, row, stage) {
  const profile = finalFulfillmentFailureProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_FULFILLMENT_FAILURE_PROFILE_REJECTED");
  return profile;
}
export const currentStandardWireReceiptCases = Object.freeze({
  x402: Object.freeze(["official-decoder-positive", "private-envelope-excluded", "private-payment-id-excluded"]),
  mpp: Object.freeze(["official-decoder-positive", "private-envelope-excluded", "private-payment-id-excluded", "direct-wrapper-2xx-positive", "direct-wrapper-non2xx-negative"]),
});
const finalStandardWireReceiptProfiles = Object.freeze(Object.fromEntries([
  ["x402-2.23", "2.23.0", "x402", "@x402/core@2.23.0"],
  ["x402-2.22", "2.22.0", "x402", "@x402/core@2.22.0"],
  ["mppx-0.8.19", "0.8.19", "mpp", "mppx@0.8.19"],
  ["mppx-0.8.17", "0.8.17", "mpp", "mppx@0.8.17"],
].map(([fixture, version, protocol, owner]) => [fixture, Object.freeze({ fixture, row: `${fixture}-standard-wire-receipt`, version, protocol, owner, catalog: currentStandardWireReceiptCases[protocol] })])));
export function resolveFinalStandardWireReceiptProfile(fixture, row, stage) {
  const profile = finalStandardWireReceiptProfiles[fixture];
  if (!profile || row !== profile.row || stage !== "final-7b") throw new Error("FINAL_STANDARD_WIRE_RECEIPT_PROFILE_REJECTED");
  return profile;
}
const sellerCaseIds = Object.values(sellerCases).flat();
export const wireCases = Object.freeze({
  "malformed-ambiguous-offer": Object.freeze(["both-credential-headers", "selected-malformed-credential"]),
  "temporal-validity": Object.freeze(["expired-authorization", "future-authorization", "inverted-validity-window"]),
  "network-mismatch": Object.freeze(["credential-offer-chain-mismatch"]),
  "asset-mismatch": Object.freeze(["credential-offer-asset-mismatch"]),
  "payee-mismatch": Object.freeze(["credential-offer-recipient-mismatch"]),
  "amount-mismatch": Object.freeze(["credential-offer-amount-mismatch"]),
});
const wireCaseIds = Object.values(wireCases).flat();
export const wireDecoderCaseIds = Object.freeze(["credential-invalid-encoding", "credential-invalid-json"]);
export const supportCaseIds = Object.freeze(["S-supported-timeout", "S-supported-invalid-json", "S-supported-invalid-shape", "S-mpp-only-nondependency-positive", "X-supported-timeout", "X-supported-invalid-json", "X-supported-invalid-shape"]);
const kinds = new Set(["identify", "identified", "start", "ready", "snapshot", "close", "closed", "completed", "prepared", "failure", "configure", "configured", "claim-ready", "claim-release", "claim-decided", "claim-proceed", "claim-result", "freeze-result", "receipt-result", "offer-result"]);
kinds.add("authorization-result");
kinds.add("mpp-authorization-result");
kinds.add("seller-result"); kinds.add("seller-retry");
kinds.add("support-buyer-result");
kinds.add("support-call"); kinds.add("support-caller-result");
kinds.add("preflight-result"); kinds.add("preflight-prepared");
kinds.add("dual-result");
kinds.add("realm-result");
kinds.add("wire-result");
kinds.add("wire-decoder-result");
kinds.add("replay-proceed"); kinds.add("replay-result");
const counterNames = ["sign", "save", "signedSend", "supported", "verify", "settle", "economicEffect", "handler", "applicationEffect", "fulfillment", "rpc", "clear", "challenge"];
const eventNames = new Set(["sign", "save", "signedSend", "clear", "settle", "rpc", "handler"]);
const packageNames = new Set(["@0xkey-io/pay/client", "@0xkey-io/pay/server", "@0xkey-io/pay/x402", "@0xkey-io/pay/mpp", "@x402/core/client", "@x402/core/server", "@x402/core/http", "@x402/evm/exact/client", "@x402/evm/exact/server", "@x402/fetch", "viem", "viem/accounts", "mppx", "mppx/client", "mppx/server", "mppx/evm", "mppx/evm/client"]);
const failureCodes = new Set(["UNCLASSIFIED", "PAYMENT_CHALLENGE_INVALID", "PAYMENT_STATUS_UNKNOWN", "PAYMENT_RECEIPT_MISSING", "PAYMENT_RECEIPT_MISMATCH", "PAYMENT_RECEIPT_UNVERIFIED", "PAYMENT_SERVICE_UNAVAILABLE", "PAYMENT_POLICY_DENIED", "PAYMENT_SIGNING_FAILED"]);
const freezeErrors = new Set(["PENDING_PAYMENT_VERSION_UNSUPPORTED", "PENDING_PAYMENT_CORRUPT", "PAYMENT_POLICY_DENIED", "PAYMENT_SERVICE_UNAVAILABLE", "PAYMENT_STATUS_UNKNOWN", "PAYMENT_CHALLENGE_INVALID"]);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const timestamp = value => typeof value === "string" && /^[0-9]{1,20}$/.test(value);
const number = (value, max = 1_000_000) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const path = value => typeof value === "string" && isAbsolute(value) && resolve(value) === value && /^\/[A-Za-z0-9.@+_/-]+$/.test(value);
function requireValue(value) { if (!value) throw new Error("IPC_MESSAGE_REJECTED"); }
function record(value, required, optional = []) {
  requireValue(value && Object.getPrototypeOf(value) === Object.prototype);
  requireValue(required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key)));
}
function list(value, validate, max = 10000) { requireValue(Array.isArray(value) && value.length <= max); for (const item of value) validate(item); }
function counts(value) { record(value, counterNames); for (const name of counterNames) requireValue(number(value[name])); }
function events(value) { list(value, item => { record(item, ["event", "atNs"]); requireValue(eventNames.has(item.event) && typeof item.atNs === "string" && /^[0-9]{1,20}$/.test(item.atNs)); }); }
function claimDecision(value) {
  requireValue(["saved", "occupied", "threw"].includes(value.saveOutcome));
  requireValue(value.saveOutcome === "threw" ? ["EEXIST", "CONTROLLED_THROW"].includes(value.storageError) : value.storageError === null);
}
function inventory(value) {
  list(value, item => {
    record(item, ["name", "version", "condition", "entry", "sha256", "resolution"], ["nativeResolution"]);
    requireValue(packageNames.has(item.name) && typeof item.version === "string" && /^[0-9]+\.[0-9]+\.[0-9]+(?:-rc\.[0-9]+)?$/.test(item.version));
    requireValue(path(item.entry) && digest(item.sha256));
    if (item.condition === "require") requireValue(item.resolution === "native-bare-require" && !Object.hasOwn(item, "nativeResolution"));
    else {
      requireValue(item.condition === "import" && item.resolution === "native-import-meta.resolve-equality" && typeof item.nativeResolution === "string");
      requireValue(fileURLToPath(item.nativeResolution) === item.entry);
    }
  }, 32);
  requireValue(value.length > 0);
}

export function validateRoleMessage(message) {
  try {
    requireValue(Buffer.byteLength(JSON.stringify(message)) <= 131072);
    requireValue(message && typeof message.type === "string" && kinds.has(message.type));
    const type = message.type;
    if (["start", "close"].includes(type) || (type === "snapshot" && !Object.hasOwn(message, "counters"))) record(message, ["type"]);
    else if (type === "identify") {
      record(message, ["type", "config"]);
      const config = message.config;
      record(config, ["condition", "protocol", "payBuyer", "native", "pay", "certificates"], ["facilitator", "merchant", "store", "step", "caseId", "freezeCaseId", "freezeStage", "receiptCaseId", "receiptStage", "receiptAbsentMalformedFinal", "unverifiedReceiptFinal", "receiptMismatchFinal", "offerCaseId", "offerStage", "sellerCaseId", "handlerFailureFinal", "fulfillmentFailureFinal", "standardWireReceiptFinal", "standardReceiptCaseId", "supportCaseId", "supportStage", "supportedFailureFinal", "preflightCaseId", "preflightStage", "dualCaseId", "dualStage", "realmCaseId", "realmProfile", "billingRecovery", "wireCaseId", "wireStage", "wireDecoderCaseId", "wireDecoderStage", "authorizationCaseId", "authorizationStage", "authorizationOffer", "mppAuthorizationCaseId", "mppAuthorizationStage", "mppAuthorizationOffer", "networkMismatchFinal", "mppNetworkMismatchFinal", "amountMismatchFinal", "mppAmountMismatchFinal", "assetMismatchFinal", "mppAssetMismatchFinal", "payeeMismatchFinal", "mppPayeeMismatchFinal", "temporalValidityFinal", "replayFinal", "replayCaseId", "replayStage", "verifySettleRejectionFinal", "verifySettleRejectionCaseId", "settleUnknownFinal", "protocolFreezeFinal"]);
      if (Object.hasOwn(config,"protocolFreezeFinal")) requireValue(config.protocolFreezeFinal===true && finalProtocolShapeCaseIds.includes(config.freezeCaseId));
      if (Object.hasOwn(config, "settleUnknownFinal")) {
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "facilitator", "merchant", "store", "step", "sellerCaseId", "settleUnknownFinal"];
        const buyer = config.payBuyer === true && settleUnknownSteps.includes(config.step) && Object.hasOwn(config, "store") && !Object.hasOwn(config, "sellerCaseId");
        const seller = config.payBuyer === false && config.step === "accepted-503" && config.sellerCaseId === "handler-200" && !Object.hasOwn(config, "store");
        requireValue(config.settleUnknownFinal === true && (buyer || seller) && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "verifySettleRejectionFinal") || Object.hasOwn(config, "verifySettleRejectionCaseId")) {
        const allowedCases = config.protocol === "x402" ? currentVerifySettleRejectionCases.x402.seller : [...currentVerifySettleRejectionCases.mpp.seller, ...currentVerifySettleRejectionCases.mpp.method];
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "facilitator", "merchant", "sellerCaseId", "verifySettleRejectionFinal", "verifySettleRejectionCaseId"];
        requireValue(config.verifySettleRejectionFinal === true && allowedCases.includes(config.verifySettleRejectionCaseId) && config.payBuyer === false && config.sellerCaseId === "handler-200" && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "replayFinal")) {
        const buyer = currentReplayCases.buyer.includes(config.replayCaseId) && config.payBuyer === true && (config.replayCaseId === "same-process-replay" ? config.replayStage === "initial" : ["initial", "resume"].includes(config.replayStage));
        const seller = currentReplayCases.seller.includes(config.replayCaseId) && config.payBuyer === false && config.sellerCaseId === "handler-500" && !Object.hasOwn(config, "replayStage");
        const owner = currentReplayCases.owner.includes(config.replayCaseId) && config.payBuyer === true && config.caseId === config.replayCaseId && !Object.hasOwn(config, "replayStage");
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "replayFinal", "replayCaseId", "facilitator", "merchant", ...(buyer || owner ? ["store"] : []), ...(buyer ? ["replayStage"] : seller ? ["sellerCaseId"] : ["caseId"] )];
        requireValue(config.replayFinal === true && [buyer, seller, owner].filter(Boolean).length === 1 && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "temporalValidityFinal")) {
        const catalog = currentTemporalValidityCases[config.protocol];
        const offer = catalog?.offer?.includes(config.offerCaseId) && ["negative", "positive"].includes(config.offerStage) && config.payBuyer === true;
        const wire = catalog?.wire?.includes(config.wireCaseId) && ["negative", "positive"].includes(config.wireStage) && config.payBuyer === false;
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "temporalValidityFinal", "facilitator", "merchant", "store", ...(offer ? ["offerCaseId", "offerStage"] : wire ? ["wireCaseId", "wireStage"] : [])];
        requireValue(config.temporalValidityFinal === true && [offer, wire].filter(Boolean).length === 1 && Object.keys(config).every(key => allowed.includes(key)));
      }
      for (const [flag, protocol, catalog] of [["assetMismatchFinal", "x402", currentX402AssetMismatchCases], ["mppAssetMismatchFinal", "mpp", currentMppAssetMismatchCases]]) if (Object.hasOwn(config, flag)) {
        const offer = catalog.offer.includes(config.offerCaseId) && ["negative", "positive"].includes(config.offerStage) && config.payBuyer === true;
        const wire = catalog.wire.includes(config.wireCaseId) && ["negative", "positive"].includes(config.wireStage) && config.payBuyer === false;
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", flag, "facilitator", "merchant", "store", ...(offer ? ["offerCaseId", "offerStage"] : wire ? ["wireCaseId", "wireStage"] : [])];
        requireValue(config[flag] === true && config.protocol === protocol && [offer, wire].filter(Boolean).length === 1 && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "unverifiedReceiptFinal")) {
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "unverifiedReceiptFinal", "receiptCaseId", "receiptStage", "facilitator", "merchant", "store"];
        requireValue(config.unverifiedReceiptFinal === true && config.payBuyer === true && currentUnverifiedReceiptCases.includes(config.receiptCaseId) && ["negative", "proof"].includes(config.receiptStage) && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "receiptMismatchFinal")) {
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "receiptMismatchFinal", "receiptCaseId", "receiptStage", "facilitator", "merchant", "store"], catalog = currentReceiptMismatchCases[config.protocol];
        requireValue(config.receiptMismatchFinal === true && config.payBuyer === true && catalog?.includes(config.receiptCaseId) && ["negative", "proof"].includes(config.receiptStage) && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "receiptAbsentMalformedFinal")) {
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "receiptAbsentMalformedFinal", "receiptCaseId", "receiptStage", "facilitator", "merchant", "store"];
        requireValue(config.receiptAbsentMalformedFinal === true && config.payBuyer === true && currentReceiptAbsentMalformedCases.includes(config.receiptCaseId) && ["negative", "proof"].includes(config.receiptStage) && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "handlerFailureFinal")) {
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "handlerFailureFinal", "sellerCaseId", "facilitator", "merchant"];
        requireValue(config.handlerFailureFinal === true && config.payBuyer === false && currentHandlerFailureCases.includes(config.sellerCaseId) && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "fulfillmentFailureFinal")) {
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "fulfillmentFailureFinal", "sellerCaseId", "facilitator", "merchant"];
        requireValue(config.fulfillmentFailureFinal === true && config.payBuyer === false && currentFulfillmentFailureCases.includes(config.sellerCaseId) && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "standardWireReceiptFinal")) {
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "standardWireReceiptFinal", "standardReceiptCaseId", "sellerCaseId", "facilitator", "merchant"];
        requireValue(config.standardWireReceiptFinal === true && config.payBuyer === false && config.sellerCaseId === "handler-200" && currentStandardWireReceiptCases[config.protocol]?.slice(0, 3).includes(config.standardReceiptCaseId) && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "supportedFailureFinal")) {
        const catalog = currentSupportedFailureCases[config.protocol], nondependency = config.supportCaseId === "S-mpp-only-nondependency-positive";
        const allowedCase = catalog && Object.values(catalog).flat().includes(config.supportCaseId);
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "supportedFailureFinal", "supportCaseId", "supportStage", "facilitator", "merchant"];
        requireValue(config.supportedFailureFinal === true && config.payBuyer === false && allowedCase && (nondependency ? config.protocol === "mpp" && config.supportStage === "positive" : ["negative", "positive"].includes(config.supportStage)) && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "mppAmountMismatchFinal")) {
        const catalog = currentMppAmountMismatchCases;
        const offer = catalog.offer.includes(config.offerCaseId) && ["negative", "positive"].includes(config.offerStage) && config.payBuyer === true;
        const wire = catalog.wire.includes(config.wireCaseId) && ["negative", "positive"].includes(config.wireStage) && config.payBuyer === false;
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "mppAmountMismatchFinal", "facilitator", "merchant", "store", ...(offer ? ["offerCaseId", "offerStage"] : wire ? ["wireCaseId", "wireStage"] : [])];
        requireValue(config.mppAmountMismatchFinal === true && config.protocol === "mpp" && [offer, wire].filter(Boolean).length === 1 && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "mppPayeeMismatchFinal")) {
        const catalog = currentMppPayeeMismatchCases;
        const offer = catalog.offer.includes(config.offerCaseId) && ["negative", "positive"].includes(config.offerStage) && config.payBuyer === true;
        const wire = catalog.wire.includes(config.wireCaseId) && ["negative", "positive"].includes(config.wireStage) && config.payBuyer === false;
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "mppPayeeMismatchFinal", "facilitator", "merchant", "store", ...(offer ? ["offerCaseId", "offerStage"] : wire ? ["wireCaseId", "wireStage"] : [])];
        requireValue(config.mppPayeeMismatchFinal === true && config.protocol === "mpp" && [offer, wire].filter(Boolean).length === 1 && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "payeeMismatchFinal")) {
        const catalog = currentX402PayeeMismatchCases;
        const offer = catalog.offer.includes(config.offerCaseId) && ["negative", "positive"].includes(config.offerStage) && config.payBuyer === true;
        const wire = catalog.wire.includes(config.wireCaseId) && ["negative", "positive"].includes(config.wireStage) && config.payBuyer === false;
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "payeeMismatchFinal", "facilitator", "merchant", "store", ...(offer ? ["offerCaseId", "offerStage"] : wire ? ["wireCaseId", "wireStage"] : [])];
        requireValue(config.payeeMismatchFinal === true && config.protocol === "x402" && [offer, wire].filter(Boolean).length === 1 && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "amountMismatchFinal")) {
        const catalog = currentX402AmountMismatchCases;
        const offer = catalog.offer.includes(config.offerCaseId) && ["negative", "positive"].includes(config.offerStage) && config.payBuyer === true;
        const wire = catalog.wire.includes(config.wireCaseId) && ["negative", "positive"].includes(config.wireStage) && config.payBuyer === false;
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "amountMismatchFinal", "facilitator", "merchant", "store", ...(offer ? ["offerCaseId", "offerStage"] : wire ? ["wireCaseId", "wireStage"] : [])];
        requireValue(config.amountMismatchFinal === true && config.protocol === "x402" && [offer, wire].filter(Boolean).length === 1 && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "networkMismatchFinal")) {
        const catalog = currentX402NetworkMismatchCases;
        const offer = catalog.offer.includes(config.offerCaseId) && ["negative", "positive"].includes(config.offerStage) && config.payBuyer === true;
        const wire = catalog.wire.includes(config.wireCaseId) && ["negative", "positive"].includes(config.wireStage) && config.payBuyer === false;
        const restart = catalog.restart.includes(config.preflightCaseId) && ["capture", "incompatible", "resume"].includes(config.preflightStage) && config.payBuyer === true;
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "networkMismatchFinal", "facilitator", "merchant", "store", ...(offer ? ["offerCaseId", "offerStage"] : wire ? ["wireCaseId", "wireStage"] : restart ? ["preflightCaseId", "preflightStage"] : [])];
        requireValue(config.networkMismatchFinal === true && config.protocol === "x402" && [offer, wire, restart].filter(Boolean).length === 1 && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "mppNetworkMismatchFinal")) {
        const catalog = currentMppNetworkMismatchCases;
        const offer = catalog.offer.includes(config.offerCaseId) && ["negative", "positive"].includes(config.offerStage) && config.payBuyer === true;
        const wire = catalog.wire.includes(config.wireCaseId) && ["negative", "positive"].includes(config.wireStage) && config.payBuyer === false;
        const restart = catalog.restart.includes(config.preflightCaseId) && ["capture", "incompatible", "resume"].includes(config.preflightStage) && config.payBuyer === true;
        const allowed = ["condition", "protocol", "payBuyer", "native", "pay", "certificates", "mppNetworkMismatchFinal", "facilitator", "merchant", "store", ...(offer ? ["offerCaseId", "offerStage"] : wire ? ["wireCaseId", "wireStage"] : restart ? ["preflightCaseId", "preflightStage"] : [])];
        requireValue(config.mppNetworkMismatchFinal === true && config.protocol === "mpp" && [offer, wire, restart].filter(Boolean).length === 1 && Object.keys(config).every(key => allowed.includes(key)));
      }
      if (Object.hasOwn(config, "authorizationOffer")) requireValue(config.authorizationOffer === true && currentX402UnsupportedAuthorizationCases.offer.includes(config.offerCaseId) && ["negative", "positive"].includes(config.offerStage) && config.protocol === "x402" && config.payBuyer === true && !["authorizationCaseId", "authorizationStage"].some(key => Object.hasOwn(config, key)));
      if (Object.hasOwn(config, "authorizationCaseId") || Object.hasOwn(config, "authorizationStage")) requireValue(currentX402UnsupportedAuthorizationCaseIds.includes(config.authorizationCaseId) && ["negative", "positive"].includes(config.authorizationStage) && config.protocol === "x402" && config.payBuyer === false && !["store", "step", "caseId", "freezeCaseId", "freezeStage", "receiptCaseId", "receiptStage", "offerCaseId", "offerStage", "sellerCaseId", "supportCaseId", "supportStage", "preflightCaseId", "preflightStage", "dualCaseId", "dualStage", "realmCaseId", "realmProfile", "billingRecovery", "wireCaseId", "wireStage", "wireDecoderCaseId", "wireDecoderStage", "authorizationOffer"].some(key => Object.hasOwn(config, key)));
      if (Object.hasOwn(config, "mppAuthorizationOffer")) requireValue(config.mppAuthorizationOffer === true && currentMppUnsupportedAuthorizationCases.offer.includes(config.offerCaseId) && ["negative", "positive"].includes(config.offerStage) && config.protocol === "mpp" && config.payBuyer === true && !["mppAuthorizationCaseId", "mppAuthorizationStage"].some(key => Object.hasOwn(config, key)));
      if (Object.hasOwn(config, "mppAuthorizationCaseId") || Object.hasOwn(config, "mppAuthorizationStage")) requireValue(config.mppAuthorizationCaseId === "unsupported-authorization-payload" && ["negative", "positive"].includes(config.mppAuthorizationStage) && config.protocol === "mpp" && config.payBuyer === false && !["store", "step", "caseId", "freezeCaseId", "freezeStage", "receiptCaseId", "receiptStage", "offerCaseId", "offerStage", "sellerCaseId", "supportCaseId", "supportStage", "preflightCaseId", "preflightStage", "dualCaseId", "dualStage", "realmCaseId", "realmProfile", "billingRecovery", "wireCaseId", "wireStage", "wireDecoderCaseId", "wireDecoderStage", "authorizationCaseId", "authorizationStage", "authorizationOffer", "mppAuthorizationOffer"].some(key => Object.hasOwn(config, key)));
      if (Object.hasOwn(config, "wireDecoderCaseId") || Object.hasOwn(config, "wireDecoderStage")) requireValue(wireDecoderCaseIds.includes(config.wireDecoderCaseId) && ["negative", "positive"].includes(config.wireDecoderStage) && config.payBuyer === false && !["store", "step", "caseId", "freezeCaseId", "freezeStage", "receiptCaseId", "receiptStage", "offerCaseId", "offerStage", "sellerCaseId", "supportCaseId", "supportStage", "preflightCaseId", "preflightStage", "dualCaseId", "dualStage", "realmCaseId", "realmProfile", "billingRecovery", "wireCaseId", "wireStage"].some(key => Object.hasOwn(config, key)));
      if (Object.hasOwn(config, "wireCaseId") || Object.hasOwn(config, "wireStage")) requireValue(wireCaseIds.includes(config.wireCaseId) && ["negative", "positive"].includes(config.wireStage) && config.payBuyer === false && !["store", "step", "caseId", "freezeCaseId", "freezeStage", "receiptCaseId", "receiptStage", "offerCaseId", "offerStage", "sellerCaseId", "supportCaseId", "supportStage", "preflightCaseId", "preflightStage", "dualCaseId", "dualStage", "realmCaseId", "realmProfile", "billingRecovery"].some(key => Object.hasOwn(config, key)));
      if (Object.hasOwn(config, "billingRecovery")) requireValue(config.billingRecovery === true && config.protocol === "mpp" && config.payBuyer === true && !["caseId", "freezeCaseId", "freezeStage", "receiptCaseId", "receiptStage", "offerCaseId", "offerStage", "sellerCaseId", "supportCaseId", "supportStage", "preflightCaseId", "preflightStage", "dualCaseId", "dualStage", "realmCaseId", "realmProfile"].some(key => Object.hasOwn(config, key)));
      if (Object.hasOwn(config, "realmCaseId") || Object.hasOwn(config, "realmProfile")) requireValue(config.realmCaseId === "coincident-realm-x402" && ["ordinary", "x402", "billing"].includes(config.realmProfile) && config.protocol === "mpp" && config.payBuyer === true && !["step", "caseId", "freezeCaseId", "freezeStage", "receiptCaseId", "receiptStage", "offerCaseId", "offerStage", "sellerCaseId", "supportCaseId", "supportStage", "preflightCaseId", "preflightStage", "dualCaseId", "dualStage"].some(key => Object.hasOwn(config, key)));
      if (Object.hasOwn(config, "dualCaseId") || Object.hasOwn(config, "dualStage")) requireValue(dualCaseIds.includes(config.dualCaseId) && (config.dualCaseId === "duplicate-incompatible-offers" ? ["negative", "positive"] : ["initial"]).includes(config.dualStage) && config.payBuyer === true && !["step", "caseId", "freezeCaseId", "freezeStage", "receiptCaseId", "receiptStage", "offerCaseId", "offerStage", "sellerCaseId", "supportCaseId", "supportStage", "preflightCaseId", "preflightStage"].some(key => Object.hasOwn(config, key)));
      if (Object.hasOwn(config, "preflightCaseId") || Object.hasOwn(config, "preflightStage")) requireValue(preflightCaseIds.includes(config.preflightCaseId) && (config.preflightCaseId === "pending-open-other-network" ? ["capture", "incompatible", "resume"] : ["negative", "positive"]).includes(config.preflightStage) && config.payBuyer === true && !["step", "caseId", "freezeCaseId", "freezeStage", "receiptCaseId", "receiptStage", "offerCaseId", "offerStage", "sellerCaseId", "supportCaseId", "supportStage"].some(key => Object.hasOwn(config, key)));
      requireValue(["require", "import"].includes(config.condition) && ["x402", "mpp"].includes(config.protocol) && typeof config.payBuyer === "boolean");
      for (const key of ["native", "pay", "certificates"]) requireValue(path(config[key]));
      if (Object.hasOwn(config, "store")) requireValue(path(config.store));
      if (Object.hasOwn(config, "step")) requireValue(recoveryStages.includes(config.step) || config.settleUnknownFinal === true && settleUnknownSteps.includes(config.step));
      if (Object.hasOwn(config, "caseId")) requireValue(claimCaseIds.includes(config.caseId) && config.payBuyer === true && !Object.hasOwn(config, "step"));
      if (Object.hasOwn(config, "freezeCaseId") || Object.hasOwn(config, "freezeStage")) requireValue((freezeCaseIds.includes(config.freezeCaseId) || config.protocolFreezeFinal===true && finalProtocolShapeCaseIds.includes(config.freezeCaseId)) && ["initial", "capture", "resume"].includes(config.freezeStage) && config.payBuyer === true && !Object.hasOwn(config, "step") && !Object.hasOwn(config, "caseId"));
      if (Object.hasOwn(config, "receiptCaseId") || Object.hasOwn(config, "receiptStage")) requireValue(receiptCaseIds.includes(config.receiptCaseId) && ["negative", "proof"].includes(config.receiptStage) && config.payBuyer === true && !["step", "caseId", "freezeCaseId", "freezeStage"].some(key => Object.hasOwn(config, key)));
      if (config.receiptCaseId === "wrong-receipt-network") requireValue(config.protocol === "x402");
      if (Object.hasOwn(config, "offerCaseId") || Object.hasOwn(config, "offerStage")) {
        const currentOnly = currentX402UnsupportedAuthorizationCases.offer.includes(config.offerCaseId) && !offerCaseIds.includes(config.offerCaseId);
        const mppAssetOnly = config.offerCaseId === "wrong-decimals" && config.mppAssetMismatchFinal === true;
        requireValue((offerCaseIds.includes(config.offerCaseId) || currentOnly && config.authorizationOffer === true || mppAssetOnly) && (mppAssetOnly ? config.protocol === "mpp" : currentOnly ? config.protocol === "x402" : !Object.hasOwn(offerCaseProtocols, config.offerCaseId) || offerCaseProtocols[config.offerCaseId] === config.protocol) && ["negative", "positive"].includes(config.offerStage) && config.payBuyer === true && !["step", "caseId", "freezeCaseId", "freezeStage", "receiptCaseId", "receiptStage"].some(key => Object.hasOwn(config, key)));
      }
      if (Object.hasOwn(config, "sellerCaseId") && !Object.hasOwn(config, "settleUnknownFinal")) requireValue(sellerCaseIds.includes(config.sellerCaseId) && config.payBuyer === false && !["store", "step", "caseId", "freezeCaseId", "freezeStage", "receiptCaseId", "receiptStage", "offerCaseId", "offerStage"].some(key => Object.hasOwn(config, key)));
      if (Object.hasOwn(config, "supportCaseId") || Object.hasOwn(config, "supportStage")) {
        requireValue(supportCaseIds.includes(config.supportCaseId) && ["negative", "positive"].includes(config.supportStage) && config.payBuyer === false && !["store", "step", "caseId", "freezeCaseId", "freezeStage", "receiptCaseId", "receiptStage", "offerCaseId", "offerStage", "sellerCaseId"].some(key => Object.hasOwn(config, key)));
        if (config.supportCaseId === "S-mpp-only-nondependency-positive") requireValue(config.protocol === "mpp" && config.supportStage === "positive");
        if (config.supportCaseId.startsWith("X-")) requireValue(config.protocol === "x402");
      }
      for (const key of ["facilitator", "merchant"]) if (Object.hasOwn(config, key)) {
        requireValue(typeof config[key] === "string" && /^https:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(config[key]));
        requireValue(Number(new URL(config[key]).port) <= 65535);
      }
    } else if (type === "wire-decoder-result") {
      record(message, ["type", "caseId", "stage", "counters", "events", "status", "classification", "responseSha256", "challenge", "receiptSha256", "receiptValid", "wrapperCalls", "wire"]);
      requireValue(wireDecoderCaseIds.includes(message.caseId) && ["negative", "positive"].includes(message.stage)); counts(message.counters); events(message.events);
      requireValue([200, 402].includes(message.status) && ["paid", "payment-required", "malformed-credential"].includes(message.classification));
      requireValue(digest(message.responseSha256) && typeof message.challenge === "boolean" && typeof message.receiptValid === "boolean" && (message.receiptSha256 === null || digest(message.receiptSha256)) && message.wrapperCalls === 1);
      const wire = message.wire;
      record(wire, ["field", "originalSha256", "transmittedSha256", "originalHeadersSha256", "transmittedHeadersSha256", "credentialHeadersSha256", "bodyBeforeSha256", "bodyAfterSha256", "bindingBeforeSha256", "bindingAfterSha256", "noncredentialBeforeSha256", "noncredentialAfterSha256"]);
      requireValue(["none", "selected-credential-encoding", "selected-credential-json"].includes(wire.field));
      for (const key of Object.keys(wire).filter(key => key !== "field")) requireValue(digest(wire[key]));
    } else if (type === "wire-result") {
      record(message, ["type", "caseId", "stage", "counters", "events", "status", "classification", "responseSha256", "challenge", "receiptSha256", "receiptValid", "wrapperCalls", "wire"]);
      requireValue(wireCaseIds.includes(message.caseId) && ["negative", "positive"].includes(message.stage)); counts(message.counters); events(message.events);
      requireValue([200, 400, 402].includes(message.status) && ["paid", "AMBIGUOUS_PAYMENT_CREDENTIAL", "PAYMENT_CREDENTIAL_INVALID", "no-matching-requirements", "malformed-credential", "invalid-challenge", "verification-failed", "temporal-rejected"].includes(message.classification));
      requireValue(digest(message.responseSha256) && typeof message.challenge === "boolean" && typeof message.receiptValid === "boolean" && (message.receiptSha256 === null || digest(message.receiptSha256)) && message.wrapperCalls === 1);
      const wire = message.wire;
      record(wire, ["field", "originalSha256", "transmittedSha256", "originalHeadersSha256", "transmittedHeadersSha256", "credentialHeadersSha256", "bodySha256", "unchangedBeforeSha256", "unchangedAfterSha256", "envelopeBeforeSha256", "envelopeAfterSha256"], ["decodedNetwork", "decodedSourceNetwork", "decodedPayeeSha256", "decodedAmountSha256", "decodedAssetSha256", "decodedDecimals", "codecOwner", "decoder", "encoder", "challengeBeforeSha256", "challengeAfterSha256", "payloadBeforeSha256", "payloadAfterSha256", "payloadRemainderBeforeSha256", "payloadRemainderAfterSha256", "challengeRemainderBeforeSha256", "challengeRemainderAfterSha256", "validAfter", "validBefore"]);
      requireValue(["none", "opposite-credential-header", "payload", "accepted.network", "accepted.asset", "challenge.request.methodDetails.chainId", "challenge.request.currency", "payload.authorization.to", "payload.authorization.value", "payload.to", "payload.value", "credential.source", "authorization.validity"].includes(wire.field));
      for (const key of ["originalSha256", "transmittedSha256", "originalHeadersSha256", "transmittedHeadersSha256", "credentialHeadersSha256", "bodySha256", "unchangedBeforeSha256", "unchangedAfterSha256", "envelopeBeforeSha256", "envelopeAfterSha256"]) requireValue(digest(wire[key]));
      const networkCodec = Object.hasOwn(wire, "decodedNetwork");
      const mppNetworkCodec = Object.hasOwn(wire, "decodedSourceNetwork");
      const mppPayeeCodec = Object.hasOwn(wire, "decodedPayeeSha256");
      const mppAmountCodec = Object.hasOwn(wire, "decodedAmountSha256");
      const assetCodec = Object.hasOwn(wire, "decodedAssetSha256");
      const temporalCodec = Object.hasOwn(wire, "validAfter") || Object.hasOwn(wire, "validBefore");
      requireValue([networkCodec, mppNetworkCodec, mppPayeeCodec, mppAmountCodec, assetCodec, temporalCodec].filter(Boolean).length <= 1);
      requireValue(!["codecOwner", "decoder", "encoder"].some(key => Object.hasOwn(wire, key)) || networkCodec || mppNetworkCodec || mppPayeeCodec || mppAmountCodec || assetCodec || temporalCodec);
      if (temporalCodec) {
        const mpp = wire.codecOwner.startsWith("mppx@"), negative = message.stage === "negative";
        requireValue(currentTemporalValidityCases[mpp ? "mpp" : "x402"].wire.includes(message.caseId) && wire.field === (negative ? "authorization.validity" : "none"));
        requireValue(/^\d{1,10}$/.test(wire.validAfter) && /^\d{1,10}$/.test(wire.validBefore));
        requireValue(mpp ? /^mppx@0\.8\.(17|19)$/.test(wire.codecOwner) && wire.decoder === "Credential.deserialize" && wire.encoder === "Credential.serialize" : /^@x402\/core@2\.(22|23)\.0$/.test(wire.codecOwner) && wire.decoder === "decodePaymentSignatureHeader" && wire.encoder === "encodePaymentSignatureHeader");
      }
      if (networkCodec) requireValue(message.caseId === "credential-offer-chain-mismatch" && ["eip155:84532", "eip155:8453"].includes(wire.decodedNetwork) && finalX402NetworkMismatchCodecOwners.has(wire.codecOwner) && wire.decoder === "decodePaymentSignatureHeader" && wire.encoder === "encodePaymentSignatureHeader");
      if (mppNetworkCodec) {
        for (const key of ["challengeBeforeSha256", "challengeAfterSha256", "payloadBeforeSha256", "payloadAfterSha256"]) requireValue(digest(wire[key]));
        const negative = message.stage === "negative";
        requireValue(message.caseId === "credential-offer-chain-mismatch" && wire.field === (negative ? "credential.source" : "none") && wire.decodedSourceNetwork === (negative ? "eip155:8453" : "eip155:84532") && finalMppNetworkMismatchCodecOwners.has(wire.codecOwner) && wire.decoder === "Credential.deserialize" && wire.encoder === "Credential.serialize");
        requireValue(wire.challengeBeforeSha256 === wire.challengeAfterSha256 && wire.payloadBeforeSha256 === wire.payloadAfterSha256);
        requireValue(message.status === (negative ? 402 : 200) && message.classification === (negative ? "verification-failed" : "paid") && message.challenge === negative);
      }
      if (assetCodec) {
        const negative = message.stage === "negative", mpp = finalMppAssetMismatchOwners.has(wire.codecOwner);
        requireValue(digest(wire.decodedAssetSha256));
        requireValue(message.caseId === "credential-offer-asset-mismatch" && (mpp ? finalMppAssetMismatchOwners : finalX402AssetMismatchOwners).has(wire.codecOwner));
        requireValue(wire.field === (negative ? (mpp ? "challenge.request.currency" : "accepted.asset") : "none"));
        requireValue(wire.decoder === (mpp ? "Credential.deserialize" : "decodePaymentSignatureHeader") && wire.encoder === (mpp ? "Credential.serialize" : "encodePaymentSignatureHeader"));
        requireValue(negative ? wire.originalSha256 !== wire.transmittedSha256 : wire.originalSha256 === wire.transmittedSha256);
        if (mpp) requireValue(digest(wire.challengeRemainderBeforeSha256) && digest(wire.challengeRemainderAfterSha256) && digest(wire.payloadBeforeSha256) && digest(wire.payloadAfterSha256) && wire.challengeRemainderBeforeSha256 === wire.challengeRemainderAfterSha256 && wire.payloadBeforeSha256 === wire.payloadAfterSha256);
      }
      if (mppPayeeCodec) {
        for (const key of ["decodedPayeeSha256", "challengeBeforeSha256", "challengeAfterSha256", "payloadRemainderBeforeSha256", "payloadRemainderAfterSha256"]) requireValue(digest(wire[key]));
        const negative = message.stage === "negative";
        requireValue(message.caseId === "credential-offer-recipient-mismatch" && wire.field === (negative ? "payload.to" : "none") && finalMppPayeeMismatchOwners.has(wire.codecOwner) && wire.decoder === "Credential.deserialize" && wire.encoder === "Credential.serialize");
        requireValue(wire.challengeBeforeSha256 === wire.challengeAfterSha256 && wire.payloadRemainderBeforeSha256 === wire.payloadRemainderAfterSha256);
        requireValue(message.status === (negative ? 402 : 200) && message.classification === (negative ? "verification-failed" : "paid") && message.challenge === negative);
      }
      if (mppAmountCodec) {
        for (const key of ["decodedAmountSha256", "challengeBeforeSha256", "challengeAfterSha256", "payloadRemainderBeforeSha256", "payloadRemainderAfterSha256"]) requireValue(digest(wire[key]));
        const negative = message.stage === "negative";
        requireValue(message.caseId === "credential-offer-amount-mismatch" && wire.field === (negative ? "payload.value" : "none") && finalMppAmountMismatchOwners.has(wire.codecOwner) && wire.decoder === "Credential.deserialize" && wire.encoder === "Credential.serialize");
        requireValue(wire.decodedAmountSha256 === finalMppAmountDigests[negative ? message.caseId : "positive"] && (negative ? wire.originalSha256 !== wire.transmittedSha256 : wire.originalSha256 === wire.transmittedSha256));
        requireValue(wire.challengeBeforeSha256 === wire.challengeAfterSha256 && wire.payloadRemainderBeforeSha256 === wire.payloadRemainderAfterSha256);
        requireValue(message.status === (negative ? 402 : 200) && message.classification === (negative ? "verification-failed" : "paid") && message.challenge === negative);
      }
    } else if (type === "realm-result") {
      record(message, ["type", "profile", "preference", "counters", "events", "status", "error", "pending", "saveAttempts", "clearAttempts", "saved", "offers", "sent", "receiptSha256", "receiptValid"]);
      requireValue(["ordinary", "x402", "billing"].includes(message.profile) && JSON.stringify(message.preference) === '["mpp"]'); counts(message.counters); events(message.events);
      requireValue([null, 200, 402].includes(message.status) && typeof message.pending === "boolean" && typeof message.receiptValid === "boolean" && number(message.saveAttempts, 1) && number(message.clearAttempts, 1));
      if (message.error !== null) {
        record(message.error, ["code", "phase", "retryable"]);
        const expected = { PAYMENT_OFFER_UNSUPPORTED: ["challenge", false], PAYMENT_CHALLENGE_INVALID: ["challenge", false], PAYMENT_POLICY_DENIED: ["policy", false], PAYMENT_SERVICE_UNAVAILABLE: ["request", true] }[message.error.code];
        requireValue(expected && message.error.phase === expected[0] && message.error.retryable === expected[1]);
      }
      if (message.saved !== null) {
        const saved = message.saved; record(saved, ["protocol", "protocolId", "network", "credentialSha256", "recordSha256", "ciphertextSha256", "keySha256", "economicSha256"]);
        requireValue(saved.protocol === "mpp" && saved.protocolId === "mpp-evm-charge-v0" && saved.network === "eip155:84532");
        for (const key of ["credentialSha256", "recordSha256", "ciphertextSha256", "keySha256", "economicSha256"]) requireValue(digest(saved[key]));
      }
      list(message.offers, value => { record(value, ["headerSha256", "urlSha256", "x402Present"]); requireValue(digest(value.headerSha256) && digest(value.urlSha256) && typeof value.x402Present === "boolean"); }, 1);
      list(message.sent, value => { record(value, ["protocol", "credentialSha256", "recordSha256"]); requireValue(value.protocol === "mpp" && digest(value.credentialSha256) && digest(value.recordSha256)); }, 1);
      requireValue(message.receiptSha256 === null || digest(message.receiptSha256));
    } else if (type === "dual-result") {
      record(message, ["type", "caseId", "stage", "preference", "counters", "events", "status", "error", "pending", "saveAttempts", "clearAttempts", "selectedProtocol", "saved", "offers", "sent", "receiptSha256", "receiptValid", "receiptOwner"]);
      const duplicate = message.caseId === "duplicate-incompatible-offers", negative = duplicate && message.stage === "negative";
      requireValue(dualCaseIds.includes(message.caseId) && (duplicate ? ["negative", "positive"] : ["initial"]).includes(message.stage));
      const selected = duplicate ? message.preference?.[0] : message.caseId.endsWith("-x402") ? "x402" : "mpp";
      requireValue(["x402", "mpp"].includes(selected) && JSON.stringify(message.preference) === JSON.stringify(duplicate ? [selected] : [selected, selected === "x402" ? "mpp" : "x402"]));
      counts(message.counters); events(message.events);
      requireValue(message.status === null || message.status === 200 || message.status === 402);
      if (negative) { record(message.error, ["code", "phase", "retryable"]); requireValue(message.error.code === "PAYMENT_CHALLENGE_INVALID" && message.error.phase === "challenge" && message.error.retryable === false); }
      else requireValue(message.error === null);
      requireValue(typeof message.pending === "boolean" && typeof message.receiptValid === "boolean");
      requireValue(number(message.saveAttempts, 1) && number(message.clearAttempts, 1) && message.selectedProtocol === (negative ? null : selected));
      const saved = message.saved;
      if (negative) requireValue(saved === null); else {
      record(saved, ["protocol", "protocolId", "network", "credentialSha256", "recordSha256", "ciphertextSha256", "keySha256"]);
      requireValue(saved.protocol === selected && saved.network === "eip155:84532" && saved.protocolId === (selected === "x402" ? "x402-exact-v2-eip3009" : "mpp-evm-charge-v0"));
      for (const key of ["credentialSha256", "recordSha256", "ciphertextSha256", "keySha256"]) requireValue(digest(saved[key]));
      }
      list(message.offers, value => { record(value, ["x402Sha256", "mppSha256", "urlSha256"]); requireValue(digest(value.urlSha256) && (duplicate ? digest(value[selected + "Sha256"]) && value[(selected === "mpp" ? "x402" : "mpp") + "Sha256"] === null : digest(value.x402Sha256) && digest(value.mppSha256))); }, 1);
      list(message.sent, value => { record(value, ["protocol", "credentialSha256", "recordSha256"]); requireValue(value.protocol === selected && digest(value.credentialSha256) && digest(value.recordSha256)); }, 1);
      requireValue(negative ? message.receiptSha256 === null && message.receiptOwner === null : digest(message.receiptSha256) && ["selected", "auxiliary"].includes(message.receiptOwner));
    } else if (type === "preflight-prepared") {
      record(message, ["type", "counters", "events", "credentialSha256", "recordSha256", "saveAttempts", "requests", "transports", "network"]);
      counts(message.counters); events(message.events); requireValue(digest(message.credentialSha256) && digest(message.recordSha256) && message.saveAttempts === 1 && message.network === "eip155:84532");
      list(message.requests, value => { record(value, ["method", "urlSha256", "bodySha256", "headersSha256", "credentialSha256", "signed"]); requireValue(value.method === "GET" && value.signed === false && value.credentialSha256 === null); for (const key of ["urlSha256", "bodySha256", "headersSha256"]) requireValue(digest(value[key])); }, 1);
      list(message.transports, value => { record(value, ["startedAtNs", "completedAtNs", "status", "errorIdentity"]); requireValue(timestamp(value.startedAtNs) && timestamp(value.completedAtNs) && value.status === 402 && value.errorIdentity === false); }, 1);
    } else if (type === "preflight-result") {
      record(message, ["type", "caseId", "stage", "network", "counters", "events", "status", "error", "pending", "pendingError", "saveAttempts", "clearAttempts", "credentialSha256", "recordSha256", "receiptSha256", "receiptValid", "input", "transports", "requests"]);
      const networkCase = message.caseId === "pending-open-other-network", conflict = networkCase && message.stage === "incompatible";
      requireValue(preflightCaseIds.includes(message.caseId) && (networkCase ? ["incompatible", "resume"] : ["negative", "positive"]).includes(message.stage) && message.network === (conflict ? "eip155:8453" : "eip155:84532")); counts(message.counters); events(message.events);
      requireValue(message.status === null || message.status === 200); requireValue(typeof message.receiptValid === "boolean");
      if (conflict) { requireValue(message.pending === null); record(message.pendingError, ["code", "phase", "retryable"]); requireValue(message.pendingError.code === "PENDING_PAYMENT_CONFLICT" && message.pendingError.phase === "recovery" && message.pendingError.retryable === false); }
      else requireValue(typeof message.pending === "boolean" && message.pendingError === null);
      requireValue(number(message.saveAttempts, 1) && number(message.clearAttempts, 1));
      for (const key of ["credentialSha256", "recordSha256", "receiptSha256"]) requireValue(message[key] === null || digest(message[key]));
      if (message.error !== null) { record(message.error, ["code", "phase", "retryable"]); requireValue(message.error.code === (conflict ? "PENDING_PAYMENT_CONFLICT" : "PAYMENT_SERVICE_UNAVAILABLE") && message.error.phase === (conflict ? "recovery" : "request") && message.error.retryable === !conflict); }
      const input = message.input;
      if (networkCase) requireValue(input === null);
      else {
      record(input, ["method", "bodyUsedBeforeCall", "bodyLockedBeforeCall", "bodySha256", "createdAtNs", "callAtNs", "completedAtNs", "pullCount", "failedAtNs"]);
      requireValue(input.method === "POST" && typeof input.bodyUsedBeforeCall === "boolean" && typeof input.bodyLockedBeforeCall === "boolean" && (input.bodySha256 === null || digest(input.bodySha256)) && number(input.pullCount, 1));
      for (const key of ["createdAtNs", "callAtNs", "completedAtNs"]) requireValue(timestamp(input[key])); requireValue(input.failedAtNs === null || timestamp(input.failedAtNs));
      }
      list(message.transports, value => { record(value, ["startedAtNs", "completedAtNs", "status", "errorIdentity"]); requireValue(timestamp(value.startedAtNs) && timestamp(value.completedAtNs) && (value.status === null || number(value.status, 599) && value.status >= 100) && typeof value.errorIdentity === "boolean"); }, 6);
      list(message.requests, value => { record(value, ["method", "urlSha256", "bodySha256", "headersSha256", "credentialSha256", "signed"]); requireValue(value.method === (networkCase ? "GET" : "POST") && typeof value.signed === "boolean" && (value.credentialSha256 === null || digest(value.credentialSha256))); for (const key of ["urlSha256", "bodySha256", "headersSha256"]) requireValue(digest(value[key])); }, 2);
    } else if (type === "support-call" || type === "support-caller-result") {
      record(message, type === "support-call" ? ["type", "caseId", "stage"] : ["type", "caseId", "stage", "calls", "counters", "events", "error", "result", "supportTransports"]);
      requireValue(supportCaseIds.includes(message.caseId) && message.caseId.startsWith("X-") && ["negative", "positive"].includes(message.stage));
      if (type === "support-caller-result") {
        const positive = message.stage === "positive";
        requireValue(message.calls === (positive ? 2 : 1)); counts(message.counters); events(message.events);
        list(message.supportTransports, value => { record(value, ["startedAtNs", "completedAtNs", "responseStatus", "transportError"]); requireValue(timestamp(value.startedAtNs) && timestamp(value.completedAtNs) && [null, 200].includes(value.responseStatus) && [null, "ABORT_ERR"].includes(value.transportError)); }, 2);
        if (positive) {
          requireValue(message.error === null); record(message.result, ["kinds", "extensions", "signers"]);
          requireValue(JSON.stringify(message.result) === JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }], extensions: [], signers: {} }));
        } else {
          requireValue(message.result === null); const error = message.error;
          record(error, ["nativeInstance", "causeInstance", "causeIdentity", "causeDescriptor", "code", "phase", "retryable", "errorSha256", "causeSha256"]);
          requireValue(error.nativeInstance === true && error.causeInstance === true && error.causeIdentity === true && error.code === "PAYMENT_SERVICE_UNAVAILABLE" && error.phase === "request" && error.retryable === true && digest(error.errorSha256) && digest(error.causeSha256));
          record(error.causeDescriptor, ["enumerable", "writable", "configurable"]); requireValue(Object.values(error.causeDescriptor).every(value => value === false));
        }
      }
    } else if (type === "mpp-authorization-result") {
      record(message, ["type", "caseId", "stage", "counters", "events", "status", "classification", "responseSha256", "challenge", "receiptSha256", "receiptValid", "wrapperCalls", "targetSelection", "actualSelection"]);
      requireValue(message.caseId === "unsupported-authorization-payload" && ["negative", "positive"].includes(message.stage)); counts(message.counters); events(message.events);
      requireValue(message.status === (message.stage === "negative" ? 402 : 200) && message.classification === (message.stage === "negative" ? "invalid-payload" : "paid"));
      requireValue(digest(message.responseSha256) && typeof message.challenge === "boolean" && typeof message.receiptValid === "boolean" && (message.receiptSha256 === null || digest(message.receiptSha256)) && message.wrapperCalls === 1);
      const selection = message.stage === "negative" ? message.targetSelection : message.actualSelection;
      requireValue((message.stage === "negative" ? message.actualSelection : message.targetSelection) === null);
      record(selection, ["protocol", "method", "intent", "authorization", "owner", "operation", "wireSha256"]);
      requireValue(selection.protocol === "mpp" && selection.method === "evm" && selection.intent === "charge" && finalMppUnsupportedAuthorizationOwners.includes(selection.owner) && selection.authorization === (message.stage === "negative" ? "future-authorization" : "authorization") && selection.operation === "credential-decode" && digest(selection.wireSha256));
    } else if (type === "authorization-result") {
      record(message, ["type", "caseId", "stage", "counters", "events", "status", "classification", "responseSha256", "challenge", "receiptSha256", "receiptValid", "wrapperCalls", "targetSelector", "actualSelector"]);
      requireValue(currentX402UnsupportedAuthorizationCaseIds.includes(message.caseId) && ["negative", "positive"].includes(message.stage)); counts(message.counters); events(message.events);
      requireValue(message.status === (message.stage === "negative" ? 402 : 200) && message.classification === (message.stage === "negative" ? "no-matching-requirements" : "paid"));
      requireValue(digest(message.responseSha256) && typeof message.challenge === "boolean" && typeof message.receiptValid === "boolean" && (message.receiptSha256 === null || digest(message.receiptSha256)) && message.wrapperCalls === 1);
      if (message.stage === "negative") {
        record(message.targetSelector, ["field", "valueSha256", "owner"]);
        requireValue(message.targetSelector.field === (message.caseId === "upto" ? "accepts.scheme" : "accepts.extra.assetTransferMethod") && digest(message.targetSelector.valueSha256) && ["@x402/evm@2.23.0", "@x402/evm@2.22.0"].includes(message.targetSelector.owner));
      } else requireValue(message.targetSelector === null);
      record(message.actualSelector, ["scheme", "assetTransferMethod", "owner"]);
      const expectedActual = message.stage === "positive" ? ["exact", "eip3009"] : message.caseId === "upto" ? ["upto", "eip3009"] : message.caseId === "permit2" ? ["exact", "permit2"] : ["exact", "future-transfer"];
      requireValue(message.actualSelector.scheme === expectedActual[0] && message.actualSelector.assetTransferMethod === expectedActual[1] && ["@x402/evm@2.23.0", "@x402/evm@2.22.0"].includes(message.actualSelector.owner));
    } else if (type === "support-buyer-result") {
      record(message, ["type", "caseId", "stage", "counters", "events", "status", "error", "retryAfter", "receiptSha256", "receiptValid", "wrapperCalls", "challenges", "signedProtocols", "selectedChallengeSha256"]);
      requireValue(supportCaseIds.includes(message.caseId) && message.caseId.startsWith("S-") && ["negative", "positive"].includes(message.stage)); counts(message.counters); events(message.events);
      requireValue([200, 502].includes(message.status) && message.wrapperCalls === 1 && typeof message.receiptValid === "boolean");
      requireValue(message.retryAfter === null || message.retryAfter === "2");
      for (const key of ["receiptSha256", "selectedChallengeSha256"]) requireValue(message[key] === null || digest(message[key]));
      if (message.error !== null) { record(message.error, ["code", "retryable"]); requireValue(message.error.code === "PAYMENT_SERVICE_UNAVAILABLE" && message.error.retryable === true); }
      list(message.challenges, value => { record(value, ["protocol", "headerSha256"], ["challengeIdSha256"]); requireValue(["x402", "mpp"].includes(value.protocol) && digest(value.headerSha256)); if (value.protocol === "mpp") requireValue(digest(value.challengeIdSha256)); }, 2);
      list(message.signedProtocols, value => requireValue(["x402", "mpp"].includes(value)), 1);
    } else if (type === "replay-proceed") {
      record(message, ["type", "caseId"]); requireValue(message.caseId === "same-process-replay");
    } else if (type === "replay-result") {
      record(message, ["type", "caseId", "stage", "counters", "events", "status", "errorCode", "pending", "credentialSha256", "recordSha256", "receiptSha256", "receiptValid"]);
      requireValue(currentReplayCases.buyer.includes(message.caseId) && ["first", "replay"].includes(message.stage)); counts(message.counters); events(message.events);
      requireValue(typeof message.pending === "boolean" && typeof message.receiptValid === "boolean" && digest(message.credentialSha256) && digest(message.recordSha256));
      if (message.stage === "first") requireValue(message.status === null && message.errorCode === "PAYMENT_RECEIPT_MISSING" && message.pending === true && message.receiptSha256 === null && message.receiptValid === false);
      else requireValue(message.status === 200 && message.errorCode === null && message.pending === false && digest(message.receiptSha256) && message.receiptValid === true);
    } else if (type === "seller-retry") {
      record(message, ["type", "caseId"]); requireValue(sellerCaseIds.includes(message.caseId) && message.caseId !== "handler-200");
    } else if (type === "seller-result") {
      record(message, ["type", "caseId", "stage", "counters", "events", "status", "error", "retryAfter", "receiptSha256", "receiptValid", "wrapperCalls", "requests"], ["receiptFields"]);
      requireValue(sellerCaseIds.includes(message.caseId) && ["first", "retry"].includes(message.stage)); counts(message.counters); events(message.events);
      requireValue(number(message.status, 599) && message.status >= 100 && message.wrapperCalls === 1 && typeof message.receiptValid === "boolean");
      requireValue(message.retryAfter === null || message.retryAfter === "2"); requireValue(message.receiptSha256 === null || digest(message.receiptSha256));
      if (Object.hasOwn(message, "receiptFields")) { list(message.receiptFields, value => requireValue(["method", "status", "reference", "timestamp", "success", "transaction", "network", "payer"].includes(value)), 8); requireValue(!message.receiptFields.includes("paymentId")); }
      if (message.error !== null) { record(message.error, ["code", "retryable"]); requireValue(message.error.code === "HANDLER_ERROR" && message.error.retryable === false || message.error.code === "PAYMENT_STATUS_UNKNOWN" && message.error.retryable === true); }
      list(message.requests, request => { record(request, ["method", "urlSha256", "headersSha256", "bodySha256", "credentialSha256"]); requireValue(request.method === "GET"); for (const key of ["urlSha256", "headersSha256", "bodySha256", "credentialSha256"]) requireValue(digest(request[key])); }, 2);
      requireValue(message.requests.length > 0);
    } else if (type === "offer-result") {
      record(message, ["type", "caseId", "counters", "events", "status", "error", "pending", "credentialSha256", "recordSha256", "saveAttempts", "clearAttempts", "receiptSha256", "receiptValid"], ["authorizationOffer", "stage", "targetSelector", "actualSelector", "mppAuthorizationOffer", "targetSelection", "actualSelection"]);
      requireValue(offerCaseIds.includes(message.caseId) || currentX402UnsupportedAuthorizationCases.offer.includes(message.caseId) || message.caseId === "wrong-decimals"); counts(message.counters); events(message.events);
      requireValue(number(message.status, 599) && message.status >= 100 && typeof message.pending === "boolean" && typeof message.receiptValid === "boolean" && number(message.saveAttempts, 10) && number(message.clearAttempts, 10));
      for (const key of ["credentialSha256", "recordSha256", "receiptSha256"]) requireValue(message[key] === null || digest(message[key]));
      if (["authorizationOffer", "targetSelector", "actualSelector"].some(key => Object.hasOwn(message, key))) {
        requireValue(message.authorizationOffer === true && ["authorizationOffer", "stage", "targetSelector", "actualSelector"].every(key => Object.hasOwn(message, key)) && currentX402UnsupportedAuthorizationCases.offer.includes(message.caseId) && ["negative", "positive"].includes(message.stage));
        if (message.stage === "negative") {
          record(message.targetSelector, ["field", "valueSha256", "owner"]);
          requireValue(message.targetSelector.field === (message.caseId === "upto" ? "accepts.scheme" : "accepts.extra.assetTransferMethod") && digest(message.targetSelector.valueSha256) && ["@x402/evm@2.23.0", "@x402/evm@2.22.0"].includes(message.targetSelector.owner) && message.actualSelector === null);
        } else {
          requireValue(message.targetSelector === null);
          record(message.actualSelector, ["scheme", "assetTransferMethod", "owner"]);
          requireValue(message.actualSelector.scheme === "exact" && message.actualSelector.assetTransferMethod === "eip3009" && ["@x402/evm@2.23.0", "@x402/evm@2.22.0"].includes(message.actualSelector.owner));
        }
      }
      if (["mppAuthorizationOffer", "targetSelection", "actualSelection"].some(key => Object.hasOwn(message, key))) {
        requireValue(message.mppAuthorizationOffer === true && ["mppAuthorizationOffer", "stage", "targetSelection", "actualSelection"].every(key => Object.hasOwn(message, key)) && currentMppUnsupportedAuthorizationCases.offer.includes(message.caseId) && ["negative", "positive"].includes(message.stage));
        const selection = message.stage === "negative" ? message.targetSelection : message.actualSelection;
        requireValue((message.stage === "negative" ? message.actualSelection : message.targetSelection) === null);
        record(selection, ["protocol", "method", "intent", "authorization", "owner", "operation", "wireSha256"]);
        const expected = message.stage === "positive" ? ["evm", "charge", "authorization", "credential-decode"] : message.caseId === "session-intent" ? ["evm", "session", null, "challenge-decode"] : ["tempo", "charge", null, "challenge-decode"];
        requireValue(selection.protocol === "mpp" && finalMppUnsupportedAuthorizationOwners.includes(selection.owner) && selection.method === expected[0] && selection.intent === expected[1] && selection.authorization === expected[2] && selection.operation === expected[3] && digest(selection.wireSha256));
      }
      if (message.error !== null) {
        record(message.error, ["code", "phase", "retryable"]);
        requireValue(["PAYMENT_CHALLENGE_INVALID", "PAYMENT_POLICY_DENIED", "PAYMENT_OFFER_UNSUPPORTED", "PAYMENT_SERVICE_UNAVAILABLE"].includes(message.error.code) && ["challenge", "policy", "request"].includes(message.error.phase) && typeof message.error.retryable === "boolean");
      }
    } else if (type === "receipt-result") {
      record(message, ["type", "caseId", "counters", "events", "status", "error", "pending", "credentialSha256", "recordSha256", "sentCiphertextSha256", "clearAttempts", "receiptSha256", "receiptValid"], ["verifierCalls"]);
      requireValue(receiptCaseIds.includes(message.caseId)); counts(message.counters); events(message.events);
      requireValue(number(message.status, 599) && message.status >= 100 && typeof message.pending === "boolean" && typeof message.receiptValid === "boolean" && number(message.clearAttempts, 1));
      for (const key of ["credentialSha256", "recordSha256", "sentCiphertextSha256"]) requireValue(digest(message[key]));
      requireValue(message.receiptSha256 === null || digest(message.receiptSha256));
      if (Object.hasOwn(message, "verifierCalls")) list(message.verifierCalls, value => { record(value, ["decision", "inputSha256"]); requireValue(["false", "throws"].includes(value.decision) && digest(value.inputSha256)); }, 1);
      if (message.error !== null) {
        record(message.error, ["code", "phase", "retryable"]);
        requireValue(failureCodes.has(message.error.code) && ["request", "receipt", "recovery"].includes(message.error.phase) && typeof message.error.retryable === "boolean");
      }
    } else if (type === "freeze-result") {
      record(message, ["type", "caseId", "counters", "events", "status", "errorCode", "pending", "pendingError", "credentialSha256", "recordSha256", "requests"]);
      requireValue(freezeCaseIds.includes(message.caseId) || finalProtocolShapeCaseIds.includes(message.caseId)); counts(message.counters); events(message.events);
      requireValue(message.status === null || number(message.status, 599) && message.status >= 100);
      for (const key of ["errorCode", "pendingError"]) requireValue(message[key] === null || freezeErrors.has(message[key]));
      requireValue(typeof message.pending === "boolean" || message.pending === null && message.pendingError !== null);
      for (const key of ["credentialSha256", "recordSha256"]) requireValue(message[key] === null || digest(message[key]));
      list(message.requests, request => {
        record(request, ["signed", "redirect", "status", "credentialSha256", "protocol", "network", "bodySha256", "method"]);
        requireValue(typeof request.signed === "boolean" && ["manual", "follow", "error"].includes(request.redirect));
        requireValue(number(request.status, 599) && request.status >= 100 && digest(request.bodySha256) && ["GET", "POST"].includes(request.method));
        requireValue(request.signed ? digest(request.credentialSha256) && ["x402", "mpp"].includes(request.protocol) && request.network === "eip155:84532" : request.credentialSha256 === null && request.protocol === null && request.network === null);
      }, 10);
    } else if (type.startsWith("claim-")) {
      requireValue(claimCaseIds.includes(message.caseId));
      if (["claim-release", "claim-proceed"].includes(type)) record(message, ["type", "caseId"]);
      else if (type === "claim-decided") {
        record(message, ["type", "caseId", "saveOutcome", "storageError"]); claimDecision(message);
      } else if (type === "claim-ready") {
        record(message, ["type", "caseId", "counters", "saveAttempts", "candidateCredentialSha256", "candidateRecordSha256"]);
        counts(message.counters); requireValue(message.saveAttempts === 1);
        requireValue(digest(message.candidateCredentialSha256) && digest(message.candidateRecordSha256));
      } else {
        record(message, ["type", "caseId", "counters", "events", "saveAttempts", "saveOutcome", "storageError", "candidateCredentialSha256", "candidateRecordSha256", "calls", "pending", "status", "receiptSha256", "receiptValid"]);
        counts(message.counters); events(message.events); claimDecision(message);
        requireValue(message.saveAttempts === 1 && digest(message.candidateCredentialSha256) && digest(message.candidateRecordSha256));
        requireValue(typeof message.pending === "boolean" && typeof message.receiptValid === "boolean");
        requireValue(message.status === null || number(message.status, 599) && message.status >= 100);
        requireValue(digest(message.receiptSha256) || message.receiptSha256 === null && message.receiptValid === false);
        list(message.calls, call => {
          record(call, ["status", "errorCode"]);
          requireValue(call.errorCode === null ? number(call.status, 599) && call.status >= 100 : call.status === null && ["PAYMENT_IN_PROGRESS", "PENDING_PAYMENT_CLAIMED", "PAYMENT_RECEIPT_MISSING", "PAYMENT_SERVICE_UNAVAILABLE"].includes(call.errorCode));
        }, 2);
        requireValue(message.calls.length > 0);
      }
    } else if (["configure", "configured"].includes(type)) {
      record(message, ["type", "step"]); requireValue(recoveryStages.includes(message.step) || settleUnknownSteps.includes(message.step));
    } else if (type === "identified") {
      record(message, ["type", "pid", "inventory"]); requireValue(number(message.pid) && message.pid > 0); inventory(message.inventory);
    } else if (type === "ready") { record(message, ["type", "port"]); requireValue(number(message.port, 65535)); }
    else if (["snapshot", "closed"].includes(type)) {
      record(message, ["type", "counters", "failures", "events"], ["received", "dependencyErrors", "redirectTargets", "offers", "requestBodies", "supportedProtocols", "rpcReads", "receiptChanges", "offerChanges", "fulfillmentAttempts", "settlementObservations", "handlerObservations", "fulfillmentObservations", "supportArrivals", "supportTransports", "businessArrivals", "dualOffers", "dualArrivals", "protocolCounters", "protocolArrivals", "duplicate", "realmOffers", "realmArrivals", "realmPrivateArrivals", "wireArrivals", "wirePrivateArrivals"]); counts(message.counters); events(message.events);
      if (Object.hasOwn(message, "wireArrivals")) list(message.wireArrivals, value => {
        record(value, ["stage", "atNs", "bodyReadAtNs", "protocol", "credentialSha256", "credentialHeadersSha256", "bodySha256", "responseStatus", "completedAtNs"]);
        requireValue(["negative", "positive"].includes(value.stage) && timestamp(value.atNs) && [null, "x402", "mpp", "both"].includes(value.protocol));
        requireValue(value.credentialSha256 === null || digest(value.credentialSha256)); requireValue(digest(value.credentialHeadersSha256));
        requireValue(value.bodyReadAtNs === null ? value.bodySha256 === null : timestamp(value.bodyReadAtNs) && digest(value.bodySha256));
        requireValue(value.completedAtNs === null ? value.responseStatus === null : timestamp(value.completedAtNs) && number(value.responseStatus, 599) && value.responseStatus >= 100);
      }, 4);
      if (Object.hasOwn(message, "wirePrivateArrivals")) list(message.wirePrivateArrivals, value => {
        record(value, ["stage", "operation", "atNs", "bodyReadAtNs", "stampMetadataValidatedAtNs", "authorizationValidatedAtNs", "responseStatus", "completedAtNs"]);
        requireValue(["negative", "positive"].includes(value.stage) && ["supported", "verify", "charge", "fulfillment", "other"].includes(value.operation) && timestamp(value.atNs));
        for (const key of ["bodyReadAtNs", "stampMetadataValidatedAtNs", "authorizationValidatedAtNs"]) requireValue(value[key] === null || timestamp(value[key]));
        requireValue(value.completedAtNs === null ? value.responseStatus === null : timestamp(value.completedAtNs) && number(value.responseStatus, 599) && value.responseStatus >= 100);
      }, 8);
      if (Object.hasOwn(message, "realmOffers")) list(message.realmOffers, value => {
        record(value, ["profile", "realm", "method", "intent", "amount", "network", "urlSha256", "headerSha256", "challengeSha256", "idSha256", "economicSha256"]);
        requireValue(["ordinary", "x402", "billing"].includes(value.profile) && value.realm === (value.profile === "ordinary" ? "127.0.0.1" : value.profile) && value.method === "evm" && value.intent === "charge" && value.amount === "10000" && value.network === "eip155:84532");
        for (const key of ["urlSha256", "headerSha256", "challengeSha256", "idSha256", "economicSha256"]) requireValue(digest(value[key]));
      }, 1);
      if (Object.hasOwn(message, "realmArrivals")) list(message.realmArrivals, value => { record(value, ["atNs", "method", "urlSha256", "protocol"]); requireValue(timestamp(value.atNs) && value.method === "GET" && digest(value.urlSha256) && [null, "x402", "mpp", "both"].includes(value.protocol)); }, 2);
      if (Object.hasOwn(message, "realmPrivateArrivals")) list(message.realmPrivateArrivals, value => { record(value, ["atNs", "method", "path", "wireProtocol"]); requireValue(timestamp(value.atNs) && ["GET", "POST"].includes(value.method) && ["/v1/settlements/charge", "/supported", "/verify", "/settle"].includes(value.path) && [null, "x402", "mpp"].includes(value.wireProtocol)); }, 4);
      if (Object.hasOwn(message, "duplicate") && message.duplicate !== null) { const value = message.duplicate; record(value, ["protocol", "firstSha256", "secondSha256", "coalescedSha256", "envelopeBeforeSha256", "envelopeAfterSha256"]); requireValue(["mpp", "x402"].includes(value.protocol)); for (const key of ["firstSha256", "secondSha256", "coalescedSha256", "envelopeBeforeSha256", "envelopeAfterSha256"]) requireValue(digest(value[key])); }
      if (Object.hasOwn(message, "dualArrivals")) list(message.dualArrivals, value => { record(value, ["atNs", "method", "urlSha256", "protocol"]); requireValue(timestamp(value.atNs) && value.method === "GET" && digest(value.urlSha256) && [null, "x402", "mpp", "both"].includes(value.protocol)); }, 3);
      if (Object.hasOwn(message, "protocolCounters")) { record(message.protocolCounters, ["x402", "mpp"]); counts(message.protocolCounters.x402); counts(message.protocolCounters.mpp); }
      if (Object.hasOwn(message, "dualOffers")) list(message.dualOffers, value => {
        record(value, ["protocol", "owner", "priceProfile", "urlSha256", "headerSha256", "decodedSha256", "amount", "network", "economicSha256"]);
        requireValue(["x402", "mpp"].includes(value.protocol) && ["selected", "auxiliary"].includes(value.owner) && ["standard", "duplicate-second"].includes(value.priceProfile) && value.amount === (value.priceProfile === "standard" ? "10000" : "5000") && value.network === "eip155:84532");
        for (const key of ["urlSha256", "headerSha256", "decodedSha256", "economicSha256"]) requireValue(digest(value[key]));
      }, 3);
      if (Object.hasOwn(message, "protocolArrivals")) list(message.protocolArrivals, value => {
        record(value, ["path", "method", "atNs", "wireProtocol"]);
        const protocol = value.path.startsWith("/dual-x402/") ? "x402" : "mpp";
        requireValue(["/dual-x402/supported", "/dual-x402/verify", "/dual-x402/settle", "/dual-x402/v1/settlements/charge", "/dual-mpp/v1/settlements/charge"].includes(value.path));
        requireValue(value.method === (value.path.endsWith("/supported") ? "GET" : "POST") && timestamp(value.atNs) && (value.wireProtocol === null || value.wireProtocol === protocol));
      }, 6);
      if (Object.hasOwn(message, "businessArrivals")) list(message.businessArrivals, value => {
        record(value, ["atNs", "method", "urlSha256", "bodyReadAtNs", "bodySha256", "credentialSha256"]);
        requireValue(timestamp(value.atNs) && typeof value.method === "string" && /^[A-Z]{1,20}$/.test(value.method) && digest(value.urlSha256));
        requireValue(value.bodyReadAtNs === null ? value.bodySha256 === null : timestamp(value.bodyReadAtNs) && digest(value.bodySha256)); requireValue(value.credentialSha256 === null || digest(value.credentialSha256));
      }, 2);
      if (Object.hasOwn(message, "supportArrivals")) list(message.supportArrivals, value => {
        record(value, ["atNs", "wireProtocol", "responseStatus", "responseKind", "responseSha256"]);
        requireValue(timestamp(value.atNs) && value.wireProtocol === "x402" && ["timeout", "invalid-json", "invalid-shape", "supported"].includes(value.responseKind));
        requireValue(value.responseKind === "timeout" ? value.responseStatus === null && value.responseSha256 === null : value.responseStatus === 200 && digest(value.responseSha256));
      }, 2);
      if (Object.hasOwn(message, "supportTransports")) list(message.supportTransports, value => {
        record(value, ["startedAtNs", "completedAtNs", "responseStatus", "transportError"]);
        requireValue(timestamp(value.startedAtNs) && timestamp(value.completedAtNs) && (value.responseStatus === null ? value.transportError === "ABORT_ERR" : value.responseStatus === 200 && value.transportError === null));
      }, 2);
      if (Object.hasOwn(message, "fulfillmentAttempts")) list(message.fulfillmentAttempts, value => {
        record(value, ["state", "failureCode", "paymentIdSha256", "atNs", "responseStatus", "acknowledged"]);
        requireValue(["FULFILLED", "FAILED"].includes(value.state) && (value.state === "FAILED" ? value.failureCode === "HANDLER_ERROR" : value.failureCode === null));
        requireValue(digest(value.paymentIdSha256) && timestamp(value.atNs) && [null, 200, 204, 503].includes(value.responseStatus) && value.acknowledged === (value.responseStatus === 200));
      }, 2);
      if (Object.hasOwn(message, "fulfillmentObservations")) list(message.fulfillmentObservations, value => {
        record(value, ["startedAtNs", "completedAtNs", "responseStatus", "acknowledged", "transportError"]);
        requireValue(timestamp(value.startedAtNs) && timestamp(value.completedAtNs) && [null, 200, 204, 503].includes(value.responseStatus) && value.acknowledged === (value.responseStatus === 200));
        requireValue(value.responseStatus === null ? ["ABORT_ERR", "ECONNRESET"].includes(value.transportError) : value.transportError === null);
      }, 2);
      if (Object.hasOwn(message, "settlementObservations")) list(message.settlementObservations, value => {
        record(value, ["protocol", "paymentIdSha256", "economicSha256", "atNs"]);
        requireValue(["x402", "mpp"].includes(value.protocol) && digest(value.paymentIdSha256) && digest(value.economicSha256) && timestamp(value.atNs));
      }, 2);
      if (Object.hasOwn(message, "handlerObservations")) list(message.handlerObservations, value => {
        record(value, ["protocol", "paymentIdSha256", "settlementAtNs", "atNs", "responseStatus", "receiptInjected"]);
        requireValue(["x402", "mpp"].includes(value.protocol) && digest(value.paymentIdSha256) && timestamp(value.settlementAtNs) && timestamp(value.atNs) && [null, 200, 302, 400, 404, 500].includes(value.responseStatus) && typeof value.receiptInjected === "boolean");
      }, 2);
      if (Object.hasOwn(message, "offerChanges")) list(message.offerChanges, value => {
        record(value, ["caseId", "stage", "field", "beforeSha256", "afterSha256", "envelopeBeforeSha256", "envelopeAfterSha256"], ["unchangedBeforeSha256", "unchangedAfterSha256", "requestBeforeSha256", "requestAfterSha256", "decodedNetwork", "decodedChainId", "decodedPayeeSha256", "decodedAmountSha256", "decodedAssetSha256", "decodedDecimals", "codecOwner", "decoder", "encoder"]);
        requireValue((offerCaseIds.includes(value.caseId) || currentX402UnsupportedAuthorizationCases.offer.includes(value.caseId) || value.caseId === "wrong-decimals") && ["negative", "positive"].includes(value.stage) && ["none", "request-encoding", "header-encoding", "request.methodDetails.chainId", "request.methodDetails.decimals", "accepts.network", "request.currency", "accepts.asset", "request.recipient", "accepts.payTo", "request.amount", "accepts.amount", "accepts.scheme", "accepts.extra.assetTransferMethod", "challenge.method", "challenge.intent", "challenge.expires"].includes(value.field));
        for (const key of ["beforeSha256", "afterSha256", "envelopeBeforeSha256", "envelopeAfterSha256"]) requireValue(digest(value[key]));
        if (["unsupported-scheme", "upto", "permit2", "unknown-required-extension", "malformed-price", "session-intent", "non-evm-method", "expired-challenge"].includes(value.caseId) || Object.hasOwn(value, "unchangedBeforeSha256") || Object.hasOwn(value, "unchangedAfterSha256")) requireValue(digest(value.unchangedBeforeSha256) && digest(value.unchangedAfterSha256));
        if (["session-intent", "non-evm-method", "expired-challenge"].includes(value.caseId) || Object.hasOwn(value, "requestBeforeSha256") || Object.hasOwn(value, "requestAfterSha256")) requireValue(digest(value.requestBeforeSha256) && digest(value.requestAfterSha256));
        const networkCodec = Object.hasOwn(value, "decodedNetwork");
        const mppNetworkCodec = Object.hasOwn(value, "decodedChainId");
        const mppPayeeCodec = Object.hasOwn(value, "decodedPayeeSha256");
        const mppAmountCodec = Object.hasOwn(value, "decodedAmountSha256");
        const assetCodec = Object.hasOwn(value, "decodedAssetSha256");
        requireValue([networkCodec, mppNetworkCodec, mppPayeeCodec, mppAmountCodec, assetCodec].filter(Boolean).length <= 1);
        requireValue(!["codecOwner", "decoder", "encoder"].some(key => Object.hasOwn(value, key)) || networkCodec || mppNetworkCodec || mppPayeeCodec || mppAmountCodec || assetCodec);
        if (networkCodec && !mppNetworkCodec) requireValue(currentX402NetworkMismatchCases.offer.includes(value.caseId) && ["none", "accepts.network"].includes(value.field) && ["eip155:84532", "eip155:8453", "eip155:1"].includes(value.decodedNetwork) && finalX402NetworkMismatchCodecOwners.has(value.codecOwner) && value.decoder === "decodePaymentRequiredHeader" && value.encoder === "encodePaymentRequiredHeader");
        if (mppNetworkCodec) {
          const expectedChainId = value.stage === "positive" ? 84532 : value.caseId === "other-base-network-offer" ? 8453 : 1;
          requireValue(currentMppNetworkMismatchCases.offer.includes(value.caseId) && value.field === (value.stage === "negative" ? "request.methodDetails.chainId" : "none") && value.decodedChainId === expectedChainId && finalMppNetworkMismatchCodecOwners.has(value.codecOwner) && value.decoder === "Challenge.fromResponse" && value.encoder === "Challenge.serialize");
        }
        if (assetCodec) {
          const mpp = value.field.startsWith("request.") || value.field === "none" && finalMppAssetMismatchOwners.has(value.codecOwner);
          requireValue(digest(value.decodedAssetSha256));
          requireValue((mpp ? currentMppAssetMismatchCases : currentX402AssetMismatchCases).offer.includes(value.caseId) && value.field === (value.stage === "negative" ? value.caseId === "wrong-decimals" ? "request.methodDetails.decimals" : (mpp ? "request.currency" : "accepts.asset") : "none"));
          if (mpp) requireValue(value.decodedDecimals === (value.stage === "negative" && value.caseId === "wrong-decimals" ? 18 : 6));
          requireValue((mpp ? finalMppAssetMismatchOwners : finalX402AssetMismatchOwners).has(value.codecOwner) && value.decoder === (mpp ? "Challenge.fromResponse" : "decodePaymentRequiredHeader") && value.encoder === (mpp ? "Challenge.serialize" : "encodePaymentRequiredHeader"));
          requireValue(value.stage === "negative" ? value.beforeSha256 !== value.afterSha256 : value.beforeSha256 === value.afterSha256);
        }
        if (mppPayeeCodec) requireValue(value.caseId === "invalid-recipient-offer" && value.field === (value.stage === "negative" ? "request.recipient" : "none") && digest(value.decodedPayeeSha256) && digest(value.unchangedBeforeSha256) && value.unchangedBeforeSha256 === value.unchangedAfterSha256 && digest(value.envelopeBeforeSha256) && value.envelopeBeforeSha256 === value.envelopeAfterSha256 && finalMppPayeeMismatchOwners.has(value.codecOwner) && value.decoder === "Challenge.fromResponse" && value.encoder === "Challenge.serialize");
        if (mppAmountCodec) {
          const negative = value.stage === "negative";
          requireValue(currentMppAmountMismatchCases.offer.includes(value.caseId) && value.field === (negative ? "request.amount" : "none") && value.decodedAmountSha256 === finalMppAmountDigests[negative ? value.caseId : "positive"] && (negative ? value.beforeSha256 !== value.afterSha256 : value.beforeSha256 === value.afterSha256) && digest(value.unchangedBeforeSha256) && value.unchangedBeforeSha256 === value.unchangedAfterSha256 && digest(value.envelopeBeforeSha256) && value.envelopeBeforeSha256 === value.envelopeAfterSha256 && finalMppAmountMismatchOwners.has(value.codecOwner) && value.decoder === "Challenge.fromResponse" && value.encoder === "Challenge.serialize");
        }
      }, 2);
      if (Object.hasOwn(message, "rpcReads")) list(message.rpcReads, value => {
        record(value, ["method", "stage", "resultSha256"], ["originalResultSha256", "paramsSha256", "field", "responseStatus"]);
        requireValue(["eth_chainId", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByNumber"].includes(value.method) && ["negative", "proof"].includes(value.stage) && digest(value.resultSha256));
        if (["originalResultSha256", "paramsSha256", "field"].some(key => Object.hasOwn(value, key))) requireValue(digest(value.originalResultSha256) && digest(value.paramsSha256) && ["none", "chainId", "transaction.to", "transaction.input.from", "transaction.input.to", "transaction.input.value", "transaction.input.nonce", "transaction.input.validBefore", "transaction.input", "receipt.logs.Transfer", "receipt.logs.AuthorizationUsed", "block.hash", "receipt.status", "transaction.hash", "response.status", "response.envelope"].includes(value.field));
        if (Object.hasOwn(value, "responseStatus")) requireValue([200, 503].includes(value.responseStatus));
      }, 16);
      if (Object.hasOwn(message, "receiptChanges")) list(message.receiptChanges, value => {
        record(value, ["caseId", "stage", "field", "beforeSha256", "afterSha256"]);
        requireValue(receiptCaseIds.includes(value.caseId) && ["negative", "proof"].includes(value.stage) && ["none", "header-value", "header-name", "transaction", "reference", "network"].includes(value.field) && digest(value.beforeSha256) && (value.afterSha256 === null || digest(value.afterSha256)));
      }, 2);
      list(message.failures, value => requireValue(digest(value)), 100);
      if (Object.hasOwn(message, "received")) list(message.received, value => requireValue(digest(value)));
      if (Object.hasOwn(message, "redirectTargets")) requireValue(number(message.redirectTargets));
      if (Object.hasOwn(message, "offers")) list(message.offers, offer => { record(offer, ["protocol", "headerSha256"]); requireValue(["x402", "mpp"].includes(offer.protocol) && digest(offer.headerSha256)); }, 10);
      if (Object.hasOwn(message, "requestBodies")) list(message.requestBodies, value => requireValue(digest(value)), 10);
      if (Object.hasOwn(message, "supportedProtocols")) list(message.supportedProtocols, value => requireValue(["x402", "mpp"].includes(value)), 10);
      if (Object.hasOwn(message, "dependencyErrors")) list(message.dependencyErrors, value => {
        record(value, ["owner", "step", "messageSha256"]);
        requireValue(value.owner === "x402-facilitator" && (recoveryStages.includes(value.step) || settleUnknownSteps.includes(value.step)) && digest(value.messageSha256));
      }, 100);
    } else if (type === "prepared") {
      record(message, ["type", "counters", "events", "credentialSha256", "recordSha256"]);
      counts(message.counters); events(message.events);
      requireValue(digest(message.credentialSha256) && digest(message.recordSha256));
    } else if (type === "completed") {
      record(message, ["type", "counters", "events", "status", "credentialSha256", "receiptSha256", "receiptValid"], ["recordSha256", "pending", "errorCode"]);
      counts(message.counters); events(message.events); requireValue((number(message.status, 599) && message.status >= 100 || message.status === null && message.pending === true) && typeof message.receiptValid === "boolean");
      requireValue(digest(message.credentialSha256));
      requireValue(digest(message.receiptSha256) || message.receiptSha256 === null && message.receiptValid === false);
      if (Object.hasOwn(message, "pending")) requireValue(typeof message.pending === "boolean");
      if (Object.hasOwn(message, "errorCode")) requireValue(message.errorCode === null || failureCodes.has(message.errorCode));
      if (Object.hasOwn(message, "recordSha256")) requireValue(digest(message.recordSha256));
    } else {
      record(message, ["type", "messageSha256"], ["code", "counters", "lastStatus"]);
      requireValue(digest(message.messageSha256));
      if (Object.hasOwn(message, "code")) requireValue(failureCodes.has(message.code));
      if (Object.hasOwn(message, "counters")) counts(message.counters);
      if (Object.hasOwn(message, "lastStatus")) requireValue(message.lastStatus === null || (number(message.lastStatus, 599) && message.lastStatus >= 100));
    }
    return structuredClone(message);
  } catch { throw new Error("IPC_MESSAGE_REJECTED"); }
}
