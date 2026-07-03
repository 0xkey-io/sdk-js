import {
  uint8ArrayFromHexString,
  uint8ArrayToHexString,
} from "@0xkey-io/encoding";
import type { v1AppProof, v1BootProof } from "@0xkey-io/sdk-types";
import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha2";
// `cbor-js` assigns `module.exports = obj` via an indirect variable
// reference (not an inline object literal), which `cjs-module-lexer` fails
// to statically analyze for named exports. `import * as CBOR` therefore only
// yields `{ default }` under Node's native ESM loader (bundlers like
// webpack/vite don't hit this since they interop at runtime, not via static
// lexing) — use the default import, which works under both.
import CBOR from "cbor-js";
import * as x509 from "@peculiar/x509";
import {
  AWS_ROOT_CERT_PEM,
  AWS_ROOT_CERT_SHA256,
  PRODUCTION_QUORUM_KEY_HEX,
  PRODUCTION_QUORUM_MANIFEST_SET_MEMBERS,
  PRODUCTION_QUORUM_MANIFEST_SET_THRESHOLD,
  STAGING_QUORUM_KEY_HEX,
  STAGING_QUORUM_MANIFEST_SET_MEMBERS,
  STAGING_QUORUM_MANIFEST_SET_THRESHOLD,
} from "./constants";
import {
  decodeVersionedManifestEnvelope,
  type ParsedManifestEnvelope,
} from "./boot-proof-manifest";

export const getCryptoInstance = async () => {
  let cryptoInstance: Crypto;
  // Use globalThis.crypto.subtle if available
  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) {
    cryptoInstance = globalThis.crypto as Crypto;
    x509.cryptoProvider.set(cryptoInstance);

    return cryptoInstance;
  } else {
    throw new Error(
      "Web Crypto API is not available in this environment. You may need to polyfill it.",
    );
  }
};

/**
 * Utility: SHA-256 digest → hex (uppercase)
 */
async function sha256Hex(data: Uint8Array): Promise<string> {
  const cryptoInstance = await getCryptoInstance();
  const digest = await cryptoInstance.subtle.digest("SHA-256", data);
  return uint8ArrayToHexString(new Uint8Array(digest)).toUpperCase();
}

/**
 * Utility: Import SPKI public key for ECDSA verify
 */
async function importEcdsaPublicKey(spki: ArrayBuffer): Promise<CryptoKey> {
  const cryptoInstance = await getCryptoInstance();
  return cryptoInstance.subtle.importKey(
    "spki",
    spki,
    { name: "ECDSA", namedCurve: "P-384" }, // AWS Nitro uses ES384
    false,
    ["verify"],
  );
}

/**
 * Utility: standard-base64 string -> bytes (matches Go's `base64.StdEncoding`
 * and Rust's `base64::engine::general_purpose::STANDARD`, which is what the
 * coordinator uses to encode every `*B64` field on `v1BootProof`).
 */
function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * A quorum trust anchor: the manifest-set members + threshold (and,
 * optionally, the pinned quorum key) that a `verifyBootProof` caller trusts
 * to approve manifests. Defaults to {@link PRODUCTION_QUORUM_MANIFEST_SET}.
 * Override this for preprod/staging boot proofs, which are approved by a
 * different quorum ceremony than production.
 */
export interface QuorumManifestSetAnchor {
  threshold: number;
  members: ReadonlyArray<{ alias: string; pubKeyHex: string }>;
  /**
   * `manifest.namespace.quorumKey`, pinned to make sure the manifest belongs
   * to the expected quorum ceremony/namespace. Optional because it's an
   * extra defense-in-depth binding beyond the (already sufficient) approval
   * threshold check.
   */
  quorumKeyHex?: string;
}

/**
 * 0xkey production quorum trust anchor, pinned from the manifest-set that
 * approved the currently-deployed enclave manifests. See
 * `repos/enclave-releases/releases/2026.6.15/signer/manifest.json`.
 */
export const PRODUCTION_QUORUM_MANIFEST_SET: QuorumManifestSetAnchor = {
  threshold: PRODUCTION_QUORUM_MANIFEST_SET_THRESHOLD,
  members: PRODUCTION_QUORUM_MANIFEST_SET_MEMBERS,
  quorumKeyHex: PRODUCTION_QUORUM_KEY_HEX,
};

