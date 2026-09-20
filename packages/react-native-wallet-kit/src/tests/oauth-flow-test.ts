import { describe, expect, it, jest } from "@jest/globals";
import {
  AuthAction,
  OAuthProviders,
  ZeroXKeyError,
  ZeroXKeyErrorCodes,
} from "@0xkey-io/sdk-types";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { completeOAuthFlow } from "../utils/oauth";
import { createOauthRoutingSnapshot } from "../utils/oauth-routing";
import {
  createOAuthFlowCoordinator,
  type BrowserResult,
  type OAuthFlowDependencies,
  type TrustedOauthFlow,
} from "../utils/oauth-flow";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
function fixture(
  provider = OAuthProviders.FACEBOOK,
  shared?: ReturnType<typeof storageFixture>,
) {
  const storage = shared ?? storageFixture();
  const keys = new Set<string>(["unrelated"]);
  let sequence = 0;
  let keySequence = 0;
  let pkceSequence = 0;
  let current = true;
  const launches: {
    url: string;
    target: string;
    result: ReturnType<typeof deferred<BrowserResult>>;
  }[] = [];
  const snapshot = createOauthRoutingSnapshot({
    organizationId: "org",
    apiBaseUrl: "https://api.example",
    authProxyUrl: "https://proxy.example",
    authProxyConfigId: "config",
    provider,
    completion: "internal",
    settings: {
      clientId: "client",
      appScheme: "app",
      redirectUri:
        provider === OAuthProviders.X || provider === OAuthProviders.DISCORD
          ? "direct://host/callback?tag=a%20b"
          : "https://relay.example?tag=a%20b",
    },
  });
  const exchange = jest.fn<TrustedOauthFlow["exchange"]>(
    async () => "exchanged-token",
  );
  const complete = jest.fn<TrustedOauthFlow["complete"]>(async () => {});
  const flow: TrustedOauthFlow = {
    snapshot,
    isCurrent: () => current,
    exchange,
    complete,
  };
  const deps: OAuthFlowDependencies = {
    secureStorage: storage.adapter,
    now: () => 1_000,
    randomBytes: (length) => new Uint8Array(length).fill(++sequence),
    isBrowserAvailable: async () => true,
    openAuth: async (url, target) => {
      const result = deferred<BrowserResult>();
      launches.push({ url, target, result });
      return result.promise;
    },
    generatePkce: async () => ({
      verifier: `verifier-${++pkceSequence}`,
      codeChallenge: `challenge-${pkceSequence}`,
    }),
    createApiKeyPair: async () => {
      const key = `key-${++keySequence}`;
      keys.add(key);
      return key;
    },
    discardUncommittedApiKeyPair: async (key) => {
      keys.delete(key);
    },
    getConfiguredFlows: () => [flow],
  };
  return {
    storage,
    keys,
    launches,
    flow,
    deps,
    exchange,
    complete,
    setCurrent: (value: boolean) => {
      current = value;
    },
  };
}
function storageFixture() {
  const records = new Map<string, string>();
  return {
    records,
    adapter: {
      get: jest.fn(async (key: string) => records.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        records.set(key, value);
      }),
      remove: jest.fn(async (key: string) => {
        records.delete(key);
      }),
    },
  };
}
function callback(
  launch: { url: string; target: string },
  fields: Record<string, string> = { code: "auth-code", id_token: "id-token" },
) {
  const result = new URL(launch.target);
  result.searchParams.set(
    "state",
    new URL(launch.url).searchParams.get("state")!,
  );
  for (const [name, value] of Object.entries(fields))
    result.searchParams.set(name, value);
  return result.toString();
}
function start(
  f: ReturnType<typeof fixture>,
  coordinator = createOAuthFlowCoordinator(f.deps),
  additionalState?: Record<string, string>,
) {
  const promise = coordinator.startBrowserOAuth({
    flow: f.flow,
    ...(additionalState === undefined ? {} : { additionalState }),
  });
  void promise.catch(() => {});
  return { coordinator, promise };
}
function restart(f: ReturnType<typeof fixture>, flow = f.flow) {
  // A new adapter identity simulates runtime loss; persisted bytes and keys survive.
  const adapter = { ...f.storage.adapter };
  return createOAuthFlowCoordinator({
    ...f.deps,
    secureStorage: adapter,
    getConfiguredFlows: () => [flow],
  });
}

