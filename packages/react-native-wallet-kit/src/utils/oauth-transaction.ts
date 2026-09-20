import { OAuthProviders } from "@0xkey-io/sdk-types";

const TRANSACTION_KEY_PREFIX = "0xkey.oauth.transaction.v1.";
const TRANSACTION_TTL_MS = 300_000;
const TRANSACTION_ID_BYTES = 16;
const VALID_ID = /^[0-9a-f]{32}$/;
const VALID_CLEANUP_RETRY_ID = /^cleanup\.[0-9a-f]{32}$/;

const INVALID_ERROR = "OAuth transaction invalid";
const UNAVAILABLE_ERROR = "OAuth transaction unavailable";
const PERSISTENCE_ERROR = "OAuth transaction persistence failed";
const CLEANUP_ERROR = "OAuth transaction cleanup failed";

export interface OAuthTransactionSecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface OAuthTransactionDependencies {
  secureStorage: OAuthTransactionSecureStorage;
  randomBytes(length: number): Uint8Array;
  now(): number;
  cleanupTemporaryKey(publicKey: string): Promise<void>;
}

export interface OAuthTransactionContext {
  configId: string;
  provider: OAuthProviders;
}

interface CleanupDescriptor extends OAuthTransactionContext {
  publicKey: string;
}

export type BeginOAuthTransactionInput = CleanupDescriptor & {
  codeVerifier?: string;
} & (
    | { expectedState: string; createExpectedState?: never }
    | {
        expectedState?: never;
        /** Synchronous and pure; invoked only after a candidate ID is free. */
        createExpectedState(transactionId: string): string;
      }
  );

export interface OAuthTransactionMetadata {
  id: string;
  configId: string;
  provider: OAuthProviders;
  publicKey: string;
  expiresAt: number;
}

export interface ConsumedOAuthTransaction extends OAuthTransactionMetadata {
  codeVerifier?: string;
}

interface StoredOAuthTransaction extends OAuthTransactionMetadata {
  kind: "transaction";
  expectedState: string;
  codeVerifier?: string;
}

interface CleanupPendingTransaction extends CleanupDescriptor {
  kind: "cleanup-pending";
  id: string;
}

type StoredRecord = StoredOAuthTransaction | CleanupPendingTransaction;

type StoreLocks = Map<string, Promise<void>>;
const locksByStorage = new WeakMap<object, StoreLocks>();
const cleanupIntentsByStorage = new WeakMap<
  object,
  Map<string, CleanupDescriptor>
>();
const cleanupOnlyIntentsByStorage = new WeakMap<
  object,
  Map<string, CleanupDescriptor>
>();

export interface OAuthTransactionError extends Error {
  transactionId?: string;
  cleanupRetryId?: string;
}

function error(
  message: string,
  transactionId?: string,
  cleanupRetryId?: string,
): OAuthTransactionError {
  const result: OAuthTransactionError = new Error(message);
  if (transactionId !== undefined) result.transactionId = transactionId;
  if (cleanupRetryId !== undefined) result.cleanupRetryId = cleanupRetryId;
  return result;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isProvider(value: unknown): value is OAuthProviders {
  return Object.values(OAuthProviders).includes(value as OAuthProviders);
}

function hasContext(value: unknown): value is OAuthTransactionContext {
  if (!value || typeof value !== "object") return false;
  const context = value as OAuthTransactionContext;
  return isNonEmptyString(context.configId) && isProvider(context.provider);
}

function assertContextMatches(
  stored: OAuthTransactionContext,
  trusted: OAuthTransactionContext,
): void {
  if (
    stored.configId !== trusted.configId ||
    stored.provider !== trusted.provider
  ) {
    throw error(UNAVAILABLE_ERROR);
  }
}

function assertId(id: string): void {
  if (!VALID_ID.test(id)) throw error(INVALID_ERROR);
}

function cleanupDescriptor(owner: CleanupDescriptor): CleanupDescriptor {
  // Do not retain verifier/state fields from a live record or begin input.
  return {
    publicKey: owner.publicKey,
    configId: owner.configId,
    provider: owner.provider,
  };
}

function storageKey(id: string): string {
  assertId(id);
  return `${TRANSACTION_KEY_PREFIX}${id}`;
}

function parseStoredRecord(
  value: unknown,
  expectedId: string,
): StoredRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.kind === "cleanup-pending" &&
    record.id === expectedId &&
    hasContext(record) &&
    isNonEmptyString(record.publicKey)
  ) {
    return record as unknown as CleanupPendingTransaction;
  }
  if (
    record.kind === "transaction" &&
    record.id === expectedId &&
    isNonEmptyString(record.configId) &&
    isProvider(record.provider) &&
    isNonEmptyString(record.publicKey) &&
    isNonEmptyString(record.expectedState) &&
    typeof record.expiresAt === "number" &&
    Number.isFinite(record.expiresAt) &&
    (record.codeVerifier === undefined || isNonEmptyString(record.codeVerifier))
  ) {
    return record as unknown as StoredOAuthTransaction;
  }
  return null;
}

