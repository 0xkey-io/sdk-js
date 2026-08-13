import {
  createHash,
  createPrivateKey,
  KeyObject,
  sign as cryptoSign,
  type JsonWebKey,
} from "node:crypto";

import { canonicalize } from "json-canonicalize";
import { hashTypedData, type Hex } from "viem";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type DetachedJwsAlgorithm = "ES256" | "EdDSA";

export interface SignatureEnvelope {
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

export interface WalletProofAssurance extends Record<string, JsonValue> {
  readonly authorization: "NONE" | "WALLET_SIGNED" | "MANDATE_PROTECTED";
  readonly settlement: "NONE" | "SUBMITTED_ONLY" | "FINALITY_VERIFIED";
  readonly delivery: "NONE" | "SELLER_ASSERTED" | "DIRECT_BUYER_ACCEPTED" | "HOSTED_RECOVERABLE";
  readonly contentCustody: "DIRECT" | "HOSTED_EPHEMERAL" | "HOSTED_ENCRYPTED_BUFFER";
  readonly identity: "ANONYMOUS_WALLET" | "PLATFORM_BOUND" | "VERIFIED_SELLER";
}

export interface WalletAuthorizationProofClaimsInput extends Record<string, JsonValue> {
  readonly objectType: "WalletAuthorizationProof";
  readonly protocolVersion: "0.1";
  readonly receiptId: string;
  readonly invocationId: string;
  readonly issuedAt: string;
  readonly issuer: { readonly issuer: string; readonly keyId: string };
  readonly paymentIntentId: string;
  readonly paymentIntentFingerprintDigest: `sha256:${string}`;
  readonly buyerActorRef: string;
  readonly serviceSkuVersionDigest: `sha256:${string}`;
  readonly challengeDigest: `sha256:${string}`;
  readonly expiresAt: string;
  readonly amountAtomic: string;
  readonly asset: {
    readonly network: "eip155:8453";
    readonly namespace: "erc20";
    readonly reference: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    readonly symbol: "USDC";
    readonly decimals: 6;
  };
  readonly payerAddress: `0x${string}`;
  readonly payeeAddress: `0x${string}`;
  readonly mode: "HOSTED" | "DIRECT";
  readonly requestedAssurance: WalletProofAssurance;
  readonly facilitatorId: string;
}

export interface WalletAuthorizationProofClaims
  extends WalletAuthorizationProofClaimsInput {
  readonly paymentAuthorizationDigest: `sha256:${string}`;
}

export interface DetachedJwsSigningRequest {
  readonly algorithm: DetachedJwsAlgorithm;
  readonly audience: string;
  readonly issuer: string;
  readonly keyId: string;
  readonly signedObjectDigest: `sha256:${string}`;
  readonly privateKey: KeyObject | JsonWebKey;
}

export interface TransferWithAuthorizationMessage extends Record<string, JsonValue> {
  readonly from: `0x${string}`;
  readonly to: `0x${string}`;
  readonly value: string;
  readonly validAfter: "0";
  readonly validBefore: string;
  readonly nonce: `0x${string}`;
}

export interface PaymentAuthorizationTypedData extends Record<string, JsonValue> {
  readonly domain: {
    readonly name: "USD Coin";
    readonly version: "2";
    readonly chainId: 8453;
    readonly verifyingContract: typeof BASE_USDC_CONTRACT;
  };
  readonly types: {
    readonly TransferWithAuthorization: readonly {
      readonly name: string;
      readonly type: string;
    }[];
  };
  readonly primaryType: "TransferWithAuthorization";
  readonly message: TransferWithAuthorizationMessage;
}

export interface PaymentAuthorizationBuildResult {
  readonly typedData: PaymentAuthorizationTypedData;
  readonly paymentAuthorizationDigest: `sha256:${string}`;
  readonly eip712SigningHash: Hex;
}

export interface Eip712EnvelopeRequest {
  readonly issuer: string;
  readonly keyId: string;
  readonly walletProofClaims: WalletAuthorizationProofClaimsInput;
  readonly signature: Hex;
  readonly wireVersion?: string;
}

export interface Eip712EnvelopeResult extends PaymentAuthorizationBuildResult {
  readonly envelope: SignatureEnvelope;
  readonly walletProofClaims: WalletAuthorizationProofClaims;
  readonly claimsDigest: `sha256:${string}`;
}

export class ProtocolCryptoError extends Error {
  constructor(
    readonly code:
      | "CRYPTO_INVALID_JSON"
      | "CRYPTO_INVALID_PROFILE"
      | "CRYPTO_INVALID_WIRE_VERSION"
      | "CRYPTO_INVALID_JWS_INPUT"
      | "CRYPTO_INVALID_EIP712_INPUT",
    message: string,
  ) {
    super(message);
    this.name = "ProtocolCryptoError";
  }
}

const P256_ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const PROTOCOL_IDENTIFIER = /^[a-z][a-z0-9]*(?:[_:-][a-zA-Z0-9]+)+$/;

export function isProtocolIdentifier(value: string): boolean {
  return value.length >= 3
    && value.length <= 128
    && PROTOCOL_IDENTIFIER.test(value);
}

function requireProtocolIdentifier(
  value: string,
  name: string,
  code: "CRYPTO_INVALID_JWS_INPUT" | "CRYPTO_INVALID_EIP712_INPUT",
): void {
  if (!isProtocolIdentifier(value)) {
    throw new ProtocolCryptoError(code, `${name} is not a protocol identifier`);
  }
}

function requireJwsIdentifier(value: string, name: string): void {
  requireProtocolIdentifier(value, name, "CRYPTO_INVALID_JWS_INPUT");
}

function normalizeP256LowS(signature: Buffer): Buffer {
  if (signature.length !== 64) {
    throw new ProtocolCryptoError("CRYPTO_INVALID_JWS_INPUT", "ES256 must produce a 64-byte JOSE signature");
  }
  const s = BigInt(`0x${signature.subarray(32).toString("hex")}`);
  if (s <= P256_ORDER / 2n) return signature;
  const normalized = P256_ORDER - s;
  return Buffer.concat([
    signature.subarray(0, 32),
    Buffer.from(normalized.toString(16).padStart(64, "0"), "hex"),
  ]);
}

export function signDigestJws(request: DetachedJwsSigningRequest): SignatureEnvelope {
  requireJwsIdentifier(request.audience, "audience");
  requireJwsIdentifier(request.issuer, "issuer");
  requireJwsIdentifier(request.keyId, "keyId");
  if (!SHA256_DIGEST.test(request.signedObjectDigest)) {
    throw new ProtocolCryptoError("CRYPTO_INVALID_JWS_INPUT", "signedObjectDigest must be lowercase SHA-256");
  }

  const key = request.privateKey instanceof KeyObject
    ? request.privateKey
    : createPrivateKey({ key: request.privateKey, format: "jwk" });
  if (key.type !== "private") {
    throw new ProtocolCryptoError("CRYPTO_INVALID_JWS_INPUT", "a private signing key is required");
  }
  const jwk = key.export({ format: "jwk" });
  if (
    (request.algorithm === "ES256" && (jwk.kty !== "EC" || jwk.crv !== "P-256")) ||
    (request.algorithm === "EdDSA" && (jwk.kty !== "OKP" || jwk.crv !== "Ed25519"))
  ) {
    throw new ProtocolCryptoError("CRYPTO_INVALID_JWS_INPUT", "JWS algorithm does not match the key type");
  }

  const protectedHeader = {
    alg: request.algorithm,
    aud: request.audience,
    iss: request.issuer,
    kid: request.keyId,
    typ: "openant-commerce+jws",
  } as const;
  const encodedHeader = Buffer.from(canonicalizeJcs(protectedHeader)).toString("base64url");
  const encodedPayload = Buffer.from(request.signedObjectDigest, "utf8").toString("base64url");
  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii");
  const rawSignature = request.algorithm === "ES256"
    ? normalizeP256LowS(
        cryptoSign("sha256", signingInput, { key, dsaEncoding: "ieee-p1363" }),
      )
    : cryptoSign(null, signingInput, key);
  if (rawSignature.length !== 64) {
    throw new ProtocolCryptoError("CRYPTO_INVALID_JWS_INPUT", "JWS signature must be exactly 64 bytes");
  }

  return {
    scheme: request.algorithm === "ES256" ? "DETACHED_JWS_ES256" : "DETACHED_JWS_EDDSA",
    issuer: request.issuer,
    keyId: request.keyId,
    signedObjectDigest: request.signedObjectDigest,
    signature: `${encodedHeader}..${rawSignature.toString("base64url")}`,
  };
}

const SECP256K1_ORDER = BigInt(
  "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
);
const UINT256_MAX = (1n << 256n) - 1n;
export const BASE_USDC_CONTRACT = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;

const WALLET_PROOF_CLAIMS_INPUT_FIELDS = [
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
  "expiresAt",
  "amountAtomic",
  "asset",
  "payerAddress",
  "payeeAddress",
  "mode",
  "requestedAssurance",
  "facilitatorId",
] as const;

const PAYMENT_AUTHORIZATION_TYPES = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const;

function assertExactKeys(value: object, expected: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new ProtocolCryptoError(
      "CRYPTO_INVALID_EIP712_INPUT",
      `${name} contains missing or unsigned extra fields`,
    );
  }
}

