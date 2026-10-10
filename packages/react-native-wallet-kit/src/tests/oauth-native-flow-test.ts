import { describe, expect, it, jest } from "@jest/globals";
import { ZeroXKeyError, ZeroXKeyErrorCodes } from "@0xkey-io/sdk-types";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import {
  NATIVE_OAUTH_CANCELLED,
  createNativeOAuthLifecycleForTests,
  getNativeOAuthLifecycle,
  type NativeLifecycleDependencies,
  type NativeOwner,
  type NativeRecoveryContext,
} from "../utils/oauth-native-flow";
import {
  createNativeOAuthKeychainStorage,
  type NativeOAuthKeychainModule,
} from "../utils/oauth-native-keychain-storage";
import {
  parseNativeRecord,
  serializeNativeRecord,
  type NativeBinding,
  type NativeRecord,
  type NativeSlotStorage,
} from "../utils/oauth-native-store";

const publicKey = `02${"12".repeat(32)}`;
const secondPublicKey = `03${"34".repeat(32)}`;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 30; index++) await Promise.resolve();
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 200; index++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition not reached");
}

function binding(overrides: Partial<NativeBinding> = {}): NativeBinding {
  return {
    organizationId: "organization-1",
    apiBaseUrl: "https://api.example/",
    authProxyUrl: "https://proxy.example/",
    authProxyConfigId: "proxy-config-1",
    provider: "google",
    platform: "ios",
    clientId: "google-client-1",
    redirectUri: "com.googleusercontent.apps.example:/oauthredirect",
    completion: "internal",
    keyNamespace: "auth-v2",
    ...overrides,
  };
}

function record(
  phase: NativeRecord["phase"],
  overrides: Partial<NativeRecord> = {},
): NativeRecord {
  return parseNativeRecord(
    JSON.stringify({
      kind: "native-oauth",
      version: 1,
      operationId: "01".repeat(16),
      binding: binding(),
      publicKey,
      createdAt: 1_000,
      phase,
      ...overrides,
    }),
  );
}

function storageFixture(initial: string | null = null) {
  let value = initial;
  const events: string[] = [];
  const adapter: NativeSlotStorage = {
    read: jest.fn(async () => {
      events.push("read");
      return value;
    }),
    write: jest.fn(async (next: string) => {
      events.push(`write:${parseNativeRecord(next).phase}`);
      value = next;
    }),
    remove: jest.fn(async () => {
      events.push("remove");
      value = null;
    }),
  };
  return {
    adapter,
    events,
    value: () => value,
    set: (next: string | null) => {
      value = next;
    },
  };
}

function lifecycleFixture(
  options: {
    storage?: ReturnType<typeof storageFixture>;
    registry?: Record<symbol, unknown>;
    idByte?: number;
  } = {},
) {
  const storage = options.storage ?? storageFixture();
  const registry = options.registry ?? {};
  const dependencies: NativeLifecycleDependencies = {
    storage: storage.adapter,
    now: () => 1_000,
    randomBytes: (length) => new Uint8Array(length).fill(options.idByte ?? 1),
  };
  return {
    storage,
    registry,
    dependencies,
    lifecycle: createNativeOAuthLifecycleForTests(dependencies, registry),
  };
}

function ownerFixture(
  options: {
    ready?: Promise<void>;
    current?: () => boolean;
    key?: string;
    authenticate?: NativeOwner["authenticate"];
    complete?: NativeOwner["complete"];
    ownerBinding?: NativeBinding;
  } = {},
) {
  const events: string[] = [];
  const keys = new Set<string>();
  const createKey = jest.fn(async () => {
    events.push("create-key");
    const key = options.key ?? publicKey;
    keys.add(key);
    return key;
  });
  const discardKey = jest.fn(async (key: string) => {
    events.push(`discard:${key}`);
    keys.delete(key);
  });
  const authenticate = jest.fn<NativeOwner["authenticate"]>(
    options.authenticate ??
      (async () => {
        events.push("authenticate");
        return { oidcToken: "opaque-token" };
      }),
  );
  const complete = jest.fn<NativeOwner["complete"]>(
    options.complete ??
      (async () => {
        events.push("complete");
      }),
  );
  const owner: NativeOwner = {
    ready: options.ready ?? Promise.resolve(),
    binding: options.ownerBinding ?? binding(),
    isCurrent: options.current ?? (() => true),
    createKey,
    discardKey,
    authenticate,
    complete,
  };
  return {
    owner,
    events,
    keys,
    createKey,
    discardKey,
    authenticate,
    complete,
  };
}

function recoveryContext(
  owner: ReturnType<typeof ownerFixture>,
  overrides: Partial<NativeRecoveryContext> = {},
): NativeRecoveryContext {
  return {
    ready: Promise.resolve(),
    binding: owner.owner.binding,
    isCurrent: owner.owner.isCurrent,
    discardKey: owner.owner.discardKey,
    ...overrides,
  };
}

