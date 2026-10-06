export const OAUTH_TRANSACTION_DATABASE_NAME = "0xkey-oauth-transaction-v1";
const DATABASE_NAME = /^oxkey-oauth-idb-test-[0-9a-f]{32}$/;
const ID = /^[0-9a-f]{32}$/;
const LABEL = /^[A-Za-z0-9_-]{1,128}$/;
const PROVIDERS = new Set(["google", "apple", "facebook", "x", "discord"]);
const PKCE_PROVIDERS = new Set(["facebook", "x", "discord"]);
const TRANSACTION_STORE = "transactions";
const KEY_STORE = "synthetic-keys";
const TTL_MS = 300_000;
const STORAGE_TIMEOUT_MS = 2_000;
const MAX_CREATE_ATTEMPTS = 4;
const FORBIDDEN_QUERY_KEYS = new Set([
  "state",
  "code",
  "id_token",
  "error",
  "error_description",
  "error_uri",
  "provider",
  "flow",
  "publicKey",
  "nonce",
  "transactionId",
  "sessionKey",
  "oauthIntent",
  "openModal",
  "redirectUri",
  "scope",
  "authuser",
  "prompt",
  "session_state",
]);

export type OAuthTransactionFailureReason =
  | "invalid-input"
  | "invalid-record"
  | "clock-invalid"
  | "random-invalid"
  | "collision-exhausted"
  | "binding-mismatch"
  | "state-mismatch"
  | "expired"
  | "unavailable"
  | "open-failed"
  | "blocked"
  | "transaction-aborted"
  | "commit-unknown"
  | "cleanup-failed";

export class OAuthTransactionStoreError extends Error {
  readonly reason: OAuthTransactionFailureReason;

  constructor(reason: OAuthTransactionFailureReason) {
    super("OAuth transaction operation failed.");
    this.name = "OAuthTransactionStoreError";
    this.reason = reason;
  }
}

type Provider = "google" | "apple" | "facebook" | "x" | "discord";
type Route = {
  origin: string;
  pathname: string;
  staticQuery: Array<[string, string]>;
};
type Completion =
  | { kind: "synthetic"; targetId: string }
  | { kind: "redirect" };
type Binding = {
  organizationId: string;
  configId: string | null;
  apiBaseUrl: string;
  authProxyUrl: string;
  provider: Provider;
  clientId: string;
  redirectUri: string;
  route: Route;
  completion: Completion;
};
type TransactionRecord = {
  version: 1;
  id: string;
  generation: string;
  createdAtMs: number;
  expiresAtMs: number;
  expectedState: string;
  binding: Binding;
  keyRef: string;
  verifier: string | null;
};
type CreateInput = Pick<
  TransactionRecord,
  "expectedState" | "binding" | "keyRef" | "verifier"
>;
type ClaimInput = {
  transactionId: string;
  returnedState: string;
  binding: Binding;
};
type ClaimReturnedInput = {
  returnedState: string;
  binding: Binding;
};
type ClaimedTransaction = {
  kind: "claimed";
  transactionId: string;
  generation: string;
  keyRef: string;
  verifier: string | null;
  binding: Binding;
};
type CancelResult =
  | { kind: "inactive" }
  | { kind: "cancelled"; cleanup(): Promise<void> };
type CreateResult = { transactionId: string; cancel(): Promise<CancelResult> };
export type OAuthTransactionStore = {
  create(input: CreateInput): Promise<CreateResult>;
  claim(input: ClaimInput): Promise<ClaimedTransaction>;
  claimReturned(input: ClaimReturnedInput): Promise<ClaimedTransaction>;
};
type FactoryOptions = {
  databaseName: string;
  now(): number;
  randomBytes(): Uint8Array;
  discardFreshKey(keyRef: string): Promise<void>;
};

function fail(reason: OAuthTransactionFailureReason): never {
  throw new OAuthTransactionStoreError(reason);
}

function isPlainExactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  )
    return false;
  const ownKeys = Object.getOwnPropertyNames(value);
  if (
    ownKeys.length !== keys.length ||
    !keys.every((key) => ownKeys.includes(key))
  )
    return false;
  return ownKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(
      descriptor && "value" in descriptor && descriptor.enumerable,
    );
  });
}

function isText(
  value: unknown,
  maximum: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    (allowEmpty || value.length > 0) &&
    /^[\x20-\x7e]*$/.test(value)
  );
}

function isLabel(value: unknown): value is string {
  return typeof value === "string" && LABEL.test(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function parseHttpUrl(value: unknown, endpoint: boolean): URL | undefined {
  if (!isText(value, 2048)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    parsed.href !== value ||
    (endpoint && parsed.search !== "")
  )
    return undefined;
  return parsed;
}

function comparePair(left: [string, string], right: [string, string]): number {
  if (left[0] < right[0]) return -1;
  if (left[0] > right[0]) return 1;
  if (left[1] < right[1]) return -1;
  if (left[1] > right[1]) return 1;
  return 0;
}

function exactArrayValues(
  value: unknown,
  length: number,
): unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return undefined;
  if (
    value.length !== length ||
    Object.getOwnPropertySymbols(value).length !== 0
  )
    return undefined;
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== length + 1 || !names.includes("length"))
    return undefined;
  const copied: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      return undefined;
    copied.push(descriptor.value);
  }
  return copied;
}

function validateStaticQuery(
  value: unknown,
  redirect: URL,
): Array<[string, string]> | undefined {
  if (!Array.isArray(value) || value.length > 16) return undefined;
  const outer = exactArrayValues(value, value.length);
  if (!outer) return undefined;
  const supplied: Array<[string, string]> = [];
  for (const pair of outer) {
    const values = exactArrayValues(pair, 2);
    if (!values) return undefined;
    const [key, entry] = values;
    if (
      !isText(key, 256, true) ||
      !isText(entry, 256, true) ||
      FORBIDDEN_QUERY_KEYS.has(key)
    )
      return undefined;
    supplied.push([key, entry]);
  }
  const expected = Array.from(redirect.searchParams.entries()).sort(
    comparePair,
  );
  if (
    expected.length !== supplied.length ||
    supplied.some(
      (pair, index) => index > 0 && comparePair(supplied[index - 1]!, pair) > 0,
    ) ||
    supplied.some(
      (pair, index) =>
        pair[0] !== expected[index]?.[0] || pair[1] !== expected[index]?.[1],
    )
  )
    return undefined;
  return supplied;
}

function cloneBinding(value: unknown): Binding | undefined {
  if (
    !isPlainExactObject(value, [
      "organizationId",
      "configId",
      "apiBaseUrl",
      "authProxyUrl",
      "provider",
      "clientId",
      "redirectUri",
      "route",
      "completion",
    ]) ||
    !isLabel(value.organizationId) ||
    !(value.configId === null || isLabel(value.configId)) ||
    typeof value.apiBaseUrl !== "string" ||
    typeof value.authProxyUrl !== "string" ||
    typeof value.redirectUri !== "string" ||
    !parseHttpUrl(value.apiBaseUrl, true) ||
    !parseHttpUrl(value.authProxyUrl, true) ||
    typeof value.provider !== "string" ||
    !PROVIDERS.has(value.provider) ||
    !isLabel(value.clientId)
  )
    return undefined;
  const redirect = parseHttpUrl(value.redirectUri, false);
  if (
    !redirect ||
    !isPlainExactObject(value.route, ["origin", "pathname", "staticQuery"]) ||
    !isText(value.route.origin, 2048) ||
    !isText(value.route.pathname, 2048) ||
    value.route.origin !== redirect.origin ||
    value.route.pathname !== redirect.pathname
  )
    return undefined;
  const query = validateStaticQuery(value.route.staticQuery, redirect);
  const completion = cloneCompletion(value.completion);
  if (!query || !completion) return undefined;
  return {
    organizationId: value.organizationId,
    configId: value.configId,
    apiBaseUrl: value.apiBaseUrl,
    authProxyUrl: value.authProxyUrl,
    provider: value.provider as Provider,
    clientId: value.clientId,
    redirectUri: value.redirectUri,
    route: {
      origin: value.route.origin,
      pathname: value.route.pathname,
      staticQuery: query.map(([key, item]) => [key, item]),
    },
    completion,
  };
}

