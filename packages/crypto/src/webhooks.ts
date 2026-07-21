/**
 * 0xkey webhook signature verification.
 *
 * Mirrors the design of Turnkey's `verifyTurnkeyWebhookSignature` in
 * `@turnkey/crypto`, using the same signed-input format so the two
 * implementations remain structurally identical.
 *
 * Signed-input format (shared with the Rust `webhook-contract` crate):
 *   `"{version}.{algorithm}.{keyId}.{timestampMs}.{eventId}." + rawBodyBytes`
 *
 * Verification keys are base64-encoded Ed25519 public keys (the `x` field
 * of a JWK, RFC 7517 OKP). Use `verifyWebhookFromJWKS` for automatic
 * key fetching and caching from
 * `GET /public/v1/discovery/webhooks/jwks` (Public API).
 */

import { ed25519 } from "@noble/curves/ed25519";

// ---------------------------------------------------------------------------
// Header name constants
// ---------------------------------------------------------------------------

const HEADER_TIMESTAMP = "x-0xkey-timestamp";
const HEADER_EVENT_ID = "x-0xkey-event-id";
const HEADER_KEY_ID = "x-0xkey-signature-key-id";
const HEADER_ALGORITHM = "x-0xkey-signature-algorithm";
const HEADER_VERSION = "x-0xkey-signature-version";
const HEADER_SIGNATURE = "x-0xkey-signature";

const SUPPORTED_VERSION = "v1";
const SUPPORTED_ALGORITHM = "ed25519";
const PUBLIC_KEY_BYTE_LENGTH = 32;
const ED25519_SIGNATURE_BYTE_LENGTH = 64;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ZeroXKeyWebhookHeaders =
  | Headers
  | Record<string, string | string[] | undefined>;

export type ZeroXKeyWebhookBody = string | Uint8Array | ArrayBuffer;

export type ZeroXKeyWebhookVerificationKey = {
  keyId: string;
  /** Base64-encoded 32-byte Ed25519 public key (the `x` field of a JWK). */
  publicKey: string;
  algorithm?: "ed25519";
};

export const ZeroXKeyWebhookVerificationFailureReasons = {
  InvalidMaxTimestampAge: "invalid_max_timestamp_age",
  InvalidNow: "invalid_now",
  MissingHeader: "missing_header",
  InvalidTimestamp: "invalid_timestamp",
  StaleTimestamp: "stale_timestamp",
  UnsupportedSignatureVersion: "unsupported_signature_version",
  UnsupportedSignatureAlgorithm: "unsupported_signature_algorithm",
  MissingKey: "missing_key",
  InvalidVerificationKeyAlgorithm: "invalid_verification_key_algorithm",
  InvalidVerificationKey: "invalid_verification_key",
  InvalidSignature: "invalid_signature",
  JwksFetchError: "jwks_fetch_error",
} as const;

export type ZeroXKeyWebhookVerificationFailureReason =
  (typeof ZeroXKeyWebhookVerificationFailureReasons)[keyof typeof ZeroXKeyWebhookVerificationFailureReasons];

export type ZeroXKeyWebhookVerificationSuccess = {
  ok: true;
  eventId: string;
  keyId: string;
  timestampMs: number;
};

export type ZeroXKeyWebhookVerificationFailure = {
  ok: false;
  reason: ZeroXKeyWebhookVerificationFailureReason;
  headerName?: string;
  message?: string;
};

export type ZeroXKeyWebhookVerificationResult =
  | ZeroXKeyWebhookVerificationSuccess
  | ZeroXKeyWebhookVerificationFailure;

export type VerifyWebhookParams = {
  headers: ZeroXKeyWebhookHeaders;
  body: ZeroXKeyWebhookBody;
  verificationKeys: ZeroXKeyWebhookVerificationKey[];
  maxTimestampAgeMs: number;
  nowMs?: number;
};

export type VerifyWebhookFromJWKSParams = {
  headers: ZeroXKeyWebhookHeaders;
  body: ZeroXKeyWebhookBody;
  jwksUrl: string;
  maxTimestampAgeMs: number;
  nowMs?: number;
  fetch?: typeof globalThis.fetch;
};

// ---------------------------------------------------------------------------
// Primary API
// ---------------------------------------------------------------------------

/**
 * Verify an 0xkey webhook delivery using caller-provided Ed25519 verification
 * keys.
 *
 * Returns a typed result instead of throwing, so handlers can distinguish
 * expected verification failures without exception-driven control flow.
 */
