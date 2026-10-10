import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { createNativeOAuthKeychainStorage } from "./oauth-native-keychain-storage";
import {
  NATIVE_OAUTH_SERVICE,
  canonicalizeNativeBinding,
  createNativeOAuthStore,
  nativeOAuthError,
  sameNativeRecord,
  serializeNativeRecord,
  withNativeRecordPhase,
  type NativeBinding,
  type NativeOAuthErrorCode,
  type NativeOAuthStore,
  type NativeRecord,
  type NativeSlotStorage,
} from "./oauth-native-store";

export const NATIVE_OAUTH_CANCELLED = Symbol.for(
  "0xkey.oauth.native.cancelled.v1",
);

export type NativeOwner = Readonly<{
  ready: Promise<void>;
  binding: NativeBinding;
  isCurrent(): boolean;
  createKey(): Promise<string>;
  discardKey(publicKey: string): Promise<void>;
  authenticate(input: {
    publicKey: string;
    expectedNonce: string;
  }): Promise<{ oidcToken: string }>;
  complete(input: { publicKey: string; oidcToken: string }): Promise<void>;
}>;

export type NativeRecoveryContext = Readonly<{
  ready: Promise<void>;
  binding: NativeBinding;
  isCurrent(): boolean;
  discardKey(publicKey: string): Promise<void>;
}>;

export type NativeAttempt = Readonly<{
  result: Promise<void>;
  cancel(): Promise<void>;
  retry(): Promise<void>;
}>;

export type NativeRecovery = Readonly<{
  result: Promise<void>;
  retry(): Promise<void>;
}>;

export type NativeLifecycle = Readonly<{
  start(owner: NativeOwner): NativeAttempt;
  recover(context: NativeRecoveryContext): NativeRecovery;
}>;

export type NativeLifecycleDependencies = Readonly<{
  storage: NativeSlotStorage;
  now(): number;
  randomBytes(length: number): Uint8Array;
}>;

type CapturedRecovery = Readonly<{
  ready: Promise<void>;
  binding: NativeBinding;
  isCurrent(): boolean;
  discardKey(publicKey: string): Promise<void>;
}>;

type CapturedOwner = CapturedRecovery &
  Readonly<{
    createKey(): Promise<string>;
    authenticate(input: {
      publicKey: string;
      expectedNonce: string;
    }): Promise<{ oidcToken: string }>;
    complete(input: { publicKey: string; oidcToken: string }): Promise<void>;
  }>;

type CleanupMaintenance = {
  kind: "cleanup";
  record: NativeRecord;
  discardKey(publicKey: string): Promise<void>;
  allowAbsent: boolean;
  keyDiscarded: boolean;
  removalAttempted: boolean;
  runnable: boolean;
  pending?: Promise<void>;
};

type RetirementMaintenance = {
  kind: "retirement";
  record: NativeRecord;
  runnable: boolean;
  pending?: Promise<void>;
};

type Maintenance = CleanupMaintenance | RetirementMaintenance;

type Work = {
  readonly kind: "attempt" | "recovery";
  readonly captured: CapturedOwner | CapturedRecovery;
  readonly result: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
  resultSettled: boolean;
  mainRunning: boolean;
  uiPending: boolean;
  retired: boolean;
  cancelRequested: boolean;
  handoffIntent: boolean;
  terminalReason?: NativeOAuthErrorCode;
  maintenance?: Maintenance;
  phase:
    | "reserved"
    | "cold-read"
    | "allocating"
    | "persisting"
    | "awaiting-ui"
    | "authenticating"
    | "handoff"
    | "completion"
    | "retiring"
    | "blocked"
    | "retired";
};

type Runtime = {
  readonly store: NativeOAuthStore;
  readonly dependencies: NativeLifecycleDependencies;
  active: Work | null;
  lock: Promise<void>;
};

type RegistryEnvelope = Readonly<{
  registryVersion: 1;
  recordVersion: 1;
  policy: "native-lifecycle-v1";
  service: typeof NATIVE_OAUTH_SERVICE;
  lifecycle: NativeLifecycle;
}>;