/**
 * 0xkey `staging-default` quorum trust anchor, pinned from the manifest-set
 * that approved staging's currently-deployed enclave manifests. Distinct
 * from {@link PRODUCTION_QUORUM_MANIFEST_SET} — staging is approved by its
 * own, separate quorum ceremony (smaller membership/threshold), so verifying
 * a staging boot proof against the production anchor will always fail the
 * quorum-key check. Use this anchor explicitly when verifying non-production
 * (staging/preprod) enclaves.
 */
export const STAGING_QUORUM_MANIFEST_SET: QuorumManifestSetAnchor = {
  threshold: STAGING_QUORUM_MANIFEST_SET_THRESHOLD,
  members: STAGING_QUORUM_MANIFEST_SET_MEMBERS,
  quorumKeyHex: STAGING_QUORUM_KEY_HEX,
};

/**
 * Extract the boot proof's observation time. Attestation documents expire
 * (AWS Nitro caps validity at 3 hours), so `verifyBootProof` validates the
 * certificate chain as of this time rather than "now" — the enclave is
 * immutable, so a proof captured while the cert chain was valid remains
 * trustworthy even if verified long after the cert has since expired.
 * Mirrors `sdk-go`'s `GetBootProofTime`.
 */
export function getBootProofTime(bootProof: v1BootProof): Date {
  const seconds = Number.parseInt(bootProof.createdAt?.seconds ?? "", 10);
  const nanos = Number.parseInt(bootProof.createdAt?.nanos ?? "", 10);
  if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) {
    throw new Error("Missing or invalid boot proof timestamp");
  }
  return new Date(seconds * 1000 + Math.floor(nanos / 1e6));
}

/**
 * Verify a boot proof standalone (independent of any app proof), proving
 * that the pivot binary running in a live enclave matches a manifest
 * approved by quorum multi-sig:
 *  1. AWS Nitro attestation document is validly signed and chains to the
 *     pinned AWS root (hardware root of trust).
 *  2. `sha256(qosManifestB64) == attestationDoc.user_data` (binds the
 *     specific manifest to this specific hardware measurement).
 *  3. The manifest embedded in `qosManifestEnvelopeB64` hashes to the same
 *     value as (2) (binds the envelope's approvals/PCRs to that manifest).
 *  4. `attestationDoc.pcrs[0..3] == manifest.enclave.pcr0-3` (the manifest's
 *     declared measurements match what the hardware actually measured).
 *  5. At least `anchor.threshold` valid, unique quorum-member signatures
 *     over the manifest hash, from members in `anchor.members` (NOT merely
 *     the manifest's self-declared `manifest_set` — an untrusted manifest
 *     could declare its own attacker-controlled member set).
 *
 * On success, returns the decoded envelope so callers can read off e.g.
 * `manifest.pivotHashHex` (the verified, live pivot binary hash).
 */
