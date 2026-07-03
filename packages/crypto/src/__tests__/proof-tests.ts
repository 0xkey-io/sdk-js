/** @jest-environment node */

import { verify, verifyAppProofSignature } from "../proof";
import { test, expect, describe } from "@jest/globals";
import {
  preprodAnchor,
  testAppProof1,
  testAppProof2,
  testBootProof1,
  testBootProof2,
} from "./shared";

describe("Proof verification tests", () => {
  test("should verify valid app proof signatures", () => {
    expect(verifyAppProofSignature(testAppProof1)).toBeUndefined();
    expect(verifyAppProofSignature(testAppProof2)).toBeUndefined();
  });

  test("should verify correct app proof / boot proof combos", async () => {
    // testAppProof*/testBootProof* are real preprod vectors (see shared.ts),
    // approved by a preprod quorum — not PRODUCTION_QUORUM_MANIFEST_SET (the
    // default anchor), so `verify()`'s quorum check needs the matching
    // preprod anchor here.
    await expect(
      verify(testAppProof1, testBootProof1, preprodAnchor),
    ).resolves.toBeUndefined();
    await expect(
      verify(testAppProof2, testBootProof2, preprodAnchor),
    ).resolves.toBeUndefined();
  });

  test("should NOT verify against the wrong (production) quorum anchor", async () => {
    // Without passing `preprodAnchor` explicitly, `verify()` falls back to
    // PRODUCTION_QUORUM_MANIFEST_SET, which must reject a preprod-approved
    // manifest — this is exactly the security gap the old `verify()`
    // (pre-`verifyBootProof` delegation) didn't check at all.
    await expect(verify(testAppProof1, testBootProof1)).rejects.toThrow(
      "quorum_key does not match",
    );
  });

  test("should NOT verify with malformed app proofs", () => {
    let malformedAppProof2 = { ...testAppProof2 };

    // Wrong publicKey - should cause signature verification failure
    malformedAppProof2.publicKey = testAppProof1.publicKey;
    expect(() => verifyAppProofSignature(malformedAppProof2)).toThrow(
      "Signature verification failed",
    );
    malformedAppProof2.publicKey = testAppProof2.publicKey;

    // Wrong proofPayload - should cause signature verification failure
    malformedAppProof2.proofPayload = testAppProof1.proofPayload;
    expect(() => verifyAppProofSignature(malformedAppProof2)).toThrow(
      "Signature verification failed",
    );
    malformedAppProof2.proofPayload = testAppProof2.proofPayload;

    // Wrong signature - should cause signature verification failure
    malformedAppProof2.signature = testAppProof1.signature;
    expect(() => verifyAppProofSignature(malformedAppProof2)).toThrow(
      "Signature verification failed",
    );
  });

  test("should NOT verify with malformed boot proofs", async () => {
    let malformedBootProof2 = { ...testBootProof2 };

    // Wrong ephemeral key - should cause ephemeral key mismatch
    malformedBootProof2.ephemeralPublicKeyHex =
      testBootProof1.ephemeralPublicKeyHex;
    await expect(
      verify(testAppProof2, malformedBootProof2, preprodAnchor),
    ).rejects.toThrow("Ephemeral pub keys from app proof:");
    malformedBootProof2.ephemeralPublicKeyHex =
      testBootProof2.ephemeralPublicKeyHex;

    // Wrong awsAttestationDocB64 - causes ephemeral key mistmatch error because the boot proofs have the same qos manifest, so the user data check doesn't fail
    malformedBootProof2.awsAttestationDocB64 =
      testBootProof1.awsAttestationDocB64;
    await expect(
      verify(testAppProof2, malformedBootProof2, preprodAnchor),
    ).rejects.toThrow("Ephemeral pub keys from app proof:");
    malformedBootProof2.awsAttestationDocB64 =
      testBootProof2.awsAttestationDocB64;

    // Wrong qosManifestB64 (randomly generated) - should cause user_data verification failure
    malformedBootProof2.qosManifestB64 =
      "puwpDDoA3dqZpFV0nDnSgj2iFyy2VDUnDSE7u+awts0=";
    await expect(
      verify(testAppProof2, malformedBootProof2, preprodAnchor),
    ).rejects.toThrow(
      "attestationDoc's user_data doesn't match the hash of the manifest",
    );
  });
});