export function verifyWebhook({
  headers,
  body,
  verificationKeys,
  maxTimestampAgeMs,
  nowMs = Date.now(),
}: VerifyWebhookParams): ZeroXKeyWebhookVerificationResult {
  if (!Number.isFinite(maxTimestampAgeMs) || maxTimestampAgeMs < 0) {
    return failure(
      ZeroXKeyWebhookVerificationFailureReasons.InvalidMaxTimestampAge,
    );
  }
  if (!Number.isFinite(nowMs)) {
    return failure(ZeroXKeyWebhookVerificationFailureReasons.InvalidNow);
  }

  const timestampHeader = getRequiredHeader(headers, HEADER_TIMESTAMP);
  if (!timestampHeader.ok) return timestampHeader;

  const eventIdHeader = getRequiredHeader(headers, HEADER_EVENT_ID);
  if (!eventIdHeader.ok) return eventIdHeader;

  const keyIdHeader = getRequiredHeader(headers, HEADER_KEY_ID);
  if (!keyIdHeader.ok) return keyIdHeader;

  const algorithmHeader = getRequiredHeader(headers, HEADER_ALGORITHM);
  if (!algorithmHeader.ok) return algorithmHeader;

  const versionHeader = getRequiredHeader(headers, HEADER_VERSION);
  if (!versionHeader.ok) return versionHeader;

  const signatureHeader = getRequiredHeader(headers, HEADER_SIGNATURE);
  if (!signatureHeader.ok) return signatureHeader;

  const timestampMs = parseTimestampMs(timestampHeader.value);
  if (timestampMs === undefined) {
    return failure(ZeroXKeyWebhookVerificationFailureReasons.InvalidTimestamp);
  }

  if (Math.abs(nowMs - timestampMs) > maxTimestampAgeMs) {
    return failure(ZeroXKeyWebhookVerificationFailureReasons.StaleTimestamp);
  }

  if (versionHeader.value !== SUPPORTED_VERSION) {
    return failure(
      ZeroXKeyWebhookVerificationFailureReasons.UnsupportedSignatureVersion,
    );
  }
  if (algorithmHeader.value !== SUPPORTED_ALGORITHM) {
    return failure(
      ZeroXKeyWebhookVerificationFailureReasons.UnsupportedSignatureAlgorithm,
    );
  }

  const key = verificationKeys.find((k) => k.keyId === keyIdHeader.value);
  if (!key) {
    return failure(ZeroXKeyWebhookVerificationFailureReasons.MissingKey);
  }

  if (key.algorithm !== undefined && key.algorithm !== SUPPORTED_ALGORITHM) {
    return failure(
      ZeroXKeyWebhookVerificationFailureReasons.InvalidVerificationKeyAlgorithm,
    );
  }

  const pubKeyResult = decodePublicKey(key.publicKey);
  if (!pubKeyResult.ok) return pubKeyResult;

  const sigResult = hexToBytes(
    signatureHeader.value,
    ED25519_SIGNATURE_BYTE_LENGTH,
    ZeroXKeyWebhookVerificationFailureReasons.InvalidSignature,
  );
  if (!sigResult.ok) return sigResult;

  const signedInput = buildSignedInput({
    version: versionHeader.value,
    algorithm: algorithmHeader.value,
    keyId: keyIdHeader.value,
    timestampMs: timestampHeader.value,
    eventId: eventIdHeader.value,
    body,
  });

  let verified = false;
  try {
    verified = ed25519.verify(sigResult.value, signedInput, pubKeyResult.value);
  } catch {
    return failure(ZeroXKeyWebhookVerificationFailureReasons.InvalidSignature);
  }

  if (!verified) {
    return failure(ZeroXKeyWebhookVerificationFailureReasons.InvalidSignature);
  }

  return {
    ok: true,
    eventId: eventIdHeader.value,
    keyId: keyIdHeader.value,
    timestampMs,
  };
}

/**
 * Verify an 0xkey webhook delivery by fetching the Ed25519 public key from
 * the JWKS endpoint. Keys are fetched once and cached in-memory per
 * `(jwksUrl, keyId)`.
 */
export async function verifyWebhookFromJWKS({
  headers,
  body,
  jwksUrl,
  maxTimestampAgeMs,
  nowMs,
  fetch: fetchImpl = globalThis.fetch,
}: VerifyWebhookFromJWKSParams): Promise<ZeroXKeyWebhookVerificationResult> {
  const keyIdHeader = getRequiredHeader(headers, HEADER_KEY_ID);
  if (!keyIdHeader.ok) return keyIdHeader;

  const keyResult = await fetchPublicKeyFromJWKS(
    jwksUrl,
    keyIdHeader.value,
    fetchImpl,
  );
  if (!keyResult.ok) return keyResult;

  return verifyWebhook({
    body,
    headers,
    verificationKeys: [
      { keyId: keyIdHeader.value, publicKey: keyResult.publicKey },
    ],
    maxTimestampAgeMs,
    ...(nowMs !== undefined ? { nowMs } : {}),
  });
}

/**
 * Build the canonical signed-input bytes used for signing and verification.
 *
 * Format: `"{version}.{algorithm}.{keyId}.{timestampMs}.{eventId}." + rawBodyBytes`
 *
 * The `timestampMs` parameter must be the raw string value of the
 * `X-0xkey-Timestamp` header, not a re-formatted number.
 */
