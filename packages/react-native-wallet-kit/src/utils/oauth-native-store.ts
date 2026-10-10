import { utf8ToBytes } from "@noble/hashes/utils";

export const NATIVE_OAUTH_SERVICE =
  "com.0xkey.oauth.native.v1:nativeUI" as const;
export const NATIVE_OAUTH_USERNAME = "0xkey-oauth-native-v1" as const;

export type NativeOAuthErrorCode =
  | "busy"
  | "config-invalid"
  | "not-ready"
  | "context-changed"
  | "randomness-unavailable"
  | "clock-unavailable"
  | "key-creation-failed"
  | "cancelled"
  | "adapter-failed"
  | "result-invalid"
  | "recovery-required";

const ERROR_MESSAGES: Readonly<Record<NativeOAuthErrorCode, string>> = {
  busy: "Native OAuth busy",
  "config-invalid": "Native OAuth configuration invalid",
  "not-ready": "Native OAuth client not ready",
  "context-changed": "Native OAuth context changed",
  "randomness-unavailable": "Native OAuth randomness unavailable",
  "clock-unavailable": "Native OAuth clock unavailable",
  "key-creation-failed": "Native OAuth key creation failed",
  cancelled: "Native OAuth cancelled",
  "adapter-failed": "Native OAuth adapter failed",
  "result-invalid": "Native OAuth result invalid",
  "recovery-required": "Native OAuth recovery required",
};

export class NativeOAuthError extends Error {
  readonly code: NativeOAuthErrorCode;

  constructor(code: NativeOAuthErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "NativeOAuthError";
    this.code = code;
  }
}

export function nativeOAuthError(code: NativeOAuthErrorCode): NativeOAuthError {
  return new NativeOAuthError(code);
}

export type NativeBinding = Readonly<{
  organizationId: string;
  apiBaseUrl: string;
  authProxyUrl: string;
  authProxyConfigId: string | null;
  provider: "google" | "apple";
  platform: "ios" | "android";
  clientId: string;
  redirectUri: string | null;
  completion: "internal" | "onOauthSuccess" | "onOauthRedirect";
  keyNamespace: "auth-v2";
}>;

export type NativeRecord = Readonly<{
  kind: "native-oauth";
  version: 1;
  operationId: string;
  binding: NativeBinding;
  publicKey: string;
  createdAt: number;
  phase: "awaiting_native" | "cleanup_claimed" | "handoff_started";
}>;

export type NativeSlotStorage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
};

export type NativeOAuthStore = {
  read(): Promise<NativeRecord | null>;
  write(record: NativeRecord): Promise<void>;
  remove(record: NativeRecord): Promise<void>;
};