describe("OAuth flow coordinator", () => {
  it.each(Object.values(OAuthProviders))(
    "owns one %s transaction through completion",
    async (provider) => {
      const f = fixture(provider);
      const sessionKey = "a=b&c+%雪";
      const run = start(f, undefined, { sessionKey, extension: "retained" });
      await flush();
      expect(f.launches).toHaveLength(1);
      const launch = f.launches[0]!;
      const state = new URL(launch.url).searchParams.get("state")!;
      const id = new URLSearchParams(state).get("transactionId");
      const pkce =
        provider !== OAuthProviders.GOOGLE && provider !== OAuthProviders.APPLE;
      expect(JSON.parse([...f.storage.records.values()][0]!)).toMatchObject({
        id,
        publicKey: "key-1",
        binding: f.flow.snapshot.binding,
        expectedState: state,
        ...(pkce ? { codeVerifier: "verifier-1" } : {}),
      });
      expect(launch.target).toBe(f.flow.snapshot.appReturnTarget);
      launch.result.resolve({
        type: "success",
        url: callback(launch, {
          code: "auth-code",
          id_token: "id-token",
          provider: "evil",
          publicKey: "evil",
          sessionKey: "evil",
        }),
      });
      await run.promise;
      expect(f.storage.records.size).toBe(0);
      expect(f.keys).toEqual(new Set(["unrelated", "key-1"]));
      expect(f.complete).toHaveBeenCalledWith({
        provider,
        publicKey: "key-1",
        oidcToken: pkce ? "exchanged-token" : "id-token",
        sessionKey,
      });
      if (pkce)
        expect(f.exchange).toHaveBeenCalledWith({
          snapshot: f.flow.snapshot,
          publicKey: "key-1",
          nonce: bytesToHex(sha256("key-1")),
          authCode: "auth-code",
          codeVerifier: "verifier-1",
        });
      else expect(f.exchange).not.toHaveBeenCalled();
    },
  );

  it.each(Object.values(OAuthProviders))(
    "disposes only consumed %s key if its required result is absent",
    async (provider) => {
      const f = fixture(provider);
      const run = start(f);
      await flush();
      expect(f.launches).toHaveLength(1);
      f.launches[0]!.result.resolve({
        type: "success",
        url: callback(f.launches[0]!, {}),
      });
      await expect(run.promise).rejects.toThrow("OAuth result invalid");
      expect(f.keys).toEqual(new Set(["unrelated"]));
      expect(f.storage.records.size).toBe(0);
      expect(f.complete).not.toHaveBeenCalled();
    },
  );

  it("keeps concurrent verifier/key pairs independent when browsers settle out of order", async () => {
    const f = fixture();
    const coordinator = createOAuthFlowCoordinator(f.deps);
    const a = start(f, coordinator, { sessionKey: "first" });
    await flush();
    const b = start(f, coordinator, { sessionKey: "second" });
    await flush();
    expect(f.launches).toHaveLength(2);
    f.launches[1]!.result.resolve({
      type: "success",
      url: callback(f.launches[1]!),
    });
    await b.promise;
    f.launches[0]!.result.resolve({
      type: "success",
      url: callback(f.launches[0]!),
    });
    await a.promise;
    expect(
      f.exchange.mock.calls.map(([input]) => [
        input.publicKey,
        input.codeVerifier,
      ]),
    ).toEqual([
      ["key-2", "verifier-2"],
      ["key-1", "verifier-1"],
    ]);
    expect(f.complete.mock.calls.map(([input]) => input.sessionKey)).toEqual([
      "second",
      "first",
    ]);
    expect(f.keys.size).toBe(3);
    expect(f.storage.records.size).toBe(0);
  });

  it.each([false, true])(
    "receiver delegates the entire equal-binding live capability (failure=%s)",
    async (failure) => {
      const a = fixture();
      const b = fixture(OAuthProviders.FACEBOOK, a.storage);
      const wait = deferred<string>();
      a.exchange.mockImplementation(() => wait.promise);
      const run = start(a);
      await flush();
      expect(a.launches).toHaveLength(1);
      const receiver = createOAuthFlowCoordinator(b.deps);
      const delivery = receiver.handleOAuthCallbackUrl(
        callback(a.launches[0]!),
      );
      void delivery.catch(() => {});
      await flush();
      a.launches[0]!.result.resolve({ type: "cancel" });
      await flush();
      expect(a.storage.records.size).toBe(0);
      expect(a.keys.has("key-1")).toBe(true);
      if (failure) wait.reject(new Error("sensitive"));
      else wait.resolve("owner-token");
      if (failure) {
        await expect(delivery).rejects.toThrow("OAuth exchange failed");
        await expect(run.promise).rejects.toThrow("OAuth exchange failed");
      } else {
        await expect(delivery).resolves.toBe("completed");
        await run.promise;
      }
      expect(b.exchange).not.toHaveBeenCalled();
      expect(b.complete).not.toHaveBeenCalled();
      expect(a.complete).toHaveBeenCalledTimes(failure ? 0 : 1);
      expect(a.keys.has("key-1")).toBe(!failure);
      expect(b.keys).toEqual(new Set(["unrelated"]));
    },
  );

  it("joins Linking duplicates and ignores replay after warm release", async () => {
    const f = fixture();
    const run = start(f);
    await flush();
    expect(f.launches).toHaveLength(1);
    const url = callback(f.launches[0]!);
    const deliveries = [
      run.coordinator.handleOAuthCallbackUrl(url),
      createOAuthFlowCoordinator(f.deps).handleOAuthCallbackUrl(url),
    ];
    await expect(Promise.all(deliveries)).resolves.toEqual([
      "completed",
      "completed",
    ]);
    f.launches[0]!.result.resolve({ type: "cancel" });
    await run.promise;
    await expect(run.coordinator.handleOAuthCallbackUrl(url)).resolves.toBe(
      "ignored",
    );
    expect(f.exchange).toHaveBeenCalledTimes(1);
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(f.keys.size).toBe(2);
  });

  it("warm success joins an already settled Linking completion only for the accepted state", async () => {
    const f = fixture();
    const run = start(f);
    await flush();
    const url = callback(f.launches[0]!);
    await expect(run.coordinator.handleOAuthCallbackUrl(url)).resolves.toBe(
      "completed",
    );
    f.launches[0]!.result.resolve({ type: "success", url });
    await run.promise;
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(f.keys.size).toBe(2);
  });

  it("stale warm context cancels its pending operation without handing off", async () => {
    const f = fixture();
    const run = start(f);
    await flush();
    f.setCurrent(false);
    f.launches[0]!.result.resolve({
      type: "success",
      url: callback(f.launches[0]!),
    });
    await expect(run.promise).rejects.toThrow("OAuth context changed");
    expect(f.keys).toEqual(new Set(["unrelated"]));
    expect(f.storage.records.size).toBe(0);
  });

  it("copies PKCE primitives before an asynchronous key allocation", async () => {
    const f = fixture();
    const pair = {
      verifier: "original-verifier",
      codeChallenge: "original-challenge",
    };
    const keyReady = deferred<string>();
    f.deps.generatePkce = async () => pair;
    f.deps.createApiKeyPair = () => keyReady.promise;
    const run = start(f);
    await flush();
    pair.verifier = "mutated";
    pair.codeChallenge = "mutated";
    f.keys.add("key-1");
    keyReady.resolve("key-1");
    await flush();
    expect(JSON.parse([...f.storage.records.values()][0]!).codeVerifier).toBe(
      "original-verifier",
    );
    expect(new URL(f.launches[0]!.url).searchParams.get("codeChallenge")).toBe(
      "original-challenge",
    );
    f.launches[0]!.result.resolve({
      type: "success",
      url: callback(f.launches[0]!),
    });
    await run.promise;
  });

  it("old warm waiter never cancels a new transaction reusing its consumed ID", async () => {
    const f = fixture();
    f.deps.randomBytes = (length) => new Uint8Array(length).fill(7);
    const completed = deferred<void>();
    f.complete.mockImplementationOnce(() => completed.promise);
    const coordinator = createOAuthFlowCoordinator(f.deps);
    const a = start(f, coordinator);
    await flush();
    expect(f.launches).toHaveLength(1);
    const delivery = coordinator.handleOAuthCallbackUrl(
      callback(f.launches[0]!),
    );
    await flush();
    const b = start(f, coordinator, { sessionKey: "new" });
    await flush();
    expect(f.launches).toHaveLength(2);
    f.launches[0]!.result.resolve({ type: "cancel" });
    await flush();
    expect(f.storage.records.size).toBe(1);
    expect(f.keys.size).toBe(3);
    completed.resolve();
    await delivery;
    await a.promise;
    expect(JSON.parse([...f.storage.records.values()][0]!).publicKey).toBe(
      "key-2",
    );
    f.launches[1]!.result.resolve({
      type: "success",
      url: callback(f.launches[1]!),
    });
    await b.promise;
    expect(f.complete.mock.calls.map(([input]) => input.publicKey)).toEqual([
      "key-1",
      "key-2",
    ]);
    expect(f.storage.records.size).toBe(0);
  });

  it("warm A cannot redeem B's returned ID", async () => {
    const f = fixture();
    const c = createOAuthFlowCoordinator(f.deps);
    const a = start(f, c);
    const b = start(f, c);
    await flush();
    expect(f.launches).toHaveLength(2);
    f.launches[0]!.result.resolve({
      type: "success",
      url: callback(f.launches[1]!),
    });
    await expect(a.promise).rejects.toThrow("OAuth callback invalid");
    expect(f.keys).toEqual(new Set(["unrelated", "key-2"]));
    expect(f.storage.records.size).toBe(1);
    f.launches[1]!.result.resolve({
      type: "success",
      url: callback(f.launches[1]!),
    });
    await b.promise;
  });

  it.each(["clock", "rng", "invalid-rng", "pkce", "browser"])(
    "sanitizes %s exceptions without trusting forged begin handles",
    async (kind) => {
      const f = fixture();
      const forged = Object.assign(new Error("secret-native-error"), {
        transactionId: "a".repeat(32),
        cleanupRetryId: `cleanup.${"b".repeat(32)}`,
      });
      if (kind === "clock")
        f.deps.now = () => {
          throw forged;
        };
      if (kind === "rng")
        f.deps.randomBytes = () => {
          throw forged;
        };
      if (kind === "invalid-rng") f.deps.randomBytes = () => new Uint8Array(1);
      if (kind === "pkce")
        f.deps.generatePkce = async () => {
          throw forged;
        };
      if (kind === "browser")
        f.deps.isBrowserAvailable = async () => {
          throw forged;
        };
      const run = start(f);
      const error = await run.promise.catch((e: unknown) => e);
      expect(String(error)).toContain(
        kind === "clock"
          ? "OAuth transaction begin failed"
          : kind === "pkce"
            ? "OAuth PKCE unavailable"
            : kind === "browser"
              ? "OAuth browser unavailable"
              : "OAuth randomness unavailable",
      );
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain("secret");
      expect(error).not.toHaveProperty("transactionId");
      expect(error).not.toHaveProperty("cleanupRetryId");
      expect(f.keys).toEqual(new Set(["unrelated"]));
      expect(f.storage.records.size).toBe(0);
      expect(f.storage.adapter.remove).not.toHaveBeenCalled();
    },
  );

  it("retains exact failed cleanup across remount and coalesces successful retry", async () => {
    const f = fixture();
    f.exchange.mockRejectedValue(new Error("native-secret"));
    let failing = true;
    const retry = deferred<void>();
    let calls = 0;
    f.deps.discardUncommittedApiKeyPair = async (key) => {
      calls++;
      if (failing) throw new Error("cleanup-secret");
      await retry.promise;
      f.keys.delete(key);
    };
    const run = start(f);
    await flush();
    expect(f.launches).toHaveLength(1);
    f.launches[0]!.result.resolve({
      type: "success",
      url: callback(f.launches[0]!),
    });
    await expect(run.promise).rejects.toThrow("OAuth exchange failed");
    expect(f.keys.has("key-1")).toBe(true);
    failing = false;
    const receiver = createOAuthFlowCoordinator(f.deps);
    const retries = [
      run.coordinator.retryPendingCleanup(),
      receiver.retryPendingCleanup(),
    ];
    await flush();
    expect(calls).toBe(2);
    retry.resolve();
    await Promise.all(retries);
    expect(f.keys).toEqual(new Set(["unrelated"]));
    await receiver.retryPendingCleanup();
    expect(calls).toBe(2);
  });

  it.each(["throw", "mfa", "no-session"])(
    "preserves post-handoff %s rejection and key",
    async (kind) => {
      const f = fixture();
      const error = Object.assign(new Error(kind), {
        code: "MFA_REQUIRED",
        transactionId: "a".repeat(32),
      });
      f.complete.mockImplementation(() => {
        throw error;
      });
      const run = start(f);
      await flush();
      expect(f.launches).toHaveLength(1);
      f.launches[0]!.result.resolve({
        type: "success",
        url: callback(f.launches[0]!),
      });
      await expect(run.promise).rejects.toBe(error);
      await run.coordinator.retryPendingCleanup();
      expect(f.keys.size).toBe(2);
      expect(f.storage.records.size).toBe(0);
    },
  );

  it("configuration change during exchange disposes consumed key before handoff", async () => {
    const f = fixture();
    const exchanged = deferred<string>();
    f.exchange.mockImplementation(() => exchanged.promise);
    const run = start(f);
    await flush();
    expect(f.launches).toHaveLength(1);
    f.launches[0]!.result.resolve({
      type: "success",
      url: callback(f.launches[0]!),
    });
    await flush();
    f.setCurrent(false);
    exchanged.resolve("token");
    await expect(run.promise).rejects.toThrow("OAuth context changed");
    expect(f.keys).toEqual(new Set(["unrelated"]));
    expect(f.complete).not.toHaveBeenCalled();
  });

  it.each([
    "wrong-route",
    "duplicate-state",
    "error-only",
    "fragment",
    "malformed",
  ])("cold %s callback cannot cancel pending key", async (kind) => {
    const f = fixture();
    const run = start(f);
    await flush();
    expect(f.launches).toHaveLength(1);
    let url = callback(f.launches[0]!);
    if (kind === "wrong-route") url = url.replace("app://", "alien://");
    if (kind === "duplicate-state") url += "&state=x";
    if (kind === "error-only") url = "app://?error=secret";
    if (kind === "fragment") url += "#code=secret";
    if (kind === "malformed") url += "&code=%ZZ";
    const result = run.coordinator.handleOAuthCallbackUrl(url);
    if (kind === "wrong-route") await expect(result).resolves.toBe("ignored");
    else await expect(result).rejects.toThrow("OAuth callback invalid");
    expect(f.keys.size).toBe(2);
    expect(f.storage.records.size).toBe(1);
    expect(f.exchange).not.toHaveBeenCalled();
    f.launches[0]!.result.resolve({
      type: "success",
      url: callback(f.launches[0]!),
    });
    await run.promise;
  });

  it.each(Object.values(OAuthProviders))(
    "cold restart redeems original %s key and per-transaction verifier",
    async (provider) => {
      const f = fixture(provider);
      start(f);
      await flush();
      const c = restart(f);
      const url = callback(f.launches[0]!);
      await expect(c.handleOAuthCallbackUrl(url)).resolves.toBe("completed");
      expect(f.keys).toEqual(new Set(["unrelated", "key-1"]));
      expect(f.storage.records.size).toBe(0);
      expect(f.complete.mock.calls[0]![0].publicKey).toBe("key-1");
      if (
        provider !== OAuthProviders.GOOGLE &&
        provider !== OAuthProviders.APPLE
      )
        expect(f.exchange.mock.calls[0]![0].codeVerifier).toBe("verifier-1");
      await expect(c.handleOAuthCallbackUrl(url)).resolves.toBe("ignored");
      expect(f.complete).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    "config",
    "provider",
    "client",
    "api",
    "proxy",
    "org",
    "completion",
  ])(
    "cold changed %s binding leaves foreign pending bytes and key intact",
    async (change) => {
      const f = fixture();
      start(f);
      await flush();
      const s = f.flow.snapshot;
      const changed = createOauthRoutingSnapshot({
        organizationId: change === "org" ? "other" : s.organizationId,
        apiBaseUrl: change === "api" ? "https://other.example" : s.apiBaseUrl,
        authProxyUrl:
          change === "proxy" ? "https://other.example" : s.authProxyUrl,
        authProxyConfigId: change === "config" ? "other" : "config",
        provider: change === "provider" ? OAuthProviders.GOOGLE : s.provider,
        completion: change === "completion" ? "onOauthSuccess" : s.completion,
        settings: {
          clientId: change === "client" ? "other" : s.clientId,
          redirectUri: s.providerRedirectUri,
          appScheme: s.appScheme,
        },
      });
      const c = restart(f, { ...f.flow, snapshot: changed });
      const before = [...f.storage.records.entries()];
      await expect(
        c.handleOAuthCallbackUrl(callback(f.launches[0]!)),
      ).resolves.toBe("ignored");
      expect([...f.storage.records.entries()]).toEqual(before);
      expect(f.keys.size).toBe(2);
      expect(f.complete).not.toHaveBeenCalled();
    },
  );

  it("stale live owner cannot be replaced by a matching receiver", async () => {
    const a = fixture();
    const b = fixture(OAuthProviders.FACEBOOK, a.storage);
    const run = start(a);
    await flush();
    a.setCurrent(false);
    await expect(
      createOAuthFlowCoordinator(b.deps).handleOAuthCallbackUrl(
        callback(a.launches[0]!),
      ),
    ).resolves.toBe("ignored");
    expect(a.storage.records.size).toBe(1);
    expect(a.keys.size).toBe(2);
    expect(b.complete).not.toHaveBeenCalled();
    a.launches[0]!.result.resolve({ type: "cancel" });
    await expect(run.promise).rejects.toThrow("OAuth browser cancelled");
    expect(a.keys.size).toBe(1);
  });

  it("route validation precedes metadata lookup even with malformed state", async () => {
    const f = fixture();
    const c = createOAuthFlowCoordinator(f.deps);
    await expect(c.handleOAuthCallbackUrl("evil://?state=%ZZ")).resolves.toBe(
      "ignored",
    );
    expect(f.storage.adapter.get).not.toHaveBeenCalled();
    expect(f.keys.size).toBe(1);
  });

  it.each(["read", "remove"])(
    "consume %s failure never grants local disposal ownership",
    async (point) => {
      const f = fixture();
      const run = start(f);
      await flush();
      const before = [...f.storage.records.entries()];
      if (point === "read")
        f.storage.adapter.get.mockRejectedValueOnce(new Error("secret"));
      else f.storage.adapter.remove.mockRejectedValueOnce(new Error("secret"));
      f.launches[0]!.result.resolve({
        type: "success",
        url: callback(f.launches[0]!),
      });
      await expect(run.promise).rejects.toThrow(
        "OAuth transaction unavailable",
      );
      expect(f.keys.size).toBe(2);
      expect([...f.storage.records.entries()]).toEqual(before);
      expect(f.complete).not.toHaveBeenCalled();
      await expect(
        run.coordinator.handleOAuthCallbackUrl(callback(f.launches[0]!)),
      ).resolves.toBe("completed");
    },
  );

  it("consume admitted before deferred removal wins against browser cancellation", async () => {
    const f = fixture();
    const run = start(f);
    await flush();
    const removed = deferred<void>();
    f.storage.adapter.remove.mockImplementationOnce(async (key) => {
      await removed.promise;
      f.storage.records.delete(key);
    });
    const delivery = run.coordinator.handleOAuthCallbackUrl(
      callback(f.launches[0]!),
    );
    await flush();
    f.launches[0]!.result.resolve({ type: "cancel" });
    await flush();
    expect(f.keys.size).toBe(2);
    expect(f.storage.records.size).toBe(1);
    removed.resolve();
    await expect(delivery).resolves.toBe("completed");
    await run.promise;
    expect(f.keys.size).toBe(2);
    expect(f.complete).toHaveBeenCalledTimes(1);
  });

  it("cancel admitted before deferred cleanup prevents later redemption", async () => {
    const f = fixture();
    const disposed = deferred<void>();
    f.deps.discardUncommittedApiKeyPair = async (key) => {
      await disposed.promise;
      f.keys.delete(key);
    };
    const run = start(f);
    await flush();
    f.launches[0]!.result.resolve({ type: "cancel" });
    await flush();
    await expect(
      run.coordinator.handleOAuthCallbackUrl(callback(f.launches[0]!)),
    ).resolves.toBe("ignored");
    expect(f.complete).not.toHaveBeenCalled();
    disposed.resolve();
    await expect(run.promise).rejects.toThrow("OAuth browser cancelled");
    expect(f.keys.size).toBe(1);
    expect(f.storage.records.size).toBe(0);
  });

  it.each(["read", "write", "write-after"])(
    "no-handle begin %s failure idempotently discards only its fresh key",
    async (point) => {
      const f = fixture();
      const discards: string[] = [];
      f.deps.discardUncommittedApiKeyPair = async (key) => {
        discards.push(key);
        f.keys.delete(key);
      };
      if (point === "read")
        f.storage.adapter.get.mockRejectedValueOnce(new Error("secret"));
      else
        f.storage.adapter.set.mockImplementationOnce(async (key, value) => {
          if (point === "write-after") f.storage.records.set(key, value);
          throw new Error("secret");
        });
      const run = start(f);
      await expect(run.promise).rejects.toThrow(
        "OAuth transaction begin failed",
      );
      expect(discards).toEqual(["key-1", "key-1"]);
      expect(f.keys.size).toBe(1);
      expect(f.storage.records.size).toBe(0);
      await run.coordinator.retryPendingCleanup();
      expect(discards).toHaveLength(2);
    },
  );

  it.each(["read", "write"])(
    "begin %s handle retains store cleanup without independent discard and clears on success",
    async (point) => {
      const f = fixture();
      let failing = true;
      const discards: string[] = [];
      f.deps.discardUncommittedApiKeyPair = async (key) => {
        discards.push(key);
        if (failing) throw new Error("secret");
        f.keys.delete(key);
      };
      if (point === "read")
        f.storage.adapter.get.mockRejectedValueOnce(new Error("secret"));
      else f.storage.adapter.set.mockRejectedValueOnce(new Error("secret"));
      const run = start(f);
      await expect(run.promise).rejects.toThrow(
        "OAuth transaction begin failed",
      );
      expect(discards).toEqual(["key-1"]);
      expect(f.keys.size).toBe(2);
      await expect(run.coordinator.retryPendingCleanup()).rejects.toThrow(
        "OAuth cleanup failed",
      );
      expect(f.keys.size).toBe(2);
      failing = false;
      await createOAuthFlowCoordinator(f.deps).retryPendingCleanup();
      expect(f.keys.size).toBe(1);
      expect(f.storage.records.size).toBe(0);
      await run.coordinator.retryPendingCleanup();
      expect(discards).toHaveLength(3);
    },
  );

  it("collision retries launch only the winning ID and exhaustion releases only the new key", async () => {
    const f = fixture();
    f.deps.randomBytes = (length) => new Uint8Array(length).fill(9);
    const c = createOAuthFlowCoordinator(f.deps);
    const a = start(f, c);
    await flush();
    const before = [...f.storage.records.entries()];
    const b = start(f, c);
    await expect(b.promise).rejects.toThrow("OAuth transaction begin failed");
    expect(f.keys).toEqual(new Set(["unrelated", "key-1"]));
    expect([...f.storage.records.entries()]).toEqual(before);
    expect(f.launches).toHaveLength(1);
    f.launches[0]!.result.resolve({
      type: "success",
      url: callback(f.launches[0]!),
    });
    await a.promise;
  });

  it.each([OAuthProviders.GOOGLE, OAuthProviders.APPLE])(
    "requires RNG even for %s before key creation",
    async (provider) => {
      const f = fixture(provider);
      f.deps.randomBytes = () => {
        throw new Error("unavailable");
      };
      const run = start(f);
      await expect(run.promise).rejects.toThrow("OAuth randomness unavailable");
      expect(f.keys.size).toBe(1);
      expect(f.launches).toHaveLength(0);
    },
  );

  it("additionalState is captured before awaiting browser availability", async () => {
    const f = fixture();
    const available = deferred<boolean>();
    f.deps.isBrowserAvailable = () => available.promise;
    const additionalState = { sessionKey: "original=雪", extension: "a&b" };
    const run = start(f, undefined, additionalState);
    additionalState.sessionKey = "changed";
    available.resolve(true);
    await flush();
    f.launches[0]!.result.resolve({
      type: "success",
      url: callback(f.launches[0]!),
    });
    await run.promise;
    expect(f.complete.mock.calls[0]![0].sessionKey).toBe("original=雪");
  });

  it.each(["transactionId", "publicKey", "provider", "flow", "nonce"])(
    "reserved additional state %s rejects before fresh allocation",
    async (field) => {
      const f = fixture();
      const run = start(f, undefined, { [field]: "evil" });
      await expect(run.promise).rejects.toThrow(
        "OAuth additional state invalid",
      );
      expect(f.keys.size).toBe(1);
      expect(f.storage.records.size).toBe(0);
    },
  );

  it("mismatched state cannot join an already consumed operation", async () => {
    const f = fixture();
    const finish = deferred<void>();
    f.complete.mockImplementation(() => finish.promise);
    const run = start(f);
    await flush();
    const url = callback(f.launches[0]!);
    const delivery = run.coordinator.handleOAuthCallbackUrl(url);
    await flush();
    const changed = new URL(url);
    changed.searchParams.set(
      "state",
      changed.searchParams.get("state")! + "&extra=evil",
    );
    await expect(
      run.coordinator.handleOAuthCallbackUrl(changed.toString()),
    ).rejects.toThrow("OAuth callback invalid");
    expect(f.keys.size).toBe(2);
    finish.resolve();
    await delivery;
    f.launches[0]!.result.resolve({ type: "cancel" });
    await run.promise;
  });

  it("exact-context state mismatch follows store invalidation without independent disposal", async () => {
    const f = fixture();
    const run = start(f);
    await flush();
    const url = new URL(callback(f.launches[0]!));
    url.searchParams.set(
      "state",
      url.searchParams.get("state")! + "&extra=mismatch",
    );
    await expect(
      run.coordinator.handleOAuthCallbackUrl(url.toString()),
    ).rejects.toThrow("OAuth transaction unavailable");
    expect(f.keys.size).toBe(1);
    expect(f.storage.records.size).toBe(0);
    expect(f.exchange).not.toHaveBeenCalled();
    f.launches[0]!.result.resolve({ type: "cancel" });
    await expect(run.promise).rejects.toThrow("OAuth transaction unavailable");
  });

  it("sanitizes browser result getter failures and cancels only the held transaction", async () => {
    const f = fixture();
    const run = start(f);
    await flush();
    f.launches[0]!.result.resolve({
      get type(): string {
        throw new Error("native-secret");
      },
    });
    await expect(run.promise).rejects.toThrow("OAuth browser failed");
    expect(f.keys.size).toBe(1);
    expect(f.storage.records.size).toBe(0);
  });

  it("registers original ownership before a callback delivered during begin persistence can dispatch", async () => {
    const a = fixture();
    const b = fixture(OAuthProviders.FACEBOOK, a.storage);
    const c = createOAuthFlowCoordinator(b.deps);
    let delivery: Promise<unknown> | undefined;
    a.storage.adapter.set.mockImplementationOnce(async (key, value) => {
      a.storage.records.set(key, value);
      const record = JSON.parse(value);
      delivery = c.handleOAuthCallbackUrl(
        `app://?code=early-code&state=${encodeURIComponent(record.expectedState)}`,
      );
      void delivery.catch(() => {});
    });
    const run = start(a);
    await flush();
    await delivery;
    expect(a.complete).toHaveBeenCalledTimes(1);
    expect(b.complete).not.toHaveBeenCalled();
    expect(b.exchange).not.toHaveBeenCalled();
    a.launches[0]!.result.resolve({ type: "cancel" });
    await run.promise;
    expect(a.keys.size).toBe(2);
  });

  it("preserves the SDK error instance returned by the existing completion adapter", async () => {
    const f = fixture();
    const error = new ZeroXKeyError(
      "Pending continuation",
      ZeroXKeyErrorCodes.OAUTH_LOGIN_ERROR,
      { status: "ACTIVITY_STATUS_REQUIRES_ADDITIONAL_AUTH" },
    );
    f.complete.mockImplementation((input) =>
      completeOAuthFlow({
        ...input,
        completeOauth: async () => {
          throw error;
        },
      }),
    );
    const run = start(f);
    await flush();
    f.launches[0]!.result.resolve({
      type: "success",
      url: callback(f.launches[0]!),
    });
    await expect(run.promise).rejects.toBe(error);
    expect(f.keys.size).toBe(2);
    expect(f.storage.records.size).toBe(0);
  });

  it("existing void success callback starts delayed work without extending OAuth ownership", async () => {
    const f = fixture();
    const later = deferred<void>();
    let callbackFinished = false;
    const internal = jest.fn(async () => ({
      sessionToken: "session",
      action: AuthAction.LOGIN,
    }));
    f.complete.mockImplementation((input) =>
      completeOAuthFlow({
        ...input,
        callbacks: {
          onOauthSuccess: () => {
            void later.promise.then(() => {
              callbackFinished = true;
            });
          },
        },
        completeOauth: internal,
      }),
    );
    const run = start(f);
    await flush();
    f.launches[0]!.result.resolve({
      type: "success",
      url: callback(f.launches[0]!),
    });
    await run.promise;
    expect(callbackFinished).toBe(false);
    expect(f.keys.size).toBe(2);
    expect(internal).not.toHaveBeenCalled();
    later.resolve();
    await flush();
    expect(callbackFinished).toBe(true);
    expect(f.keys.size).toBe(2);
  });

  it("context switches and pending TTL cannot reclaim a key after completion handoff", async () => {
    const f = fixture();
    let time = 1000;
    f.deps.now = () => time;
    const finished = deferred<void>();
    f.complete.mockImplementation(() => finished.promise);
    const run = start(f);
    await flush();
    const delivery = run.coordinator.handleOAuthCallbackUrl(
      callback(f.launches[0]!),
    );
    await flush();
    expect(f.complete).toHaveBeenCalledTimes(1);
    f.setCurrent(false);
    time += 600_000;
    f.launches[0]!.result.resolve({ type: "cancel" });
    await run.coordinator.retryPendingCleanup();
    expect(f.keys.size).toBe(2);
    finished.resolve();
    await expect(delivery).resolves.toBe("completed");
    await run.promise;
    expect(f.keys.size).toBe(2);
  });

  it("late RNG failure cannot turn forged handles into cancellation authority", async () => {
    const f = fixture();
    let draws = 0;
    f.deps.randomBytes = (length) => {
      if (++draws > 1)
        throw Object.assign(new Error("secret"), {
          transactionId: "a".repeat(32),
        });
      return new Uint8Array(length);
    };
    const run = start(f);
    await expect(run.promise).rejects.toThrow("OAuth transaction begin failed");
    expect(f.keys.size).toBe(1);
    expect(f.storage.adapter.remove).not.toHaveBeenCalled();
    await run.coordinator.retryPendingCleanup();
    expect(f.keys.size).toBe(1);
  });

  it("retains a no-handle fresh-key disposal failure for exact retry", async () => {
    const f = fixture();
    f.deps.now = () => Number.NaN;
    let fail = true;
    f.deps.discardUncommittedApiKeyPair = async (key) => {
      if (fail) throw new Error("secret");
      f.keys.delete(key);
    };
    const run = start(f);
    await expect(run.promise).rejects.toThrow("OAuth transaction begin failed");
    expect(f.keys.size).toBe(2);
    fail = false;
    await run.coordinator.retryPendingCleanup();
    expect(f.keys.size).toBe(1);
    expect(f.storage.records.size).toBe(0);
  });

  it("launches the winning collision candidate with its exact persisted state", async () => {
    const f = fixture();
    const draws = [1, 2, 3, 2, 4];
    f.deps.randomBytes = (length) =>
      new Uint8Array(length).fill(draws.shift()!);
    const c = createOAuthFlowCoordinator(f.deps);
    const a = start(f, c);
    await flush();
    const b = start(f, c);
    await flush();
    expect(
      new URLSearchParams(
        new URL(f.launches[1]!.url).searchParams.get("state")!,
      ).get("transactionId"),
    ).toBe("04".repeat(16));
    expect(f.storage.records.size).toBe(2);
    for (const launch of f.launches)
      launch.result.resolve({ type: "success", url: callback(launch) });
    await Promise.all([a.promise, b.promise]);
    expect(f.keys.size).toBe(3);
  });

  it("failed cancellation read retains admission authority until exact cleanup succeeds and cannot delete a reused ID", async () => {
    const f = fixture();
    f.deps.randomBytes = (length) => new Uint8Array(length).fill(7);
    const coordinator = createOAuthFlowCoordinator(f.deps);
    const receiver = createOAuthFlowCoordinator(f.deps);
    const a = start(f, coordinator);
    await flush();
    const aUrl = callback(f.launches[0]!);
    const before = [...f.storage.records.entries()];
    f.storage.adapter.get.mockRejectedValueOnce(new Error("read-secret"));
    f.launches[0]!.result.resolve({ type: "cancel" });
    await expect(a.promise).rejects.toThrow("OAuth browser cancelled");
    expect([...f.storage.records.entries()]).toEqual(before);
    expect(f.keys).toEqual(new Set(["unrelated", "key-1"]));

    await expect(receiver.handleOAuthCallbackUrl(aUrl)).resolves.toBe(
      "ignored",
    );
    expect(f.exchange).not.toHaveBeenCalled();
    expect(f.complete).not.toHaveBeenCalled();
    expect([...f.storage.records.entries()]).toEqual(before);

    const readReady = deferred<void>();
    f.storage.adapter.get.mockImplementationOnce(async (key) => {
      await readReady.promise;
      return f.storage.records.get(key) ?? null;
    });
    const readsBeforeRetry = f.storage.adapter.get.mock.calls.length;
    const retries = [
      coordinator.retryPendingCleanup(),
      receiver.retryPendingCleanup(),
    ];
    await flush();
    expect(f.storage.adapter.get.mock.calls.length).toBe(readsBeforeRetry + 1);
    await expect(receiver.handleOAuthCallbackUrl(aUrl)).resolves.toBe(
      "ignored",
    );
    expect(f.keys.has("key-1")).toBe(true);
    readReady.resolve();
    await Promise.all(retries);
    expect(f.keys).toEqual(new Set(["unrelated"]));
    expect(f.storage.records.size).toBe(0);

    const c = start(f, coordinator, { sessionKey: "replacement" });
    await flush();
    expect(f.launches).toHaveLength(2);
    const replacement = [...f.storage.records.entries()];
    expect(replacement[0]![0]).toBe(before[0]![0]);
    expect(JSON.parse(replacement[0]![1]).publicKey).toBe("key-2");
    await Promise.all([
      coordinator.retryPendingCleanup(),
      receiver.retryPendingCleanup(),
    ]);
    expect([...f.storage.records.entries()]).toEqual(replacement);
    expect(f.keys).toEqual(new Set(["unrelated", "key-2"]));
    f.launches[1]!.result.resolve({
      type: "success",
      url: callback(f.launches[1]!),
    });
    await c.promise;
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(f.complete.mock.calls[0]![0].publicKey).toBe("key-2");
    expect(f.storage.records.size).toBe(0);
    expect(f.keys).toEqual(new Set(["unrelated", "key-2"]));
  });
});