function encodeId(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.length < TRANSACTION_ID_BYTES) {
    throw error(INVALID_ERROR);
  }
  return Array.from(bytes.slice(0, TRANSACTION_ID_BYTES), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function withStorageLock<T>(
  storage: OAuthTransactionSecureStorage,
  id: string,
  operation: () => Promise<T>,
): Promise<T> {
  let locks = locksByStorage.get(storage);
  if (!locks) {
    locks = new Map();
    locksByStorage.set(storage, locks);
  }
  const previous = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(id, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(id) === current) locks.delete(id);
  }
}

export function createOAuthTransactionStore(
  dependencies: OAuthTransactionDependencies,
): {
  beginOAuthTransaction(
    input: BeginOAuthTransactionInput,
  ): Promise<OAuthTransactionMetadata>;
  consumeOAuthTransaction(
    id: string,
    returnedState: string,
    /** From trusted configuration/provider routing, never callback fields. */
    context: OAuthTransactionContext,
  ): Promise<ConsumedOAuthTransaction>;
  /** Exact-owner operation; never cancel an untrusted cold-start lookup hint. */
  cancelOAuthTransaction(id: string): Promise<void>;
} {
  const { secureStorage, randomBytes, now, cleanupTemporaryKey } = dependencies;
  let cleanupIntents = cleanupIntentsByStorage.get(secureStorage);
  if (!cleanupIntents) {
    cleanupIntents = new Map();
    cleanupIntentsByStorage.set(secureStorage, cleanupIntents);
  }
  let cleanupOnlyIntents = cleanupOnlyIntentsByStorage.get(secureStorage);
  if (!cleanupOnlyIntents) {
    cleanupOnlyIntents = new Map();
    cleanupOnlyIntentsByStorage.set(secureStorage, cleanupOnlyIntents);
  }

  async function remove(key: string): Promise<void> {
    try {
      await secureStorage.remove(key);
    } catch {
      throw error(PERSISTENCE_ERROR);
    }
  }

  async function cleanup(publicKey: string): Promise<void> {
    try {
      await cleanupTemporaryKey(publicKey);
    } catch {
      throw error(CLEANUP_ERROR);
    }
  }

  function allocateCleanupRetryId(owner: CleanupDescriptor): string {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      let cleanupRetryId: string;
      try {
        cleanupRetryId = `cleanup.${encodeId(
          randomBytes(TRANSACTION_ID_BYTES),
        )}`;
      } catch {
        throw error(PERSISTENCE_ERROR);
      }
      if (!cleanupOnlyIntents!.has(cleanupRetryId)) {
        cleanupOnlyIntents!.set(cleanupRetryId, cleanupDescriptor(owner));
        return cleanupRetryId;
      }
    }
    throw error(PERSISTENCE_ERROR);
  }

  async function load(id: string): Promise<StoredRecord | null> {
    let serialized: string | null;
    try {
      serialized = await secureStorage.get(storageKey(id));
    } catch {
      throw error(PERSISTENCE_ERROR);
    }
    if (serialized === null) return null;
    try {
      const parsed: unknown = JSON.parse(serialized);
      return parseStoredRecord(parsed, id);
    } catch {
      return null;
    }
  }

  async function invalidateAndCleanup(
    key: string,
    id: string,
    owner: CleanupDescriptor,
  ): Promise<void> {
    const descriptor = cleanupDescriptor(owner);
    cleanupIntents!.set(id, descriptor);
    const tombstone: CleanupPendingTransaction = {
      kind: "cleanup-pending",
      id,
      ...descriptor,
    };
    try {
      await secureStorage.set(key, JSON.stringify(tombstone));
    } catch {
      // The in-memory intent still blocks redemption across store instances
      // sharing this storage object. Continue exact-key cleanup and removal.
    }
    await cleanup(descriptor.publicKey);
    await remove(key);
    cleanupIntents!.delete(id);
  }

  async function retryCleanupIntent(
    key: string,
    id: string,
    owner: CleanupDescriptor,
  ): Promise<void> {
    await invalidateAndCleanup(key, id, owner);
  }

  return {
    async beginOAuthTransaction(input) {
      if (
        !isNonEmptyString(input.configId) ||
        !isProvider(input.provider) ||
        !isNonEmptyString(input.publicKey) ||
        (input.expectedState !== undefined
          ? !isNonEmptyString(input.expectedState) ||
            input.createExpectedState !== undefined
          : typeof input.createExpectedState !== "function") ||
        (input.codeVerifier !== undefined &&
          !isNonEmptyString(input.codeVerifier))
      ) {
        throw error(INVALID_ERROR);
      }

      const startedAt = now();
      if (!Number.isFinite(startedAt)) throw error(INVALID_ERROR);
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const id = encodeId(randomBytes(TRANSACTION_ID_BYTES));
        const stored = await withStorageLock(secureStorage, id, async () => {
          const key = storageKey(id);
          let existing: string | null;
          try {
            existing = await secureStorage.get(key);
          } catch {
            try {
              await cleanup(input.publicKey);
            } catch {
              const cleanupRetryId = allocateCleanupRetryId(input);
              throw error(PERSISTENCE_ERROR, undefined, cleanupRetryId);
            }
            throw error(PERSISTENCE_ERROR);
          }
          if (existing !== null) return null;
          let expectedState: unknown;
          try {
            expectedState = input.createExpectedState
              ? input.createExpectedState(id)
              : input.expectedState;
          } catch {
            throw error(INVALID_ERROR);
          }
          if (!isNonEmptyString(expectedState)) {
            try {
              // Observe only current-runtime Promises: the RN fallback's
              // `then` does not brand-check arbitrary receivers. Discard both
              // outcomes without awaiting or accepting either as state.
              if (expectedState instanceof Promise) {
                void Promise.prototype.then.call(
                  expectedState,
                  () => undefined,
                  () => undefined,
                );
              }
            } catch {
              // Non-Promise values remain invalid; never invoke their `then`.
            }
            throw error(INVALID_ERROR);
          }
          const transaction: StoredOAuthTransaction = {
            kind: "transaction",
            id,
            configId: input.configId,
            provider: input.provider,
            publicKey: input.publicKey,
            expectedState,
            expiresAt: startedAt + TRANSACTION_TTL_MS,
            ...(input.codeVerifier === undefined
              ? {}
              : { codeVerifier: input.codeVerifier }),
          };
          try {
            await secureStorage.set(key, JSON.stringify(transaction));
            return transaction;
          } catch {
            try {
              await invalidateAndCleanup(key, id, transaction);
            } catch {
              // Preserve the cleanup intent for cancel(transactionId) retry.
            }
            throw error(PERSISTENCE_ERROR, id);
          }
        });
        if (stored) {
          const {
            expectedState: _expectedState,
            codeVerifier: _codeVerifier,
            kind: _kind,
            ...metadata
          } = stored;
          return metadata;
        }
      }
      throw error(PERSISTENCE_ERROR);
    },

    async consumeOAuthTransaction(id, returnedState, context) {
      assertId(id);
      if (!hasContext(context)) throw error(INVALID_ERROR);
      return withStorageLock(secureStorage, id, async () => {
        const key = storageKey(id);
        const pendingOwner = cleanupIntents!.get(id);
        if (pendingOwner !== undefined) {
          assertContextMatches(pendingOwner, context);
          await retryCleanupIntent(key, id, pendingOwner);
          throw error(UNAVAILABLE_ERROR);
        }
        const transaction = await load(id);
        if (!transaction) {
          throw error(UNAVAILABLE_ERROR);
        }
        assertContextMatches(transaction, context);

        if (transaction.kind === "cleanup-pending") {
          await retryCleanupIntent(key, id, transaction);
          throw error(UNAVAILABLE_ERROR);
        }

        const currentTime = now();
        if (
          !Number.isFinite(currentTime) ||
          transaction.expiresAt <= currentTime ||
          transaction.expectedState !== returnedState
        ) {
          await invalidateAndCleanup(key, id, transaction);
          throw error(UNAVAILABLE_ERROR);
        }

        // Deletion is the consume point. The verifier is not returned unless
        // durable removal succeeds; callers may retry after a removal failure.
        await remove(key);
        const {
          expectedState: _expectedState,
          kind: _kind,
          ...consumed
        } = transaction;
        return consumed;
      });
    },

    async cancelOAuthTransaction(id) {
      if (VALID_CLEANUP_RETRY_ID.test(id)) {
        await withStorageLock(secureStorage, id, async () => {
          const owner = cleanupOnlyIntents!.get(id);
          if (owner === undefined) return;
          await cleanup(owner.publicKey);
          cleanupOnlyIntents!.delete(id);
        });
        return;
      }
      assertId(id);
      await withStorageLock(secureStorage, id, async () => {
        const key = storageKey(id);
        const pendingOwner = cleanupIntents!.get(id);
        if (pendingOwner !== undefined) {
          await retryCleanupIntent(key, id, pendingOwner);
          return;
        }
        const transaction = await load(id);
        if (!transaction) {
          try {
            await secureStorage.remove(key);
          } catch {
            throw error(PERSISTENCE_ERROR);
          }
          return;
        }
        if (transaction.kind === "cleanup-pending") {
          await retryCleanupIntent(key, id, transaction);
          return;
        }
        await invalidateAndCleanup(key, id, transaction);
      });
    },
  };
}