const BINDING_KEYS = [
  "organizationId",
  "apiBaseUrl",
  "authProxyUrl",
  "authProxyConfigId",
  "provider",
  "platform",
  "clientId",
  "redirectUri",
  "completion",
  "keyNamespace",
] as const;
const RECORD_KEYS = [
  "kind",
  "version",
  "operationId",
  "binding",
  "publicKey",
  "createdAt",
  "phase",
] as const;
const VISIBLE_ASCII = /^[\x21-\x7e]+$/;
const OPERATION_ID = /^[0-9a-f]{32}$/;
const PUBLIC_KEY = /^(?:0[23][0-9a-f]{64}|04[0-9a-f]{128})$/;
const CUSTOM_SCHEME = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+:\/[^/][^?#]*$/;

function fail(code: "config-invalid" | "recovery-required"): never {
  throw nativeOAuthError(code);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function byteLength(value: string): number {
  return utf8ToBytes(value).length;
}

function boundedVisibleAscii(
  value: unknown,
  maximum: number,
  code: "config-invalid" | "recovery-required",
): string {
  if (
    typeof value !== "string" ||
    !VISIBLE_ASCII.test(value) ||
    byteLength(value) > maximum
  ) {
    return fail(code);
  }
  return value;
}

function checkedUrlInput(
  value: unknown,
  code: "config-invalid" | "recovery-required",
): string {
  const text = boundedVisibleAscii(value, 2_048, code);
  if (
    text.includes("\\") ||
    text.includes("?") ||
    text.includes("#") ||
    /%(?![0-9a-fA-F]{2})/.test(text)
  ) {
    return fail(code);
  }
  return text;
}

function parseUrl(
  value: string,
  code: "config-invalid" | "recovery-required",
): URL {
  try {
    return new URL(value);
  } catch {
    return fail(code);
  }
}

function canonicalBaseUrl(
  value: unknown,
  code: "config-invalid" | "recovery-required",
): string {
  const input = checkedUrlInput(value, code);
  const url = parseUrl(input, code);
  if (!url.hostname || url.username || url.password) return fail(code);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    return fail(code);
  const output = url.href;
  if (byteLength(output) < 1 || byteLength(output) > 2_048) return fail(code);
  return output;
}

function redirectUri(
  value: unknown,
  provider: NativeBinding["provider"],
  platform: NativeBinding["platform"],
  code: "config-invalid" | "recovery-required",
): string | null {
  if (
    (provider === "google" && platform === "android") ||
    (provider === "apple" && platform === "ios")
  ) {
    if (value !== null) return fail(code);
    return null;
  }
  const input = checkedUrlInput(value, code);
  const url = parseUrl(input, code);
  if (provider === "google") {
    if (
      !CUSTOM_SCHEME.test(input) ||
      url.href !== input ||
      url.hostname ||
      url.username ||
      url.password
    ) {
      return fail(code);
    }
    return input;
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.href !== input
  ) {
    return fail(code);
  }
  return input;
}

function bindingSnapshot(
  input: unknown,
  code: "config-invalid" | "recovery-required",
  requireCanonicalBases: boolean,
): NativeBinding {
  try {
    if (!isPlainObject(input) || !hasExactKeys(input, BINDING_KEYS))
      return fail(code);
    const organizationId = boundedVisibleAscii(input.organizationId, 256, code);
    const apiBaseUrl = canonicalBaseUrl(input.apiBaseUrl, code);
    const authProxyUrl = canonicalBaseUrl(input.authProxyUrl, code);
    if (
      requireCanonicalBases &&
      (apiBaseUrl !== input.apiBaseUrl || authProxyUrl !== input.authProxyUrl)
    ) {
      return fail(code);
    }
    const authProxyConfigId =
      input.authProxyConfigId === null
        ? null
        : boundedVisibleAscii(input.authProxyConfigId, 256, code);
    if (input.provider !== "google" && input.provider !== "apple")
      return fail(code);
    if (input.platform !== "ios" && input.platform !== "android")
      return fail(code);
    const clientId = boundedVisibleAscii(input.clientId, 1_024, code);
    const selectedRedirect = redirectUri(
      input.redirectUri,
      input.provider,
      input.platform,
      code,
    );
    if (
      input.completion !== "internal" &&
      input.completion !== "onOauthSuccess" &&
      input.completion !== "onOauthRedirect"
    ) {
      return fail(code);
    }
    if (input.keyNamespace !== "auth-v2") return fail(code);
    return Object.freeze({
      organizationId,
      apiBaseUrl,
      authProxyUrl,
      authProxyConfigId,
      provider: input.provider,
      platform: input.platform,
      clientId,
      redirectUri: selectedRedirect,
      completion: input.completion,
      keyNamespace: input.keyNamespace,
    });
  } catch {
    return fail(code);
  }
}

export function canonicalizeNativeBinding(input: unknown): NativeBinding {
  return bindingSnapshot(input, "config-invalid", false);
}

function canonicalRecord(
  input: unknown,
  code: "config-invalid" | "recovery-required",
  requireCanonicalBases: boolean,
): NativeRecord {
  try {
    if (!isPlainObject(input) || !hasExactKeys(input, RECORD_KEYS))
      return fail(code);
    if (input.kind !== "native-oauth" || input.version !== 1) return fail(code);
    if (
      typeof input.operationId !== "string" ||
      !OPERATION_ID.test(input.operationId)
    )
      return fail(code);
    const validatedBinding = bindingSnapshot(
      input.binding,
      code,
      requireCanonicalBases,
    );
    if (
      typeof input.publicKey !== "string" ||
      !PUBLIC_KEY.test(input.publicKey)
    )
      return fail(code);
    if (
      typeof input.createdAt !== "number" ||
      !Number.isSafeInteger(input.createdAt) ||
      input.createdAt < 0
    ) {
      return fail(code);
    }
    if (
      input.phase !== "awaiting_native" &&
      input.phase !== "cleanup_claimed" &&
      input.phase !== "handoff_started"
    ) {
      return fail(code);
    }
    return Object.freeze({
      kind: "native-oauth",
      version: 1,
      operationId: input.operationId,
      binding: validatedBinding,
      publicKey: input.publicKey,
      createdAt: input.createdAt,
      phase: input.phase,
    });
  } catch {
    return fail(code);
  }
}

export function serializeNativeRecord(input: NativeRecord): string {
  return JSON.stringify(canonicalRecord(input, "config-invalid", false));
}

export function parseNativeRecord(raw: string): NativeRecord {
  try {
    if (
      typeof raw !== "string" ||
      byteLength(raw) < 1 ||
      byteLength(raw) > 16_384
    ) {
      return fail("recovery-required");
    }
    const parsed: unknown = JSON.parse(raw);
    const record = canonicalRecord(parsed, "recovery-required", true);
    if (JSON.stringify(record) !== raw) return fail("recovery-required");
    return record;
  } catch {
    return fail("recovery-required");
  }
}

export function sameNativeRecord(a: NativeRecord, b: NativeRecord): boolean {
  return serializeNativeRecord(a) === serializeNativeRecord(b);
}

export function withNativeRecordPhase(
  record: NativeRecord,
  phase: NativeRecord["phase"],
): NativeRecord {
  return canonicalRecord({ ...record, phase }, "config-invalid", false);
}

export function createNativeOAuthStore(
  storage: NativeSlotStorage,
): NativeOAuthStore {
  async function readRaw(): Promise<string | null> {
    try {
      const value = await storage.read();
      if (value !== null && typeof value !== "string")
        throw nativeOAuthError("recovery-required");
      return value;
    } catch {
      throw nativeOAuthError("recovery-required");
    }
  }

  async function read(): Promise<NativeRecord | null> {
    const value = await readRaw();
    return value === null ? null : parseNativeRecord(value);
  }

  return Object.freeze({
    read,
    async write(record) {
      const encoded = serializeNativeRecord(record);
      try {
        await storage.write(encoded);
      } catch {
        throw nativeOAuthError("recovery-required");
      }
      const persisted = await readRaw();
      if (persisted !== encoded) throw nativeOAuthError("recovery-required");
      parseNativeRecord(persisted);
    },
    async remove(expected) {
      const existing = await read();
      if (existing === null || !sameNativeRecord(existing, expected))
        throw nativeOAuthError("recovery-required");
      try {
        await storage.remove();
      } catch {
        // Removal can reject after applying. Exact absence is authoritative.
      }
      if ((await readRaw()) !== null)
        throw nativeOAuthError("recovery-required");
    },
  });
}
