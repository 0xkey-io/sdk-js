import { describe, expect, it } from "@jest/globals";
import { OAuthProviders } from "@0xkey-io/sdk-types";
import {
  createOAuthTransactionStore,
  type BeginOAuthTransactionInput,
  type OAuthTransactionSecureStorage,
} from "../utils/oauth-transaction";

class MemoryStorage implements OAuthTransactionSecureStorage {
  readonly values = new Map<string, string>();
  failSet = false;
  failSetAfterWrite = false;
  failGet = false;
  failRemove = false;
  deferRemove = false;
  removeStarted: Promise<void> = Promise.resolve();
  private signalRemoveStarted: (() => void) | undefined;
  private releaseRemove: (() => void) | undefined;

  constructor() {
    this.resetRemoveSignal();
  }

  async get(key: string): Promise<string | null> {
    if (this.failGet) throw new Error("storage get included-secret");
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    if (this.failSet) throw new Error("storage set included-secret");
    this.values.set(key, value);
    if (this.failSetAfterWrite) {
      throw new Error("storage set-after-write included-secret");
    }
  }

  async remove(key: string): Promise<void> {
    this.signalRemoveStarted?.();
    if (this.deferRemove) {
      await new Promise<void>((resolve) => {
        this.releaseRemove = resolve;
      });
    }
    if (this.failRemove) throw new Error("storage remove included-secret");
    this.values.delete(key);
  }

  releaseDeferredRemove(): void {
    this.releaseRemove?.();
    this.deferRemove = false;
    this.resetRemoveSignal();
  }

  private resetRemoveSignal(): void {
    this.removeStarted = new Promise<void>((resolve) => {
      this.signalRemoveStarted = resolve;
    });
  }
}

function randomSource(...bytes: number[][]): () => Uint8Array {
  let index = 0;
  return () => Uint8Array.from(bytes[index++] ?? bytes[bytes.length - 1]!);
}

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    configId: "config-1",
    provider: OAuthProviders.GOOGLE,
    binding: "routing-1",
    publicKey: "public-key-1",
    expectedState: "provider=google&nonce=state-1",
    codeVerifier: "verifier-secret-1",
    ...overrides,
  };
}

function makeStore(
  storage: MemoryStorage,
  options: {
    now?: () => number;
    randomBytes?: () => Uint8Array;
    cleanup?: (publicKey: string) => Promise<void>;
  } = {},
) {
  return createOAuthTransactionStore({
    secureStorage: storage,
    randomBytes: options.randomBytes ?? randomSource(new Array(16).fill(1)),
    now: options.now ?? (() => 1_000_000),
    cleanupTemporaryKey: options.cleanup ?? (async () => undefined),
  });
}