function requireEvmAddress(value: string, name: string): void {
  if (!isNonZeroEvmAddress(value)) {
    throw new ProtocolCryptoError("CRYPTO_INVALID_EIP712_INPUT", `${name} is not a non-zero EVM address`);
  }
}

export function isNonZeroEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value);
}

export function isPositiveUint256Decimal(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value) && BigInt(value) <= UINT256_MAX;
}

function parseRfc3339UtcWholeSeconds(value: string, name: string): number {
  if (!isRfc3339UtcWholeSeconds(value)) {
    throw new ProtocolCryptoError(
      "CRYPTO_INVALID_EIP712_INPUT",
      `${name} must be RFC 3339 UTC with whole seconds`,
    );
  }
  return Date.parse(value);
}

export function isRfc3339UtcWholeSeconds(value: string): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)
    || value.startsWith("0000-")
  ) return false;
  const epochMillis = Date.parse(value);
  return Number.isFinite(epochMillis)
    && new Date(epochMillis).toISOString() === value.replace(/Z$/, ".000Z");
}

function validateWalletProofClaims(
  claims: WalletAuthorizationProofClaimsInput | WalletAuthorizationProofClaims,
  includesAuthorizationDigest: boolean,
): void {
  assertExactKeys(
    claims,
    [
      ...WALLET_PROOF_CLAIMS_INPUT_FIELDS,
      ...(includesAuthorizationDigest ? ["paymentAuthorizationDigest"] : []),
    ],
    "Wallet authorization proof claims",
  );
  assertExactKeys(claims.issuer, ["issuer", "keyId"], "Wallet proof issuer");
  assertExactKeys(
    claims.asset,
    ["network", "namespace", "reference", "symbol", "decimals"],
    "Wallet proof asset",
  );
  assertExactKeys(
    claims.requestedAssurance,
    ["authorization", "settlement", "delivery", "contentCustody", "identity"],
    "Wallet proof assurance",
  );
  if (
    claims.objectType !== "WalletAuthorizationProof"
    || claims.protocolVersion !== "0.1"
    || claims.asset.network !== "eip155:8453"
    || claims.asset.namespace !== "erc20"
    || claims.asset.reference !== BASE_USDC_CONTRACT
    || claims.asset.symbol !== "USDC"
    || claims.asset.decimals !== 6
  ) {
    throw new ProtocolCryptoError(
      "CRYPTO_INVALID_EIP712_INPUT",
      "Wallet proof claims must use the Phase 0 wire contract and Base USDC",
    );
  }
  if (
    !["HOSTED", "DIRECT"].includes(claims.mode)
    || !["NONE", "WALLET_SIGNED", "MANDATE_PROTECTED"].includes(
      claims.requestedAssurance.authorization,
    )
    || !["NONE", "SUBMITTED_ONLY", "FINALITY_VERIFIED"].includes(
      claims.requestedAssurance.settlement,
    )
    || !["NONE", "SELLER_ASSERTED", "DIRECT_BUYER_ACCEPTED", "HOSTED_RECOVERABLE"].includes(
      claims.requestedAssurance.delivery,
    )
    || !["DIRECT", "HOSTED_EPHEMERAL", "HOSTED_ENCRYPTED_BUFFER"].includes(
      claims.requestedAssurance.contentCustody,
    )
    || !["ANONYMOUS_WALLET", "PLATFORM_BOUND", "VERIFIED_SELLER"].includes(
      claims.requestedAssurance.identity,
    )
  ) {
    throw new ProtocolCryptoError(
      "CRYPTO_INVALID_EIP712_INPUT",
      "Wallet proof mode or assurance is outside the Phase 0 contract",
    );
  }
  if (
    !SHA256_DIGEST.test(claims.paymentIntentFingerprintDigest)
    || !SHA256_DIGEST.test(claims.serviceSkuVersionDigest)
    || !SHA256_DIGEST.test(claims.challengeDigest)
    || (includesAuthorizationDigest
      && !SHA256_DIGEST.test(
        (claims as WalletAuthorizationProofClaims).paymentAuthorizationDigest,
      ))
  ) {
    throw new ProtocolCryptoError(
      "CRYPTO_INVALID_EIP712_INPUT",
      "Wallet proof claim digests must be lowercase SHA-256",
    );
  }
  requireEvmAddress(claims.payerAddress, "Wallet proof payerAddress");
  requireEvmAddress(claims.payeeAddress, "Wallet proof payeeAddress");
  if (!isPositiveUint256Decimal(claims.amountAtomic)) {
    throw new ProtocolCryptoError(
      "CRYPTO_INVALID_EIP712_INPUT",
      "Wallet proof amountAtomic must be a positive decimal integer",
    );
  }
  for (const [name, value] of [
    ["receiptId", claims.receiptId],
    ["invocationId", claims.invocationId],
    ["issuer", claims.issuer.issuer],
    ["keyId", claims.issuer.keyId],
    ["paymentIntentId", claims.paymentIntentId],
    ["buyerActorRef", claims.buyerActorRef],
    ["facilitatorId", claims.facilitatorId],
  ] as const) {
    requireProtocolIdentifier(value, name, "CRYPTO_INVALID_EIP712_INPUT");
  }
  const issuedAt = parseRfc3339UtcWholeSeconds(claims.issuedAt, "Wallet proof issuedAt");
  const expiresAt = parseRfc3339UtcWholeSeconds(claims.expiresAt, "Wallet proof expiresAt");
  if (issuedAt >= expiresAt) {
    throw new ProtocolCryptoError(
      "CRYPTO_INVALID_EIP712_INPUT",
      "Wallet proof issuedAt must be earlier than the exclusive expiresAt boundary",
    );
  }
  if (claims.issuer.issuer !== claims.buyerActorRef) {
    throw new ProtocolCryptoError(
      "CRYPTO_INVALID_EIP712_INPUT",
      "Wallet proof issuer must equal buyerActorRef",
    );
  }
}

