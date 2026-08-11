import {
  verifyCommerceSignature,
  isVerifiedCommerceBootProjection,
  type CommercePublicJwk,
  type VerifiedCommerceBootProjection,
} from "@0xkey-io/crypto";
import { recoverTypedDataAddress } from "viem";

import {
  canonicalizeJcs,
  sha256Bytes,
} from "../commerce/generated/jcs";
import { parseCommerceJson } from "../commerce/generated/strict-json";

export const COMMERCE_VERIFIER_METADATA = Object.freeze({
  protocolVersion: "0.1.0-draft.4",
  wireVersion: "0.1",
  sourceDigest:
    "sha256:0069b449f4b0f2f2ae88103219a182703498231b3e7cbe6d76cdd7e3f195ff27",
  jwsVectorDigest:
    "sha256:dc02568cb014cb46cdc984a38e987ffa1c9cfc05ddcb018c604d624a479ef6f9",
  eip712VectorDigest:
    "sha256:fbd11abda83fcbc214808e3506a33001fab2d4193faee96245d0e27182cb9e6d",
  artifactBundleDigest:
    "sha256:f5d1ea24047de1ac5bc325137b68fa6cc166a03728a0ae6214d1f2424c2cc0e7",
  artifactManifestDigest:
    "sha256:717fcc6c3fe26a5e8c1ba45746c67fdee5199c2a93fb860de8aab41e22c1e95e",
  bootCaptureDelayMaxMs: 1_000,
  bootVectorDigest:
    "sha256:210ec8cec947783a3258d4e04b97e93a411856711a2c2b0504923096a8038fc7",
  wrongSignerVectorDigest:
    "sha256:c74f0ec0c8ae1b398334fccb114aadc209a9b0758d2ef8d1d7b1074761d12070",
  conformanceCorpusDigest:
    "sha256:884e5b39f1da5871c400f974c2bca6c61e805101b9bd2abfad9aeb5d709bc589",
  conformanceReportDigest:
    "sha256:f17ff6db79340a323dc640aacceb0c251b9c03947cd605c4796e708239ef0b40",
} as const);

export type CommerceKeyRole = "ISSUER" | "CUSTODY" | "BOOT";
export type CommerceJwsAlgorithm = "ES256" | "EdDSA";

export type CommerceVerificationReason =
  | "VERIFIED"
  | "ARTIFACT_INTEGRITY_FAILED"
  | "MALFORMED_PROOF"
  | "UNSUPPORTED_WIRE_VERSION"
  | "CLAIMS_DIGEST_MISMATCH"
  | "AUDIENCE_MISMATCH"
  | "ISSUER_MISMATCH"
  | "KEY_ID_MISMATCH"
  | "KEY_NOT_FOUND"
  | "KEY_ROLE_MISMATCH"
  | "KEY_NOT_ACTIVE"
  | "KEY_REVOKED"
  | "KEY_REGISTRY_INVALID"
  | "STATEMENT_TIME_INVALID"
  | "STATEMENT_FROM_FUTURE"
  | "CLOCK_SKEW_INVALID"
  | "CLOCK_UNAVAILABLE"
  | "SIGNATURE_ENCODING_INVALID"
  | "SIGNATURE_NON_CANONICAL"
  | "SIGNATURE_INVALID"
  | "AUTHORIZATION_DOMAIN_MISMATCH"
  | "AUTHORIZATION_MESSAGE_MISMATCH"
  | "AUTHORIZATION_DIGEST_MISMATCH"
  | "AUTHORIZATION_TIME_INVALID"
  | "PAYER_ADDRESS_MISMATCH"
  | "BOOT_BINDING_MISMATCH";

export interface CommerceVerificationResult {
  readonly valid: boolean;
  readonly claimsHash: `sha256:${string}` | null;
  readonly reason: CommerceVerificationReason;
}

export interface HistoricalCommerceKey {
  readonly issuer: string;
  readonly kid: string;
  readonly role: CommerceKeyRole;
  readonly algorithm: CommerceJwsAlgorithm;
  readonly notBeforeUnixMs: number;
  readonly notAfterUnixMs: number | null;
  readonly revokedAtUnixMs: number | null;
  readonly jwk: CommercePublicJwk;
}

