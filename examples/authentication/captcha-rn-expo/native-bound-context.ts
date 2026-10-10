export const NATIVE_BOUND_CONTEXT_PROTOCOL = "0xkey-bound-context-v3";

export type NativeSessionSnapshot = {
  revision: number;
  activeSessionKey: string | null;
  sessions: Array<{ key: string; token: string }>;
};
export type NativeMutationResult = "committed" | "conflict";

export interface NativeBoundContextPort {
  /** Null until this exact native bridge instance receives a host-only grant. */
  capability(): Promise<{
    protocol: string;
    handle: string;
    targetKey: string;
    ownerId: string;
  } | null>;
  read(handle: string, targetKey: string): Promise<NativeSessionSnapshot>;
  putSession(
    handle: string,
    targetKey: string,
    expectedRevision: number,
    sessionKey: string,
    expectedToken: string | null,
    nextToken: string,
  ): Promise<NativeMutationResult>;
  /** Reserved: native candidate rejects until a trusted host intent exists. */
  removeSession(
    handle: string,
    targetKey: string,
    expectedRevision: number,
    sessionKey: string,
    expectedToken: string,
  ): Promise<NativeMutationResult>;
  /** Reserved: native candidate rejects until a trusted host intent exists. */
  setActiveSession(
    handle: string,
    targetKey: string,
    expectedRevision: number,
    sessionKey: string,
    expectedToken: string,
  ): Promise<NativeMutationResult>;
  retire(handle: string): Promise<void>;
}

/** Native typed operations; deliberately not a Core AtomicBoundSessionStore. */
export interface NativeBoundSessionContext {
  read(targetKey: string): Promise<NativeSessionSnapshot>;
  putSession(
    targetKey: string,
    expectedRevision: number,
    sessionKey: string,
    expectedToken: string | null,
    nextToken: string,
  ): Promise<NativeMutationResult>;
  /** Reserved: native candidate rejects until a trusted host intent exists. */
  removeSession(
    targetKey: string,
    expectedRevision: number,
    sessionKey: string,
    expectedToken: string,
  ): Promise<NativeMutationResult>;
  /** Reserved: native candidate rejects until a trusted host intent exists. */
  setActiveSession(
    targetKey: string,
    expectedRevision: number,
    sessionKey: string,
    expectedToken: string,
  ): Promise<NativeMutationResult>;
  clearAll(): Promise<void>;
  retire(): Promise<void>;
}

const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const revisionIsValid = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const assertSnapshot = (
  value: NativeSessionSnapshot,
): NativeSessionSnapshot => {
  if (
    !value ||
    !revisionIsValid(value.revision) ||
    (value.activeSessionKey !== null && !nonempty(value.activeSessionKey)) ||
    !Array.isArray(value.sessions)
  )
    throw new Error("Invalid native bound snapshot");
  const keys = new Set<string>();
  for (const entry of value.sessions) {
    if (
      !entry ||
      !nonempty(entry.key) ||
      !nonempty(entry.token) ||
      keys.has(entry.key)
    )
      throw new Error("Invalid native bound snapshot");
    keys.add(entry.key);
  }
  if (value.activeSessionKey !== null && !keys.has(value.activeSessionKey))
    throw new Error("Invalid native bound snapshot");
  return value;
};

/** Consumes only a native host-granted context; JS cannot issue or renew one. */
export async function openNativeBoundSessionStore(
  port: NativeBoundContextPort | null,
  targetKey: string,
  ownerId: string,
): Promise<NativeBoundSessionContext | null> {
  if (!port) return null;
  if (!targetKey.startsWith("@0xkey-io/auth/v3/target/") || !nonempty(ownerId))
    throw new Error("Invalid native bound target or owner");
  const capability = await port.capability();
  if (capability === null) return null;
  if (
    !capability ||
    capability.protocol !== NATIVE_BOUND_CONTEXT_PROTOCOL ||
    capability.targetKey !== targetKey ||
    capability.ownerId !== ownerId ||
    !nonempty(capability.handle) ||
    typeof port.read !== "function" ||
    typeof port.putSession !== "function" ||
    typeof port.removeSession !== "function" ||
    typeof port.setActiveSession !== "function" ||
    typeof port.retire !== "function"
  )
    throw new Error("Native bound capability mismatch");

  const { handle } = capability;
  let revoked = false;
  let closePromise: Promise<void> | undefined;
  const assertLive = (key: string) => {
    if (key !== targetKey) throw new Error("Native bound target mismatch");
    if (revoked) throw new Error("Native bound context retired");
  };
  const assertMutation = (revision: number, key: string, token: string) => {
    if (!revisionIsValid(revision) || !nonempty(key) || !nonempty(token))
      throw new Error("Invalid native session mutation");
  };
  const outcome = (value: NativeMutationResult): NativeMutationResult => {
    if (value !== "committed" && value !== "conflict")
      throw new Error("Invalid native mutation result");
    return value;
  };
  const retire = (): Promise<void> => {
    revoked = true;
    closePromise ??= port.retire(handle);
    return closePromise;
  };
  return {
    read: async (key) => {
      assertLive(key);
      const snapshot = await port.read(handle, targetKey);
      assertLive(key);
      return assertSnapshot(snapshot);
    },
    putSession: async (key, revision, sessionKey, expectedToken, nextToken) => {
      assertLive(key);
      assertMutation(revision, sessionKey, nextToken);
      if (expectedToken !== null && !nonempty(expectedToken))
        throw new Error("Invalid native session mutation");
      const result = await port.putSession(
        handle,
        targetKey,
        revision,
        sessionKey,
        expectedToken,
        nextToken,
      );
      assertLive(key);
      return outcome(result);
    },
    removeSession: async (key, revision, sessionKey, expectedToken) => {
      assertLive(key);
      assertMutation(revision, sessionKey, expectedToken);
      const result = await port.removeSession(
        handle,
        targetKey,
        revision,
        sessionKey,
        expectedToken,
      );
      assertLive(key);
      return outcome(result);
    },
    setActiveSession: async (key, revision, sessionKey, expectedToken) => {
      assertLive(key);
      assertMutation(revision, sessionKey, expectedToken);
      const result = await port.setActiveSession(
        handle,
        targetKey,
        revision,
        sessionKey,
        expectedToken,
      );
      assertLive(key);
      return outcome(result);
    },
    clearAll: async () => {
      revoked = true;
      throw new Error("Host authorization required for global clear");
    },
    retire,
  };
}