export async function verifyBootProof(
  bootProof: v1BootProof,
  anchor: QuorumManifestSetAnchor = PRODUCTION_QUORUM_MANIFEST_SET,
): Promise<ParsedManifestEnvelope> {
  // 1. Parse + verify the attestation document's hardware root of trust.
  const coseSign1Der = base64ToBytes(bootProof.awsAttestationDocB64);
  const coseSign1 = CBOR.decode(coseSign1Der.buffer);
  const [, , payload] = coseSign1;
  const attestationDoc = CBOR.decode(new Uint8Array(payload).buffer);

  await verifyCoseSign1Sig(coseSign1, attestationDoc.certificate);

  const bootProofTime = getBootProofTime(bootProof);
  await verifyCertificateChain(
    attestationDoc.cabundle,
    AWS_ROOT_CERT_PEM,
    attestationDoc.certificate,
    bootProofTime.getTime(),
  );

  // 2. user_data binding: H = sha256(qosManifestB64) must match the
  // hardware-measured attestation user_data.
  const manifestBytes = base64ToBytes(bootProof.qosManifestB64);
  const manifestHash = sha256(manifestBytes);
  if (!bytesEq(manifestHash, attestationDoc.user_data)) {
    throw new Error(
      "attestationDoc's user_data doesn't match the hash of the manifest",
    );
  }
  const manifestHashHex = uint8ArrayToHexString(manifestHash);

  // 3. Decode the envelope (borsh) and cross-check it embeds the exact same
  // manifest as (2) — otherwise a tampered envelope could smuggle in
  // approvals/PCRs for a different manifest than the one bound to user_data.
  const envelopeBytes = base64ToBytes(bootProof.qosManifestEnvelopeB64);
  const envelope = decodeVersionedManifestEnvelope(envelopeBytes);
  if (
    envelope.manifestHashHex.toLowerCase() !== manifestHashHex.toLowerCase()
  ) {
    throw new Error(
      "qosManifestEnvelopeB64's embedded manifest does not match qosManifestB64",
    );
  }

  // 4. PCRs: the manifest's declared enclave measurements must match what
  // the hardware actually measured.
  const pcrPairs: Array<[keyof typeof envelope.manifest.enclave, string]> = [
    ["pcr0Hex", "0"],
    ["pcr1Hex", "1"],
    ["pcr2Hex", "2"],
    ["pcr3Hex", "3"],
  ];
  for (const [field, pcrIndex] of pcrPairs) {
    const attestationPcr = attestationDoc.pcrs?.[pcrIndex];
    if (!attestationPcr) {
      throw new Error(`attestation document missing pcr${pcrIndex}`);
    }
    const attestationPcrHex = uint8ArrayToHexString(
      new Uint8Array(attestationPcr),
    );
    const manifestPcrHex = envelope.manifest.enclave[field];
    if (attestationPcrHex.toLowerCase() !== manifestPcrHex.toLowerCase()) {
      throw new Error(
        `pcr${pcrIndex} mismatch: attestation=${attestationPcrHex}, manifest=${manifestPcrHex}`,
      );
    }
  }

  // 5. Quorum multi-sig: verify approvals against the pinned trust anchor,
  // NOT the manifest's self-declared manifest_set (which is untrusted input).
  if (
    anchor.quorumKeyHex &&
    envelope.manifest.namespace.quorumKeyHex.toLowerCase() !==
      anchor.quorumKeyHex.toLowerCase()
  ) {
    throw new Error(
      "manifest namespace quorum_key does not match the pinned trust anchor",
    );
  }

  // QOS's ECDSA signing implementation (RustCrypto p256) hashes its input
  // with SHA-256 before signing, and approvals are signed over
  // `manifest.qos_hash()` (itself `sha256(borsh(manifest))`). So the raw
  // ECDSA digest is `sha256(sha256(borsh(manifest)))` — verified empirically
  // against real quorum-approved manifests.
  const doubleHash = sha256(manifestHash);

  const anchorByPubKey = new Map(
    anchor.members.map((m) => [m.pubKeyHex.toLowerCase(), m]),
  );
  const validApprovers = new Set<string>();
  for (const approval of envelope.manifestSetApprovals) {
    const pubKeyHex = approval.member.pubKeyHex.toLowerCase();
    if (!anchorByPubKey.has(pubKeyHex)) continue; // not a trusted quorum member

    let signingKeyBytes: Uint8Array;
    try {
      const pubKeyBytes = uint8ArrayFromHexString(pubKeyHex);
      if (pubKeyBytes.length !== 130) continue;
      signingKeyBytes = pubKeyBytes.slice(65);
      if (signingKeyBytes.length !== 65 || signingKeyBytes[0] !== 0x04)
        continue;
    } catch {
      continue;
    }

    let signatureBytes: Uint8Array;
    try {
      signatureBytes = uint8ArrayFromHexString(approval.signatureHex);
      if (signatureBytes.length !== 64) continue;
    } catch {
      continue;
    }

    if (p256.verify(signatureBytes, doubleHash, signingKeyBytes)) {
      validApprovers.add(pubKeyHex);
    }
  }

  if (validApprovers.size < anchor.threshold) {
    throw new Error(
      `Insufficient quorum approvals: got ${validApprovers.size} valid approvals from pinned members, need ${anchor.threshold}`,
    );
  }

  return envelope;
}

