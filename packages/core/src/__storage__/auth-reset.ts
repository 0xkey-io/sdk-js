import { SessionType } from "@0xkey-io/sdk-types";
import { jwtDecode } from "jwt-decode";

export const AUTH_ROOT = "@0xkey-io/auth/v2/";
export const RESET_MARKER = "@0xkey-io/auth-reset/v2";
const ALL = "@0xkey-io/all-session-keys";
const ACTIVE = "@0xkey-io/active-session-key";
const DEFAULT = "@0xkey-io/session/v3";
const STANDALONE_KEYS = new Set(["@0xkey-io/session/v2", "@0xkey-io/client"]);

export interface RawAuthStorage {
  identity: object;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  cleanup(publicKeys: string[]): Promise<void>;
}

const inFlight = new WeakMap<object, Promise<void>>();
type ResetStage =
  | "read_marker"
  | "read_legacy"
  | "clear_keys"
  | "clear_sessions"
  | "write_marker";

/** Internal, sanitized diagnostics: never retain the raw platform cause. */
export class AuthResetError extends Error {
  readonly code = "LOCAL_AUTH_RESET_FAILED";
  readonly retryable = true;
  constructor(readonly stage: ResetStage) {
    super("Local authentication reset failed");
  }
}
const parse = (raw: string | null): unknown => {
  try {
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
};
const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  Object.getPrototypeOf(value) === Object.prototype;
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

// Association/format validation only: decoding does not authenticate a token.
function legacyPublicKey(raw: string | null): string | undefined {
  const value = parse(raw);
  if (
    !plain(value) ||
    !nonempty(value.token) ||
    !nonempty(value.userId) ||
    !nonempty(value.organizationId) ||
    typeof value.expiry !== "number" ||
    !Number.isFinite(value.expiry) ||
    !Object.values(SessionType).includes(value.sessionType as SessionType) ||
    typeof value.publicKey !== "string" ||
    !/^(?:0[23][a-fA-F0-9]{64}|04[a-fA-F0-9]{128})$/.test(value.publicKey)
  )
    return;
  try {
    const claims = jwtDecode<Record<string, unknown>>(value.token);
    if (
      plain(claims) &&
      claims.exp === value.expiry &&
      claims.public_key === value.publicKey &&
      claims.user_id === value.userId &&
      claims.organization_id === value.organizationId &&
      claims.session_type === value.sessionType
    )
      return value.publicKey;
  } catch {
    /* Unknown legacy records are retained. */
  }
  return;
}

async function reset(raw: RawAuthStorage): Promise<void> {
  let stage: ResetStage = "read_marker";
  try {
    if ((await raw.get(RESET_MARKER)) === "complete") return;
    stage = "read_legacy";
    const list = parse(await raw.get(ALL));
    const active = parse(await raw.get(ACTIVE));
    const candidates = new Set<string>([DEFAULT]);
    if (Array.isArray(list))
      for (const key of list) if (nonempty(key)) candidates.add(key);
    if (nonempty(active)) candidates.add(active);
    const owned = new Map<string, string>();
    const publicKeys = new Set<string>();
    for (const key of candidates) {
      if (
        key.startsWith(AUTH_ROOT) ||
        key === RESET_MARKER ||
        key === ALL ||
        key === ACTIVE ||
        STANDALONE_KEYS.has(key)
      )
        continue;
      const value = await raw.get(key);
      const publicKey = legacyPublicKey(value);
      if (publicKey) {
        owned.set(key, value!);
        publicKeys.add(publicKey);
      }
    }
    stage = "clear_keys";
    await raw.cleanup([...publicKeys]);
    stage = "clear_sessions";
    for (const [key, snapshot] of owned) {
      // Narrows stale snapshot deletion; get/remove cannot implement cross-runtime CAS.
      if (key !== DEFAULT && (await raw.get(key)) === snapshot)
        await raw.remove(key);
    }
    await raw.remove(DEFAULT);
    await raw.remove(ALL);
    await raw.remove(ACTIVE);
    stage = "write_marker";
    await raw.set(RESET_MARKER, "complete");
  } catch {
    throw new AuthResetError(stage);
  }
}

export function prepareAuthStorage(raw: RawAuthStorage): Promise<void> {
  const pending = inFlight.get(raw.identity);
  if (pending) return pending;
  const work = Promise.resolve()
    .then(() => reset(raw))
    .finally(() => {
      inFlight.delete(raw.identity);
    });
  inFlight.set(raw.identity, work);
  return work;
}