export function buildPaymentAuthorizationTypedData(
  walletProofClaims: WalletAuthorizationProofClaimsInput,
  wireVersion = "0.1",
): PaymentAuthorizationBuildResult {
  validateWalletProofClaims(walletProofClaims, false);
  if (wireVersion !== "0.1") {
    throw new ProtocolCryptoError(
      "CRYPTO_INVALID_WIRE_VERSION",
      "TransferWithAuthorization supports only wire version 0.1",
    );
  }
  const validBefore = Math.floor(
    parseRfc3339UtcWholeSeconds(walletProofClaims.expiresAt, "expiresAt") / 1_000,
  ).toString();
  const nonce = `0x${walletProofClaims.paymentIntentFingerprintDigest.slice("sha256:".length)}` as const;
  const message: TransferWithAuthorizationMessage = {
    from: walletProofClaims.payerAddress.toLowerCase() as `0x${string}`,
    to: walletProofClaims.payeeAddress.toLowerCase() as `0x${string}`,
    value: walletProofClaims.amountAtomic,
    validAfter: "0",
    validBefore,
    nonce,
  };

  const typedData: PaymentAuthorizationTypedData = {
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: 8453,
      verifyingContract: BASE_USDC_CONTRACT,
    },
    types: { TransferWithAuthorization: PAYMENT_AUTHORIZATION_TYPES },
    primaryType: "TransferWithAuthorization",
    message,
  };
  const paymentAuthorizationDigest = digestStructured(
    "PAYMENT_AUTHORIZATION",
    typedData,
    wireVersion,
  );
  const eip712SigningHash = hashTypedData(
    typedData as Parameters<typeof hashTypedData>[0],
  );
  return { typedData, paymentAuthorizationDigest, eip712SigningHash };
}

