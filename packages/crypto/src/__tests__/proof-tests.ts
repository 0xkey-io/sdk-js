/** @jest-environment node */

import {
  verify,
  verifyAppProofSignature,
  verifyQosLiveMeasurements,
} from "../proof";
import { test, expect, describe } from "@jest/globals";
import {
  preprodAnchor,
  testAppProof1,
  testAppProof2,
  testBootProof1,
  testBootProof2,
} from "./shared";
import qosProofPolicy from "./fixtures/qos-proof-policy.json";

const manifestHashHex = "01".repeat(32);
const publicKeyHex = "03".repeat(130);
const manifestPcrsHex = ["00", "11", "22", "33"].map((byte) => byte.repeat(48));
const expectedLivePcr17Hex =
  "99d1eab3ea476f590f2eeddc03d1accddaed7aba31ef47ea11afcb83c554ec47fc40613231317e42b45c83641d20080a";

const livePolicy = {
  allowedManifestDigestsHex: [manifestHashHex],
};

function liveMeasurements(): {
  digest: string;
  nonce: unknown;
  publicKeyHex: string;
  pcrsHex: Record<string, string>;
} {
  return {
    digest: "SHA384",
    nonce: null,
    publicKeyHex,
    pcrsHex: Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [index, "00".repeat(48)]),
    ),
  };
}

describe("Proof verification tests", () => {
  test("checks the QoS 0.14 live PCR17 commitment", async () => {
    const measurements = liveMeasurements();
    measurements.pcrsHex[0] = manifestPcrsHex[0]!;
    measurements.pcrsHex[1] = manifestPcrsHex[1]!;
    measurements.pcrsHex[2] = manifestPcrsHex[2]!;
    measurements.pcrsHex[3] = manifestPcrsHex[3]!;
    measurements.pcrsHex[17] = expectedLivePcr17Hex;

    await expect(
      verifyQosLiveMeasurements(
        measurements,
        manifestHashHex,
        manifestPcrsHex,
        livePolicy,
      ),
    ).resolves.toBeUndefined();
  });

  test("rejects a live manifest outside the policy", async () => {
    const measurements = liveMeasurements();
    measurements.pcrsHex[0] = manifestPcrsHex[0]!;
    measurements.pcrsHex[1] = manifestPcrsHex[1]!;
    measurements.pcrsHex[2] = manifestPcrsHex[2]!;
    measurements.pcrsHex[3] = manifestPcrsHex[3]!;
    measurements.pcrsHex[17] = expectedLivePcr17Hex;

    await expect(
      verifyQosLiveMeasurements(
        measurements,
        manifestHashHex,
        manifestPcrsHex,
        { ...livePolicy, allowedManifestDigestsHex: ["02".repeat(32)] },
      ),
    ).rejects.toThrow("manifest digest is not allowed");
  });

  test.each([
    [
      "missing PCR",
      (m: ReturnType<typeof liveMeasurements>) => delete m.pcrsHex[31],
    ],
    [
      "PCR17 mismatch",
      (m: ReturnType<typeof liveMeasurements>) =>
        (m.pcrsHex[17] = "00".repeat(48)),
    ],
    [
      "nonce present",
      (m: ReturnType<typeof liveMeasurements>) => (m.nonce = "01"),
    ],
    [
      "wrong digest",
      (m: ReturnType<typeof liveMeasurements>) => (m.digest = "SHA256"),
    ],
    [
      "wrong public key size",
      (m: ReturnType<typeof liveMeasurements>) =>
        (m.publicKeyHex = "03".repeat(65)),
    ],
  ])("rejects QoS 0.14 live measurements with %s", async (_name, mutate) => {
    const measurements = liveMeasurements();
    measurements.pcrsHex[0] = manifestPcrsHex[0]!;
    measurements.pcrsHex[1] = manifestPcrsHex[1]!;
    measurements.pcrsHex[2] = manifestPcrsHex[2]!;
    measurements.pcrsHex[3] = manifestPcrsHex[3]!;
    measurements.pcrsHex[17] = expectedLivePcr17Hex;
    mutate(measurements);

    await expect(
      verifyQosLiveMeasurements(
        measurements,
        manifestHashHex,
        manifestPcrsHex,
        livePolicy,
      ),
    ).rejects.toThrow();
  });

  test("uses the frozen cross-repo PCR17 policy vector", async () => {
    expect(qosProofPolicy.schemaVersion).toBe("turnkey-alignment/v1");
    expect(qosProofPolicy.inputs.manifestHashHex).toBe(manifestHashHex);
    expect(qosProofPolicy.inputs.ephemeralPublicKeyHex).toBe(publicKeyHex);

    const measurements = liveMeasurements();
    measurements.pcrsHex[0] = manifestPcrsHex[0]!;
    measurements.pcrsHex[1] = manifestPcrsHex[1]!;
    measurements.pcrsHex[2] = manifestPcrsHex[2]!;
    measurements.pcrsHex[3] = manifestPcrsHex[3]!;
    measurements.pcrsHex[17] = qosProofPolicy.proof.pcr17Hex;

    await expect(
      verifyQosLiveMeasurements(
        measurements,
        qosProofPolicy.inputs.manifestHashHex,
        manifestPcrsHex,
        {
          allowedManifestDigestsHex:
            qosProofPolicy.policy.allowedManifestDigestsHex,
        },
      ),
    ).resolves.toBeUndefined();

    measurements.pcrsHex[17] = qosProofPolicy.cases[1]!.proofOverride!.pcr17Hex;
    await expect(
      verifyQosLiveMeasurements(
        measurements,
        qosProofPolicy.inputs.manifestHashHex,
        manifestPcrsHex,
        {
          allowedManifestDigestsHex:
            qosProofPolicy.policy.allowedManifestDigestsHex,
        },
      ),
    ).rejects.toThrow("PCR17 live manifest commitment does not match");
  });

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

    // Wrong awsAttestationDocB64 is rejected first by the signed-attestation
    // timestamp/capture binding; this prevents mixing fields from two captures.
    malformedBootProof2.awsAttestationDocB64 =
      testBootProof1.awsAttestationDocB64;
    await expect(
      verify(testAppProof2, malformedBootProof2, preprodAnchor),
    ).rejects.toThrow(
      "boot proof capture timestamp is not bound to attestation timestamp",
    );
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