function cloneCompletion(value: unknown): Completion | undefined {
  if (isPlainExactObject(value, ["kind"]) && value.kind === "redirect")
    return { kind: "redirect" };
  if (
    isPlainExactObject(value, ["kind", "targetId"]) &&
    value.kind === "synthetic" &&
    isLabel(value.targetId)
  )
    return { kind: "synthetic", targetId: value.targetId };
  return undefined;
}

function validTimestamps(createdAtMs: unknown, expiresAtMs: unknown): boolean {
  return (
    Number.isSafeInteger(createdAtMs) &&
    Number.isSafeInteger(expiresAtMs) &&
    (createdAtMs as number) >= 0 &&
    (createdAtMs as number) <= Number.MAX_SAFE_INTEGER - TTL_MS &&
    expiresAtMs === (createdAtMs as number) + TTL_MS
  );
}

function cloneRecord(value: unknown): TransactionRecord | undefined {
  if (
    !isPlainExactObject(value, [
      "version",
      "id",
      "generation",
      "createdAtMs",
      "expiresAtMs",
      "expectedState",
      "binding",
      "keyRef",
      "verifier",
    ]) ||
    value.version !== 1 ||
    !isId(value.id) ||
    !isId(value.generation) ||
    value.id === value.generation ||
    !validTimestamps(value.createdAtMs, value.expiresAtMs) ||
    !isText(value.expectedState, 4096) ||
    !isLabel(value.keyRef)
  )
    return undefined;
  const binding = cloneBinding(value.binding);
  if (!binding) return undefined;
  if (
    PKCE_PROVIDERS.has(binding.provider)
      ? !isText(value.verifier, 128)
      : value.verifier !== null
  )
    return undefined;
  return {
    version: 1,
    id: value.id,
    generation: value.generation,
    createdAtMs: value.createdAtMs as number,
    expiresAtMs: value.expiresAtMs as number,
    expectedState: value.expectedState,
    binding,
    keyRef: value.keyRef,
    verifier: value.verifier as string | null,
  };
}

function snapshotCreateInput(value: unknown): CreateInput {
  if (
    !isPlainExactObject(value, [
      "expectedState",
      "binding",
      "keyRef",
      "verifier",
    ]) ||
    !isText(value.expectedState, 4096) ||
    !isLabel(value.keyRef)
  )
    fail("invalid-input");
  const binding = cloneBinding(value.binding);
  if (
    !binding ||
    (PKCE_PROVIDERS.has(binding.provider)
      ? !isText(value.verifier, 128)
      : value.verifier !== null)
  )
    fail("invalid-input");
  return {
    expectedState: value.expectedState,
    binding,
    keyRef: value.keyRef,
    verifier: value.verifier as string | null,
  };
}

function snapshotClaimInput(value: unknown): ClaimInput {
  if (
    !isPlainExactObject(value, ["transactionId", "returnedState", "binding"]) ||
    !isId(value.transactionId) ||
    !isText(value.returnedState, 4096)
  )
    fail("invalid-input");
  const binding = cloneBinding(value.binding);
  if (!binding) fail("invalid-input");
  return {
    transactionId: value.transactionId,
    returnedState: value.returnedState,
    binding,
  };
}

function snapshotClaimReturnedInput(value: unknown): ClaimReturnedInput {
  if (
    !isPlainExactObject(value, ["returnedState", "binding"]) ||
    !isText(value.returnedState, 4096)
  )
    fail("invalid-input");
  const binding = cloneBinding(value.binding);
  if (!binding) fail("invalid-input");
  return { returnedState: value.returnedState, binding };
}