/**
 * verify goes through the following verification steps for an app proof & boot proof pair:
 *  - Verify app proof signature
 *  - Verify the boot proof via {@link verifyBootProof} — this is the same
 *    full chain used to verify a boot proof standalone: AWS attestation
 *    chain, `user_data` == manifest hash, envelope binding, PCR match
 *    against the manifest, and **quorum multi-sig approval against
 *    `anchor`** (defaults to {@link PRODUCTION_QUORUM_MANIFEST_SET}).
 *  - Verify the connection between the app proof & boot proof i.e. that the
 *    ephemeral keys match (app proof, boot proof structure, and the
 *    attestation doc's own `public_key` all agree)
 *
 * Earlier versions of this function only checked the AWS attestation chain
 * and `user_data`/manifest binding — it did **not** check PCR values or
 * quorum approvals, so a manifest that was never approved by 0xkey's quorum
 * (or that declared different PCRs than what's actually running) would
 * still pass. Delegating to `verifyBootProof` closes that gap.
 *
 *  For more information, check out https://whitepaper.0xkey.com/foundations
 */
export async function verify(
  appProof: v1AppProof,
  bootProof: v1BootProof,
  anchor: QuorumManifestSetAnchor = PRODUCTION_QUORUM_MANIFEST_SET,
): Promise<void> {
  // 1. Verify App Proof signature.
  verifyAppProofSignature(appProof);

  // 2. Verify Boot Proof: AWS attestation chain + user_data/manifest binding
  // + PCR match + quorum multi-sig approval against `anchor`.
  await verifyBootProof(bootProof, anchor);

  // 3. Verify that all the ephemeral public keys match: app proof, boot
  // proof structure, and the actual attestation doc. `verifyBootProof`
  // doesn't expose the raw attestation doc's `public_key` field, so it's
  // decoded again here (cheap: no signature/chain re-verification, just
  // reading a CBOR field already known-valid from step 2).
  const coseSign1Der = base64ToBytes(bootProof.awsAttestationDocB64);
  const coseSign1 = CBOR.decode(coseSign1Der.buffer);
  const [, , payload] = coseSign1;
  const attestationDoc = CBOR.decode(new Uint8Array(payload).buffer);
  const attestationPubKey = uint8ArrayToHexString(
    new Uint8Array(attestationDoc.public_key),
  );
  if (
    appProof.publicKey !== attestationPubKey ||
    attestationPubKey !== bootProof.ephemeralPublicKeyHex
  ) {
    throw new Error(
      `Ephemeral pub keys from app proof: ${appProof.publicKey}, boot proof structure ${bootProof.ephemeralPublicKeyHex}, and attestation doc ${attestationPubKey} should all match`,
    );
  }
}

/**
 * Verify app proof signature with @noble/curves
 */
export function verifyAppProofSignature(appProof: v1AppProof): void {
  if (appProof.scheme !== "SIGNATURE_SCHEME_EPHEMERAL_KEY_P256") {
    throw new Error("Unsupported signature scheme");
  }

  // Decode public key
  let publicKeyBytes: Uint8Array;
  try {
    publicKeyBytes = uint8ArrayFromHexString(appProof.publicKey);
  } catch {
    throw new Error("Failed to decode public key");
  }

  if (publicKeyBytes.length !== 130) {
    throw new Error(
      `Expected 130 bytes (encryption + signing pub keys), got ${publicKeyBytes.length} bytes`,
    );
  }

  // Extract signing key (last 65 bytes, uncompressed P-256 point)
  const signingKeyBytes = publicKeyBytes.slice(65);
  if (signingKeyBytes.length !== 65 || signingKeyBytes[0] !== 0x04) {
    throw new Error(
      "Invalid signing key format: expected 65-byte uncompressed P-256 point (0x04||X||Y)",
    );
  }

  // Validate it's a valid P-256 public key by attempting to create a point
  try {
    p256.ProjectivePoint.fromHex(signingKeyBytes);
  } catch (error) {
    throw new Error(`Invalid P-256 public key: ${error}`);
  }

  // Decode signature (64 bytes = 32 bytes r + 32 bytes s)
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = uint8ArrayFromHexString(appProof.signature);
  } catch {
    throw new Error("Failed to decode signature");
  }
  if (signatureBytes.length !== 64) {
    throw new Error(
      `Expected 64 bytes signature (r||s), got ${signatureBytes.length} bytes`,
    );
  }

  // Hash the proof payload
  const payloadBytes = new TextEncoder().encode(appProof.proofPayload);
  const payloadDigest = sha256(payloadBytes);

  // Verify ECDSA signature
  const isValid = p256.verify(signatureBytes, payloadDigest, signingKeyBytes);
  if (!isValid) {
    throw new Error("Signature verification failed");
  }
}