const REGISTRY_SYMBOL = Symbol.for("0xkey.oauth.native.lifecycle.v1");
// This registry serializes one JavaScript realm only. Independent realms,
// processes, headless runtimes, and app extensions require a native ownership
// primitive; Keychain get/set/reset is not cross-process CAS.
const PUBLIC_KEY = /^(?:0[23][0-9a-f]{64}|04[0-9a-f]{128})$/;
const TOKEN = /^[\x21-\x7e]+$/;

function observed<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => undefined);
  return promise;
}

function deferredResult(): {
  promise: Promise<void>;
  resolve(): void;
  reject(reason: unknown): void;
} {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = observed(
    new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
  );
  return { promise, resolve, reject };
}

function inertAttempt(code: NativeOAuthErrorCode): NativeAttempt {
  const result = observed(Promise.reject(nativeOAuthError(code)));
  return Object.freeze({
    result,
    async cancel() {},
    async retry() {},
  });
}

function inertRecovery(code: NativeOAuthErrorCode): NativeRecovery {
  const result = observed(Promise.reject(nativeOAuthError(code)));
  return Object.freeze({
    result,
    async retry() {},
  });
}

function thenable(value: unknown): value is PromiseLike<void> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function captureRecovery(input: unknown): CapturedRecovery {
  try {
    if (!input || (typeof input !== "object" && typeof input !== "function"))
      throw nativeOAuthError("config-invalid");
    const source = input as NativeRecoveryContext;
    const ready = source.ready;
    if (!thenable(ready)) throw nativeOAuthError("config-invalid");
    const readyPromise = observed(Promise.resolve(ready));
    const binding = canonicalizeNativeBinding(source.binding);
    if (
      typeof source.isCurrent !== "function" ||
      typeof source.discardKey !== "function"
    ) {
      throw nativeOAuthError("config-invalid");
    }
    return Object.freeze({
      ready: readyPromise,
      binding,
      isCurrent: source.isCurrent.bind(source),
      discardKey: source.discardKey.bind(source),
    });
  } catch {
    throw nativeOAuthError("config-invalid");
  }
}

function captureOwner(input: unknown): CapturedOwner {
  try {
    const recovery = captureRecovery(input);
    const source = input as NativeOwner;
    if (
      typeof source.createKey !== "function" ||
      typeof source.authenticate !== "function" ||
      typeof source.complete !== "function"
    ) {
      throw nativeOAuthError("config-invalid");
    }
    return Object.freeze({
      ...recovery,
      createKey: source.createKey.bind(source),
      authenticate: source.authenticate.bind(source),
      complete: source.complete.bind(source),
    });
  } catch {
    throw nativeOAuthError("config-invalid");
  }
}

function current(captured: CapturedRecovery): boolean {
  try {
    return captured.isCurrent() === true;
  } catch {
    return false;
  }
}

function sameBinding(a: NativeBinding, b: NativeBinding): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameRecordIgnoringPhase(a: NativeRecord, b: NativeRecord): boolean {
  return sameNativeRecord(
    withNativeRecordPhase(a, "awaiting_native"),
    withNativeRecordPhase(b, "awaiting_native"),
  );
}