export function createEip712ProofEnvelope(request: Eip712EnvelopeRequest): Eip712EnvelopeResult {
  assertExactKeys(
    request,
    [
      "issuer",
      "keyId",
      "walletProofClaims",
      "signature",
      ...(request.wireVersion === undefined ? [] : ["wireVersion"]),
    ],
    "EIP-712 envelope request",
  );
  requireProtocolIdentifier(request.issuer, "issuer", "CRYPTO_INVALID_EIP712_INPUT");
  requireProtocolIdentifier(request.keyId, "keyId", "CRYPTO_INVALID_EIP712_INPUT");
  if (
    request.issuer !== request.walletProofClaims.buyerActorRef
    || request.issuer !== request.walletProofClaims.issuer.issuer
    || request.keyId !== request.walletProofClaims.issuer.keyId
  ) {
    throw new ProtocolCryptoError(
      "CRYPTO_INVALID_EIP712_INPUT",
      "envelope issuer/keyId must equal the WalletAuthorizationProof buyer and issuer",
    );
  }
  if (!/^0x[0-9a-f]{130}$/.test(request.signature)) {
    throw new ProtocolCryptoError(
      "CRYPTO_INVALID_EIP712_INPUT",
      "EIP-712 signature must be lowercase 65-byte 0x-prefixed r,s,v",
    );
  }
  const r = BigInt(`0x${request.signature.slice(2, 66)}`);
  const s = BigInt(`0x${request.signature.slice(66, 130)}`);
  const v = request.signature.slice(130, 132);
  if (
    r === 0n
    || r >= SECP256K1_ORDER
    || s === 0n
    || s > SECP256K1_ORDER / 2n
    || !["1b", "1c"].includes(v)
  ) {
    throw new ProtocolCryptoError(
      "CRYPTO_INVALID_EIP712_INPUT",
      "EIP-712 signature scalars/parity are not canonical",
    );
  }

  const prepared = buildPaymentAuthorizationTypedData(
    request.walletProofClaims,
    request.wireVersion,
  );
  const walletProofClaims: WalletAuthorizationProofClaims = {
    ...request.walletProofClaims,
    paymentAuthorizationDigest: prepared.paymentAuthorizationDigest,
  };
  const claimsDigest = digestWalletAuthorizationProofClaims(
    walletProofClaims,
    request.wireVersion,
  );
  return {
    envelope: {
      scheme: "EIP712",
      issuer: request.issuer,
      keyId: request.keyId,
      signedObjectDigest: prepared.paymentAuthorizationDigest,
      signature: request.signature,
    },
    walletProofClaims,
    claimsDigest,
    ...prepared,
  };
}