export function buildSignedInput({
  version,
  algorithm,
  keyId,
  timestampMs,
  eventId,
  body,
}: {
  version: string;
  algorithm: string;
  keyId: string;
  timestampMs: string;
  eventId: string;
  body: ZeroXKeyWebhookBody;
}): Uint8Array {
  const prefix = new TextEncoder().encode(
    `${version}.${algorithm}.${keyId}.${timestampMs}.${eventId}.`,
  );
  const bodyBytes = bodyToBytes(body);
  const out = new Uint8Array(prefix.length + bodyBytes.length);
  out.set(prefix, 0);
  out.set(bodyBytes, prefix.length);
  return out;
}

// ---------------------------------------------------------------------------
// JWKS cache
// ---------------------------------------------------------------------------

interface JWKEntry {
  kid: string;
  x: string;
}

const jwksCache = new Map<string, { keys: JWKEntry[]; fetchedAt: number }>();
const JWKS_CACHE_TTL_MS = 3_600_000; // 1 hour

async function fetchPublicKeyFromJWKS(
  jwksUrl: string,
  keyId: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<
  { ok: true; publicKey: string } | ZeroXKeyWebhookVerificationFailure
> {
  const cached = jwksCache.get(jwksUrl);
  if (cached && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    const key = cached.keys.find((k) => k.kid === keyId);
    if (key) return { ok: true, publicKey: normalizeBase64(key.x) };
  }

  let json: { keys?: unknown[] };
  try {
    const resp = await fetchImpl(jwksUrl, { method: "GET" });
    if (!resp.ok) {
      return failure(ZeroXKeyWebhookVerificationFailureReasons.JwksFetchError, {
        message: `HTTP ${resp.status} from ${jwksUrl}`,
      });
    }
    json = await resp.json();
  } catch (e) {
    return failure(ZeroXKeyWebhookVerificationFailureReasons.JwksFetchError, {
      message: String(e),
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keys: JWKEntry[] = ((json.keys ?? []) as any[]).map((k) => ({
    kid: String(k.kid ?? ""),
    x: String(k.x ?? ""),
  }));
  jwksCache.set(jwksUrl, { keys, fetchedAt: Date.now() });

  const key = keys.find((k) => k.kid === keyId);
  if (!key) {
    return failure(ZeroXKeyWebhookVerificationFailureReasons.MissingKey, {
      message: `No JWKS key found for kid="${keyId}" at ${jwksUrl}`,
    });
  }
  return { ok: true, publicKey: normalizeBase64(key.x) };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getRequiredHeader(
  headers: ZeroXKeyWebhookHeaders,
  name: string,
): { ok: true; value: string } | ZeroXKeyWebhookVerificationFailure {
  const value = getHeader(headers, name);
  if (value === undefined || value === "") {
    return failure(ZeroXKeyWebhookVerificationFailureReasons.MissingHeader, {
      headerName: name,
    });
  }
  return { ok: true, value };
}

function getHeader(
  headers: ZeroXKeyWebhookHeaders,
  name: string,
): string | undefined {
  if (isHeaders(headers)) {
    return headers.get(name) ?? undefined;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== name) continue;
    if (Array.isArray(v)) return v[0];
    return v;
  }
  return undefined;
}

function isHeaders(h: ZeroXKeyWebhookHeaders): h is Headers {
  return typeof Headers !== "undefined" && h instanceof Headers;
}

function decodePublicKey(
  publicKey: string,
): { ok: true; value: Uint8Array } | ZeroXKeyWebhookVerificationFailure {
  try {
    const bytes = base64Decode(publicKey);
    if (bytes.length !== PUBLIC_KEY_BYTE_LENGTH) {
      return failure(
        ZeroXKeyWebhookVerificationFailureReasons.InvalidVerificationKey,
        {
          message: `Expected ${PUBLIC_KEY_BYTE_LENGTH} bytes, got ${bytes.length}`,
        },
      );
    }
    return { ok: true, value: bytes };
  } catch {
    return failure(
      ZeroXKeyWebhookVerificationFailureReasons.InvalidVerificationKey,
    );
  }
}

function hexToBytes(
  input: string,
  expectedLength: number,
  reason: ZeroXKeyWebhookVerificationFailureReason,
): { ok: true; value: Uint8Array } | ZeroXKeyWebhookVerificationFailure {
  if (input.length !== expectedLength * 2 || !/^[0-9a-fA-F]+$/.test(input)) {
    return failure(reason);
  }
  const bytes = new Uint8Array(input.length / 2);
  for (let i = 0; i < input.length; i += 2) {
    bytes[i / 2] = parseInt(input.slice(i, i + 2), 16);
  }
  return { ok: true, value: bytes };
}

function bodyToBytes(body: ZeroXKeyWebhookBody): Uint8Array {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(body);
}

function parseTimestampMs(s: string): number | undefined {
  if (!/^[0-9]+$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : undefined;
}

function base64Decode(str: string): Uint8Array {
  const b64 = normalizeBase64(str);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function normalizeBase64(value: string): string {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  return pad === 0 ? b64 : b64 + "=".repeat(4 - pad);
}

function failure(
  reason: ZeroXKeyWebhookVerificationFailureReason,
  details: Omit<ZeroXKeyWebhookVerificationFailure, "ok" | "reason"> = {},
): ZeroXKeyWebhookVerificationFailure {
  return { ok: false, reason, ...details };
}