async function withLock<T>(
  runtime: Runtime,
  action: () => Promise<T>,
): Promise<T> {
  const previous = runtime.lock;
  let release!: () => void;
  runtime.lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

function createWork(
  kind: Work["kind"],
  captured: CapturedOwner | CapturedRecovery,
): Work {
  const result = deferredResult();
  return {
    kind,
    captured,
    result: result.promise,
    resolve: result.resolve,
    reject: result.reject,
    resultSettled: false,
    mainRunning: true,
    uiPending: false,
    retired: false,
    cancelRequested: false,
    handoffIntent: false,
    phase: "reserved",
  };
}

function buildLifecycle(
  dependencies: NativeLifecycleDependencies,
): NativeLifecycle {
  const runtime: Runtime = {
    dependencies,
    store: createNativeOAuthStore(dependencies.storage),
    active: null,
    lock: Promise.resolve(),
  };

  function tryRelease(work: Work): void {
    if (
      runtime.active === work &&
      work.resultSettled &&
      !work.uiPending &&
      work.maintenance === undefined
    ) {
      work.retired = true;
      work.phase = "retired";
      runtime.active = null;
    }
  }

  function settleResolve(work: Work): void {
    if (work.resultSettled) return;
    work.resultSettled = true;
    work.resolve();
    tryRelease(work);
  }

  function settleReject(work: Work, reason: unknown): void {
    if (work.resultSettled) return;
    work.resultSettled = true;
    work.reject(reason);
    tryRelease(work);
  }

  async function cleanupMaintenance(
    work: Work,
    descriptor: CleanupMaintenance,
    requireCurrent: boolean,
  ): Promise<boolean> {
    return withLock(runtime, async () => {
      if (runtime.active !== work || work.maintenance !== descriptor)
        return false;
      if (requireCurrent && !current(work.captured)) return false;
      let existing = await runtime.store.read();
      if (existing === null) {
        if (
          !descriptor.allowAbsent &&
          !(descriptor.keyDiscarded && descriptor.removalAttempted)
        )
          throw nativeOAuthError("recovery-required");
        if (!descriptor.keyDiscarded) {
          await descriptor.discardKey(descriptor.record.publicKey);
          descriptor.keyDiscarded = true;
        }
        return true;
      }
      if (!sameRecordIgnoringPhase(existing, descriptor.record))
        throw nativeOAuthError("recovery-required");
      if (existing.phase === "handoff_started")
        throw nativeOAuthError("recovery-required");
      if (existing.phase === "awaiting_native") {
        existing = withNativeRecordPhase(existing, "cleanup_claimed");
        await runtime.store.write(existing);
      }
      if (!descriptor.keyDiscarded) {
        await descriptor.discardKey(existing.publicKey);
        descriptor.keyDiscarded = true;
      }
      descriptor.removalAttempted = true;
      await runtime.store.remove(existing);
      return true;
    });
  }

  async function retirementMaintenance(
    work: Work,
    descriptor: RetirementMaintenance,
    requireCurrent: boolean,
  ): Promise<boolean> {
    return withLock(runtime, async () => {
      if (runtime.active !== work || work.maintenance !== descriptor)
        return false;
      if (requireCurrent && !current(work.captured)) return false;
      let existing = await runtime.store.read();
      if (existing === null) return true;
      if (!sameRecordIgnoringPhase(existing, descriptor.record))
        throw nativeOAuthError("recovery-required");
      if (existing.phase === "awaiting_native") {
        existing = withNativeRecordPhase(existing, "handoff_started");
        await runtime.store.write(existing);
      }
      if (existing.phase !== "handoff_started")
        throw nativeOAuthError("recovery-required");
      await runtime.store.remove(existing);
      return true;
    });
  }

  function runMaintenance(work: Work, requireCurrent = false): Promise<void> {
    const descriptor = work.maintenance;
    if (!descriptor || !descriptor.runnable) return Promise.resolve();
    if (descriptor.pending) return descriptor.pending;
    const action =
      descriptor.kind === "cleanup"
        ? cleanupMaintenance(work, descriptor, requireCurrent)
        : retirementMaintenance(work, descriptor, requireCurrent);
    descriptor.pending = action.then(
      (completed) => {
        if (completed && work.maintenance === descriptor)
          delete work.maintenance;
        delete descriptor.pending;
        tryRelease(work);
      },
      () => {
        delete descriptor.pending;
        work.phase = "blocked";
        throw nativeOAuthError("recovery-required");
      },
    );
    return observed(descriptor.pending);
  }

  async function finishPreHandoff(
    work: Work,
    reason: NativeOAuthErrorCode,
  ): Promise<void> {
    if (work.handoffIntent) return;
    if (!work.terminalReason) work.terminalReason = reason;
    const selected = work.terminalReason;
    if (work.maintenance?.kind === "cleanup") {
      work.maintenance.runnable = true;
      try {
        await runMaintenance(work);
        settleReject(work, nativeOAuthError(selected));
      } catch {
        settleReject(work, nativeOAuthError("recovery-required"));
      }
    } else {
      settleReject(work, nativeOAuthError(selected));
    }
  }

  async function discoverCold(work: Work): Promise<NativeRecord | null> {
    work.phase = "cold-read";
    return withLock(runtime, async () => {
      const existing = await runtime.store.read();
      if (work.cancelRequested) return null;
      if (!current(work.captured)) throw nativeOAuthError("context-changed");
      if (
        existing !== null &&
        !sameBinding(existing.binding, work.captured.binding)
      )
        throw nativeOAuthError("recovery-required");
      return existing;
    });
  }

  function coldMaintenance(work: Work, record: NativeRecord): Maintenance {
    return record.phase === "handoff_started"
      ? {
          kind: "retirement",
          record,
          runnable: true,
        }
      : {
          kind: "cleanup",
          record,
          discardKey: work.captured.discardKey,
          allowAbsent: false,
          keyDiscarded: false,
          removalAttempted: false,
          runnable: true,
        };
  }

  async function runColdMaintenance(
    work: Work,
    record: NativeRecord,
  ): Promise<boolean> {
    const descriptor = coldMaintenance(work, record);
    const installed = await withLock(runtime, async () => {
      if (
        runtime.active !== work ||
        work.maintenance !== undefined ||
        work.cancelRequested ||
        work.terminalReason !== undefined ||
        !current(work.captured)
      ) {
        return false;
      }
      work.maintenance = descriptor;
      return true;
    });
    if (!installed) return false;
    await runMaintenance(work, true);
    return work.maintenance !== descriptor;
  }

  function checkedOperationId(): string {
    try {
      const value = runtime.dependencies.randomBytes(16);
      if (!(value instanceof Uint8Array) || value.length !== 16)
        throw nativeOAuthError("randomness-unavailable");
      return bytesToHex(new Uint8Array(value));
    } catch {
      throw nativeOAuthError("randomness-unavailable");
    }
  }

  function checkedNow(): number {
    try {
      const value = runtime.dependencies.now();
      if (!Number.isSafeInteger(value) || value < 0)
        throw nativeOAuthError("clock-unavailable");
      return value;
    } catch {
      throw nativeOAuthError("clock-unavailable");
    }
  }

  function adapterToken(value: unknown): string | undefined {
    try {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return undefined;
      if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;
      const keys = Reflect.ownKeys(value);
      if (keys.length !== 1 || keys[0] !== "oidcToken") return undefined;
      const token = (value as { oidcToken?: unknown }).oidcToken;
      if (
        typeof token !== "string" ||
        !TOKEN.test(token) ||
        token.length > 65_536
      ) {
        return undefined;
      }
      return token;
    } catch {
      return undefined;
    }
  }

  function containContinuationFailure(work: Work): void {
    work.uiPending = false;
    work.mainRunning = false;
    if (runtime.active === work && !work.retired && !work.resultSettled) {
      if (work.maintenance) work.maintenance.runnable = true;
      work.phase = "blocked";
      settleReject(work, nativeOAuthError("recovery-required"));
    }
    tryRelease(work);
  }

  async function retireAfterHandoff(
    work: Work,
    originalError?: unknown,
    withheldReason?: NativeOAuthErrorCode,
    originalRejected = false,
  ): Promise<void> {
    const descriptor = work.maintenance;
    if (!descriptor || descriptor.kind !== "retirement") {
      settleReject(work, nativeOAuthError("recovery-required"));
      return;
    }
    work.phase = "retiring";
    descriptor.runnable = true;
    try {
      await runMaintenance(work);
      if (originalRejected) settleReject(work, originalError);
      else if (withheldReason)
        settleReject(work, nativeOAuthError(withheldReason));
      else settleResolve(work);
    } catch {
      if (originalRejected) settleReject(work, originalError);
      else settleReject(work, nativeOAuthError("recovery-required"));
    }
  }

  async function handoff(
    work: Work,
    owner: CapturedOwner,
    token: string,
  ): Promise<void> {
    const cleanup = work.maintenance;
    if (!cleanup || cleanup.kind !== "cleanup") {
      await finishPreHandoff(work, "recovery-required");
      return;
    }
    if (work.cancelRequested || work.terminalReason) {
      await finishPreHandoff(work, work.terminalReason ?? "cancelled");
      return;
    }
    if (!current(owner)) {
      await finishPreHandoff(work, "context-changed");
      return;
    }
    work.handoffIntent = true;
    work.phase = "handoff";
    const handoffRecord = withNativeRecordPhase(
      cleanup.record,
      "handoff_started",
    );
    const retirement: RetirementMaintenance = {
      kind: "retirement",
      record: handoffRecord,
      runnable: false,
    };
    work.maintenance = retirement;
    try {
      await withLock(runtime, async () => {
        if (runtime.active !== work || work.maintenance !== retirement)
          throw nativeOAuthError("recovery-required");
        const existing = await runtime.store.read();
        if (
          existing === null ||
          existing.phase !== "awaiting_native" ||
          !sameRecordIgnoringPhase(existing, handoffRecord)
        ) {
          throw nativeOAuthError("recovery-required");
        }
        await runtime.store.write(handoffRecord);
      });
    } catch {
      retirement.runnable = true;
      work.phase = "blocked";
      settleReject(work, nativeOAuthError("recovery-required"));
      return;
    }
    if (!current(owner)) {
      await retireAfterHandoff(work, undefined, "context-changed");
      return;
    }
    work.phase = "completion";
    let completion: Promise<void>;
    try {
      completion = Promise.resolve(
        owner.complete({
          publicKey: handoffRecord.publicKey,
          oidcToken: token,
        }),
      );
    } catch (error) {
      completion = Promise.reject(error);
    }
    let completionError: unknown;
    let completionRejected = false;
    try {
      await completion;
    } catch (error) {
      completionRejected = true;
      completionError = error;
    }
    await retireAfterHandoff(
      work,
      completionError,
      undefined,
      completionRejected,
    );
  }

  async function adapterSettled(
    work: Work,
    owner: CapturedOwner,
    outcome:
      | { type: "resolved"; value: unknown }
      | { type: "rejected"; reason: unknown },
  ): Promise<void> {
    work.uiPending = false;
    if (runtime.active !== work || work.retired) return;
    if (work.cancelRequested || work.terminalReason) {
      tryRelease(work);
      return;
    }
    work.mainRunning = true;
    try {
      if (outcome.type === "rejected") {
        await finishPreHandoff(
          work,
          outcome.reason === NATIVE_OAUTH_CANCELLED
            ? "cancelled"
            : "adapter-failed",
        );
        return;
      }
      const token = adapterToken(outcome.value);
      if (token === undefined) {
        await finishPreHandoff(work, "result-invalid");
        return;
      }
      await handoff(work, owner, token);
    } finally {
      work.mainRunning = false;
      tryRelease(work);
    }
  }

  async function runStart(work: Work, owner: CapturedOwner): Promise<void> {
    try {
      try {
        await owner.ready;
      } catch {
        await finishPreHandoff(
          work,
          work.cancelRequested ? "cancelled" : "not-ready",
        );
        return;
      }
      if (work.cancelRequested) {
        await finishPreHandoff(work, "cancelled");
        return;
      }
      if (!current(owner)) {
        await finishPreHandoff(work, "context-changed");
        return;
      }
      let cold: NativeRecord | null;
      try {
        cold = await discoverCold(work);
      } catch {
        if (work.cancelRequested) {
          await finishPreHandoff(work, "cancelled");
        } else if (!current(owner)) {
          await finishPreHandoff(work, "context-changed");
        } else {
          settleReject(work, nativeOAuthError("recovery-required"));
        }
        return;
      }
      if (work.cancelRequested) {
        await finishPreHandoff(work, "cancelled");
        return;
      }
      if (cold !== null) {
        try {
          if (!(await runColdMaintenance(work, cold))) {
            if (work.cancelRequested || work.terminalReason) {
              await finishPreHandoff(work, work.terminalReason ?? "cancelled");
              return;
            }
            settleReject(
              work,
              nativeOAuthError(
                current(owner) ? "recovery-required" : "context-changed",
              ),
            );
            return;
          }
        } catch {
          settleReject(work, nativeOAuthError("recovery-required"));
          return;
        }
      }
      if (work.cancelRequested) {
        await finishPreHandoff(work, "cancelled");
        return;
      }
      if (!current(owner)) {
        await finishPreHandoff(work, "context-changed");
        return;
      }
      let operationId: string;
      let createdAt: number;
      try {
        operationId = checkedOperationId();
      } catch {
        settleReject(work, nativeOAuthError("randomness-unavailable"));
        return;
      }
      try {
        createdAt = checkedNow();
      } catch {
        settleReject(work, nativeOAuthError("clock-unavailable"));
        return;
      }
      if (work.cancelRequested) {
        await finishPreHandoff(work, "cancelled");
        return;
      }
      work.phase = "allocating";
      let key: string;
      try {
        key = await owner.createKey();
      } catch {
        await finishPreHandoff(
          work,
          work.cancelRequested ? "cancelled" : "key-creation-failed",
        );
        return;
      }
      if (typeof key !== "string" || !PUBLIC_KEY.test(key)) {
        await finishPreHandoff(
          work,
          work.cancelRequested ? "cancelled" : "key-creation-failed",
        );
        return;
      }
      const awaiting: NativeRecord = Object.freeze({
        kind: "native-oauth",
        version: 1,
        operationId,
        binding: owner.binding,
        publicKey: key,
        createdAt,
        phase: "awaiting_native",
      });
      // Validate the complete record before its first persistence attempt.
      serializeNativeRecord(awaiting);
      const cleanup: CleanupMaintenance = {
        kind: "cleanup",
        record: awaiting,
        discardKey: owner.discardKey,
        allowAbsent: true,
        keyDiscarded: false,
        removalAttempted: false,
        runnable: false,
      };
      work.maintenance = cleanup;
      work.phase = "persisting";
      try {
        await withLock(runtime, () => runtime.store.write(awaiting));
        cleanup.allowAbsent = false;
      } catch {
        cleanup.runnable = true;
        work.phase = "blocked";
        settleReject(work, nativeOAuthError("recovery-required"));
        return;
      }
      if (work.cancelRequested) {
        await finishPreHandoff(work, "cancelled");
        return;
      }
      if (!current(owner)) {
        await finishPreHandoff(work, "context-changed");
        return;
      }
      work.phase = "awaiting-ui";
      if (work.cancelRequested) {
        await finishPreHandoff(work, "cancelled");
        return;
      }
      work.phase = "authenticating";
      work.uiPending = true;
      let authentication: Promise<unknown>;
      try {
        authentication = Promise.resolve(
          owner.authenticate({
            publicKey: key,
            expectedNonce: bytesToHex(sha256(key)),
          }),
        );
      } catch (error) {
        authentication = Promise.reject(error);
      }
      const continuation = authentication.then(
        (value) => adapterSettled(work, owner, { type: "resolved", value }),
        (reason) => adapterSettled(work, owner, { type: "rejected", reason }),
      );
      void observed(
        continuation.catch(() => {
          containContinuationFailure(work);
        }),
      );
    } finally {
      work.mainRunning = false;
      tryRelease(work);
    }
  }

  async function runRecovery(
    work: Work,
    captured: CapturedRecovery,
  ): Promise<void> {
    try {
      try {
        await captured.ready;
      } catch {
        settleReject(work, nativeOAuthError("not-ready"));
        return;
      }
      if (!current(captured)) {
        settleReject(work, nativeOAuthError("context-changed"));
        return;
      }
      let existing: NativeRecord | null;
      try {
        existing = await discoverCold(work);
      } catch {
        settleReject(
          work,
          nativeOAuthError(
            current(captured) ? "recovery-required" : "context-changed",
          ),
        );
        return;
      }
      if (existing === null) {
        settleResolve(work);
        return;
      }
      try {
        if (!(await runColdMaintenance(work, existing))) {
          settleReject(
            work,
            nativeOAuthError(
              current(captured) ? "recovery-required" : "context-changed",
            ),
          );
          return;
        }
        settleResolve(work);
      } catch {
        settleReject(work, nativeOAuthError("recovery-required"));
      }
    } finally {
      work.mainRunning = false;
      tryRelease(work);
    }
  }

  async function retry(work: Work): Promise<void> {
    if (
      runtime.active !== work ||
      work.retired ||
      !work.maintenance ||
      !work.maintenance.runnable ||
      !current(work.captured)
    ) {
      return;
    }
    await runMaintenance(work, true);
  }

  function cancel(work: Work): Promise<void> {
    if (
      runtime.active !== work ||
      work.retired ||
      work.handoffIntent ||
      work.kind !== "attempt"
    ) {
      return Promise.resolve();
    }
    if (!work.terminalReason) {
      work.cancelRequested = true;
      work.terminalReason = "cancelled";
      if (work.phase === "awaiting-ui" || work.phase === "authenticating") {
        void finishPreHandoff(work, "cancelled");
      }
    }
    return work.result.then(
      () => undefined,
      (error) => {
        if (
          error &&
          typeof error === "object" &&
          (error as { code?: unknown }).code === "recovery-required"
        ) {
          throw error;
        }
      },
    );
  }

  return Object.freeze({
    start(ownerInput: NativeOwner): NativeAttempt {
      if (runtime.active !== null) return inertAttempt("busy");
      let owner: CapturedOwner;
      try {
        owner = captureOwner(ownerInput);
      } catch {
        return inertAttempt("config-invalid");
      }
      const work = createWork("attempt", owner);
      runtime.active = work;
      const handle: NativeAttempt = Object.freeze({
        result: work.result,
        cancel: () => cancel(work),
        retry: () => retry(work),
      });
      void runStart(work, owner);
      return handle;
    },
    recover(contextInput: NativeRecoveryContext): NativeRecovery {
      if (runtime.active !== null) return inertRecovery("busy");
      let captured: CapturedRecovery;
      try {
        captured = captureRecovery(contextInput);
      } catch {
        return inertRecovery("config-invalid");
      }
      const work = createWork("recovery", captured);
      runtime.active = work;
      const handle: NativeRecovery = Object.freeze({
        result: work.result,
        retry: () => retry(work),
      });
      void runRecovery(work, captured);
      return handle;
    },
  });
}

function isEnvelope(value: unknown): value is RegistryEnvelope {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const envelope = value as Partial<RegistryEnvelope>;
    const keys = Object.keys(value);
    return (
      keys.length === 5 &&
      envelope.registryVersion === 1 &&
      envelope.recordVersion === 1 &&
      envelope.policy === "native-lifecycle-v1" &&
      envelope.service === NATIVE_OAUTH_SERVICE &&
      !!envelope.lifecycle &&
      typeof envelope.lifecycle.start === "function" &&
      typeof envelope.lifecycle.recover === "function"
    );
  } catch {
    return false;
  }
}