export function digestWalletAuthorizationProofClaims(
  claims: WalletAuthorizationProofClaims,
  wireVersion = "0.1",
): `sha256:${string}` {
  validateWalletProofClaims(claims, true);
  return digestStructured("RECEIPT_CLAIMS", claims, wireVersion);
}

function validateUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) {
        throw new ProtocolCryptoError("CRYPTO_INVALID_JSON", "lone high surrogate is not I-JSON");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new ProtocolCryptoError("CRYPTO_INVALID_JSON", "lone low surrogate is not I-JSON");
    }
  }
}

function validateIJson(value: unknown, ancestors: Set<object>): asserts value is JsonValue {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    validateUnicode(value);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ProtocolCryptoError("CRYPTO_INVALID_JSON", "non-finite numbers are not I-JSON");
    }
    return;
  }
  if (typeof value !== "object") {
    throw new ProtocolCryptoError("CRYPTO_INVALID_JSON", `unsupported JSON value: ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new ProtocolCryptoError("CRYPTO_INVALID_JSON", "cyclic values are not JSON");
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new ProtocolCryptoError("CRYPTO_INVALID_JSON", "sparse arrays are not I-JSON");
      }
      validateIJson(value[index], ancestors);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ProtocolCryptoError("CRYPTO_INVALID_JSON", "only plain JSON objects are accepted");
    }
    for (const [key, child] of Object.entries(value)) {
      validateUnicode(key);
      validateIJson(child, ancestors);
    }
  }
  ancestors.delete(value);
}

function validateFrameComponent(component: string, code: "CRYPTO_INVALID_PROFILE" | "CRYPTO_INVALID_WIRE_VERSION"): void {
  if (component.length === 0 || component.includes("\0")) {
    throw new ProtocolCryptoError(code, "digest frame components must be non-empty and NUL-free");
  }
}

export function canonicalizeJcs(value: JsonValue): Uint8Array {
  validateIJson(value, new Set());
  return new TextEncoder().encode(canonicalize(value));
}

export function digestStructured(
  profile: string,
  value: JsonValue,
  wireVersion = "0.1",
): `sha256:${string}` {
  validateFrameComponent(profile, "CRYPTO_INVALID_PROFILE");
  validateFrameComponent(wireVersion, "CRYPTO_INVALID_WIRE_VERSION");
  const nul = Uint8Array.of(0);
  const frame = Buffer.concat([
    Buffer.from("openant-commerce", "utf8"),
    nul,
    Buffer.from(wireVersion, "utf8"),
    nul,
    Buffer.from(profile, "utf8"),
    nul,
    canonicalizeJcs(value),
  ]);
  return `sha256:${createHash("sha256").update(frame).digest("hex")}`;
}