function sameBinding(left: Binding, right: Binding): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.configId === right.configId &&
    left.apiBaseUrl === right.apiBaseUrl &&
    left.authProxyUrl === right.authProxyUrl &&
    left.provider === right.provider &&
    left.clientId === right.clientId &&
    left.redirectUri === right.redirectUri &&
    left.route.origin === right.route.origin &&
    left.route.pathname === right.route.pathname &&
    left.route.staticQuery.length === right.route.staticQuery.length &&
    left.route.staticQuery.every(
      (pair, index) =>
        pair[0] === right.route.staticQuery[index]?.[0] &&
        pair[1] === right.route.staticQuery[index]?.[1],
    ) &&
    sameCompletion(left.completion, right.completion)
  );
}

function sameCompletion(left: Completion, right: Completion): boolean {
  if (left.kind === "synthetic" && right.kind === "synthetic")
    return left.targetId === right.targetId;
  return left.kind === "redirect" && right.kind === "redirect";
}

function sameRecord(
  left: TransactionRecord,
  right: TransactionRecord,
): boolean {
  return (
    left.version === right.version &&
    left.id === right.id &&
    left.generation === right.generation &&
    left.createdAtMs === right.createdAtMs &&
    left.expiresAtMs === right.expiresAtMs &&
    left.expectedState === right.expectedState &&
    sameBinding(left.binding, right.binding) &&
    left.keyRef === right.keyRef &&
    left.verifier === right.verifier
  );
}

function frozenBinding(binding: Binding): Binding {
  const copy = cloneBinding(binding)!;
  for (const pair of copy.route.staticQuery) Object.freeze(pair);
  Object.freeze(copy.route.staticQuery);
  Object.freeze(copy.route);
  Object.freeze(copy.completion);
  return Object.freeze(copy);
}

function sampleClock(now: () => number): number {
  let value: number;
  try {
    value = now();
  } catch {
    fail("clock-invalid");
  }
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  )
    fail("clock-invalid");
  return value;
}

function sampleId(randomBytes: () => Uint8Array): string {
  let bytes: Uint8Array;
  try {
    bytes = randomBytes();
  } catch {
    fail("random-invalid");
  }
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16)
    fail("random-invalid");
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function validateSchema(database: IDBDatabase): boolean {
  const names = Array.from(database.objectStoreNames).sort();
  if (
    database.version !== 1 ||
    names.length !== 2 ||
    names[0] !== KEY_STORE ||
    names[1] !== TRANSACTION_STORE
  )
    return false;
  const transaction = database.transaction(
    [TRANSACTION_STORE, KEY_STORE],
    "readonly",
  );
  const records = transaction.objectStore(TRANSACTION_STORE);
  const keys = transaction.objectStore(KEY_STORE);
  return (
    records.keyPath === "id" &&
    records.autoIncrement === false &&
    records.indexNames.length === 0 &&
    keys.keyPath === null &&
    keys.autoIncrement === false &&
    keys.indexNames.length === 0
  );
}

function acceptedDatabaseName(name: string): boolean {
  return (
    name === OAUTH_TRANSACTION_DATABASE_NAME || DATABASE_NAME.test(name)
  );
}

function openDatabase(databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finishError = (reason: OAuthTransactionFailureReason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new OAuthTransactionStoreError(reason));
    };
    timeout = setTimeout(() => finishError("open-failed"), STORAGE_TIMEOUT_MS);
    try {
      request = indexedDB.open(databaseName, 1);
    } catch {
      finishError("open-failed");
      return;
    }
    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      try {
        const database = request.result;
        if (event.oldVersion !== 0) {
          request.transaction?.abort();
          return;
        }
        database.createObjectStore(TRANSACTION_STORE, { keyPath: "id" });
        database.createObjectStore(KEY_STORE);
      } catch {
        try {
          request.transaction?.abort();
        } catch {
          /* bounded below */
        }
      }
    };
    request.onblocked = () => finishError("blocked");
    request.onerror = () => finishError("open-failed");
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      if (!validateSchema(database)) {
        database.close();
        finishError("open-failed");
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(database);
    };
  });
}