export interface CommerceSignatureEnvelope {
  readonly scheme:
    | "DETACHED_JWS_ES256"
    | "DETACHED_JWS_EDDSA"
    | "EIP712"
    | "APP_PROOF_COMMERCE_V1";
  readonly issuer: string;
  readonly keyId: string;
  readonly signedObjectDigest: `sha256:${string}`;
  readonly signature: string;
}

export interface DetachedJwsVerificationRequest {
  readonly audience: string;
  readonly claims: unknown;
  readonly envelope: CommerceSignatureEnvelope;
  readonly keyRegistry: readonly HistoricalCommerceKey[];
  readonly profile: string;
  readonly requiredRole: CommerceKeyRole;
  readonly wireVersion: string;
}

export interface Eip3009VerificationRequest {
  readonly claimedClaimsHash: `sha256:${string}`;
  readonly envelope: CommerceSignatureEnvelope;
  readonly typedData: unknown;
  readonly walletProofClaims: unknown;
  readonly wireVersion: string;
}

export interface BootBindingRequest {
  readonly expected: VerifiedCommerceBootProjection;
  readonly verified: VerifiedCommerceBootProjection;
}

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z][a-z0-9]*(?:[_:-][a-zA-Z0-9]+)+$/;
const MAX_CLOCK_SKEW_MS = 300_000;
const SECP256K1_ORDER = BigInt(
  "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
);
const BASE_USDC_CONTRACT =
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const UINT256_MAX = (1n << 256n) - 1n;
const ARTIFACT_FILES = Object.freeze([
  ["eip712-v1.json", 3355, "sha256:fbd11abda83fcbc214808e3506a33001fab2d4193faee96245d0e27182cb9e6d"],
  ["jcs-v1.json", 2960, "sha256:c331b38d94a56a0c383f23c52f1d92803b8deff78331426a7aa2de80f28d186c"],
  ["jws-v1.json", 3363, "sha256:dc02568cb014cb46cdc984a38e987ffa1c9cfc05ddcb018c604d624a479ef6f9"],
  ["lexical-v1.json", 1508, "sha256:d788d31815411b0f323ae869ae4b91483c7278bbac9d2b78d30ec42f0c0da99a"],
  ["protocol-index.ts.source", 21305, "sha256:8d61f4759245f6d26108225c97b60ad5e418ada00024ab8843f3cdbea50a3233"],
  ["verifier-lib.rs", 47421, "sha256:038fcce977da0bd4a1f8b3c96d868c4d954eda2bd1c2f5f93531e3e45520ac6e"],
] as const);

function result(
  reason: CommerceVerificationReason,
  claimsHash: `sha256:${string}` | null = null,
): CommerceVerificationResult {
  return Object.freeze({ valid: reason === "VERIFIED", claimsHash, reason });
}