describe("OAuth transaction store", () => {
  it("builds state only for the winning locked candidate after a collision", async () => {
    const storage = new MemoryStorage();
    const store = makeStore(storage, {
      randomBytes: randomSource(
        new Array(16).fill(1),
        new Array(16).fill(1),
        new Array(16).fill(2),
      ),
    });
    const first = await store.beginOAuthTransaction(fixture());
    const originalBytes = [...storage.values.values()][0];
    const calls: string[] = [];
    const { expectedState: _, ...input } = fixture();
    const second = await store.beginOAuthTransaction({
      ...input,
      createExpectedState: (id: string) => {
        calls.push(id);
        return `transactionId=${id}&label=winning`;
      },
    });
    expect(calls).toEqual(["02020202020202020202020202020202"]);
    expect([...storage.values.values()][0]).toBe(originalBytes);
    await expect(
      store.consumeOAuthTransaction(
        second.id,
        "transactionId=02020202020202020202020202020202&label=winning",
        fixture(),
      ),
    ).resolves.toMatchObject({ codeVerifier: "verifier-secret-1" });
    await expect(
      store.consumeOAuthTransaction(
        first.id,
        fixture().expectedState,
        fixture(),
      ),
    ).resolves.toMatchObject({ publicKey: "public-key-1" });
  });

  it.each([
    [
      "exception",
      () => {
        throw new Error("factory-secret");
      },
    ],
    ["empty", () => ""],
    ["non-string", () => 7],
    ["promise", () => Promise.resolve("factory-secret")],
    [
      "thenable",
      () => ({
        then: () => {
          throw new Error("must not await");
        },
      }),
    ],
  ])(
    "rejects %s factory results before persistence or cleanup ownership",
    async (_label, createExpectedState) => {
      const storage = new MemoryStorage();
      const cleaned: string[] = [];
      const store = makeStore(storage, {
        randomBytes: randomSource(new Array(16).fill(1), new Array(16).fill(2)),
        cleanup: async (key) => void cleaned.push(key),
      });
      await store.beginOAuthTransaction(fixture());
      const original = [...storage.values];
      const { expectedState: _, ...input } = fixture();
      const writes: string[] = [];
      storage.set = async () => {
        writes.push("set");
      };
      storage.remove = async () => {
        writes.push("remove");
      };
      let factoryCalls = 0;
      const failure = await store
        .beginOAuthTransaction({
          ...input,
          createExpectedState: () => {
            factoryCalls++;
            return (createExpectedState as () => unknown)();
          },
        } as BeginOAuthTransactionInput)
        .catch((e: unknown) => e);
      expect(factoryCalls).toBe(1);
      expect(failure).toMatchObject({ message: "OAuth transaction invalid" });
      expect(failure).not.toHaveProperty("transactionId");
      expect(failure).not.toHaveProperty("cleanupRetryId");
      expect(String(failure)).not.toContain("factory-secret");
      expect(writes).toEqual([]);
      expect(cleaned).toEqual([]);
      expect([...storage.values]).toEqual(original);
    },
  );

  it.each(["immediate", "later"])(
    "rejects a %s rejected factory Promise without an unhandled rejection or cleanup ownership",
    async (timing) => {
      const storage = new MemoryStorage();
      const cleaned: string[] = [];
      const writes: string[] = [];
      const store = makeStore(storage, {
        cleanup: async (key) => void cleaned.push(key),
      });
      storage.set = async () => {
        writes.push("set");
      };
      storage.remove = async () => {
        writes.push("remove");
      };
      const { expectedState: _, ...input } = fixture();
      let rejectLater: ((reason: Error) => void) | undefined;
      const failure = await store
        .beginOAuthTransaction({
          ...input,
          createExpectedState: () =>
            timing === "immediate"
              ? Promise.reject(new Error("factory-secret"))
              : new Promise<string>((_resolve, reject) => {
                  rejectLater = reject;
                }),
        } as unknown as BeginOAuthTransactionInput)
        .catch((caught: unknown) => caught);

      // The operation must reject before a still-pending factory Promise settles.
      expect(failure).toMatchObject({ message: "OAuth transaction invalid" });
      expect(failure).not.toHaveProperty("transactionId");
      expect(failure).not.toHaveProperty("cleanupRetryId");
      expect(String(failure)).not.toContain("factory-secret");
      rejectLater?.(new Error("factory-secret"));
      // Let genuine unhandled rejections reach Jest's error listener.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(writes).toEqual([]);
      expect(cleaned).toEqual([]);
      expect(storage.values.size).toBe(0);
    },
  );

  it.each(["getter", "method"])(
    "rejects a thenable without executing its then %s",
    async (shape) => {
      const storage = new MemoryStorage();
      const store = makeStore(storage);
      let calls = 0;
      const thenable =
        shape === "getter"
          ? {
              get then() {
                calls++;
                throw new Error("thenable-secret");
              },
            }
          : {
              then() {
                calls++;
                throw new Error("thenable-secret");
              },
            };
      const { expectedState: _, ...input } = fixture();
      await expect(
        store.beginOAuthTransaction({
          ...input,
          createExpectedState: () => thenable,
        } as unknown as BeginOAuthTransactionInput),
      ).rejects.toThrow(new Error("OAuth transaction invalid"));
      expect(calls).toBe(0);
      expect(storage.values.size).toBe(0);
    },
  );

  it.each(["both", "neither"])(
    "rejects %s state input forms at runtime",
    async (form) => {
      const storage = new MemoryStorage();
      let calls = 0;
      const { expectedState, ...input } = fixture();
      const invalid =
        form === "both"
          ? {
              ...input,
              expectedState,
              createExpectedState: () => {
                calls++;
                return "other";
              },
            }
          : input;
      await expect(
        makeStore(storage).beginOAuthTransaction(
          invalid as BeginOAuthTransactionInput,
        ),
      ).rejects.toThrow("OAuth transaction invalid");
      expect(calls).toBe(0);
      expect(storage.values.size).toBe(0);
    },
  );

  it("retains contextual cleanup ownership after factory success and persistence failure", async () => {
    const storage = new MemoryStorage();
    let cleanupFails = true;
    const cleaned: string[] = [];
    const store = makeStore(storage, {
      cleanup: async (key) => {
        if (cleanupFails) throw new Error("cleanup secret");
        cleaned.push(key);
      },
    });
    storage.failSetAfterWrite = true;
    const { expectedState: _, ...input } = fixture();
    const calls: string[] = [];
    await expect(
      store.beginOAuthTransaction({
        ...input,
        createExpectedState: (id: string) => {
          calls.push(id);
          return "created-state";
        },
      }),
    ).rejects.toMatchObject({
      message: "OAuth transaction persistence failed",
      transactionId: "01010101010101010101010101010101",
    });
    expect(calls).toEqual(["01010101010101010101010101010101"]);
    const original = [...storage.values];
    cleanupFails = false;
    storage.failSetAfterWrite = false;
    await expect(
      store.consumeOAuthTransaction(calls[0]!, "created-state", {
        configId: "other",
        provider: OAuthProviders.GOOGLE,
        binding: "routing-1",
      }),
    ).rejects.toThrow("OAuth transaction unavailable");
    expect([...storage.values]).toEqual(original);
    expect(cleaned).toEqual([]);
    await expect(
      store.consumeOAuthTransaction(calls[0]!, "created-state", fixture()),
    ).rejects.toThrow("OAuth transaction unavailable");
    expect(cleaned).toEqual(["public-key-1"]);
    expect(storage.values.size).toBe(0);
  });

  it.each(["live", "expired", "tombstone", "intent", "contextless-intent"])(
    "preserves %s bytes and keys across wrong config/provider and permits the rightful context",
    async (kind) => {
      const storage = new MemoryStorage();
      let now = 1_000_000;
      let cleanupFails = false;
      const keys = new Set(["public-key-1", "other-key"]);
      const cleanupAttempts: string[] = [];
      const options = {
        now: () => now,
        cleanup: async (key: string) => {
          cleanupAttempts.push(key);
          if (cleanupFails) throw new Error("cleanup secret");
          keys.delete(key);
        },
      };
      const store = makeStore(storage, options);
      const begun = await store.beginOAuthTransaction(fixture());
      if (kind === "expired") now = 1_300_000;
      if (["tombstone", "intent", "contextless-intent"].includes(kind)) {
        cleanupFails = true;
        storage.failSet = kind !== "tombstone";
        await expect(store.cancelOAuthTransaction(begun.id)).rejects.toThrow(
          "OAuth transaction cleanup failed",
        );
        storage.failSet = false;
        cleanupFails = false;
        cleanupAttempts.length = 0;
        if (kind === "contextless-intent")
          storage.values.set([...storage.values.keys()][0]!, "{}");
      }
      // A new backing object models a restart for durable records; intents require the same runtime object.
      const resumedStorage = kind.endsWith("intent")
        ? storage
        : new MemoryStorage();
      for (const [key, value] of storage.values)
        resumedStorage.values.set(key, value);
      const resumed = makeStore(resumedStorage, options);
      const original = [...resumedStorage.values];
      for (const context of [
        {
          configId: "other-config",
          provider: OAuthProviders.GOOGLE,
          binding: "routing-1",
        },
        {
          configId: "config-1",
          provider: OAuthProviders.X,
          binding: "routing-1",
        },
      ]) {
        await expect(
          resumed.consumeOAuthTransaction(
            begun.id,
            fixture().expectedState,
            context,
          ),
        ).rejects.toThrow("OAuth transaction unavailable");
        await expect(
          resumed.consumeOAuthTransaction(begun.id, "wrong-state", context),
        ).rejects.toThrow("OAuth transaction unavailable");
        expect([...resumedStorage.values]).toEqual(original);
        expect(cleanupAttempts).toEqual([]);
        expect([...keys]).toEqual(["public-key-1", "other-key"]);
      }
      if (kind === "live") {
        await expect(
          resumed.consumeOAuthTransaction(
            begun.id,
            fixture().expectedState,
            fixture(),
          ),
        ).resolves.toMatchObject({ codeVerifier: "verifier-secret-1" });
        expect([...keys]).toEqual(["public-key-1", "other-key"]);
      } else {
        await expect(
          resumed.consumeOAuthTransaction(
            begun.id,
            fixture().expectedState,
            fixture(),
          ),
        ).rejects.toThrow("OAuth transaction unavailable");
        expect([...keys]).toEqual(["other-key"]);
      }
      expect(resumedStorage.values.size).toBe(0);
    },
  );

  it.each([
    null,
    "not-json",
    "{}",
    JSON.stringify({
      kind: "cleanup-pending",
      id: "01010101010101010101010101010101",
      publicKey: "public-key-1",
    }),
  ])(
    "retains unavailable/contextless records without storage mutation (%s)",
    async (bytes) => {
      const storage = new MemoryStorage();
      const id = "01010101010101010101010101010101";
      if (bytes !== null)
        storage.values.set(`0xkey.oauth.transaction.v1.${id}`, bytes);
      const original = [...storage.values];
      const writes: string[] = [];
      storage.set = async () => {
        writes.push("set");
      };
      storage.remove = async () => {
        writes.push("remove");
      };
      const cleaned: string[] = [];
      const store = makeStore(storage, {
        cleanup: async (key) => void cleaned.push(key),
      });
      for (const context of [
        fixture(),
        {
          configId: "other",
          provider: OAuthProviders.GOOGLE,
          binding: "routing-1",
        },
        {
          configId: "config-1",
          provider: OAuthProviders.X,
          binding: "routing-1",
        },
      ]) {
        await expect(
          store.consumeOAuthTransaction(id, fixture().expectedState, context),
        ).rejects.toThrow("OAuth transaction unavailable");
      }
      expect(writes).toEqual([]);
      expect(cleaned).toEqual([]);
      expect([...storage.values]).toEqual(original);
    },
  );

  it.each([
    undefined,
    null,
    {},
    { configId: "", provider: OAuthProviders.GOOGLE, binding: "routing-1" },
    { configId: "config-1", provider: "unknown", binding: "routing-1" },
  ])(
    "rejects invalid trusted context before accessing storage (%s)",
    async (context) => {
      const storage = new MemoryStorage();
      const store = makeStore(storage);
      const begun = await store.beginOAuthTransaction(fixture());
      storage.failGet = true;
      await expect(
        store.consumeOAuthTransaction(
          begun.id,
          fixture().expectedState,
          context as never,
        ),
      ).rejects.toThrow("OAuth transaction invalid");
      expect(storage.values.size).toBe(1);
    },
  );

  it("creates unique 128-bit IDs with an exact 300-second expiry", async () => {
    const storage = new MemoryStorage();
    const store = makeStore(storage, {
      randomBytes: randomSource(new Array(16).fill(1), new Array(16).fill(2)),
    });

    const first = await store.beginOAuthTransaction(fixture());
    const second = await store.beginOAuthTransaction(
      fixture({ publicKey: "public-key-2" }),
    );

    expect(first).toEqual({
      id: "01010101010101010101010101010101",
      configId: "config-1",
      provider: OAuthProviders.GOOGLE,
      binding: "routing-1",
      publicKey: "public-key-1",
      expiresAt: 1_300_000,
    });
    expect(second.id).toBe("02020202020202020202020202020202");
    expect(second.id).not.toBe(first.id);
    expect(JSON.stringify(first)).not.toContain("verifier-secret-1");
  });

  it("regenerates an ID instead of overwriting an existing transaction", async () => {
    const storage = new MemoryStorage();
    const store = makeStore(storage, {
      randomBytes: randomSource(
        new Array(16).fill(1),
        new Array(16).fill(1),
        new Array(16).fill(2),
      ),
    });
    const first = await store.beginOAuthTransaction(fixture());
    const second = await store.beginOAuthTransaction(
      fixture({ publicKey: "public-key-2" }),
    );

    expect(second.id).toBe("02020202020202020202020202020202");
    await expect(
      store.consumeOAuthTransaction(
        first.id,
        fixture().expectedState,
        fixture(),
      ),
    ).resolves.toMatchObject({ publicKey: "public-key-1" });
  });

  it("preserves a colliding transaction when the next begin read fails", async () => {
    const storage = new MemoryStorage();
    const cleaned: string[] = [];
    const store = makeStore(storage, {
      randomBytes: randomSource(new Array(16).fill(1), new Array(16).fill(1)),
      cleanup: async (publicKey) => void cleaned.push(publicKey),
    });
    const first = await store.beginOAuthTransaction(fixture());
    storage.failGet = true;

    await expect(
      store.beginOAuthTransaction(
        fixture({
          publicKey: "public-key-2",
          codeVerifier: "verifier-secret-2",
        }),
      ),
    ).rejects.toThrow("OAuth transaction persistence failed");
    expect(cleaned).toEqual(["public-key-2"]);

    storage.failGet = false;
    await expect(
      store.consumeOAuthTransaction(
        first.id,
        fixture().expectedState,
        fixture(),
      ),
    ).resolves.toMatchObject({
      publicKey: "public-key-1",
      codeVerifier: "verifier-secret-1",
    });
  });

  it("uses a separate cleanup retry handle when pre-ownership cleanup fails", async () => {
    const storage = new MemoryStorage();
    let cleanupFails = true;
    const store = makeStore(storage, {
      randomBytes: randomSource(
        new Array(16).fill(1),
        new Array(16).fill(1),
        new Array(16).fill(9),
      ),
      cleanup: async () => {
        if (cleanupFails) throw new Error("cleanup failed");
      },
    });
    const first = await store.beginOAuthTransaction(fixture());
    storage.failGet = true;
    const operation = store.beginOAuthTransaction(
      fixture({ publicKey: "public-key-2", codeVerifier: "verifier-secret-2" }),
    );
    await expect(operation).rejects.toMatchObject({
      message: "OAuth transaction persistence failed",
      cleanupRetryId: "cleanup.09090909090909090909090909090909",
    });

    cleanupFails = false;
    storage.failGet = false;
    const failure = await operation.catch((caught: unknown) => caught);
    await expect(
      store.cancelOAuthTransaction(
        (failure as { cleanupRetryId: string }).cleanupRetryId,
      ),
    ).resolves.toBeUndefined();
    await expect(
      store.consumeOAuthTransaction(
        first.id,
        fixture().expectedState,
        fixture(),
      ),
    ).resolves.toMatchObject({ publicKey: "public-key-1" });
  });

  it("never overwrites an occupied cleanup retry handle on random collision", async () => {
    const storage = new MemoryStorage();
    let cleanupFails = true;
    const cleaned: string[] = [];
    const store = makeStore(storage, {
      randomBytes: randomSource(
        new Array(16).fill(1),
        new Array(16).fill(2),
        new Array(16).fill(9),
        new Array(16).fill(3),
        new Array(16).fill(9),
      ),
      cleanup: async (publicKey) => {
        if (cleanupFails) throw new Error(`cleanup failed ${publicKey}`);
        cleaned.push(publicKey);
      },
    });
    await store.beginOAuthTransaction(fixture());
    storage.failGet = true;

    const firstFailure = store.beginOAuthTransaction(
      fixture({ publicKey: "public-key-2", codeVerifier: "verifier-secret-2" }),
    );
    await expect(firstFailure).rejects.toMatchObject({
      message: "OAuth transaction persistence failed",
      cleanupRetryId: "cleanup.09090909090909090909090909090909",
    });

    const secondFailure = store.beginOAuthTransaction(
      fixture({ publicKey: "public-key-3", codeVerifier: "verifier-secret-3" }),
    );
    await expect(secondFailure).rejects.toMatchObject({
      message: "OAuth transaction persistence failed",
    });
    const secondError = await secondFailure.catch((caught: unknown) => caught);
    expect(secondError).not.toHaveProperty("cleanupRetryId");
    expect(String(secondError)).not.toContain("public-key-3");

    cleanupFails = false;
    storage.failGet = false;
    const firstError = await firstFailure.catch((caught: unknown) => caught);
    await store.cancelOAuthTransaction(
      (firstError as { cleanupRetryId: string }).cleanupRetryId,
    );
    expect(cleaned).toEqual(["public-key-2"]);
  });

  it.each(Object.values(OAuthProviders))(
    "round-trips the %s provider",
    async (provider) => {
      const storage = new MemoryStorage();
      const store = makeStore(storage);
      const begun = await store.beginOAuthTransaction(fixture({ provider }));

      await expect(
        store.consumeOAuthTransaction(
          begun.id,
          "provider=google&nonce=state-1",
          { configId: "config-1", provider, binding: "routing-1" },
        ),
      ).resolves.toMatchObject({ provider, codeVerifier: "verifier-secret-1" });
    },
  );

  it("keeps two same-provider logins independent", async () => {
    const storage = new MemoryStorage();
    const store = makeStore(storage, {
      randomBytes: randomSource(new Array(16).fill(1), new Array(16).fill(2)),
    });
    const first = await store.beginOAuthTransaction(fixture());
    const second = await store.beginOAuthTransaction(
      fixture({ publicKey: "public-key-2", codeVerifier: "verifier-secret-2" }),
    );

    await expect(
      store.consumeOAuthTransaction(
        first.id,
        fixture().expectedState,
        fixture(),
      ),
    ).resolves.toMatchObject({ codeVerifier: "verifier-secret-1" });
    await expect(
      store.consumeOAuthTransaction(
        second.id,
        fixture().expectedState,
        fixture(),
      ),
    ).resolves.toMatchObject({ codeVerifier: "verifier-secret-2" });
  });

  it("survives store reconstruction", async () => {
    const storage = new MemoryStorage();
    const begun = await makeStore(storage).beginOAuthTransaction(fixture());

    await expect(
      makeStore(storage).consumeOAuthTransaction(
        begun.id,
        fixture().expectedState,
        fixture(),
      ),
    ).resolves.toMatchObject({ publicKey: "public-key-1" });
  });

  it("allows at most one concurrent consume in one store", async () => {
    const storage = new MemoryStorage();
    const store = makeStore(storage);
    const begun = await store.beginOAuthTransaction(fixture());
    storage.deferRemove = true;

    const first = store.consumeOAuthTransaction(
      begun.id,
      fixture().expectedState,
      fixture(),
    );
    await storage.removeStarted;
    const second = store.consumeOAuthTransaction(
      begun.id,
      fixture().expectedState,
      fixture(),
    );
    storage.releaseDeferredRemove();

    const settled = await Promise.allSettled([first, second]);
    expect(
      settled.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      settled.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });

  it("allows at most one concurrent consume across stores sharing storage", async () => {
    const storage = new MemoryStorage();
    const firstStore = makeStore(storage);
    const secondStore = makeStore(storage);
    const begun = await firstStore.beginOAuthTransaction(fixture());
    storage.deferRemove = true;

    const first = firstStore.consumeOAuthTransaction(
      begun.id,
      fixture().expectedState,
      fixture(),
    );
    await storage.removeStarted;
    const second = secondStore.consumeOAuthTransaction(
      begun.id,
      fixture().expectedState,
      fixture(),
    );
    storage.releaseDeferredRemove();

    const settled = await Promise.allSettled([first, second]);
    expect(
      settled.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
  });

  it("rejects replay without returning a secret", async () => {
    const storage = new MemoryStorage();
    const store = makeStore(storage);
    const begun = await store.beginOAuthTransaction(fixture());
    await store.consumeOAuthTransaction(
      begun.id,
      fixture().expectedState,
      fixture(),
    );

    await expect(
      store.consumeOAuthTransaction(
        begun.id,
        fixture().expectedState,
        fixture(),
      ),
    ).rejects.toThrow("OAuth transaction unavailable");
  });

  it("expires at the exact boundary and cleans only its temporary key", async () => {
    const storage = new MemoryStorage();
    let now = 1_000_000;
    const cleaned: string[] = [];
    const store = makeStore(storage, {
      now: () => now,
      cleanup: async (publicKey) => void cleaned.push(publicKey),
    });
    const begun = await store.beginOAuthTransaction(fixture());
    now = 1_300_000;

    await expect(
      store.consumeOAuthTransaction(
        begun.id,
        fixture().expectedState,
        fixture(),
      ),
    ).rejects.toThrow("OAuth transaction unavailable");
    expect(cleaned).toEqual(["public-key-1"]);
    expect(storage.values.size).toBe(0);
  });

  it("invalidates and cleans a transaction after a wrong state", async () => {
    const storage = new MemoryStorage();
    const cleaned: string[] = [];
    const store = makeStore(storage, {
      cleanup: async (publicKey) => void cleaned.push(publicKey),
    });
    const begun = await store.beginOAuthTransaction(fixture());

    await expect(
      store.consumeOAuthTransaction(begun.id, "wrong-state", fixture()),
    ).rejects.toThrow("OAuth transaction unavailable");
    expect(cleaned).toEqual(["public-key-1"]);
    await expect(
      store.consumeOAuthTransaction(
        begun.id,
        fixture().expectedState,
        fixture(),
      ),
    ).rejects.toThrow("OAuth transaction unavailable");
  });

  it("blocks redemption and cleans when mismatch tombstone persistence fails", async () => {
    const storage = new MemoryStorage();
    const cleaned: string[] = [];
    const firstStore = makeStore(storage, {
      cleanup: async (publicKey) => void cleaned.push(publicKey),
    });
    const secondStore = makeStore(storage, {
      cleanup: async (publicKey) => void cleaned.push(publicKey),
    });
    const begun = await firstStore.beginOAuthTransaction(fixture());
    storage.failSet = true;
    storage.failRemove = true;

    await expect(
      firstStore.consumeOAuthTransaction(begun.id, "wrong-state", fixture()),
    ).rejects.toThrow("OAuth transaction persistence failed");
    expect(cleaned).toEqual(["public-key-1"]);
    expect(storage.values.size).toBe(1);

    storage.failSet = false;
    storage.failRemove = false;
    await expect(
      secondStore.consumeOAuthTransaction(
        begun.id,
        fixture().expectedState,
        fixture(),
      ),
    ).rejects.toThrow("OAuth transaction unavailable");
    expect(storage.values.size).toBe(0);
  });

  it("persists a verifier-free tombstone before retrying failed cleanup", async () => {
    const storage = new MemoryStorage();
    const store = makeStore(storage, {
      cleanup: async () => {
        throw new Error("cleanup failed");
      },
    });
    const begun = await store.beginOAuthTransaction(fixture());
    storage.failSet = true;

    await expect(
      store.consumeOAuthTransaction(begun.id, "wrong-state", fixture()),
    ).rejects.toThrow("OAuth transaction cleanup failed");
    expect([...storage.values.values()][0]).toContain("verifier-secret-1");

    storage.failSet = false;
    await expect(
      store.consumeOAuthTransaction(
        begun.id,
        fixture().expectedState,
        fixture(),
      ),
    ).rejects.toThrow("OAuth transaction cleanup failed");
    expect([...storage.values.values()][0]).not.toContain("verifier-secret-1");

    const reconstructedStorage = new MemoryStorage();
    for (const [key, value] of storage.values) {
      reconstructedStorage.values.set(key, value);
    }
    const reconstructed = makeStore(reconstructedStorage, {
      cleanup: async () => {
        throw new Error("cleanup still failed");
      },
    });
    await expect(
      reconstructed.consumeOAuthTransaction(
        begun.id,
        fixture().expectedState,
        fixture(),
      ),
    ).rejects.toThrow("OAuth transaction cleanup failed");
  });

  it("treats an empty returned state as a mismatch and cleans the transaction", async () => {
    const storage = new MemoryStorage();
    const cleaned: string[] = [];
    const store = makeStore(storage, {
      cleanup: async (publicKey) => void cleaned.push(publicKey),
    });
    const begun = await store.beginOAuthTransaction(fixture());

    await expect(
      store.consumeOAuthTransaction(begun.id, "", fixture()),
    ).rejects.toThrow("OAuth transaction unavailable");
    expect(cleaned).toEqual(["public-key-1"]);
    expect(storage.values.size).toBe(0);
  });

  it("cancels idempotently without affecting a separate transaction", async () => {
    const storage = new MemoryStorage();
    const cleaned: string[] = [];
    const store = makeStore(storage, {
      randomBytes: randomSource(new Array(16).fill(1), new Array(16).fill(2)),
      cleanup: async (publicKey) => void cleaned.push(publicKey),
    });
    const first = await store.beginOAuthTransaction(fixture());
    const second = await store.beginOAuthTransaction(
      fixture({ publicKey: "public-key-2" }),
    );

    await store.cancelOAuthTransaction(first.id);
    await store.cancelOAuthTransaction(first.id);
    expect(cleaned).toEqual(["public-key-1"]);
    await expect(
      store.consumeOAuthTransaction(
        second.id,
        fixture().expectedState,
        fixture(),
      ),
    ).resolves.toMatchObject({ publicKey: "public-key-2" });
  });

  it("retains cancellation intent across a tombstone mutation failure", async () => {
    const storage = new MemoryStorage();
    const cleaned: string[] = [];
    const firstStore = makeStore(storage, {
      cleanup: async (publicKey) => void cleaned.push(publicKey),
    });
    const secondStore = makeStore(storage, {
      cleanup: async (publicKey) => void cleaned.push(publicKey),
    });
    const begun = await firstStore.beginOAuthTransaction(fixture());
    storage.failSet = true;
    storage.failRemove = true;

    await expect(firstStore.cancelOAuthTransaction(begun.id)).rejects.toThrow(
      "OAuth transaction persistence failed",
    );
    expect(cleaned).toEqual(["public-key-1"]);

    storage.failSet = false;
    storage.failRemove = false;
    await expect(
      secondStore.consumeOAuthTransaction(
        begun.id,
        fixture().expectedState,
        fixture(),
      ),
    ).rejects.toThrow("OAuth transaction unavailable");
  });

  it("rejects malformed records and retains them without cleanup guesses", async () => {
    const storage = new MemoryStorage();
    const cleaned: string[] = [];
    const store = makeStore(storage, {
      cleanup: async (publicKey) => void cleaned.push(publicKey),
    });
    const begun = await store.beginOAuthTransaction(fixture());
    storage.values.set([...storage.values.keys()][0]!, '{"publicKey":7}');

    await expect(
      store.consumeOAuthTransaction(
        begun.id,
        fixture().expectedState,
        fixture(),
      ),
    ).rejects.toThrow("OAuth transaction unavailable");
    expect([...storage.values.values()]).toEqual(['{"publicKey":7}']);
    expect(cleaned).toEqual([]);
  });

  it("rejects invalid input and IDs before touching storage", async () => {
    const storage = new MemoryStorage();
    const store = makeStore(storage);

    await expect(
      store.beginOAuthTransaction(fixture({ configId: "" })),
    ).rejects.toThrow("OAuth transaction invalid");
    await expect(
      store.consumeOAuthTransaction(
        "../other-key",
        fixture().expectedState,
        fixture(),
      ),
    ).rejects.toThrow("OAuth transaction invalid");
    await expect(store.cancelOAuthTransaction("short")).rejects.toThrow(
      "OAuth transaction invalid",
    );
    expect(storage.values.size).toBe(0);
  });

  it("rejects an ID with a trailing newline before any storage access", async () => {
    const storage = new MemoryStorage();
    storage.failGet = true;
    const store = makeStore(storage);
    await expect(
      store.consumeOAuthTransaction(
        "01010101010101010101010101010101\n",
        fixture().expectedState,
        fixture(),
      ),
    ).rejects.toThrow("OAuth transaction invalid");
    await expect(
      store.cancelOAuthTransaction("01010101010101010101010101010101\n"),
    ).rejects.toThrow("OAuth transaction invalid");
  });

  it("maps set and get failures to fixed non-secret errors", async () => {
    const storage = new MemoryStorage();
    const store = makeStore(storage);
    storage.failSet = true;
    await expect(store.beginOAuthTransaction(fixture())).rejects.toThrow(
      "OAuth transaction persistence failed",
    );
    storage.failSet = false;
    const begun = await store.beginOAuthTransaction(fixture());
    storage.failGet = true;
    await expect(
      store.consumeOAuthTransaction(
        begun.id,
        fixture().expectedState,
        fixture(),
      ),
    ).rejects.toThrow("OAuth transaction persistence failed");
  });

  it("unwinds the exact temporary key when begin fails before writing", async () => {
    const storage = new MemoryStorage();
    const cleaned: string[] = [];
    const store = makeStore(storage, {
      cleanup: async (publicKey) => void cleaned.push(publicKey),
    });
    storage.failGet = true;

    const operation = store.beginOAuthTransaction(fixture());
    await expect(operation).rejects.toMatchObject({
      message: "OAuth transaction persistence failed",
    });
    expect(cleaned).toEqual(["public-key-1"]);
    expect(storage.values.size).toBe(0);
  });

  it("blocks a write-then-reject begin record until cleanup can retry", async () => {
    const storage = new MemoryStorage();
    const cleaned: string[] = [];
    const firstStore = makeStore(storage, {
      cleanup: async (publicKey) => void cleaned.push(publicKey),
    });
    const secondStore = makeStore(storage, {
      cleanup: async (publicKey) => void cleaned.push(publicKey),
    });
    storage.failSetAfterWrite = true;
    storage.failRemove = true;

    const operation = firstStore.beginOAuthTransaction(fixture());
    await expect(operation).rejects.toMatchObject({
      message: "OAuth transaction persistence failed",
      transactionId: "01010101010101010101010101010101",
    });
    expect(cleaned).toEqual(["public-key-1"]);
    expect(storage.values.size).toBe(1);

    storage.failSetAfterWrite = false;
    storage.failRemove = false;
    await expect(
      secondStore.consumeOAuthTransaction(
        "01010101010101010101010101010101",
        fixture().expectedState,
        fixture(),
      ),
    ).rejects.toThrow("OAuth transaction unavailable");
    expect(storage.values.size).toBe(0);
  });

  it("does not return a verifier when durable removal fails and permits retry", async () => {
    const storage = new MemoryStorage();
    const store = makeStore(storage);
    const begun = await store.beginOAuthTransaction(fixture());
    storage.failRemove = true;

    await expect(
      store.consumeOAuthTransaction(
        begun.id,
        fixture().expectedState,
        fixture(),
      ),
    ).rejects.toThrow("OAuth transaction persistence failed");
    expect(storage.values.size).toBe(1);
    storage.failRemove = false;
    await expect(
      store.consumeOAuthTransaction(
        begun.id,
        fixture().expectedState,
        fixture(),
      ),
    ).resolves.toMatchObject({ codeVerifier: "verifier-secret-1" });
  });

  it("retains exact-key cleanup metadata for an idempotent retry", async () => {
    const storage = new MemoryStorage();
    let attempts = 0;
    const store = makeStore(storage, {
      cleanup: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("cleanup leaked verifier-secret-1");
        }
      },
    });
    const begun = await store.beginOAuthTransaction(fixture());

    await expect(store.cancelOAuthTransaction(begun.id)).rejects.toThrow(
      "OAuth transaction cleanup failed",
    );
    expect(storage.values.size).toBe(1);
    expect([...storage.values.values()][0]).not.toContain("verifier-secret-1");
    await expect(
      store.cancelOAuthTransaction(begun.id),
    ).resolves.toBeUndefined();
    expect(storage.values.size).toBe(0);
    expect(attempts).toBe(2);
  });

  it("rejects a non-finite clock without persisting an invalid expiry", async () => {
    const storage = new MemoryStorage();
    const store = makeStore(storage, { now: () => Number.NaN });

    await expect(store.beginOAuthTransaction(fixture())).rejects.toThrow(
      "OAuth transaction invalid",
    );
    expect(storage.values.size).toBe(0);
  });

  it("never includes sensitive input or dependency errors in thrown errors", async () => {
    const storage = new MemoryStorage();
    const store = makeStore(storage);
    storage.failSet = true;

    const operation = store.beginOAuthTransaction(
      fixture({
        expectedState: "state-sensitive-value",
        codeVerifier: "verifier-sensitive-value",
      }),
    );
    await expect(operation).rejects.toMatchObject({
      message: "OAuth transaction persistence failed",
    });
  });
});
