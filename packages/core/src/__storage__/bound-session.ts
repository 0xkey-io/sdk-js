import { parseSession } from "@utils";

export interface BoundAuthTarget {
  organizationId: string;
  apiBaseUrl: string;
  authProxyUrl: string;
  authProxyConfigId?: string | undefined;
}

export interface BoundSessionRecord {
  version: 3;
  target: BoundAuthTarget;
  targetGeneration?: number;
  activeSessionKey?: string | undefined;
  sessions: Array<{ key: string; token: string }>;
}

/**
 * Implementations must execute update synchronously inside one durable,
 * cross-tab/process readwrite transaction. A process-local queue or a
 * get-then-set pair does not satisfy this contract.
 */
export interface AtomicBoundSessionStore {
  read(key: string): Promise<unknown>;
  transact(
    key: string,
    update: (current: unknown) => BoundSessionRecord | undefined,
    signal: AbortSignal,
  ): Promise<unknown>;
  /** Resolve only after native durable retirement fences every earlier write. */
  retire?(): Promise<void>;
}

const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export function boundTargetKey(target: BoundAuthTarget): string {
  if (
    !nonempty(target.organizationId) ||
    !nonempty(target.apiBaseUrl) ||
    !nonempty(target.authProxyUrl) ||
    (target.authProxyConfigId !== undefined &&
      typeof target.authProxyConfigId !== "string")
  )
    throw new Error("Invalid bound authentication target");
  return `@0xkey-io/auth/v3/target/${JSON.stringify([
    target.organizationId,
    target.apiBaseUrl,
    target.authProxyUrl,
    target.authProxyConfigId ?? null,
  ])}`;
}

export function emptyBoundRecord(target: BoundAuthTarget): BoundSessionRecord {
  return { version: 3, target: { ...target }, sessions: [] };
}

export function readBoundRecord(
  value: unknown,
  target: BoundAuthTarget,
): BoundSessionRecord | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object")
    throw new Error("Invalid bound session record");
  const record = value as Partial<BoundSessionRecord>;
  if (
    record.version !== 3 ||
    !record.target ||
    record.target.organizationId !== target.organizationId ||
    record.target.apiBaseUrl !== target.apiBaseUrl ||
    record.target.authProxyUrl !== target.authProxyUrl ||
    record.target.authProxyConfigId !== target.authProxyConfigId ||
    !Array.isArray(record.sessions) ||
    (record.targetGeneration !== undefined &&
      (!Number.isSafeInteger(record.targetGeneration) ||
        record.targetGeneration < 0)) ||
    (record.activeSessionKey !== undefined &&
      typeof record.activeSessionKey !== "string")
  )
    throw new Error("Invalid bound session record");
  const seen = new Set<string>();
  for (const entry of record.sessions) {
    if (
      !entry ||
      !nonempty(entry.key) ||
      !nonempty(entry.token) ||
      seen.has(entry.key)
    )
      throw new Error("Invalid bound session record");
    seen.add(entry.key);
    try {
      parseSession(entry.token);
    } catch {
      throw new Error("Invalid bound session record");
    }
  }
  if (record.activeSessionKey && !seen.has(record.activeSessionKey))
    throw new Error("Invalid bound session record");
  return record as BoundSessionRecord;
}