/** Verifies the byte-pinned accepted PR-002 bundle without I/O or fetching. */
export function verifyCommerceVerifierBundle(
  manifestBytes: Uint8Array,
  files: Readonly<Record<string, Uint8Array>>,
): CommerceVerificationResult {
  try {
    if (
      !(manifestBytes instanceof Uint8Array) ||
      sha256Bytes(manifestBytes) !== COMMERCE_VERIFIER_METADATA.artifactManifestDigest ||
      files === null ||
      typeof files !== "object" ||
      Array.isArray(files) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(files)) ||
      Object.getOwnPropertySymbols(files).length !== 0
    ) {
      return result("ARTIFACT_INTEGRITY_FAILED");
    }
    const descriptors = Object.getOwnPropertyDescriptors(files);
    if (
      Object.values(descriptors).some(
        (descriptor) =>
          !descriptor.enumerable ||
          !("value" in descriptor) ||
          !(descriptor.value instanceof Uint8Array),
      ) ||
      JSON.stringify(Object.keys(files).sort()) !==
        JSON.stringify(ARTIFACT_FILES.map(([path]) => path))
    ) {
      return result("ARTIFACT_INTEGRITY_FAILED");
    }
    for (const [path, byteLength, expectedDigest] of ARTIFACT_FILES) {
      const descriptor = descriptors[path];
      const bytes = descriptor && "value" in descriptor ? descriptor.value : null;
      if (
        !(bytes instanceof Uint8Array) ||
        bytes.byteLength !== byteLength ||
        sha256Bytes(bytes) !== expectedDigest
      ) {
        return result("ARTIFACT_INTEGRITY_FAILED");
      }
    }
    const manifest = parseCommerceJson(manifestBytes);
    if (
      !exactKeys(manifest, [
        "formatVersion", "protocolVersion", "releaseCandidate", "sourceDigest",
        "wireVersion", "files", "bundleDigest",
      ]) ||
      (manifest as { formatVersion?: unknown }).formatVersion !== 1 ||
      (manifest as { protocolVersion?: unknown }).protocolVersion !== COMMERCE_VERIFIER_METADATA.protocolVersion ||
      (manifest as { releaseCandidate?: unknown }).releaseCandidate !== "AC-M0-PR-002/accepted" ||
      (manifest as { sourceDigest?: unknown }).sourceDigest !== COMMERCE_VERIFIER_METADATA.sourceDigest ||
      (manifest as { wireVersion?: unknown }).wireVersion !== COMMERCE_VERIFIER_METADATA.wireVersion ||
      (manifest as { bundleDigest?: unknown }).bundleDigest !== COMMERCE_VERIFIER_METADATA.artifactBundleDigest ||
      JSON.stringify((manifest as { files?: unknown }).files) !==
        JSON.stringify(ARTIFACT_FILES.map(([path, bytes, sha256]) => ({ path, bytes, sha256 })))
    ) {
      return result("ARTIFACT_INTEGRITY_FAILED");
    }
    const { bundleDigest: _bundleDigest, ...frame } = manifest as Record<string, unknown>;
    if (sha256Bytes(canonicalizeJcs(frame)) !== COMMERCE_VERIFIER_METADATA.artifactBundleDigest) {
      return result("ARTIFACT_INTEGRITY_FAILED");
    }
    return result("VERIFIED");
  } catch {
    return result("ARTIFACT_INTEGRITY_FAILED");
  }
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 128 &&
    IDENTIFIER.test(value)
  );
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  if (Object.getOwnPropertySymbols(value).length !== 0) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort()) &&
    Object.values(descriptors).every(
      (descriptor) => descriptor.enumerable && "value" in descriptor,
    );
}

function parseRfc3339UtcWholeSeconds(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    value.startsWith("0000-") ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)
  ) {
    return null;
  }
  const instant = Date.parse(value);
  return Number.isFinite(instant) &&
    new Date(instant).toISOString().replace(".000Z", "Z") === value
    ? instant
    : null;
}

