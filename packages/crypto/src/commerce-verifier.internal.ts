import type { v1AppProof } from "@0xkey-io/sdk-types";
import { sha256 } from "@noble/hashes/sha2";

import { verifyAppProofSignature } from "./proof";

export interface AuthenticatedBootEvidenceProjection {
  readonly bootProofHash: `sha256:${string}`;
  readonly ephemeralKeyHash: `sha256:${string}`;
  readonly pivotHash: `sha256:${string}`;
}

export interface CommerceBootProjectionValue {
  readonly profile: "commerce-authorization/v1";
  readonly appProofClaimsHash: `sha256:${string}`;
  readonly bootProofHash: `sha256:${string}`;
  readonly ephemeralKeyHash: `sha256:${string}`;
  readonly pivotHash: `sha256:${string}`;
}

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${Array.from(sha256(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function canonicalHex(value: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/.test(value) || value.length % 2 !== 0) return null;
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

/**
 * Package-private deterministic seam. It verifies the real ephemeral session
 * signature and exact canonical Commerce payload, then binds only evidence
 * already produced by the full Boot verifier. The public module alone applies
 * the non-forgeable WeakSet brand.
 */
export function projectAuthenticatedCommerceAppProof(
  appProof: v1AppProof,
  expectedClaimsHash: `sha256:${string}`,
  evidence: AuthenticatedBootEvidenceProjection,
): CommerceBootProjectionValue {
  if (!/^sha256:[0-9a-f]{64}$/.test(expectedClaimsHash)) {
    throw new Error("Expected Commerce claims hash is not canonical sha256");
  }
  const canonicalPayload = JSON.stringify({
    claimsHash: expectedClaimsHash,
    profile: "commerce-authorization/v1",
  });
  if (appProof.proofPayload !== canonicalPayload) {
    throw new Error("AppProof is not canonical commerce-authorization/v1");
  }
  verifyAppProofSignature(appProof);

  const ephemeralKey = canonicalHex(appProof.publicKey);
  if (!ephemeralKey || digest(ephemeralKey) !== evidence.ephemeralKeyHash) {
    throw new Error("AppProof ephemeral key is not bound to verified Boot evidence");
  }
  for (const value of [
    evidence.bootProofHash,
    evidence.ephemeralKeyHash,
    evidence.pivotHash,
  ]) {
    if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
      throw new Error("Verified Boot evidence is malformed");
    }
  }

  return Object.freeze({
    profile: "commerce-authorization/v1",
    appProofClaimsHash: expectedClaimsHash,
    ...evidence,
  });
}