describe("native OAuth lifecycle", () => {
  it("returns frozen handles synchronously and reserves before readiness", async () => {
    const ready = deferred<void>();
    const f = lifecycleFixture();
    const a = ownerFixture({ ready: ready.promise });
    const first = f.lifecycle.start(a.owner);
    const second = f.lifecycle.start(ownerFixture().owner);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
    expect(a.createKey).not.toHaveBeenCalled();
    await expect(second.result).rejects.toMatchObject({
      code: "busy",
      message: "Native OAuth busy",
    });
    ready.reject(new Error("readiness-sensitive-canary"));
    const failure = await first.result.catch((error) => error);
    expect(failure).toMatchObject({
      code: "not-ready",
      message: "Native OAuth client not ready",
    });
    expect(String(failure)).not.toContain("readiness-sensitive-canary");
    expect(f.storage.events).toEqual([]);
  });

  it("shares one registry runtime and retains the first dependencies", async () => {
    const registry: Record<symbol, unknown> = {};
    const firstStorage = storageFixture();
    const secondStorage = storageFixture();
    const first = lifecycleFixture({ storage: firstStorage, registry });
    const second = lifecycleFixture({ storage: secondStorage, registry });
    expect(second.lifecycle).toBe(first.lifecycle);
    const auth = deferred<{ oidcToken: string }>();
    const a = ownerFixture({ authenticate: () => auth.promise });
    const attempt = second.lifecycle.start(a.owner);
    await flush();
    expect(firstStorage.events).toContain("write:awaiting_native");
    expect(secondStorage.events).toEqual([]);
    await attempt.cancel();
    auth.reject(new Error("late-native-error"));
    await expect(attempt.result).rejects.toMatchObject({ code: "cancelled" });
  });

  it("rejects incompatible registry envelopes without replacing them", () => {
    const symbol = Symbol.for("0xkey.oauth.native.lifecycle.v1");
    const envelope = { registryVersion: 2 };
    const registry: Record<symbol, unknown> = { [symbol]: envelope };
    const f = storageFixture();
    expect(() =>
      createNativeOAuthLifecycleForTests(
        {
          storage: f.adapter,
          now: () => 1,
          randomBytes: (length) => new Uint8Array(length),
        },
        registry,
      ),
    ).toThrow("Native OAuth recovery required");
    expect(registry[symbol]).toBe(envelope);
  });

  it("sanitizes an incompatible registry envelope with throwing getters", () => {
    const symbol = Symbol.for("0xkey.oauth.native.lifecycle.v1");
    const envelope = Object.defineProperty(
      {
        registryVersion: 1,
        recordVersion: 1,
        policy: "native-lifecycle-v1",
        service: "com.0xkey.oauth.native.v1:nativeUI",
      },
      "lifecycle",
      {
        enumerable: true,
        get() {
          throw new Error("registry-sensitive-canary");
        },
      },
    );
    const registry: Record<symbol, unknown> = { [symbol]: envelope };
    let failure: unknown;
    try {
      createNativeOAuthLifecycleForTests(
        {
          storage: storageFixture().adapter,
          now: () => 1,
          randomBytes: (length) => new Uint8Array(length),
        },
        registry,
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "recovery-required",
      message: "Native OAuth recovery required",
    });
    expect(String(failure)).not.toContain("registry-sensitive-canary");
    expect(registry[symbol]).toBe(envelope);
  });

  it("shares the production runtime through the realm-global symbol", () => {
    const first = getNativeOAuthLifecycle();
    const second = getNativeOAuthLifecycle();
    expect(second).toBe(first);
    expect(getNativeOAuthLifecycle.length).toBe(0);
  });

  it.each([
    [
      "wrong random type",
      () => [] as unknown as Uint8Array,
      "randomness-unavailable",
    ],
    ["short random value", () => new Uint8Array(15), "randomness-unavailable"],
    [
      "throwing random source",
      () => {
        throw new Error("random-sensitive-canary");
      },
      "randomness-unavailable",
    ],
  ])("rejects %s before allocation", async (_name, randomBytes, code) => {
    const storage = storageFixture();
    const lifecycle = createNativeOAuthLifecycleForTests(
      { storage: storage.adapter, now: () => 1_000, randomBytes },
      {},
    );
    const owner = ownerFixture();
    await expect(lifecycle.start(owner.owner).result).rejects.toMatchObject({
      code,
    });
    expect(owner.createKey).not.toHaveBeenCalled();
  });

  it.each([NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects clock value %p before allocation",
    async (now) => {
      const storage = storageFixture();
      const lifecycle = createNativeOAuthLifecycleForTests(
        {
          storage: storage.adapter,
          now: () => now,
          randomBytes: (length) => new Uint8Array(length),
        },
        {},
      );
      const owner = ownerFixture();
      await expect(lifecycle.start(owner.owner).result).rejects.toMatchObject({
        code: "clock-unavailable",
      });
      expect(owner.createKey).not.toHaveBeenCalled();
    },
  );

  it("returns a config-invalid handle for poisoned owner properties", async () => {
    const f = lifecycleFixture();
    const owner = ownerFixture().owner as NativeOwner & {
      binding: NativeBinding;
    };
    Object.defineProperty(owner, "binding", {
      get() {
        throw new Error("owner-config-sensitive-canary");
      },
    });
    let attempt: ReturnType<typeof f.lifecycle.start> | undefined;
    expect(() => {
      attempt = f.lifecycle.start(owner);
    }).not.toThrow();
    const failure = await attempt!.result.catch((error) => error);
    expect(failure).toMatchObject({ code: "config-invalid" });
    expect(String(failure)).not.toContain("owner-config-sensitive-canary");
    expect(f.storage.events).toEqual([]);
  });

  it("observes captured readiness before a later owner property rejects validation", async () => {
    let readinessObserved = false;
    const owner = ownerFixture().owner as NativeOwner & {
      ready: Promise<void>;
      binding: NativeBinding;
    };
    owner.ready = {
      then(_resolve: (value: void) => void, reject: (reason: unknown) => void) {
        readinessObserved = true;
        reject(new Error("captured-readiness-sensitive-canary"));
      },
    } as Promise<void>;
    Object.defineProperty(owner, "binding", {
      get() {
        throw new Error("binding-sensitive-canary");
      },
    });
    const attempt = lifecycleFixture().lifecycle.start(owner);
    await expect(attempt.result).rejects.toMatchObject({
      code: "config-invalid",
    });
    await flush();
    expect(readinessObserved).toBe(true);
  });

  it("returns busy without inspecting the rejected request's properties", async () => {
    const ready = deferred<void>();
    const f = lifecycleFixture();
    const first = f.lifecycle.start(
      ownerFixture({ ready: ready.promise }).owner,
    );
    let getterCalls = 0;
    const next = ownerFixture().owner as NativeOwner & { ready: Promise<void> };
    Object.defineProperty(next, "ready", {
      get() {
        getterCalls += 1;
        throw new Error("unused-busy-readiness-canary");
      },
    });
    const blocked = f.lifecycle.start(next);
    await expect(blocked.result).rejects.toMatchObject({ code: "busy" });
    expect(getterCalls).toBe(0);
    const cancellation = first.cancel();
    ready.resolve();
    await cancellation;
  });

  it("does no storage work when recovery readiness rejects", async () => {
    const f = lifecycleFixture();
    const owner = ownerFixture();
    const recovery = f.lifecycle.recover(
      recoveryContext(owner, {
        ready: Promise.reject(new Error("recovery-ready-sensitive-canary")),
      }),
    );
    const failure = await recovery.result.catch((error) => error);
    expect(failure).toMatchObject({ code: "not-ready" });
    expect(String(failure)).not.toContain("recovery-ready-sensitive-canary");
    expect(f.storage.events).toEqual([]);
  });

  it("persists awaiting and handoff readbacks before original-owner completion", async () => {
    const f = lifecycleFixture();
    const a = ownerFixture();
    const attempt = f.lifecycle.start(a.owner);
    await attempt.result;
    expect(f.storage.events).toEqual([
      "read",
      "write:awaiting_native",
      "read",
      "read",
      "write:handoff_started",
      "read",
      "read",
      "read",
      "remove",
      "read",
    ]);
    expect(a.authenticate).toHaveBeenCalledWith({
      publicKey,
      expectedNonce: bytesToHex(sha256(publicKey)),
    });
    expect(a.complete).toHaveBeenCalledWith({
      publicKey,
      oidcToken: "opaque-token",
    });
    expect(a.discardKey).not.toHaveBeenCalled();
    expect(a.keys).toEqual(new Set([publicKey]));
    expect(f.storage.value()).toBeNull();
  });

  it("captures original methods and fails closed when currentness changes", async () => {
    let current = true;
    const native = deferred<{ oidcToken: string }>();
    const a = ownerFixture({
      current: () => current,
      authenticate: () => native.promise,
    });
    const originalComplete = a.owner.complete;
    const replacementComplete = jest.fn(async () => {});
    const f = lifecycleFixture();
    const attempt = f.lifecycle.start(a.owner);
    await flush();
    (a.owner as { complete: NativeOwner["complete"] }).complete =
      replacementComplete;
    current = false;
    native.resolve({ oidcToken: "opaque-token" });
    await expect(attempt.result).rejects.toMatchObject({
      code: "context-changed",
    });
    expect(originalComplete).not.toHaveBeenCalled();
    expect(replacementComplete).not.toHaveBeenCalled();
    expect(a.discardKey).toHaveBeenCalledWith(publicKey);
  });

  it("sanitizes a poisoned currentness check", async () => {
    const f = lifecycleFixture();
    const a = ownerFixture({
      current: () => {
        throw new Error("currentness-sensitive-canary");
      },
    });
    const failure = await f.lifecycle
      .start(a.owner)
      .result.catch((error) => error);
    expect(failure).toMatchObject({
      code: "context-changed",
      message: "Native OAuth context changed",
    });
    expect(String(failure)).not.toContain("currentness-sensitive-canary");
    expect(a.createKey).not.toHaveBeenCalled();
  });

  it("keeps equal-binding Providers distinct and completes only the originator", async () => {
    const native = deferred<{ oidcToken: string }>();
    const f = lifecycleFixture();
    const a = ownerFixture({ authenticate: () => native.promise });
    const b = ownerFixture();
    const attemptA = f.lifecycle.start(a.owner);
    await waitFor(() => a.authenticate.mock.calls.length === 1);
    const attemptB = f.lifecycle.start(b.owner);
    await expect(attemptB.result).rejects.toMatchObject({ code: "busy" });
    native.resolve({ oidcToken: "originator-token" });
    await attemptA.result;
    expect(a.complete).toHaveBeenCalledWith({
      publicKey,
      oidcToken: "originator-token",
    });
    expect(b.complete).not.toHaveBeenCalled();
    expect(b.discardKey).not.toHaveBeenCalled();
  });

  it("performs the final currentness check in the same turn as completion", async () => {
    const events: string[] = [];
    const f = lifecycleFixture();
    const a = ownerFixture({
      current: () => {
        events.push("current");
        return true;
      },
      complete: async () => {
        events.push("complete");
      },
    });
    await f.lifecycle.start(a.owner).result;
    const completion = events.lastIndexOf("complete");
    expect(completion).toBeGreaterThan(0);
    expect(events[completion - 1]).toBe("current");
  });

  it.each([
    [NATIVE_OAUTH_CANCELLED, "cancelled"],
    [
      Object.assign(new Error("Native OAuth cancelled"), { code: "cancelled" }),
      "adapter-failed",
    ],
    [Symbol("0xkey.oauth.native.cancelled.v1"), "adapter-failed"],
  ])("classifies adapter rejection %p as %s", async (rejection, code) => {
    const f = lifecycleFixture();
    const a = ownerFixture({
      authenticate: async () => Promise.reject(rejection),
    });
    const attempt = f.lifecycle.start(a.owner);
    await expect(attempt.result).rejects.toMatchObject({ code });
    expect(a.discardKey).toHaveBeenCalledWith(publicKey);
  });

  it.each([
    [{ oidcToken: "" }],
    [{ oidcToken: "has space" }],
    [{ oidcToken: "x".repeat(65_537) }],
    [{ oidcToken: "ok", extra: true }],
    [Object.setPrototypeOf({ oidcToken: "ok" }, { inherited: true })],
    [
      Object.defineProperty({ oidcToken: "ok" }, "hidden", {
        value: true,
      }),
    ],
    [Object.assign({ oidcToken: "ok" }, { [Symbol("extra")]: true })],
    [NATIVE_OAUTH_CANCELLED],
  ])("rejects invalid resolved adapter result %#", async (result) => {
    const f = lifecycleFixture();
    const a = ownerFixture({ authenticate: async () => result as never });
    const attempt = f.lifecycle.start(a.owner);
    await expect(attempt.result).rejects.toMatchObject({
      code: "result-invalid",
    });
    expect(a.discardKey).toHaveBeenCalledWith(publicKey);
  });

  it("snapshots the validated adapter token exactly once", async () => {
    let reads = 0;
    const changing = Object.defineProperty({}, "oidcToken", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? "validated-token" : "";
      },
    });
    const f = lifecycleFixture();
    const a = ownerFixture({ authenticate: async () => changing as never });
    await f.lifecycle.start(a.owner).result;
    expect(reads).toBe(1);
    expect(a.complete).toHaveBeenCalledWith({
      publicKey,
      oidcToken: "validated-token",
    });
  });

  it("contains a caller getter that would throw on a second token read", async () => {
    let reads = 0;
    const changing = Object.defineProperty({}, "oidcToken", {
      enumerable: true,
      get() {
        reads += 1;
        if (reads > 1) throw new Error("second-read-sensitive-canary");
        return "validated-token";
      },
    });
    const f = lifecycleFixture();
    const a = ownerFixture({ authenticate: async () => changing as never });
    const attempt = f.lifecycle.start(a.owner);
    let outcome: unknown;
    void attempt.result.then(
      () => {
        outcome = "resolved";
      },
      (error) => {
        outcome = error;
      },
    );
    await waitFor(() => outcome !== undefined);
    expect(outcome).toBe("resolved");
    expect(reads).toBe(1);
    expect(a.complete).toHaveBeenCalledWith({
      publicKey,
      oidcToken: "validated-token",
    });
  });

  it("sanitizes a resolved adapter object with a throwing token getter", async () => {
    const poisoned = Object.defineProperty({}, "oidcToken", {
      enumerable: true,
      get() {
        throw new Error("adapter-result-sensitive-canary");
      },
    });
    const f = lifecycleFixture();
    const a = ownerFixture({ authenticate: async () => poisoned as never });
    const attempt = f.lifecycle.start(a.owner);
    let outcome: unknown;
    void attempt.result.catch((error) => {
      outcome = error;
    });
    await waitFor(() => outcome !== undefined);
    expect(outcome).toMatchObject({
      code: "result-invalid",
      message: "Native OAuth result invalid",
    });
    expect(String(outcome)).not.toContain("adapter-result-sensitive-canary");
    expect(a.discardKey).toHaveBeenCalledWith(publicKey);
  });

  it("accepts the exact maximum opaque token without storing it", async () => {
    const token = "t".repeat(65_536);
    const f = lifecycleFixture();
    const a = ownerFixture({
      authenticate: async () => ({ oidcToken: token }),
    });
    await f.lifecycle.start(a.owner).result;
    expect(a.complete).toHaveBeenCalledWith({ publicKey, oidcToken: token });
    expect(f.storage.events.join("|")).not.toContain(token);
    expect(f.storage.value()).toBeNull();
  });

  it.each([
    [
      "allocator rejection",
      async () => Promise.reject(new Error("key-sensitive-canary")),
    ],
    ["invalid SEC1 encoding", async () => "NOT-A-KEY"],
  ])(
    "reports %s without persistence or guessed deletion",
    async (_name, createKey) => {
      const f = lifecycleFixture();
      const a = ownerFixture();
      a.createKey.mockImplementation(createKey);
      const failure = await f.lifecycle
        .start(a.owner)
        .result.catch((error) => error);
      expect(failure).toMatchObject({ code: "key-creation-failed" });
      expect(String(failure)).not.toContain("key-sensitive-canary");
      expect(a.discardKey).not.toHaveBeenCalled();
      expect(f.storage.value()).toBeNull();
    },
  );

  it("cancels before readiness without storage or allocation", async () => {
    const ready = deferred<void>();
    const f = lifecycleFixture();
    const a = ownerFixture({ ready: ready.promise });
    const attempt = f.lifecycle.start(a.owner);
    const cancellation = attempt.cancel();
    ready.resolve();
    await expect(cancellation).resolves.toBeUndefined();
    await expect(attempt.result).rejects.toMatchObject({ code: "cancelled" });
    expect(f.storage.events).toEqual([]);
    expect(a.createKey).not.toHaveBeenCalled();
  });

  it("lets cancellation win over an admission read failure before capture", async () => {
    const read = deferred<string | null>();
    const storage = storageFixture();
    storage.adapter.read = jest.fn(() => read.promise);
    const f = lifecycleFixture({ storage });
    const a = ownerFixture();
    const attempt = f.lifecycle.start(a.owner);
    await flush();
    const cancellation = attempt.cancel();
    read.reject(new Error("read-sensitive-canary"));
    await expect(cancellation).resolves.toBeUndefined();
    await expect(attempt.result).rejects.toMatchObject({ code: "cancelled" });
    expect(a.createKey).not.toHaveBeenCalled();
    expect(a.discardKey).not.toHaveBeenCalled();
  });

  it("rechecks originator currentness after cold read before installing cleanup", async () => {
    const read = deferred<string | null>();
    const persisted = serializeNativeRecord(record("awaiting_native"));
    const storage = storageFixture(persisted);
    storage.adapter.read = jest.fn(() => read.promise);
    let isCurrent = true;
    const owner = ownerFixture({ current: () => isCurrent });
    owner.keys.add(publicKey);
    const f = lifecycleFixture({ storage });
    const attempt = f.lifecycle.start(owner.owner);
    await flush();
    isCurrent = false;
    read.resolve(persisted);
    await expect(attempt.result).rejects.toMatchObject({
      code: "context-changed",
    });
    expect(owner.discardKey).not.toHaveBeenCalled();
    expect(storage.value()).toBe(persisted);
  });

  it("preserves cold ownership when cancellation wins before maintenance installation", async () => {
    const persisted = serializeNativeRecord(record("awaiting_native"));
    const storage = storageFixture(persisted);
    const discovered = deferred<void>();
    let currentChecks = 0;
    const owner = ownerFixture({
      current: () => {
        currentChecks += 1;
        if (currentChecks === 2) discovered.resolve();
        return true;
      },
    });
    owner.keys.add(publicKey);
    const attempt = lifecycleFixture({ storage }).lifecycle.start(owner.owner);
    await discovered.promise;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const cancellation = attempt.cancel();

    await expect(cancellation).resolves.toBeUndefined();
    await expect(attempt.result).rejects.toMatchObject({ code: "cancelled" });
    expect(owner.discardKey).not.toHaveBeenCalled();
    expect(owner.createKey).not.toHaveBeenCalled();
    expect(owner.authenticate).not.toHaveBeenCalled();
    expect(storage.value()).toBe(persisted);
    expect(storage.events).not.toContain("write:cleanup_claimed");
  });

  it("cleans up a cancelled attempt while native UI drains and stays busy", async () => {
    const native = deferred<{ oidcToken: string }>();
    const f = lifecycleFixture();
    const a = ownerFixture({ authenticate: () => native.promise });
    const attempt = f.lifecycle.start(a.owner);
    await flush();
    const cancellation = attempt.cancel();
    await expect(cancellation).resolves.toBeUndefined();
    await expect(attempt.result).rejects.toMatchObject({ code: "cancelled" });
    expect(a.discardKey).toHaveBeenCalledWith(publicKey);
    const blocked = f.lifecycle.start(
      ownerFixture({ key: secondPublicKey }).owner,
    );
    await expect(blocked.result).rejects.toMatchObject({ code: "busy" });
    native.resolve({ oidcToken: "late-token" });
    await flush();
    const b = ownerFixture({ key: secondPublicKey });
    await expect(f.lifecycle.start(b.owner).result).resolves.toBeUndefined();
    expect(a.complete).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent cancel calls into one exact cleanup", async () => {
    const native = deferred<{ oidcToken: string }>();
    const f = lifecycleFixture();
    const a = ownerFixture({ authenticate: () => native.promise });
    const attempt = f.lifecycle.start(a.owner);
    await waitFor(() => a.authenticate.mock.calls.length === 1);
    const first = attempt.cancel();
    const second = attempt.cancel();
    await Promise.all([first, second]);
    await expect(attempt.result).rejects.toMatchObject({ code: "cancelled" });
    expect(a.discardKey).toHaveBeenCalledTimes(1);
    native.reject(new Error("late-native-sensitive-canary"));
    await flush();
    expect(a.complete).not.toHaveBeenCalled();
  });

  it("preserves an adapter failure selected before a later cancel", async () => {
    const native = deferred<{ oidcToken: string }>();
    const deletion = deferred<void>();
    const f = lifecycleFixture();
    const a = ownerFixture({ authenticate: () => native.promise });
    a.discardKey.mockImplementation(() => deletion.promise);
    const attempt = f.lifecycle.start(a.owner);
    await waitFor(() => a.authenticate.mock.calls.length === 1);
    native.reject(new Error("adapter-sensitive-canary"));
    await waitFor(() => a.discardKey.mock.calls.length === 1);
    const cancellation = attempt.cancel();
    deletion.resolve();
    await expect(cancellation).resolves.toBeUndefined();
    const failure = await attempt.result.catch((error) => error);
    expect(failure).toMatchObject({ code: "adapter-failed" });
    expect(String(failure)).not.toContain("adapter-sensitive-canary");
  });

  it("cancels during installed implicit cold cleanup without starting login", async () => {
    const storage = storageFixture(
      serializeNativeRecord(record("cleanup_claimed")),
    );
    const deletion = deferred<void>();
    const a = ownerFixture();
    a.discardKey.mockImplementation(() => deletion.promise);
    const f = lifecycleFixture({ storage });
    const attempt = f.lifecycle.start(a.owner);
    await waitFor(() => a.discardKey.mock.calls.length === 1);
    const cancellation = attempt.cancel();
    deletion.resolve();
    await cancellation;
    await expect(attempt.result).rejects.toMatchObject({ code: "cancelled" });
    expect(a.createKey).not.toHaveBeenCalled();
    expect(a.authenticate).not.toHaveBeenCalled();
    expect(storage.value()).toBeNull();
  });

  it("persists and cleans an exact key when cancellation wins during allocation", async () => {
    const allocated = deferred<string>();
    const f = lifecycleFixture();
    const a = ownerFixture();
    a.createKey.mockImplementation(() => allocated.promise);
    const attempt = f.lifecycle.start(a.owner);
    await flush();
    const cancellation = attempt.cancel();
    allocated.resolve(publicKey);
    await expect(cancellation).resolves.toBeUndefined();
    await expect(attempt.result).rejects.toMatchObject({ code: "cancelled" });
    expect(f.storage.events).toEqual([
      "read",
      "write:awaiting_native",
      "read",
      "read",
      "write:cleanup_claimed",
      "read",
      "read",
      "remove",
      "read",
    ]);
    expect(a.discardKey).toHaveBeenCalledWith(publicKey);
    expect(a.authenticate).not.toHaveBeenCalled();
  });

  it("waits for first persistence before cancelled cleanup and reports ambiguity", async () => {
    const persisted = deferred<void>();
    const storage = storageFixture();
    const originalWrite = storage.adapter.write;
    storage.adapter.write = jest.fn(async (value: string) => {
      if (parseNativeRecord(value).phase === "awaiting_native") {
        await persisted.promise;
        throw new Error("first-write-sensitive-canary");
      }
      return originalWrite(value);
    });
    const f = lifecycleFixture({ storage });
    const a = ownerFixture();
    const attempt = f.lifecycle.start(a.owner);
    await flush();
    const cancellation = attempt.cancel();
    persisted.resolve();
    await expect(cancellation).rejects.toMatchObject({
      code: "recovery-required",
    });
    await expect(attempt.result).rejects.toMatchObject({
      code: "recovery-required",
    });
    expect(a.discardKey).not.toHaveBeenCalled();
    expect(a.authenticate).not.toHaveBeenCalled();
  });

  it("does not discard until cleanup claim is durably read back", async () => {
    const storage = storageFixture();
    const originalWrite = storage.adapter.write;
    let failClaim = true;
    storage.adapter.write = jest.fn(async (value: string) => {
      if (failClaim && parseNativeRecord(value).phase === "cleanup_claimed") {
        throw new Error("claim-sensitive-canary");
      }
      return originalWrite(value);
    });
    const f = lifecycleFixture({ storage });
    const a = ownerFixture({
      authenticate: async () => Promise.reject(new Error("adapter")),
    });
    const attempt = f.lifecycle.start(a.owner);
    await expect(attempt.result).rejects.toMatchObject({
      code: "recovery-required",
    });
    expect(a.discardKey).not.toHaveBeenCalled();
    expect(parseNativeRecord(storage.value()!).phase).toBe("awaiting_native");
    failClaim = false;
    await attempt.retry();
    expect(a.discardKey).toHaveBeenCalledWith(publicKey);
    expect(storage.value()).toBeNull();
  });

  it("retries the exact original-client deletion after an applied-then-throw failure", async () => {
    const f = lifecycleFixture();
    const a = ownerFixture({
      authenticate: async () => Promise.reject(new Error("adapter")),
    });
    let calls = 0;
    a.discardKey.mockImplementation(async (key) => {
      calls += 1;
      a.keys.delete(key);
      if (calls === 1) throw new Error("delete-after-apply-sensitive-canary");
    });
    const attempt = f.lifecycle.start(a.owner);
    await expect(attempt.result).rejects.toMatchObject({
      code: "recovery-required",
    });
    expect(a.keys).not.toContain(publicKey);
    await attempt.retry();
    expect(calls).toBe(2);
    expect(storagePhase(f.storage.value())).toBeNull();
  });

  it("retains exact cleanup authority after failure and retry does not resettle result", async () => {
    const f = lifecycleFixture();
    const a = ownerFixture({
      authenticate: async () => Promise.reject(new Error("adapter")),
    });
    const firstDelete = deferred<void>();
    let deletes = 0;
    a.discardKey.mockImplementation(async () => {
      deletes += 1;
      if (deletes === 1) return firstDelete.promise;
      a.keys.delete(publicKey);
    });
    const attempt = f.lifecycle.start(a.owner);
    await flush();
    firstDelete.reject(new Error("delete-sensitive-canary"));
    const resultFailure = await attempt.result.catch((error) => error);
    expect(resultFailure).toMatchObject({ code: "recovery-required" });
    await expect(attempt.retry()).resolves.toBeUndefined();
    expect(deletes).toBe(2);
    expect(await attempt.result.catch((error) => error)).toBe(resultFailure);
    expect(f.storage.value()).toBeNull();
  });

  it("rechecks currentness inside a retry before any storage or key I/O", async () => {
    let retryMode = false;
    let retryChecks = 0;
    const f = lifecycleFixture();
    const a = ownerFixture({
      current: () => !retryMode || retryChecks++ === 0,
      authenticate: async () => Promise.reject(new Error("adapter")),
    });
    a.discardKey.mockRejectedValueOnce(new Error("delete"));
    const attempt = f.lifecycle.start(a.owner);
    await expect(attempt.result).rejects.toMatchObject({
      code: "recovery-required",
    });
    retryMode = true;
    retryChecks = 0;
    const storageCalls = f.storage.events.length;
    const deletionCalls = a.discardKey.mock.calls.length;
    await attempt.retry();
    expect(retryChecks).toBe(2);
    expect(f.storage.events).toHaveLength(storageCalls);
    expect(a.discardKey).toHaveBeenCalledTimes(deletionCalls);
  });

  it("preserves the actual SDK typed completion error and retains the key", async () => {
    const typed = new ZeroXKeyError(
      "Synthetic pending continuation",
      ZeroXKeyErrorCodes.OAUTH_LOGIN_ERROR,
      { status: "ACTIVITY_STATUS_REQUIRES_ADDITIONAL_AUTH" },
    );
    const f = lifecycleFixture();
    const a = ownerFixture({ complete: async () => Promise.reject(typed) });
    const attempt = f.lifecycle.start(a.owner);
    await expect(attempt.result).rejects.toBe(typed);
    expect(typed.code).toBe(ZeroXKeyErrorCodes.OAUTH_LOGIN_ERROR);
    expect(a.discardKey).not.toHaveBeenCalled();
    expect(a.keys).toEqual(new Set([publicKey]));
    expect(f.storage.value()).toBeNull();
  });

  it("retains the key and withholds completion when handoff persistence is ambiguous", async () => {
    const storage = storageFixture();
    const originalWrite = storage.adapter.write;
    storage.adapter.write = jest.fn(async (value: string) => {
      const parsed = parseNativeRecord(value);
      if (parsed.phase === "handoff_started") {
        storage.set(value);
        throw new Error("handoff-write-sensitive-canary");
      }
      return originalWrite(value);
    });
    const f = lifecycleFixture({ storage });
    const a = ownerFixture();
    const attempt = f.lifecycle.start(a.owner);
    await expect(attempt.result).rejects.toMatchObject({
      code: "recovery-required",
    });
    expect(a.complete).not.toHaveBeenCalled();
    expect(a.discardKey).not.toHaveBeenCalled();
    expect(storagePhase(storage.value())).toBe("handoff_started");
    await attempt.retry();
    expect(storage.value()).toBeNull();
    expect(a.complete).not.toHaveBeenCalled();
    expect(a.keys).toEqual(new Set([publicKey]));
  });

  it("makes cancellation retention-only once handoff intent wins", async () => {
    const handoffWrite = deferred<void>();
    const storage = storageFixture();
    const originalWrite = storage.adapter.write;
    storage.adapter.write = jest.fn(async (value: string) => {
      if (parseNativeRecord(value).phase === "handoff_started")
        await handoffWrite.promise;
      return originalWrite(value);
    });
    const f = lifecycleFixture({ storage });
    const a = ownerFixture();
    const attempt = f.lifecycle.start(a.owner);
    await waitFor(() =>
      (storage.adapter.write as jest.Mock).mock.calls.some(
        ([value]) =>
          parseNativeRecord(value as string).phase === "handoff_started",
      ),
    );
    await expect(attempt.cancel()).resolves.toBeUndefined();
    expect(a.discardKey).not.toHaveBeenCalled();
    handoffWrite.resolve();
    await attempt.result;
    expect(a.complete).toHaveBeenCalledTimes(1);
    expect(a.keys).toEqual(new Set([publicKey]));
  });

  it("retires metadata and reports context drift after the handoff marker", async () => {
    let current = true;
    const storage = storageFixture();
    const originalWrite = storage.adapter.write;
    storage.adapter.write = jest.fn(async (value: string) => {
      await originalWrite(value);
      if (parseNativeRecord(value).phase === "handoff_started") current = false;
    });
    const f = lifecycleFixture({ storage });
    const a = ownerFixture({ current: () => current });
    const attempt = f.lifecycle.start(a.owner);
    await expect(attempt.result).rejects.toMatchObject({
      code: "context-changed",
    });
    expect(a.complete).not.toHaveBeenCalled();
    expect(a.discardKey).not.toHaveBeenCalled();
    expect(a.keys).toEqual(new Set([publicKey]));
    expect(storage.value()).toBeNull();
  });

  it("does not retire metadata through retry while completion is pending", async () => {
    const completion = deferred<void>();
    const f = lifecycleFixture();
    const a = ownerFixture({ complete: () => completion.promise });
    const attempt = f.lifecycle.start(a.owner);
    await flush();
    expect(storagePhase(f.storage.value())).toBe("handoff_started");
    const calls = f.storage.events.length;
    await expect(attempt.retry()).resolves.toBeUndefined();
    expect(f.storage.events).toHaveLength(calls);
    completion.resolve();
    await attempt.result;
  });

  it("preserves even an undefined completion rejection through retirement", async () => {
    const f = lifecycleFixture();
    const a = ownerFixture({ complete: async () => Promise.reject(undefined) });
    const attempt = f.lifecycle.start(a.owner);
    await expect(attempt.result).rejects.toBeUndefined();
    expect(a.discardKey).not.toHaveBeenCalled();
    expect(a.keys).toEqual(new Set([publicKey]));
    expect(f.storage.value()).toBeNull();
  });

  it("preserves typed completion failure when metadata retirement also fails", async () => {
    const typed = new ZeroXKeyError(
      "Pending MFA continuation",
      ZeroXKeyErrorCodes.OAUTH_LOGIN_ERROR,
      { status: "ACTIVITY_STATUS_REQUIRES_ADDITIONAL_AUTH" },
    );
    const storage = storageFixture();
    const originalRemove = storage.adapter.remove;
    let failRemove = true;
    storage.adapter.remove = jest.fn(async () => {
      if (failRemove) throw new Error("retirement-sensitive-canary");
      return originalRemove();
    });
    const f = lifecycleFixture({ storage });
    const a = ownerFixture({ complete: async () => Promise.reject(typed) });
    const attempt = f.lifecycle.start(a.owner);
    await expect(attempt.result).rejects.toBe(typed);
    expect(storagePhase(storage.value())).toBe("handoff_started");
    expect(a.discardKey).not.toHaveBeenCalled();
    failRemove = false;
    await attempt.retry();
    expect(storage.value()).toBeNull();
    expect(a.complete).toHaveBeenCalledTimes(1);
  });

  it.each(["awaiting_native", "cleanup_claimed"] as const)(
    "cleans an exact %s record after a sequential restart",
    async (phase) => {
      const storage = storageFixture(serializeNativeRecord(record(phase)));
      const owner = ownerFixture();
      owner.keys.add(publicKey);
      const fresh = lifecycleFixture({ storage, registry: {} });
      const recovery = fresh.lifecycle.recover(recoveryContext(owner));
      expect(Object.isFrozen(recovery)).toBe(true);
      await expect(recovery.result).resolves.toBeUndefined();
      expect(owner.discardKey).toHaveBeenCalledWith(publicKey);
      expect(storage.value()).toBeNull();
    },
  );

  it("retires handoff metadata after restart without deleting or completing", async () => {
    const storage = storageFixture(
      serializeNativeRecord(record("handoff_started")),
    );
    const owner = ownerFixture();
    owner.keys.add(publicKey);
    const fresh = lifecycleFixture({ storage, registry: {} });
    await fresh.lifecycle.recover(recoveryContext(owner)).result;
    expect(owner.discardKey).not.toHaveBeenCalled();
    expect(owner.complete).not.toHaveBeenCalled();
    expect(owner.keys).toEqual(new Set([publicKey]));
    expect(storage.value()).toBeNull();
  });

  it("recovers a marker captured from a real lifecycle during completion", async () => {
    const storage = storageFixture();
    const completion = deferred<void>();
    const owner = ownerFixture({ complete: () => completion.promise });
    const running = lifecycleFixture({ storage }).lifecycle.start(owner.owner);
    await waitFor(
      () =>
        owner.complete.mock.calls.length === 1 &&
        storagePhase(storage.value()) === "handoff_started",
    );

    const interruptedSlot = storage.value();
    const restartedStorage = storageFixture(interruptedSlot);
    const recoveryOwner = ownerFixture();
    await lifecycleFixture({
      storage: restartedStorage,
      registry: {},
    }).lifecycle.recover(recoveryContext(recoveryOwner)).result;
    expect(recoveryOwner.discardKey).not.toHaveBeenCalled();
    expect(recoveryOwner.complete).not.toHaveBeenCalled();
    expect(restartedStorage.value()).toBeNull();

    completion.resolve();
    await running.result;
  });

  it("recovers a real handoff after completion settled before retirement", async () => {
    const storage = storageFixture();
    storage.adapter.remove = jest.fn(async () => {
      throw new Error("retirement-before-mutation-sensitive-canary");
    });
    const owner = ownerFixture();
    const running = lifecycleFixture({ storage }).lifecycle.start(owner.owner);
    await expect(running.result).rejects.toMatchObject({
      code: "recovery-required",
    });
    expect(owner.complete).toHaveBeenCalledTimes(1);
    expect(storagePhase(storage.value())).toBe("handoff_started");

    const restartedStorage = storageFixture(storage.value());
    const recoveryOwner = ownerFixture();
    await lifecycleFixture({
      storage: restartedStorage,
      registry: {},
    }).lifecycle.recover(recoveryContext(recoveryOwner)).result;
    expect(recoveryOwner.discardKey).not.toHaveBeenCalled();
    expect(recoveryOwner.complete).not.toHaveBeenCalled();
    expect(restartedStorage.value()).toBeNull();
  });

  it("recovers confirmed absence after real retirement removal loses readback", async () => {
    const storage = storageFixture();
    const originalRead = storage.adapter.read;
    let failNextRead = false;
    storage.adapter.read = jest.fn(async () => {
      if (failNextRead) {
        failNextRead = false;
        throw new Error("retirement-readback-sensitive-canary");
      }
      return originalRead();
    });
    storage.adapter.remove = jest.fn(async () => {
      storage.set(null);
      failNextRead = true;
    });
    const owner = ownerFixture();
    const running = lifecycleFixture({ storage }).lifecycle.start(owner.owner);
    await expect(running.result).rejects.toMatchObject({
      code: "recovery-required",
    });
    expect(owner.complete).toHaveBeenCalledTimes(1);
    expect(owner.discardKey).not.toHaveBeenCalled();
    expect(storage.value()).toBeNull();

    const restartedStorage = storageFixture(storage.value());
    const recoveryOwner = ownerFixture();
    await lifecycleFixture({
      storage: restartedStorage,
      registry: {},
    }).lifecycle.recover(recoveryContext(recoveryOwner)).result;
    expect(recoveryOwner.discardKey).not.toHaveBeenCalled();
    expect(recoveryOwner.complete).not.toHaveBeenCalled();
    expect(restartedStorage.value()).toBeNull();
  });

  it("preserves explicit cold recovery when currentness changes before installation", async () => {
    const persisted = serializeNativeRecord(record("awaiting_native"));
    const storage = storageFixture(persisted);
    const owner = ownerFixture();
    owner.keys.add(publicKey);
    let valid = true;
    let checks = 0;
    const context = recoveryContext(owner, {
      isCurrent: () => {
        checks += 1;
        if (checks === 2) queueMicrotask(() => (valid = false));
        return valid;
      },
    });
    const recovery = lifecycleFixture({ storage }).lifecycle.recover(context);
    await expect(recovery.result).rejects.toMatchObject({
      code: "context-changed",
    });
    expect(checks).toBeGreaterThanOrEqual(3);
    expect(owner.discardKey).not.toHaveBeenCalled();
    expect(storage.value()).toBe(persisted);
  });

  it("makes a failed pre-capture recovery handle inert and requires new discovery", async () => {
    const persisted = serializeNativeRecord(record("awaiting_native"));
    const storage = storageFixture(persisted);
    const originalRead = storage.adapter.read;
    let failRead = true;
    storage.adapter.read = jest.fn(async () => {
      if (failRead) throw new Error("cold-read-sensitive-canary");
      return originalRead();
    });
    const owner = ownerFixture();
    owner.keys.add(publicKey);
    const f = lifecycleFixture({ storage });
    const failed = f.lifecycle.recover(recoveryContext(owner));
    await expect(failed.result).rejects.toMatchObject({
      code: "recovery-required",
    });
    const reads = (storage.adapter.read as jest.Mock).mock.calls.length;
    failRead = false;
    await failed.retry();
    expect((storage.adapter.read as jest.Mock).mock.calls).toHaveLength(reads);
    expect(owner.discardKey).not.toHaveBeenCalled();
    const next = f.lifecycle.recover(recoveryContext(owner));
    await next.result;
    expect(owner.discardKey).toHaveBeenCalledWith(publicKey);
    expect(storage.value()).toBeNull();
  });

  it("keeps captured cold cleanup on its recovery handle and original client", async () => {
    const storage = storageFixture(
      serializeNativeRecord(record("cleanup_claimed")),
    );
    const owner = ownerFixture();
    owner.keys.add(publicKey);
    let failing = true;
    owner.discardKey.mockImplementation(async (key) => {
      if (failing) throw new Error("cold-delete-sensitive-canary");
      owner.keys.delete(key);
    });
    const f = lifecycleFixture({ storage });
    const recovery = f.lifecycle.recover(recoveryContext(owner));
    await expect(recovery.result).rejects.toMatchObject({
      code: "recovery-required",
    });
    const blocked = f.lifecycle.recover(recoveryContext(ownerFixture()));
    await expect(blocked.result).rejects.toMatchObject({ code: "busy" });
    failing = false;
    await recovery.retry();
    expect(owner.discardKey).toHaveBeenCalledTimes(2);
    expect(storage.value()).toBeNull();
  });

  it("uses the start handle for failed implicit cold recovery without resuming login", async () => {
    const storage = storageFixture(
      serializeNativeRecord(record("cleanup_claimed")),
    );
    const owner = ownerFixture();
    let failing = true;
    owner.discardKey.mockImplementation(async () => {
      if (failing) throw new Error("implicit-delete-sensitive-canary");
    });
    const f = lifecycleFixture({ storage });
    const attempt = f.lifecycle.start(owner.owner);
    await expect(attempt.result).rejects.toMatchObject({
      code: "recovery-required",
    });
    expect(owner.createKey).not.toHaveBeenCalled();
    failing = false;
    await attempt.retry();
    expect(owner.createKey).not.toHaveBeenCalled();
    expect(storage.value()).toBeNull();
  });

  it("keeps a retired equal-ID A handle inert while B has pending key cleanup", async () => {
    const f = lifecycleFixture({ idByte: 7 });
    const aCurrent = jest.fn(() => true);
    const aNative = deferred<{ oidcToken: string }>();
    const a = ownerFixture({
      current: aCurrent,
      authenticate: () => aNative.promise,
    });
    const attemptA = f.lifecycle.start(a.owner);
    await waitFor(() => a.authenticate.mock.calls.length === 1);
    await attemptA.cancel();
    await expect(attemptA.result).rejects.toMatchObject({ code: "cancelled" });
    aNative.resolve({ oidcToken: "late-a-token" });
    await flush();

    const deletion = deferred<void>();
    const b = ownerFixture({
      key: secondPublicKey,
      authenticate: async () => Promise.reject(new Error("adapter")),
    });
    b.discardKey.mockImplementation(() => deletion.promise);
    const attemptB = f.lifecycle.start(b.owner);
    await waitFor(() => b.discardKey.mock.calls.length === 1);
    const storageCalls = f.storage.events.length;
    const aCurrentCalls = aCurrent.mock.calls.length;
    await attemptA.retry();
    await attemptA.cancel();
    expect(f.storage.events).toHaveLength(storageCalls);
    expect(aCurrent).toHaveBeenCalledTimes(aCurrentCalls);
    expect(b.discardKey).toHaveBeenCalledTimes(1);
    deletion.resolve();
    await expect(attemptB.result).rejects.toMatchObject({
      code: "adapter-failed",
    });
  });

  it("keeps a retired recovery handle inert while B has pending key cleanup", async () => {
    const oldRecord = record("handoff_started", {
      operationId: "07".repeat(16),
    });
    const storage = storageFixture(serializeNativeRecord(oldRecord));
    const f = lifecycleFixture({ storage, idByte: 7 });
    const oldCurrent = jest.fn(() => true);
    const oldOwner = ownerFixture({ current: oldCurrent });
    const oldRecovery = f.lifecycle.recover(recoveryContext(oldOwner));
    await oldRecovery.result;

    const deletion = deferred<void>();
    const bCurrent = jest.fn(() => true);
    const b = ownerFixture({
      key: secondPublicKey,
      current: bCurrent,
      authenticate: async () => Promise.reject(new Error("adapter")),
    });
    b.discardKey.mockImplementation(() => deletion.promise);
    const attemptB = f.lifecycle.start(b.owner);
    await waitFor(() => b.discardKey.mock.calls.length === 1);
    expect(parseNativeRecord(storage.value()!).operationId).toBe(
      oldRecord.operationId,
    );
    const storageCalls = f.storage.events.length;
    const bCurrentCalls = bCurrent.mock.calls.length;
    const bCreateCalls = b.createKey.mock.calls.length;
    const bDiscardCalls = b.discardKey.mock.calls.length;
    await oldRecovery.retry();
    expect(f.storage.events).toHaveLength(storageCalls);
    expect(bCurrent).toHaveBeenCalledTimes(bCurrentCalls);
    expect(b.createKey).toHaveBeenCalledTimes(bCreateCalls);
    expect(b.discardKey).toHaveBeenCalledTimes(bDiscardCalls);
    deletion.resolve();
    await expect(attemptB.result).rejects.toMatchObject({
      code: "adapter-failed",
    });
  });

  it("deduplicates an acquired retry before release and leaves no stale queue entry", async () => {
    const f = lifecycleFixture({ idByte: 7 });
    const a = ownerFixture({
      authenticate: async () => Promise.reject(new Error("adapter")),
    });
    a.discardKey.mockRejectedValueOnce(new Error("first-delete"));
    const attemptA = f.lifecycle.start(a.owner);
    await expect(attemptA.result).rejects.toMatchObject({
      code: "recovery-required",
    });

    const deletion = deferred<void>();
    a.discardKey.mockImplementationOnce(() => deletion.promise);
    const firstRetry = attemptA.retry();
    const duplicateRetry = attemptA.retry();
    const deliverSavedContinuation = deferred<void>();
    const savedContinuation = firstRetry
      .then(() => deliverSavedContinuation.promise)
      .then(() => attemptA.retry());
    await waitFor(() => a.discardKey.mock.calls.length === 2);
    const blockedB = f.lifecycle.start(
      ownerFixture({ key: secondPublicKey }).owner,
    );
    await expect(blockedB.result).rejects.toMatchObject({ code: "busy" });
    expect(a.discardKey).toHaveBeenCalledTimes(2);

    deletion.resolve();
    await expect(firstRetry).resolves.toBeUndefined();
    await expect(duplicateRetry).resolves.toBeUndefined();
    expect(a.discardKey).toHaveBeenCalledTimes(2);

    const bNative = deferred<{ oidcToken: string }>();
    const bCurrent = jest.fn(() => true);
    const b = ownerFixture({
      key: secondPublicKey,
      current: bCurrent,
      authenticate: () => bNative.promise,
    });
    const attemptB = f.lifecycle.start(b.owner);
    await waitFor(() => b.authenticate.mock.calls.length === 1);
    const storageCalls = f.storage.events.length;
    const currentCalls = bCurrent.mock.calls.length;
    deliverSavedContinuation.resolve();
    await savedContinuation;
    await attemptA.cancel();
    expect(f.storage.events).toHaveLength(storageCalls);
    expect(a.discardKey).toHaveBeenCalledTimes(2);
    expect(bCurrent).toHaveBeenCalledTimes(currentCalls);
    const cancelB = attemptB.cancel();
    bNative.reject(new Error("late-b"));
    await cancelB;
    await expect(attemptB.result).rejects.toMatchObject({ code: "cancelled" });
  });

  it("keeps retired attempt and recovery handles inert during B metadata retirement", async () => {
    const storage = storageFixture(
      serializeNativeRecord(record("handoff_started")),
    );
    const f = lifecycleFixture({ storage, idByte: 1 });
    const recoveryOwner = ownerFixture();
    const oldRecovery = f.lifecycle.recover(recoveryContext(recoveryOwner));
    await oldRecovery.result;

    const a = ownerFixture();
    const oldAttempt = f.lifecycle.start(a.owner);
    await oldAttempt.result;

    const removal = deferred<void>();
    storage.adapter.remove = jest.fn(async () => {
      await removal.promise;
      storage.set(null);
    });
    const bCurrent = jest.fn(() => true);
    const b = ownerFixture({ key: secondPublicKey, current: bCurrent });
    const attemptB = f.lifecycle.start(b.owner);
    await waitFor(() => storagePhase(storage.value()) === "handoff_started");
    expect(storagePhase(storage.value())).toBe("handoff_started");
    const calls = f.storage.events.length;
    const bCurrentCalls = bCurrent.mock.calls.length;
    await oldAttempt.retry();
    await oldAttempt.cancel();
    await oldRecovery.retry();
    expect(f.storage.events).toHaveLength(calls);
    expect(bCurrent).toHaveBeenCalledTimes(bCurrentCalls);
    expect(b.discardKey).not.toHaveBeenCalled();
    removal.resolve();
    await attemptB.result;
    expect(storage.value()).toBeNull();
  });

  it("blocks B until failed metadata retirement is retried by A", async () => {
    const storage = storageFixture();
    const originalRemove = storage.adapter.remove;
    let failRemove = true;
    storage.adapter.remove = jest.fn(async () => {
      if (failRemove) throw new Error("retirement-sensitive-canary");
      return originalRemove();
    });
    const f = lifecycleFixture({ storage });
    const a = ownerFixture();
    const attemptA = f.lifecycle.start(a.owner);
    await expect(attemptA.result).rejects.toMatchObject({
      code: "recovery-required",
    });
    expect(a.discardKey).not.toHaveBeenCalled();
    const blocked = f.lifecycle.start(
      ownerFixture({ key: secondPublicKey }).owner,
    );
    await expect(blocked.result).rejects.toMatchObject({ code: "busy" });
    failRemove = false;
    await attemptA.retry();
    expect(storage.value()).toBeNull();
  });

  it("never calls injected enumeration or browser-storage capabilities", async () => {
    const storage = storageFixture(
      serializeNativeRecord(record("handoff_started", { createdAt: 0 })),
    );
    const listKeyPairs = jest.fn();
    const browserStorage = jest.fn();
    const dependencies = {
      storage: storage.adapter,
      now: () => Number.MAX_SAFE_INTEGER,
      randomBytes: (length: number) => new Uint8Array(length),
      listKeyPairs,
      browserStorage,
    };
    const lifecycle = createNativeOAuthLifecycleForTests(dependencies, {});
    const owner = ownerFixture();
    await lifecycle.recover(recoveryContext(owner)).result;
    expect(owner.discardKey).not.toHaveBeenCalled();
    expect(listKeyPairs).not.toHaveBeenCalled();
    expect(browserStorage).not.toHaveBeenCalled();
    expect(storage.value()).toBeNull();
  });

  it("runs the coordinator through the real fixed-slot Keychain adapter", async () => {
    const service = "com.0xkey.oauth.native.v1:nativeUI";
    const values = new Map<string, { username: string; password: string }>();
    const calls: string[] = [];
    const bridge: NativeOAuthKeychainModule = {
      async getGenericPassword({ service: selected }) {
        calls.push(`get:${selected}`);
        return values.get(selected) ?? false;
      },
      async setGenericPassword(username, password, { service: selected }) {
        calls.push(`set:${selected}:${username}`);
        values.set(selected, { username, password });
        return { service: selected };
      },
      async resetGenericPassword({ service: selected }) {
        calls.push(`reset:${selected}`);
        return values.delete(selected);
      },
    };
    const lifecycle = createNativeOAuthLifecycleForTests(
      {
        storage: createNativeOAuthKeychainStorage(bridge),
        now: () => 1_000,
        randomBytes: (length) => new Uint8Array(length).fill(9),
      },
      {},
    );
    const owner = ownerFixture();
    await lifecycle.start(owner.owner).result;
    expect(values.size).toBe(0);
    expect(calls.every((call) => call.includes(service))).toBe(true);
    expect(calls.some((call) => call.includes("0xkey-oauth-native-v1"))).toBe(
      true,
    );
    expect(owner.discardKey).not.toHaveBeenCalled();
  });

  it("reconciles applied native cleanup removal after its readback fails", async () => {
    const service = "com.0xkey.oauth.native.v1:nativeUI";
    const values = new Map<string, { username: string; password: string }>();
    let failNextRead = false;
    const bridge: NativeOAuthKeychainModule = {
      async getGenericPassword({ service: selected }) {
        if (failNextRead) {
          failNextRead = false;
          throw new Error("post-reset-read-sensitive-canary");
        }
        return values.get(selected) ?? false;
      },
      async setGenericPassword(username, password, { service: selected }) {
        values.set(selected, { username, password });
        return { service: selected };
      },
      async resetGenericPassword({ service: selected }) {
        values.delete(selected);
        failNextRead = true;
        return true;
      },
    };
    const lifecycle = createNativeOAuthLifecycleForTests(
      {
        storage: createNativeOAuthKeychainStorage(bridge),
        now: () => 1_000,
        randomBytes: (length) => new Uint8Array(length).fill(9),
      },
      {},
    );
    const owner = ownerFixture({
      authenticate: async () => Promise.reject(new Error("adapter")),
    });
    const attempt = lifecycle.start(owner.owner);
    await expect(attempt.result).rejects.toMatchObject({
      code: "recovery-required",
    });
    expect(values.has(service)).toBe(false);
    expect(owner.discardKey).toHaveBeenCalledTimes(1);

    await expect(attempt.retry()).resolves.toBeUndefined();
    expect(owner.discardKey).toHaveBeenCalledTimes(1);

    const next = lifecycle.start(
      ownerFixture({ ready: Promise.reject(new Error("next-not-ready")) })
        .owner,
    );
    await expect(next.result).rejects.toMatchObject({ code: "not-ready" });
  });

  it("contains a handoff readback fault through the real native adapter stack", async () => {
    const service = "com.0xkey.oauth.native.v1:nativeUI";
    const values = new Map<string, { username: string; password: string }>();
    let failNextRead = false;
    const bridge: NativeOAuthKeychainModule = {
      async getGenericPassword({ service: selected }) {
        if (failNextRead) {
          failNextRead = false;
          throw new Error("handoff-read-sensitive-canary");
        }
        return values.get(selected) ?? false;
      },
      async setGenericPassword(username, password, { service: selected }) {
        values.set(selected, { username, password });
        if (parseNativeRecord(password).phase === "handoff_started") {
          failNextRead = true;
        }
        return { service: selected };
      },
      async resetGenericPassword({ service: selected }) {
        return values.delete(selected);
      },
    };
    const lifecycle = createNativeOAuthLifecycleForTests(
      {
        storage: createNativeOAuthKeychainStorage(bridge),
        now: () => 1_000,
        randomBytes: (length) => new Uint8Array(length).fill(9),
      },
      {},
    );
    const owner = ownerFixture();
    const attempt = lifecycle.start(owner.owner);
    await expect(attempt.result).rejects.toMatchObject({
      code: "recovery-required",
    });
    expect(owner.complete).not.toHaveBeenCalled();
    expect(owner.discardKey).not.toHaveBeenCalled();
    expect(parseNativeRecord(values.get(service)!.password).phase).toBe(
      "handoff_started",
    );

    await expect(attempt.retry()).resolves.toBeUndefined();
    expect(values.has(service)).toBe(false);
    expect(owner.complete).not.toHaveBeenCalled();
    expect(owner.discardKey).not.toHaveBeenCalled();
  });

  it("documents the allocation-to-first-record restart gap without sweeping", async () => {
    const storage = storageFixture();
    storage.adapter.write = jest.fn(async () => {
      throw new Error("first-write-before-mutation-sensitive-canary");
    });
    const owner = ownerFixture();
    const first = lifecycleFixture({ storage });
    await expect(
      first.lifecycle.start(owner.owner).result,
    ).rejects.toMatchObject({
      code: "recovery-required",
    });
    expect(owner.keys).toEqual(new Set([publicKey]));
    expect(storage.value()).toBeNull();

    const afterRestart = lifecycleFixture({ storage, registry: {} });
    const recoveryOwner = ownerFixture();
    await afterRestart.lifecycle.recover(recoveryContext(recoveryOwner)).result;
    expect(recoveryOwner.discardKey).not.toHaveBeenCalled();
    expect(owner.keys).toEqual(new Set([publicKey]));
  });

  it("does not re-delete a warm key after deletion succeeded but removal failed", async () => {
    const storage = storageFixture();
    const originalRemove = storage.adapter.remove;
    let failRemove = true;
    storage.adapter.remove = jest.fn(async () => {
      if (failRemove)
        throw new Error("remove-before-mutation-sensitive-canary");
      return originalRemove();
    });
    const owner = ownerFixture({
      authenticate: async () => Promise.reject(new Error("adapter")),
    });
    const f = lifecycleFixture({ storage });
    const attempt = f.lifecycle.start(owner.owner);
    await expect(attempt.result).rejects.toMatchObject({
      code: "recovery-required",
    });
    expect(owner.discardKey).toHaveBeenCalledTimes(1);
    expect(owner.keys.has(publicKey)).toBe(false);
    failRemove = false;
    await attempt.retry();
    expect(owner.discardKey).toHaveBeenCalledTimes(1);
    expect(storage.value()).toBeNull();
  });

  it.each([
    [
      "wrong binding",
      serializeNativeRecord(
        record("awaiting_native", {
          binding: binding({ organizationId: "other-organization" }),
        }),
      ),
    ],
    [
      "newer version",
      JSON.stringify({ ...record("awaiting_native"), version: 2 }),
    ],
    ["malformed JSON", "sensitive-malformed-record-canary"],
    [
      "noncanonical schema",
      ` ${serializeNativeRecord(record("awaiting_native"))}`,
    ],
  ])("preserves a cold %s slot and blocks cleanup", async (_name, raw) => {
    const storage = storageFixture(raw);
    const owner = ownerFixture();
    owner.keys.add(publicKey);
    const recovery = lifecycleFixture({ storage }).lifecycle.recover(
      recoveryContext(owner),
    );
    const failure = await recovery.result.catch((error) => error);
    expect(failure).toMatchObject({
      code: "recovery-required",
      message: "Native OAuth recovery required",
    });
    expect(String(failure)).not.toContain("sensitive-malformed-record-canary");
    expect(owner.discardKey).not.toHaveBeenCalled();
    expect(storage.value()).toBe(raw);
  });

  it("treats absence after completed retirement as no future cleanup authority", async () => {
    const storage = storageFixture();
    const completedOwner = ownerFixture();
    await lifecycleFixture({ storage }).lifecycle.start(completedOwner.owner)
      .result;
    expect(completedOwner.keys).toEqual(new Set([publicKey]));
    expect(storage.value()).toBeNull();
    const afterRestart = lifecycleFixture({ storage, registry: {} });
    const recoveryOwner = ownerFixture();
    await afterRestart.lifecycle.recover(recoveryContext(recoveryOwner)).result;
    expect(recoveryOwner.discardKey).not.toHaveBeenCalled();
    expect(completedOwner.keys).toEqual(new Set([publicKey]));
  });
});

function storagePhase(raw: string | null): NativeRecord["phase"] | null {
  return raw === null ? null : parseNativeRecord(raw).phase;
}