function liveTime(): number | null {
  const value = Date.now();
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

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

function encodeBase64url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function digestStructured(
  profile: string,
  value: unknown,
  wireVersion: string,
): `sha256:${string}` | null {
  if (
    profile.length === 0 ||
    profile.includes("\0") ||
    wireVersion.length === 0 ||
    wireVersion.includes("\0")
  ) {
    return null;
  }
  try {
    const encoder = new TextEncoder();
    const canonical = canonicalizeJcs(value);
    const prefix = encoder.encode(
      `openant-commerce\0${wireVersion}\0${profile}\0`,
    );
    const frame = new Uint8Array(prefix.length + canonical.length);
    frame.set(prefix);
    frame.set(canonical, prefix.length);
    return sha256Bytes(frame);
  } catch {
    return null;
  }
}

function validateRegistry(keys: readonly HistoricalCommerceKey[]): boolean {
  if (!Array.isArray(keys)) return false;
  const identities = new Set<string>();
  const fingerprints = new Set<string>();
  for (const key of keys) {
    if (
      !exactKeys(key, [
        "issuer",
        "kid",
        "role",
        "algorithm",
        "notBeforeUnixMs",
        "notAfterUnixMs",
        "revokedAtUnixMs",
        "jwk",
      ]) ||
      !isIdentifier(key.issuer) ||
      !isIdentifier(key.kid) ||
      !["ISSUER", "CUSTODY"].includes(key.role) ||
      !["ES256", "EdDSA"].includes(key.algorithm) ||
      !Number.isSafeInteger(key.notBeforeUnixMs) ||
      (key.notAfterUnixMs !== null &&
        (!Number.isSafeInteger(key.notAfterUnixMs) ||
          key.notAfterUnixMs <= key.notBeforeUnixMs)) ||
      (key.revokedAtUnixMs !== null &&
        !Number.isSafeInteger(key.revokedAtUnixMs)) ||
      (key.jwk.kid !== undefined && key.jwk.kid !== key.kid)
    ) {
      return false;
    }
    const identity = `${key.issuer}\0${key.kid}`;
    const fingerprint = JSON.stringify([
      key.algorithm,
      key.jwk.kty,
      key.jwk.crv,
      key.jwk.x,
      key.jwk.y ?? null,
    ]);
    if (identities.has(identity) || fingerprints.has(fingerprint)) return false;
    identities.add(identity);
    fingerprints.add(fingerprint);
  }
  return true;
}

export async function verifyDetachedJwsLive(
  request: DetachedJwsVerificationRequest,
): Promise<CommerceVerificationResult> {
  return verifyDetachedJwsWithTrustedPolicy(request, 0);
}

async function verifyDetachedJwsWithTrustedPolicy(
  request: DetachedJwsVerificationRequest,
  skew: number,
): Promise<CommerceVerificationResult> {
  const now = liveTime();
  if (now === null) return result("CLOCK_UNAVAILABLE");
  if (!exactKeys(request, [
    "audience", "claims", "envelope", "keyRegistry", "profile", "requiredRole", "wireVersion",
  ])) {
    return result("MALFORMED_PROOF");
  }
  if (request.wireVersion !== COMMERCE_VERIFIER_METADATA.wireVersion) {
    return result("UNSUPPORTED_WIRE_VERSION");
  }
  if (
    !exactKeys(request.envelope, [
      "scheme",
      "issuer",
      "keyId",
      "signedObjectDigest",
      "signature",
    ]) ||
    !isIdentifier(request.audience) ||
    !isIdentifier(request.envelope.issuer) ||
    !isIdentifier(request.envelope.keyId) ||
    !SHA256_DIGEST.test(request.envelope.signedObjectDigest) ||
    !["DETACHED_JWS_ES256", "DETACHED_JWS_EDDSA"].includes(
      request.envelope.scheme,
    )
  ) {
    return result("MALFORMED_PROOF");
  }
  const claimsHash = digestStructured(
    request.profile,
    request.claims,
    request.wireVersion,
  );
  if (claimsHash === null || claimsHash !== request.envelope.signedObjectDigest) {
    return result("CLAIMS_DIGEST_MISMATCH", claimsHash);
  }
  if (request.requiredRole === "BOOT") {
    return result("KEY_ROLE_MISMATCH", claimsHash);
  }

  const segments = request.envelope.signature.split(".");
  if (
    segments.length !== 3 ||
    segments[0]!.length === 0 ||
    segments[1] !== "" ||
    segments[2]!.length === 0
  ) {
    return result("MALFORMED_PROOF", claimsHash);
  }
  const protectedBytes = decodeBase64urlCanonical(segments[0]!);
  const signature = decodeBase64urlCanonical(segments[2]!);
  if (!protectedBytes || !signature) {
    return result("SIGNATURE_ENCODING_INVALID", claimsHash);
  }
  let header: unknown;
  try {
    header = parseCommerceJson(protectedBytes);
  } catch {
    return result("MALFORMED_PROOF", claimsHash);
  }
  if (
    !exactKeys(header, ["alg", "aud", "iss", "kid", "typ"]) ||
    (header as { typ?: unknown }).typ !== "openant-commerce+jws" ||
    !isIdentifier((header as { aud?: unknown }).aud) ||
    !isIdentifier((header as { iss?: unknown }).iss) ||
    !isIdentifier((header as { kid?: unknown }).kid) ||
    encodeBase64url(canonicalizeJcs(header)) !== segments[0]
  ) {
    return result("MALFORMED_PROOF", claimsHash);
  }
  const closedHeader = header as {
    alg: CommerceJwsAlgorithm;
    aud: string;
    iss: string;
    kid: string;
  };
  if (closedHeader.aud !== request.audience) {
    return result("AUDIENCE_MISMATCH", claimsHash);
  }
  if (closedHeader.iss !== request.envelope.issuer) {
    return result("ISSUER_MISMATCH", claimsHash);
  }
  if (closedHeader.kid !== request.envelope.keyId) {
    return result("KEY_ID_MISMATCH", claimsHash);
  }
  const expectedAlgorithm =
    request.envelope.scheme === "DETACHED_JWS_ES256" ? "ES256" : "EdDSA";
  if (closedHeader.alg !== expectedAlgorithm) {
    return result("MALFORMED_PROOF", claimsHash);
  }
  if (!validateRegistry(request.keyRegistry)) {
    return result("KEY_REGISTRY_INVALID", claimsHash);
  }
  const identity = request.keyRegistry.filter(
    (candidate) =>
      candidate.issuer === request.envelope.issuer &&
      candidate.kid === request.envelope.keyId,
  );
  if (identity.length === 0) return result("KEY_NOT_FOUND", claimsHash);
  const key = identity.find(
    (candidate) => candidate.role === request.requiredRole,
  );
  if (!key) return result("KEY_ROLE_MISMATCH", claimsHash);
  if (key.algorithm !== expectedAlgorithm) {
    return result("MALFORMED_PROOF", claimsHash);
  }

  const payload = encodeBase64url(
    new TextEncoder().encode(request.envelope.signedObjectDigest),
  );
  const signingInput = new TextEncoder().encode(`${segments[0]}.${payload}`);
  const cryptoReason = verifyCommerceSignature(
    expectedAlgorithm,
    key.jwk,
    signingInput,
    signature,
  );
  if (cryptoReason !== "VERIFIED") {
    return result(
      cryptoReason === "KEY_INVALID" ? "KEY_REGISTRY_INVALID" : cryptoReason,
      claimsHash,
    );
  }

  const issuedAt = parseRfc3339UtcWholeSeconds(
    (request.claims as { issuedAt?: unknown } | null)?.issuedAt,
  );
  if (issuedAt === null) return result("STATEMENT_TIME_INVALID", claimsHash);
  if (issuedAt > now + skew) return result("STATEMENT_FROM_FUTURE", claimsHash);
  if (
    now < key.notBeforeUnixMs ||
    (key.notAfterUnixMs !== null && now >= key.notAfterUnixMs)
  ) {
    return result("KEY_NOT_ACTIVE", claimsHash);
  }
  if (key.revokedAtUnixMs !== null && now >= key.revokedAtUnixMs) {
    return result("KEY_REVOKED", claimsHash);
  }
  return result("VERIFIED", claimsHash);
}

export interface CommerceVerifier {
  verifyDetachedJwsLive(
    request: DetachedJwsVerificationRequest,
  ): Promise<CommerceVerificationResult>;
}

/** Trusted local policy is fixed at construction; proof callers cannot backdate. */
export function createCommerceVerifier(policy: {
  readonly maxClockSkewMs: number;
}): CommerceVerifier | CommerceVerificationResult {
  if (
    !Number.isSafeInteger(policy.maxClockSkewMs) ||
    policy.maxClockSkewMs < 0 ||
    policy.maxClockSkewMs > MAX_CLOCK_SKEW_MS
  ) {
    return result("CLOCK_SKEW_INVALID");
  }
  return Object.freeze({
    verifyDetachedJwsLive: (request: DetachedJwsVerificationRequest) =>
      verifyDetachedJwsWithTrustedPolicy(request, policy.maxClockSkewMs),
  });
}

function positiveUint256(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return false;
  try {
    return BigInt(value) <= UINT256_MAX;
  } catch {
    return false;
  }
}

function canonicalAddress(value: unknown): value is `0x${string}` {
  return (
    typeof value === "string" &&
    /^0x[0-9a-f]{40}$/.test(value) &&
    !/^0x0{40}$/.test(value)
  );
}

export async function verifyEip3009Live(
  request: Eip3009VerificationRequest,
): Promise<CommerceVerificationResult> {
  const now = liveTime();
  if (now === null) return result("CLOCK_UNAVAILABLE");
  if (!exactKeys(request, [
    "claimedClaimsHash", "envelope", "typedData", "walletProofClaims", "wireVersion",
  ])) {
    return result("MALFORMED_PROOF");
  }
  if (request.wireVersion !== COMMERCE_VERIFIER_METADATA.wireVersion) {
    return result("UNSUPPORTED_WIRE_VERSION");
  }
  if (
    !exactKeys(request.envelope, [
      "scheme",
      "issuer",
      "keyId",
      "signedObjectDigest",
      "signature",
    ]) ||
    request.envelope.scheme !== "EIP712" ||
    !SHA256_DIGEST.test(request.envelope.signedObjectDigest) ||
    !SHA256_DIGEST.test(request.claimedClaimsHash)
  ) {
    return result("MALFORMED_PROOF");
  }

  const claims = request.walletProofClaims as any;
  if (!validateWalletClaims(claims)) {
    return result("MALFORMED_PROOF");
  }
  const claimsHash = digestStructured(
    "RECEIPT_CLAIMS",
    claims,
    request.wireVersion,
  );
  if (claimsHash === null || claimsHash !== request.claimedClaimsHash) {
    return result("CLAIMS_DIGEST_MISMATCH", claimsHash);
  }
  if (
    request.envelope.issuer !== claims.buyerActorRef ||
    request.envelope.issuer !== claims.issuer?.issuer
  ) {
    return result("ISSUER_MISMATCH", claimsHash);
  }
  if (request.envelope.keyId !== claims.issuer?.keyId) {
    return result("KEY_ID_MISMATCH", claimsHash);
  }
  const issuedAt = parseRfc3339UtcWholeSeconds(claims.issuedAt);
  const expiresAt = parseRfc3339UtcWholeSeconds(claims.expiresAt);
  if (
    issuedAt === null ||
    expiresAt === null ||
    issuedAt >= expiresAt ||
    now < issuedAt ||
    now >= expiresAt
  ) {
    return result("AUTHORIZATION_TIME_INVALID", claimsHash);
  }

  if (
    !exactKeys(request.typedData, ["domain", "types", "primaryType", "message"])
  ) {
    return result("MALFORMED_PROOF", claimsHash);
  }
  const typedData = request.typedData as any;
  if (
    !exactKeys(typedData.domain, [
      "name",
      "version",
      "chainId",
      "verifyingContract",
    ]) ||
    typedData.domain.name !== "USD Coin" ||
    typedData.domain.version !== "2" ||
    typedData.domain.chainId !== 8453 ||
    typedData.domain.verifyingContract !== BASE_USDC_CONTRACT
  ) {
    return result("AUTHORIZATION_DOMAIN_MISMATCH", claimsHash);
  }
  const expectedTypes = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  } as const;
  if (
    typedData.primaryType !== "TransferWithAuthorization" ||
    JSON.stringify(typedData.types) !== JSON.stringify(expectedTypes) ||
    !exactKeys(typedData.message, [
      "from",
      "to",
      "value",
      "validAfter",
      "validBefore",
      "nonce",
    ])
  ) {
    return result("AUTHORIZATION_MESSAGE_MISMATCH", claimsHash);
  }
  const expectedMessage = {
    from: String(claims.payerAddress).toLowerCase(),
    to: String(claims.payeeAddress).toLowerCase(),
    value: claims.amountAtomic,
    validAfter: "0",
    validBefore: Math.floor(expiresAt / 1_000).toString(),
    nonce: `0x${String(claims.paymentIntentFingerprintDigest).slice(7)}`,
  };
  if (
    !canonicalAddress(typedData.message.from) ||
    !canonicalAddress(typedData.message.to) ||
    !positiveUint256(typedData.message.value) ||
    !positiveUint256(typedData.message.validBefore) ||
    !/^0x[0-9a-f]{64}$/.test(typedData.message.nonce) ||
    JSON.stringify(typedData.message) !== JSON.stringify(expectedMessage)
  ) {
    return result("AUTHORIZATION_MESSAGE_MISMATCH", claimsHash);
  }
  const authorizationHash = digestStructured(
    "PAYMENT_AUTHORIZATION",
    typedData,
    request.wireVersion,
  );
  if (
    authorizationHash === null ||
    authorizationHash !== claims.paymentAuthorizationDigest ||
    authorizationHash !== request.envelope.signedObjectDigest
  ) {
    return result("AUTHORIZATION_DIGEST_MISMATCH", claimsHash);
  }
  if (!/^0x[0-9a-f]{130}$/.test(request.envelope.signature)) {
    return result("SIGNATURE_ENCODING_INVALID", claimsHash);
  }
  const signature = request.envelope.signature;
  const r = BigInt(`0x${signature.slice(2, 66)}`);
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  if (
    r === 0n ||
    r >= SECP256K1_ORDER ||
    s === 0n ||
    s > SECP256K1_ORDER / 2n
  ) {
    return result("SIGNATURE_NON_CANONICAL", claimsHash);
  }
  if (!['1b', '1c'].includes(signature.slice(130, 132))) {
    return result("SIGNATURE_ENCODING_INVALID", claimsHash);
  }
  try {
    const recovered = await recoverTypedDataAddress({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature: signature as `0x${string}`,
    });
    if (recovered.toLowerCase() !== String(claims.payerAddress).toLowerCase()) {
      return result("PAYER_ADDRESS_MISMATCH", claimsHash);
    }
  } catch {
    return result("SIGNATURE_INVALID", claimsHash);
  }
  return result("VERIFIED", claimsHash);
}