function acquire(
  dependencies: NativeLifecycleDependencies,
  registry: Record<symbol, unknown>,
): NativeLifecycle {
  let existing: unknown;
  try {
    existing = registry[REGISTRY_SYMBOL];
  } catch {
    throw nativeOAuthError("recovery-required");
  }
  if (existing !== undefined) {
    if (!isEnvelope(existing)) throw nativeOAuthError("recovery-required");
    return existing.lifecycle;
  }
  const lifecycle = buildLifecycle(dependencies);
  const envelope: RegistryEnvelope = Object.freeze({
    registryVersion: 1,
    recordVersion: 1,
    policy: "native-lifecycle-v1",
    service: NATIVE_OAUTH_SERVICE,
    lifecycle,
  });
  try {
    registry[REGISTRY_SYMBOL] = envelope;
  } catch {
    throw nativeOAuthError("recovery-required");
  }
  return lifecycle;
}

export function createNativeOAuthLifecycleForTests(
  dependencies: NativeLifecycleDependencies,
  registry: Record<symbol, unknown>,
): NativeLifecycle {
  return acquire(dependencies, registry);
}

export function getNativeOAuthLifecycle(): NativeLifecycle {
  const registry = globalThis as unknown as Record<symbol, unknown>;
  return acquire(
    {
      storage: createNativeOAuthKeychainStorage(() =>
        require("react-native-keychain"),
      ),
      now: Date.now,
      randomBytes(length) {
        const crypto = (
          globalThis as unknown as {
            crypto?: {
              getRandomValues?(value: Uint8Array): Uint8Array;
            };
          }
        ).crypto;
        if (!crypto || typeof crypto.getRandomValues !== "function")
          throw nativeOAuthError("randomness-unavailable");
        return crypto.getRandomValues(new Uint8Array(length));
      },
    },
    registry,
  );
}
