/** @jest-environment node */

import { verifyBootProof, type QuorumManifestSetAnchor } from "../proof";
import { decodeVersionedManifestEnvelope } from "../boot-proof-manifest";
import type { v1BootProof } from "@0xkey-io/sdk-types";
import { test, expect, describe } from "@jest/globals";
import { preprodAnchor, testBootProof1, testBootProof2 } from "./shared";

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

describe("Boot proof verification (verifyBootProof)", () => {
  // testBootProof1/2 (see shared.ts) are real preprod signer boot proofs,
  // both carrying the SAME qosManifestB64/qosManifestEnvelopeB64 (two pods
  // booted from one quorum-approved manifest, with different ephemeral
  // keys). The envelope is approved by a 2-of-2 preprod quorum — NOT the
  // production quorum in PRODUCTION_QUORUM_MANIFEST_SET — so tests exercise
  // the anchor-override path via `preprodAnchor` (shared.ts), extracted by
  // borsh-decoding the envelope's `manifest_set`/`manifest_set_approvals`.

  test("decodeVersionedManifestEnvelope parses the real (v0) test vector", () => {
    const envelopeBytes = base64ToBytes(testBootProof1.qosManifestEnvelopeB64);
    const envelope = decodeVersionedManifestEnvelope(envelopeBytes);

    expect(envelope.version).toBe("v0");
    expect(envelope.manifest.namespace.name).toBe("preprod/signer");
    expect(envelope.manifest.namespace.nonce).toBe(20250902);
    expect(envelope.manifest.manifestSet.threshold).toBe(2);
    expect(envelope.manifest.manifestSet.members).toHaveLength(2);
    expect(envelope.manifestSetApprovals).toHaveLength(2);
    expect(envelope.manifest.pivotHashHex).toBe(
      "dc64e8bfc82db82fe84524ddecb971d7d5c1102517054a7a4cb3e5668615ba27",
    );
    // Independently derived: envelope's embedded manifest must hash to the
    // same value bound to qosManifestB64 / the attestation's user_data.
    expect(envelope.manifestHashHex).toBe(
      "24a9e2c0b0ce26bcbc3e65172f8b06b100d5e712591f604832cbea9ff5ce02be",
    );
  });

  test("verifyBootProof succeeds against the matching (preprod) anchor", async () => {
    const envelope = await verifyBootProof(testBootProof1, preprodAnchor);
    expect(envelope.manifest.pivotHashHex).toHaveLength(64);
    expect(envelope.manifestSetApprovals.length).toBeGreaterThanOrEqual(2);

    // testBootProof2 is a second pod booted from the identical manifest.
    const envelope2 = await verifyBootProof(testBootProof2, preprodAnchor);
    expect(envelope2.manifest.pivotHashHex).toBe(
      envelope.manifest.pivotHashHex,
    );
  });

  test("verifyBootProof rejects against the production anchor (different quorum)", async () => {
    // Uses the real PRODUCTION_QUORUM_MANIFEST_SET default anchor: this
    // preprod manifest belongs to a different quorum ceremony entirely (its
    // namespace quorum_key doesn't match production's), so the quorum-key
    // binding check rejects it before even reaching approval verification.
    await expect(verifyBootProof(testBootProof1)).rejects.toThrow(
      "quorum_key does not match the pinned trust anchor",
    );
  });

  test("verifyBootProof rejects if the anchor's pinned quorum key doesn't match the manifest's", async () => {
    const wrongQuorumKeyAnchor: QuorumManifestSetAnchor = {
      ...preprodAnchor,
      quorumKeyHex: "04" + "00".repeat(129),
    };
    await expect(
      verifyBootProof(testBootProof1, wrongQuorumKeyAnchor),
    ).rejects.toThrow("quorum_key does not match");
  });

  test("verifyBootProof rejects a tampered approval signature (insufficient remaining quorum)", async () => {
    // The envelope is: borsh(manifest) [2074 bytes] || u32 approvals_count
    // || approval[0] (u32 sig_len=64, 64 sig bytes, alias, pub_key) || ... .
    // Flipping a byte inside the first approval's 64-byte signature
    // invalidates just that one approval, dropping valid approvals from 2
    // to 1 (below the anchor's threshold of 2) without corrupting envelope
    // framing (so it still borsh-decodes cleanly).
    const original = base64ToBytes(testBootProof1.qosManifestEnvelopeB64);
    const tampered = new Uint8Array(original);
    const firstApprovalSigStart = 2074 + 4 + 4; // manifest + approvals_count + sig_len
    tampered[firstApprovalSigStart] ^= 0xff;

    const tamperedBootProof: v1BootProof = {
      ...testBootProof1,
      qosManifestEnvelopeB64: bytesToBase64(tampered),
    };

    await expect(
      verifyBootProof(tamperedBootProof, preprodAnchor),
    ).rejects.toThrow("Insufficient quorum approvals");
  });

  test("verifyBootProof rejects a manifest that doesn't match the attestation's user_data", async () => {
    const tamperedBootProof: v1BootProof = {
      ...testBootProof1,
      // Same garbage value used by proof-tests.ts's equivalent tamper case:
      // valid base64, but not the manifest this attestation was measured
      // against.
      qosManifestB64: "puwpDDoA3dqZpFV0nDnSgj2iFyy2VDUnDSE7u+awts0=",
    };

    await expect(
      verifyBootProof(tamperedBootProof, preprodAnchor),
    ).rejects.toThrow(
      "attestationDoc's user_data doesn't match the hash of the manifest",
    );
  });

  test("verifyBootProof rejects when the envelope's embedded manifest is tampered", async () => {
    // Tampering the envelope's manifest bytes alone (leaving qosManifestB64
    // untouched) changes the envelope's recomputed manifest hash without
    // changing H, so this exercises the envelope/qosManifestB64 binding
    // check (step 3) specifically -- distinct from the user_data check
    // (step 2), which by construction cannot be bypassed by tampering the
    // manifest alone (any single-field tamper changes its hash).
    const manifestLength = base64ToBytes(testBootProof1.qosManifestB64).length;
    const envelopeBytes = base64ToBytes(testBootProof1.qosManifestEnvelopeB64);
    const tamperedEnvelope = new Uint8Array(envelopeBytes);
    tamperedEnvelope[manifestLength - 1] ^= 0xff; // last byte of the embedded manifest

    const tamperedBootProof: v1BootProof = {
      ...testBootProof1,
      qosManifestEnvelopeB64: bytesToBase64(tamperedEnvelope),
    };

    await expect(
      verifyBootProof(tamperedBootProof, preprodAnchor),
    ).rejects.toThrow(
      "qosManifestEnvelopeB64's embedded manifest does not match qosManifestB64",
    );
  });
});