export function verifyBootBinding(
  request: BootBindingRequest,
): CommerceVerificationResult {
  if (!exactKeys(request, ["expected", "verified"])) {
    return result("BOOT_BINDING_MISMATCH");
  }
  const keys = [
    "profile",
    "appProofClaimsHash",
    "bootProofHash",
    "ephemeralKeyHash",
    "pivotHash",
  ] as const;
  if (
    !exactKeys(request.expected, keys) ||
    !exactKeys(request.verified, keys) ||
    !isVerifiedCommerceBootProjection(request.verified) ||
    request.expected.profile !== "commerce-authorization/v1" ||
    request.verified.profile !== "commerce-authorization/v1" ||
    keys.slice(1).some(
      (key) =>
        !SHA256_DIGEST.test(request.expected[key]) ||
        !SHA256_DIGEST.test(request.verified[key]),
    ) ||
    keys.some((key) => request.expected[key] !== request.verified[key])
  ) {
    return result("BOOT_BINDING_MISMATCH");
  }
  return result("VERIFIED", request.expected.appProofClaimsHash);
}

function validateWalletClaims(claims: any): boolean {
  return (
    exactKeys(claims, [
      "objectType",
      "protocolVersion",
      "receiptId",
      "invocationId",
      "issuedAt",
      "issuer",
      "paymentIntentId",
      "paymentIntentFingerprintDigest",
      "buyerActorRef",
      "serviceSkuVersionDigest",
      "challengeDigest",
      "paymentAuthorizationDigest",
      "expiresAt",
      "amountAtomic",
      "asset",
      "payerAddress",
      "payeeAddress",
      "mode",
      "requestedAssurance",
      "facilitatorId",
    ]) &&
    claims.objectType === "WalletAuthorizationProof" &&
    claims.protocolVersion === "0.1" &&
    isIdentifier(claims.receiptId) &&
    isIdentifier(claims.invocationId) &&
    isIdentifier(claims.paymentIntentId) &&
    isIdentifier(claims.buyerActorRef) &&
    isIdentifier(claims.facilitatorId) &&
    exactKeys(claims.issuer, ["issuer", "keyId"]) &&
    claims.issuer.issuer === claims.buyerActorRef &&
    isIdentifier(claims.issuer.issuer) &&
    isIdentifier(claims.issuer.keyId) &&
    [
      claims.paymentIntentFingerprintDigest,
      claims.serviceSkuVersionDigest,
      claims.challengeDigest,
      claims.paymentAuthorizationDigest,
    ].every((value) => typeof value === "string" && SHA256_DIGEST.test(value)) &&
    positiveUint256(claims.amountAtomic) &&
    typeof claims.payerAddress === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(claims.payerAddress) &&
    !/^0x0{40}$/i.test(claims.payerAddress) &&
    typeof claims.payeeAddress === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(claims.payeeAddress) &&
    !/^0x0{40}$/i.test(claims.payeeAddress) &&
    ["HOSTED", "DIRECT"].includes(claims.mode) &&
    exactKeys(claims.asset, [
      "network",
      "namespace",
      "reference",
      "symbol",
      "decimals",
    ]) &&
    claims.asset.network === "eip155:8453" &&
    claims.asset.namespace === "erc20" &&
    claims.asset.reference === BASE_USDC_CONTRACT &&
    claims.asset.symbol === "USDC" &&
    claims.asset.decimals === 6 &&
    exactKeys(claims.requestedAssurance, [
      "authorization",
      "settlement",
      "delivery",
      "contentCustody",
      "identity",
    ]) &&
    ["NONE", "WALLET_SIGNED", "MANDATE_PROTECTED"].includes(
      claims.requestedAssurance.authorization,
    ) &&
    ["NONE", "SUBMITTED_ONLY", "FINALITY_VERIFIED"].includes(
      claims.requestedAssurance.settlement,
    ) &&
    [
      "NONE",
      "SELLER_ASSERTED",
      "DIRECT_BUYER_ACCEPTED",
      "HOSTED_RECOVERABLE",
    ].includes(claims.requestedAssurance.delivery) &&
    ["DIRECT", "HOSTED_EPHEMERAL", "HOSTED_ENCRYPTED_BUFFER"].includes(
      claims.requestedAssurance.contentCustody,
    ) &&
    ["ANONYMOUS_WALLET", "PLATFORM_BOUND", "VERIFIED_SELLER"].includes(
      claims.requestedAssurance.identity,
    )
  );
}