export async function verifyCertificateChain(
  cabundle: Uint8Array[],
  rootCertPem: string,
  leafCert: Uint8Array,
  timestampMs: number,
): Promise<void> {
  try {
    // Check root and assert fingerprint
    const rootX509 = new x509.X509Certificate(rootCertPem);
    const rootDer = new Uint8Array(rootX509.rawData);
    const rootSha = await sha256Hex(rootDer);
    if (rootSha !== AWS_ROOT_CERT_SHA256) {
      throw new Error(
        `Pinned AWS root fingerprint mismatch: expected=${AWS_ROOT_CERT_SHA256} actual=${rootSha}`,
      );
    }

    // Bundle starts with root certificate. We're replacing the root with our hardcoded known certificate, so remove first element
    const bundleWithoutRoot = cabundle.slice(1);
    const intermediatesX509 = bundleWithoutRoot.map((c) => {
      if (!c) throw new Error("Invalid certificate data in cabundle");
      return new x509.X509Certificate(c);
    });
    const leaf = new x509.X509Certificate(leafCert);

    // Build path leaf → intermediates → root, with our hardcoded known root certificate
    const builder = new x509.X509ChainBuilder({
      certificates: [rootX509, ...intermediatesX509],
    });
    const chain = await builder.build(leaf);
    if (chain.length !== intermediatesX509.length + 2) {
      throw new Error(
        `Incorrect number of certs in X509 Chain. Expected ${intermediatesX509.length + 2}, got ${chain.length}`,
      );
    }

    const appProofDate = new Date(timestampMs);
    for (let i = 0; i < chain.length; i++) {
      const cert = chain[i];
      if (!cert) throw new Error("Invalid certificate in chain");

      if (i === chain.length - 1) {
        // is root
        // Self-signature verification for root certificate
        const ok = await cert.verify({
          publicKey: cert.publicKey,
          date: appProofDate,
        });
        if (!ok)
          throw new Error("Pinned root failed self-signature verification");
      } else {
        // Verify signature against issuer
        const issuer = chain[i + 1];
        if (!issuer) throw new Error("Issuer can't be null");

        // Attestation docs technically expire after 3 hours, so an app proof generated 3+ hours after an enclave
        // boots up will fail verification due to certificate expiration. This is okay because enclaves are immutable;
        // even if the cert is technically invalid, the code contained within it cannot change. To prevent the cert
        // expiration failure, we set `signatureOnly: true`.
        const ok = await cert.verify({
          publicKey: issuer.publicKey,
          signatureOnly: true,
          date: appProofDate,
        });
        if (!ok) {
          throw new Error(
            `Signature check failed: ${cert.subject} not signed by ${issuer?.subject}`,
          );
        }
      }
    }
  } catch (error) {
    throw new Error(
      `Certificate chain verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function verifyCoseSign1Sig(
  coseSign1: any,
  leaf: Uint8Array,
): Promise<void> {
  const [protectedHeaders, , payload, signature] = coseSign1;
  const tbs = new Uint8Array(
    CBOR.encode([
      "Signature1",
      new Uint8Array(protectedHeaders),
      new Uint8Array(0),
      new Uint8Array(payload),
    ]),
  );

  const leafCert = new x509.X509Certificate(leaf);
  const pubKey = await importEcdsaPublicKey(leafCert.publicKey.rawData);

  const cryptoInstance = await getCryptoInstance();
  const ok = await cryptoInstance.subtle.verify(
    { name: "ECDSA", hash: { name: "SHA-384" } },
    pubKey,
    new Uint8Array(signature),
    tbs,
  );
  if (!ok) throw new Error("COSE_Sign1 ES384 verification failed");
}

function bytesEq(a: ArrayBuffer, b: ArrayBuffer) {
  const A = new Uint8Array(a),
    B = new Uint8Array(b);
  if (A.length !== B.length) return false;
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return false;
  return true;
}
