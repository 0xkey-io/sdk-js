import type { v1AppProof, v1BootProof } from "@0xkey-io/sdk-types";
import { ed25519 } from "@noble/curves/ed25519";
import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha2";

import {
  PRODUCTION_QUORUM_MANIFEST_SET,
  type QuorumManifestSetAnchor,
  verifyWithBootEnvelope,
} from "./proof";
import { projectAuthenticatedCommerceAppProof } from "./commerce-verifier.internal";

export type CommerceSignatureAlgorithm = "ES256" | "EdDSA";
export type CommerceSignaturePrimitiveReason =
  | "VERIFIED"
  | "KEY_INVALID"
  | "SIGNATURE_ENCODING_INVALID"
  | "SIGNATURE_NON_CANONICAL"
  | "SIGNATURE_INVALID";

export interface CommercePublicJwk {
  readonly kty: string;
  readonly crv: string;
  readonly x: string;
  readonly y?: string;
  readonly d?: string;
  readonly use?: string;
  readonly key_ops?: readonly string[];
  readonly alg?: string;
  readonly kid?: string;
  readonly [key: string]: unknown;
}

export interface VerifiedCommerceBootProjection {
  readonly profile: "commerce-authorization/v1";
  readonly appProofClaimsHash: `sha256:${string}`;
  readonly bootProofHash: `sha256:${string}`;
  readonly ephemeralKeyHash: `sha256:${string}`;
  readonly pivotHash: `sha256:${string}`;
}

export type CommerceBootVerificationReason = "BOOT_BINDING_MISMATCH";

/**
 * Stable, metadata-only failure exposed by the public Boot-to-Commerce seam.
 * Transitive qOS/Nitro/parser errors are intentionally not observable here.
 */
export class CommerceBootVerificationError extends Error {
  readonly reason: CommerceBootVerificationReason = "BOOT_BINDING_MISMATCH";

  constructor() {
    super("Commerce Boot binding verification failed");
    this.name = "CommerceBootVerificationError";
  }
}

const verifiedBootProjections = new WeakSet<object>();

function decodeBase64urlCanonical(value: string): Uint8Array | null {
  if (value.length === 0 || value.includes("=")) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
    const encoded = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    return encoded === value ? bytes : null;
  } catch {
    return null;
  }
}

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${Array.from(sha256(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function hexBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/.test(value) || value.length % 2 !== 0) return null;
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

function validJwkMetadata(
  algorithm: CommerceSignatureAlgorithm,
  jwk: CommercePublicJwk,
): boolean {
  const required =
    algorithm === "ES256"
      ? ["crv", "kty", "use", "x", "y"]
      : ["crv", "kty", "use", "x"];
  const allowed = new Set([...required, "alg", "key_ops", "kid"]);
  const keys = Object.keys(jwk);
  if (
    ![Object.prototype, null].includes(Object.getPrototypeOf(jwk)) ||
    Object.getOwnPropertySymbols(jwk).length !== 0 ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(jwk, key)) ||
    keys.some((key) => !allowed.has(key)) ||
    Object.values(Object.getOwnPropertyDescriptors(jwk)).some(
      (descriptor) => !descriptor.enumerable || !("value" in descriptor),
    ) ||
    Object.prototype.hasOwnProperty.call(jwk, "d") ||
    jwk.use !== "sig" ||
    (jwk.key_ops !== undefined &&
      (jwk.key_ops.length !== 1 || jwk.key_ops[0] !== "verify")) ||
    (jwk.alg !== undefined && jwk.alg !== algorithm)
  ) {
    return false;
  }
  return algorithm === "ES256"
    ? jwk.kty === "EC" && jwk.crv === "P-256" && typeof jwk.y === "string"
    : jwk.kty === "OKP" && jwk.crv === "Ed25519" && jwk.y === undefined;
}

/**
 * Pure cryptographic primitive used by the Commerce verifier. It performs no
 * registry lookup, clock read, network request, logging, or proof-state claim.
 */
export function verifyCommerceSignature(
  algorithm: CommerceSignatureAlgorithm,
  jwk: CommercePublicJwk,
  signingInput: Uint8Array,
  signature: Uint8Array,
): CommerceSignaturePrimitiveReason {
  if (!validJwkMetadata(algorithm, jwk)) return "KEY_INVALID";
  const x = decodeBase64urlCanonical(jwk.x);
  if (!x || x.length !== 32) return "KEY_INVALID";

  try {
    if (algorithm === "ES256") {
      const y = decodeBase64urlCanonical(jwk.y!);
      if (!y || y.length !== 32) return "KEY_INVALID";
      if (signature.length !== 64) return "SIGNATURE_ENCODING_INVALID";
      const parsed = p256.Signature.fromCompact(signature);
      if (parsed.hasHighS()) return "SIGNATURE_NON_CANONICAL";
      const publicKey = Uint8Array.of(4, ...x, ...y);
      return p256.verify(parsed, sha256(signingInput), publicKey, {
        lowS: true,
      })
        ? "VERIFIED"
        : "SIGNATURE_INVALID";
    }

    if (signature.length !== 64) return "SIGNATURE_ENCODING_INVALID";
    return ed25519.verify(signature, signingInput, x)
      ? "VERIFIED"
      : "SIGNATURE_INVALID";
  } catch {
    return "SIGNATURE_INVALID";
  }
}

/**
 * Adapter from the existing full 0xkey BootProof/AppProof verifier into the
 * minimal projection that Commerce can bind. Boot success alone does not
 * produce a Commerce authorization result.
 */
export async function verifyCommerceBootProjection(
  appProof: v1AppProof,
  bootProof: v1BootProof,
  expectedClaimsHash: `sha256:${string}`,
  anchor: QuorumManifestSetAnchor = PRODUCTION_QUORUM_MANIFEST_SET,
): Promise<VerifiedCommerceBootProjection> {
  try {
    if (!/^sha256:[0-9a-f]{64}$/.test(expectedClaimsHash)) {
      throw new Error("claims hash rejected");
    }
    const envelope = await verifyWithBootEnvelope(appProof, bootProof, anchor);

    const ephemeralKey = hexBytes(appProof.publicKey.toLowerCase());
    if (!ephemeralKey) throw new Error("ephemeral key rejected");
    const attestationBytes = Uint8Array.from(
      atob(bootProof.awsAttestationDocB64),
      (character) => character.charCodeAt(0),
    );

    const projection = projectAuthenticatedCommerceAppProof(
      appProof,
      expectedClaimsHash,
      {
        bootProofHash: digest(attestationBytes),
        ephemeralKeyHash: digest(ephemeralKey),
        pivotHash: `sha256:${envelope.manifest.pivotHashHex.toLowerCase()}`,
      },
    );
    verifiedBootProjections.add(projection);
    return projection;
  } catch {
    throw new CommerceBootVerificationError();
  }
}

/** Runtime authenticity check for projections minted by the full verifier. */
export function isVerifiedCommerceBootProjection(
  value: unknown,
): value is VerifiedCommerceBootProjection {
  return (
    value !== null &&
    typeof value === "object" &&
    verifiedBootProjections.has(value)
  );
}