async function addRecord(
  databaseName: string,
  record: TransactionRecord,
): Promise<"created" | "collision"> {
  const database = await openDatabase(databaseName);
  try {
    return await new Promise((resolve, reject) => {
      let collision = false;
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new OAuthTransactionStoreError("commit-unknown"));
        }
      }, STORAGE_TIMEOUT_MS);
      const transaction = database.transaction(TRANSACTION_STORE, "readwrite");
      const request = transaction.objectStore(TRANSACTION_STORE).add(record);
      request.onerror = (event) => {
        if (request.error?.name === "ConstraintError") {
          collision = true;
          event.preventDefault();
          event.stopPropagation();
          try {
            transaction.abort();
          } catch {
            /* transaction events settle */
          }
        }
      };
      transaction.oncomplete = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve("created");
        }
      };
      transaction.onabort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (collision) resolve("collision");
        else reject(new OAuthTransactionStoreError("transaction-aborted"));
      };
      transaction.onerror = () => {
        if (!settled && !collision) {
          settled = true;
          clearTimeout(timeout);
          reject(new OAuthTransactionStoreError("transaction-aborted"));
        }
      };
    });
  } finally {
    database.close();
  }
}

function abortWith(
  transaction: IDBTransaction,
  setReason: (reason: OAuthTransactionFailureReason) => void,
  reason: OAuthTransactionFailureReason,
): void {
  setReason(reason);
  try {
    transaction.abort();
  } catch {
    /* transaction settlement remains authoritative */
  }
}

async function claimRecord(
  databaseName: string,
  input: ClaimInput,
  now: () => number,
): Promise<ClaimedTransaction> {
  const database = await openDatabase(databaseName);
  try {
    return await new Promise((resolve, reject) => {
      let failure: OAuthTransactionFailureReason | undefined;
      let result: ClaimedTransaction | undefined;
      let settled = false;
      const setFailure = (reason: OAuthTransactionFailureReason) => {
        failure = reason;
      };
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new OAuthTransactionStoreError("commit-unknown"));
        }
      }, STORAGE_TIMEOUT_MS);
      const transaction = database.transaction(TRANSACTION_STORE, "readwrite");
      const request = transaction
        .objectStore(TRANSACTION_STORE)
        .get(input.transactionId);
      request.onerror = () =>
        abortWith(transaction, setFailure, "transaction-aborted");
      request.onsuccess = () => {
        if (request.result === undefined) {
          abortWith(transaction, setFailure, "unavailable");
          return;
        }
        const record = cloneRecord(request.result);
        if (!record) {
          abortWith(transaction, setFailure, "invalid-record");
          return;
        }
        if (record.expectedState !== input.returnedState) {
          abortWith(transaction, setFailure, "state-mismatch");
          return;
        }
        if (!sameBinding(record.binding, input.binding)) {
          abortWith(transaction, setFailure, "binding-mismatch");
          return;
        }
        let current: number;
        try {
          current = sampleClock(now);
        } catch {
          abortWith(transaction, setFailure, "clock-invalid");
          return;
        }
        if (current < record.createdAtMs) {
          abortWith(transaction, setFailure, "clock-invalid");
          return;
        }
        if (current >= record.expiresAtMs) {
          abortWith(transaction, setFailure, "expired");
          return;
        }
        result = {
          kind: "claimed",
          transactionId: record.id,
          generation: record.generation,
          keyRef: record.keyRef,
          verifier: record.verifier,
          binding: frozenBinding(record.binding),
        };
        const deletion = transaction
          .objectStore(TRANSACTION_STORE)
          .delete(record.id);
        deletion.onerror = () => {
          failure = "transaction-aborted";
        };
      };
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (!result) reject(new OAuthTransactionStoreError("commit-unknown"));
        else resolve(Object.freeze(result));
      };
      transaction.onabort = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(
            new OAuthTransactionStoreError(failure ?? "transaction-aborted"),
          );
        }
      };
      transaction.onerror = () => {
        failure ??= "transaction-aborted";
      };
    });
  } finally {
    database.close();
  }
}

async function claimReturnedRecord(
  databaseName: string,
  input: ClaimReturnedInput,
  now: () => number,
): Promise<ClaimedTransaction> {
  const database = await openDatabase(databaseName);
  try {
    return await new Promise((resolve, reject) => {
      let failure: OAuthTransactionFailureReason | undefined;
      let result: ClaimedTransaction | undefined;
      let settled = false;
      const setFailure = (reason: OAuthTransactionFailureReason) => {
        failure = reason;
      };
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new OAuthTransactionStoreError("commit-unknown"));
        }
      }, STORAGE_TIMEOUT_MS);
      const transaction = database.transaction(TRANSACTION_STORE, "readwrite");
      const request = transaction.objectStore(TRANSACTION_STORE).getAll();
      request.onerror = () =>
        abortWith(transaction, setFailure, "transaction-aborted");
      request.onsuccess = () => {
        const rows: unknown = request.result;
        if (!Array.isArray(rows)) {
          abortWith(transaction, setFailure, "invalid-record");
          return;
        }
        const matches: TransactionRecord[] = [];
        for (const row of rows) {
          const record = cloneRecord(row);
          if (!record) {
            abortWith(transaction, setFailure, "invalid-record");
            return;
          }
          if (
            record.expectedState !== input.returnedState ||
            !sameBinding(record.binding, input.binding)
          )
            continue;
          matches.push(record);
        }
        if (matches.length === 0) {
          abortWith(transaction, setFailure, "unavailable");
          return;
        }
        const record = matches[0];
        if (matches.length > 1 || !record) {
          abortWith(transaction, setFailure, "invalid-record");
          return;
        }
        let current: number;
        try {
          current = sampleClock(now);
        } catch {
          abortWith(transaction, setFailure, "clock-invalid");
          return;
        }
        if (current < record.createdAtMs) {
          abortWith(transaction, setFailure, "clock-invalid");
          return;
        }
        if (current >= record.expiresAtMs) {
          abortWith(transaction, setFailure, "expired");
          return;
        }
        result = {
          kind: "claimed",
          transactionId: record.id,
          generation: record.generation,
          keyRef: record.keyRef,
          verifier: record.verifier,
          binding: frozenBinding(record.binding),
        };
        const deletion = transaction
          .objectStore(TRANSACTION_STORE)
          .delete(record.id);
        deletion.onerror = () => {
          failure = "transaction-aborted";
        };
      };
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (!result) reject(new OAuthTransactionStoreError("commit-unknown"));
        else resolve(Object.freeze(result));
      };
      transaction.onabort = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(
            new OAuthTransactionStoreError(failure ?? "transaction-aborted"),
          );
        }
      };
      transaction.onerror = () => {
        failure ??= "transaction-aborted";
      };
    });
  } finally {
    database.close();
  }
}

async function cancelRecord(
  databaseName: string,
  captured: TransactionRecord,
): Promise<"inactive" | "cancelled"> {
  const database = await openDatabase(databaseName);
  try {
    return await new Promise((resolve, reject) => {
      let failure: OAuthTransactionFailureReason | undefined;
      let outcome: "inactive" | "cancelled" | undefined;
      let settled = false;
      const setFailure = (reason: OAuthTransactionFailureReason) => {
        failure = reason;
      };
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new OAuthTransactionStoreError("commit-unknown"));
        }
      }, STORAGE_TIMEOUT_MS);
      const transaction = database.transaction(TRANSACTION_STORE, "readwrite");
      const request = transaction
        .objectStore(TRANSACTION_STORE)
        .get(captured.id);
      request.onerror = () =>
        abortWith(transaction, setFailure, "transaction-aborted");
      request.onsuccess = () => {
        if (request.result === undefined) {
          outcome = "inactive";
          return;
        }
        const record = cloneRecord(request.result);
        if (!record) {
          abortWith(transaction, setFailure, "invalid-record");
          return;
        }
        if (record.generation !== captured.generation) {
          outcome = "inactive";
          return;
        }
        if (!sameRecord(record, captured)) {
          abortWith(transaction, setFailure, "binding-mismatch");
          return;
        }
        outcome = "cancelled";
        const deletion = transaction
          .objectStore(TRANSACTION_STORE)
          .delete(captured.id);
        deletion.onerror = () => {
          failure = "transaction-aborted";
        };
      };
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (!outcome) reject(new OAuthTransactionStoreError("commit-unknown"));
        else resolve(outcome);
      };
      transaction.onabort = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(
            new OAuthTransactionStoreError(failure ?? "transaction-aborted"),
          );
        }
      };
      transaction.onerror = () => {
        failure ??= "transaction-aborted";
      };
    });
  } finally {
    database.close();
  }
}

export function createOAuthTransactionStore(
  options: FactoryOptions,
): OAuthTransactionStore {
  if (
    !isPlainExactObject(options, [
      "databaseName",
      "now",
      "randomBytes",
      "discardFreshKey",
    ]) ||
    typeof options.databaseName !== "string" ||
    !acceptedDatabaseName(options.databaseName) ||
    typeof options.now !== "function" ||
    typeof options.randomBytes !== "function" ||
    typeof options.discardFreshKey !== "function"
  )
    fail("invalid-input");
  const databaseName = options.databaseName;
  const now = options.now.bind(options);
  const randomBytes = options.randomBytes.bind(options);
  const discardFreshKey = options.discardFreshKey.bind(options);

  return Object.freeze({
    async create(value: CreateInput): Promise<CreateResult> {
      const input = snapshotCreateInput(value);
      const createdAtMs = sampleClock(now);
      if (createdAtMs > Number.MAX_SAFE_INTEGER - TTL_MS) fail("clock-invalid");
      const generation = sampleId(randomBytes);
      for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
        const id = sampleId(randomBytes);
        if (id === generation) fail("random-invalid");
        const record: TransactionRecord = {
          version: 1,
          id,
          generation,
          createdAtMs,
          expiresAtMs: createdAtMs + TTL_MS,
          expectedState: input.expectedState,
          binding: input.binding,
          keyRef: input.keyRef,
          verifier: input.verifier,
        };
        const outcome = await addRecord(databaseName, record);
        if (outcome === "collision") continue;
        let active = true;
        let cleanupDone = false;
        let cleanupInFlight: Promise<void> | undefined;
        const cleanup = (): Promise<void> => {
          if (cleanupDone) return Promise.resolve();
          if (cleanupInFlight) return cleanupInFlight;
          cleanupInFlight = Promise.resolve()
            .then(() => discardFreshKey(record.keyRef))
            .then(() => {
              cleanupDone = true;
            })
            .catch(() => {
              cleanupInFlight = undefined;
              throw new OAuthTransactionStoreError("cleanup-failed");
            });
          return cleanupInFlight;
        };
        const cancel = async (): Promise<CancelResult> => {
          if (!active) return Object.freeze({ kind: "inactive" });
          const cancelOutcome = await cancelRecord(databaseName, record);
          active = false;
          if (cancelOutcome === "inactive")
            return Object.freeze({ kind: "inactive" });
          return Object.freeze({ kind: "cancelled", cleanup });
        };
        return Object.freeze({ transactionId: id, cancel });
      }
      fail("collision-exhausted");
    },
    async claim(value: ClaimInput): Promise<ClaimedTransaction> {
      return claimRecord(databaseName, snapshotClaimInput(value), now);
    },
    async claimReturned(
      value: ClaimReturnedInput,
    ): Promise<ClaimedTransaction> {
      return claimReturnedRecord(
        databaseName,
        snapshotClaimReturnedInput(value),
        now,
      );
    },
  });
}
