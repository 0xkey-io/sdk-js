import { describe, expect, it, jest } from "@jest/globals";
import { OAuthProviders } from "@0xkey-io/sdk-types";
import {
  createOAuthTransactionStore,
  type OAuthTransactionSecureStorage,
} from "../utils/oauth-transaction";

interface SyntheticCredentials {
  service: string;
  storage: string;
  username: string;
  password: string;
}

interface SyntheticKeychain {
  getGenericPassword(options: {
    service: string;
  }): Promise<false | SyntheticCredentials>;
  setGenericPassword(
    username: string,
    password: string,
    options: { service: string },
  ): Promise<false | { service: string; storage: string }>;
  resetGenericPassword(options: { service: string }): Promise<boolean>;
}

function createSyntheticKeychain(): SyntheticKeychain & {
  readonly values: Map<string, SyntheticCredentials>;
  readonly calls: Array<unknown[]>;
} {
  const values = new Map<string, SyntheticCredentials>();
  const calls: Array<unknown[]> = [];
  return {
    values,
    calls,
    async getGenericPassword(options) {
      calls.push(["get", options]);
      return values.get(options.service) ?? false;
    },
    async setGenericPassword(username, password, options) {
      calls.push(["set", username, password, options]);
      values.set(options.service, {
        service: options.service,
        storage: "synthetic",
        username,
        password,
      });
      return { service: options.service, storage: "synthetic" };
    },
    async resetGenericPassword(options) {
      calls.push(["reset", options]);
      return values.delete(options.service);
    },
  };
}

function loadModule(): {
  createOAuthKeychainStorage(
    keychain: SyntheticKeychain | (() => SyntheticKeychain),
  ): OAuthTransactionSecureStorage;
  oauthTransactionSecureStorage: OAuthTransactionSecureStorage;
} {
  return require("../utils/oauth-keychain-storage") as ReturnType<
    typeof loadModule
  >;
}

function createTransactionStore(
  secureStorage: OAuthTransactionSecureStorage,
  idByte: number,
  cleanupTemporaryKey: (publicKey: string) => Promise<void> = async () =>
    undefined,
) {
  return createOAuthTransactionStore({
    secureStorage,
    randomBytes: () => Uint8Array.from(new Array(16).fill(idByte)),
    now: () => 1_000_000,
    cleanupTemporaryKey,
  });
}

function transactionInput(overrides: Record<string, unknown> = {}) {
  return {
    configId: "config-1",
    provider: OAuthProviders.GOOGLE,
    publicKey: "public-key-1",
    expectedState: "provider=google&state=one",
    codeVerifier: "verifier-secret-1",
    ...overrides,
  };
}

describe("OAuth transaction Keychain storage", () => {
  it("can be imported before the native Keychain bridge is available", () => {
    expect(loadModule).not.toThrow();
  });

  it("keeps one module-singleton identity and validates keys before bridge use", async () => {
    const first = loadModule().oauthTransactionSecureStorage;
    const second = loadModule().oauthTransactionSecureStorage;
    expect(first).toBe(second);

    await expect(first.get("invalid-key")).rejects.toThrow(
      "OAuth transaction secure storage failed",
    );
  });

  it("does not load a missing native bridge until the singleton is used", async () => {
    let bridgeLoads = 0;
    jest.doMock(
      "react-native-keychain",
      () => {
        bridgeLoads += 1;
        throw new Error("missing-native-bridge-secret");
      },
      { virtual: true },
    );
    let isolatedStorage: OAuthTransactionSecureStorage | undefined;
    jest.isolateModules(() => {
      isolatedStorage = (
        require("../utils/oauth-keychain-storage") as ReturnType<
          typeof loadModule
        >
      ).oauthTransactionSecureStorage;
      expect(bridgeLoads).toBe(0);
    });
    if (!isolatedStorage) throw new Error("isolated storage not loaded");

    const failure = await isolatedStorage
      .get("0xkey.oauth.transaction.v1.11111111111111111111111111111111")
      .catch((error) => error);
    expect(failure).toMatchObject({
      message:
        "OAuth transaction secure storage requires react-native-keychain",
    });
    expect(String(failure)).not.toContain("missing-native-bridge-secret");
    expect(bridgeLoads).toBe(1);
    jest.dontMock("react-native-keychain");
  });

  it("sanitizes an injected bridge-loading exception", async () => {
    const storage = loadModule().createOAuthKeychainStorage(() => {
      throw new Error("native-bridge-load-secret");
    });
    const failure = await storage
      .get("0xkey.oauth.transaction.v1.11111111111111111111111111111111")
      .catch((error) => error);
    expect(failure).toMatchObject({
      message:
        "OAuth transaction secure storage requires react-native-keychain",
    });
    expect(String(failure)).not.toContain("native-bridge-load-secret");
  });

  it("isolates exact transaction keys in per-ID services with one fixed username", async () => {
    const keychain = createSyntheticKeychain();
    const storage = loadModule().createOAuthKeychainStorage(keychain);
    const firstId = "11111111111111111111111111111111";
    const secondId = "22222222222222222222222222222222";
    const firstKey = `0xkey.oauth.transaction.v1.${firstId}`;
    const secondKey = `0xkey.oauth.transaction.v1.${secondId}`;

    await storage.set(firstKey, "record-one-secret");
    await storage.set(secondKey, "record-two-secret");

    expect([...keychain.values]).toEqual([
      [
        `com.0xkey.oauth.transaction.v1:${firstId}`,
        {
          service: `com.0xkey.oauth.transaction.v1:${firstId}`,
          storage: "synthetic",
          username: "0xkey-oauth-transaction-v1",
          password: "record-one-secret",
        },
      ],
      [
        `com.0xkey.oauth.transaction.v1:${secondId}`,
        {
          service: `com.0xkey.oauth.transaction.v1:${secondId}`,
          storage: "synthetic",
          username: "0xkey-oauth-transaction-v1",
          password: "record-two-secret",
        },
      ],
    ]);
    await expect(storage.get(firstKey)).resolves.toBe("record-one-secret");
    await expect(storage.get(secondKey)).resolves.toBe("record-two-secret");
  });

  it("treats only native false as absence and rejects foreign or malformed credentials", async () => {
    const id = "11111111111111111111111111111111";
    const key = `0xkey.oauth.transaction.v1.${id}`;
    const service = `com.0xkey.oauth.transaction.v1:${id}`;
    const keychain = createSyntheticKeychain();
    const storage = loadModule().createOAuthKeychainStorage(keychain);

    await expect(storage.get(key)).resolves.toBeNull();

    keychain.values.set(service, {
      service,
      storage: "synthetic",
      username: "foreign-secret-username",
      password: "record-secret",
    });
    const foreignFailure = await storage.get(key).catch((error) => error);
    expect(foreignFailure).toMatchObject({
      message: "OAuth transaction secure storage failed",
    });
    expect(String(foreignFailure)).not.toContain("foreign-secret-username");
    expect(String(foreignFailure)).not.toContain("record-secret");

    keychain.values.set(service, {
      service,
      storage: "synthetic",
      username: "0xkey-oauth-transaction-v1",
      password: 7,
    } as unknown as SyntheticCredentials);
    await expect(storage.get(key)).rejects.toThrow(
      "OAuth transaction secure storage failed",
    );
  });

  it.each(
    ["array", "coercible object", "throwing object"].flatMap((shape) =>
      (["get", "set", "remove"] as const).map(
        (operation) => [shape, operation] as const,
      ),
    ),
  )(
    "rejects a runtime %s key on %s without coercion or native I/O",
    async (shape, operation) => {
      const keychain = createSyntheticKeychain();
      const storage = loadModule().createOAuthKeychainStorage(keychain);
      const validKey =
        "0xkey.oauth.transaction.v1.11111111111111111111111111111111";
      let coercions = 0;
      const invalidKey = shape === "array" ? [validKey] : {};
      Object.assign(invalidKey, {
        toString() {
          coercions++;
          if (shape === "throwing object") throw new Error("coercion-secret");
          return validKey;
        },
      });
      const failure = await (
        operation === "set"
          ? storage.set(invalidKey as unknown as string, "record-secret")
          : storage[operation](invalidKey as unknown as string)
      ).catch((error: unknown) => error);
      expect(failure).toMatchObject({
        message: "OAuth transaction secure storage failed",
      });
      expect(String(failure)).not.toContain("coercion-secret");
      expect(coercions).toBe(0);
      expect(keychain.calls).toEqual([]);
      expect(keychain.values.size).toBe(0);
    },
  );

  it("rejects invalid keys and non-string values before native I/O", async () => {
    const keychain = createSyntheticKeychain();
    const storage = loadModule().createOAuthKeychainStorage(keychain);
    for (const key of [
      "",
      "0xkey.oauth.transaction.v1.1111111111111111111111111111111",
      "0xkey.oauth.transaction.v1.1111111111111111111111111111111A",
      "other.11111111111111111111111111111111",
    ]) {
      await expect(storage.get(key)).rejects.toThrow(
        "OAuth transaction secure storage failed",
      );
      await expect(storage.remove(key)).rejects.toThrow(
        "OAuth transaction secure storage failed",
      );
      await expect(storage.set(key, "record-secret")).rejects.toThrow(
        "OAuth transaction secure storage failed",
      );
    }
    await expect(
      storage.set(
        "0xkey.oauth.transaction.v1.11111111111111111111111111111111",
        7 as unknown as string,
      ),
    ).rejects.toThrow("OAuth transaction secure storage failed");
    expect(keychain.calls).toEqual([]);
  });

  it.each(["false", "throw-before", "throw-after"])(
    "reports a sanitized failure when a native set returns or throws %s",
    async (behavior) => {
      const id = "11111111111111111111111111111111";
      const key = `0xkey.oauth.transaction.v1.${id}`;
      const service = `com.0xkey.oauth.transaction.v1:${id}`;
      const keychain = createSyntheticKeychain();
      keychain.setGenericPassword = async (username, password, options) => {
        keychain.calls.push(["set", username, password, options]);
        if (behavior === "false") return false;
        if (behavior === "throw-before")
          throw new Error("native-set-bridge-secret");
        keychain.values.set(options.service, {
          service: options.service,
          storage: "synthetic",
          username,
          password,
        });
        throw new Error("native-set-after-write-secret");
      };
      const storage = loadModule().createOAuthKeychainStorage(keychain);

      const failure = await storage
        .set(key, "record-value-secret")
        .catch((error) => error);

      expect(failure).toMatchObject({
        message: "OAuth transaction secure storage failed",
      });
      expect(String(failure)).not.toContain("bridge-secret");
      expect(String(failure)).not.toContain("record-value-secret");
      if (behavior === "throw-after") {
        expect(keychain.values.get(service)?.password).toBe(
          "record-value-secret",
        );
      } else {
        expect(keychain.values.has(service)).toBe(false);
      }
    },
  );

  it("protects a foreign username from set and remove", async () => {
    const id = "11111111111111111111111111111111";
    const key = `0xkey.oauth.transaction.v1.${id}`;
    const service = `com.0xkey.oauth.transaction.v1:${id}`;
    const keychain = createSyntheticKeychain();
    const foreign = {
      service,
      storage: "synthetic",
      username: "foreign-username-secret",
      password: "foreign-password-secret",
    };
    keychain.values.set(service, foreign);
    const storage = loadModule().createOAuthKeychainStorage(keychain);

    await expect(storage.set(key, "replacement-secret")).rejects.toThrow(
      "OAuth transaction secure storage failed",
    );
    await expect(storage.remove(key)).rejects.toThrow(
      "OAuth transaction secure storage failed",
    );

    expect(keychain.values.get(service)).toEqual(foreign);
    expect(keychain.calls.filter(([operation]) => operation !== "get")).toEqual(
      [],
    );
  });

  it("removes an owned record and treats exact absence as idempotent", async () => {
    const id = "11111111111111111111111111111111";
    const key = `0xkey.oauth.transaction.v1.${id}`;
    const service = `com.0xkey.oauth.transaction.v1:${id}`;
    const keychain = createSyntheticKeychain();
    const storage = loadModule().createOAuthKeychainStorage(keychain);

    await expect(storage.remove(key)).resolves.toBeUndefined();
    await storage.set(key, "record-secret");
    await expect(storage.remove(key)).resolves.toBeUndefined();
    expect(keychain.values.has(service)).toBe(false);
  });

  it.each([
    ["false-before-delete", false, false, true],
    ["false-after-delete", false, true, false],
    ["throw-before-delete", true, false, true],
    ["throw-after-delete", true, true, false],
  ])(
    "handles native reset %s only according to an exact follow-up get",
    async (_label, throws, deletes, shouldReject) => {
      const id = "11111111111111111111111111111111";
      const key = `0xkey.oauth.transaction.v1.${id}`;
      const service = `com.0xkey.oauth.transaction.v1:${id}`;
      const keychain = createSyntheticKeychain();
      const storage = loadModule().createOAuthKeychainStorage(keychain);
      await storage.set(key, "record-secret");
      keychain.resetGenericPassword = async (options) => {
        keychain.calls.push(["reset", options]);
        if (deletes) keychain.values.delete(options.service);
        if (throws) throw new Error("native-reset-bridge-secret");
        return false;
      };

      const outcome = storage.remove(key);
      if (shouldReject) {
        const failure = await outcome.catch((error) => error);
        expect(failure).toMatchObject({
          message: "OAuth transaction secure storage failed",
        });
        expect(String(failure)).not.toContain("bridge-secret");
        expect(String(failure)).not.toContain("record-secret");
        expect(keychain.values.has(service)).toBe(true);
      } else {
        await expect(outcome).resolves.toBeUndefined();
        expect(keychain.values.has(service)).toBe(false);
      }
    },
  );

  it("integrates two stores through one storage identity and returns a verifier only after durable removal", async () => {
    const keychain = createSyntheticKeychain();
    const storage = loadModule().createOAuthKeychainStorage(keychain);
    const firstStore = createTransactionStore(storage, 1);
    const secondStore = createTransactionStore(storage, 2);
    const first = await firstStore.beginOAuthTransaction(transactionInput());
    const second = await secondStore.beginOAuthTransaction(
      transactionInput({
        publicKey: "public-key-2",
        expectedState: "provider=google&state=two",
        codeVerifier: "verifier-secret-2",
      }),
    );
    expect([...keychain.values.keys()]).toEqual([
      "com.0xkey.oauth.transaction.v1:01010101010101010101010101010101",
      "com.0xkey.oauth.transaction.v1:02020202020202020202020202020202",
    ]);

    let releaseReset: (() => void) | undefined;
    let signalResetStarted: (() => void) | undefined;
    const resetStarted = new Promise<void>((resolve) => {
      signalResetStarted = resolve;
    });
    keychain.resetGenericPassword = async (options) => {
      keychain.calls.push(["reset", options]);
      signalResetStarted?.();
      await new Promise<void>((resolve) => {
        releaseReset = resolve;
      });
      keychain.values.delete(options.service);
      return true;
    };
    let settled = false;
    const consuming = secondStore.consumeOAuthTransaction(
      first.id,
      "provider=google&state=one",
      { configId: "config-1", provider: OAuthProviders.GOOGLE },
    );
    void consuming.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await resetStarted;
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(
      keychain.values.has(
        "com.0xkey.oauth.transaction.v1:01010101010101010101010101010101",
      ),
    ).toBe(true);

    releaseReset?.();
    await expect(consuming).resolves.toMatchObject({
      id: first.id,
      codeVerifier: "verifier-secret-1",
    });
    expect(
      keychain.values.has(
        "com.0xkey.oauth.transaction.v1:01010101010101010101010101010101",
      ),
    ).toBe(false);
    expect(
      keychain.values.has(
        "com.0xkey.oauth.transaction.v1:02020202020202020202020202020202",
      ),
    ).toBe(true);
    keychain.resetGenericPassword = async (options) => {
      keychain.calls.push(["reset", options]);
      return keychain.values.delete(options.service);
    };
    await expect(
      firstStore.consumeOAuthTransaction(
        second.id,
        "provider=google&state=two",
        { configId: "config-1", provider: OAuthProviders.GOOGLE },
      ),
    ).resolves.toMatchObject({ codeVerifier: "verifier-secret-2" });
  });

  it("serializes a failed removal retry across stores without duplicate redemption", async () => {
    const keychain = createSyntheticKeychain();
    const storage = loadModule().createOAuthKeychainStorage(keychain);
    const firstStore = createTransactionStore(storage, 3);
    const secondStore = createTransactionStore(storage, 4);
    const begun = await firstStore.beginOAuthTransaction(transactionInput());
    let resetAttempts = 0;
    keychain.resetGenericPassword = async (options) => {
      keychain.calls.push(["reset", options]);
      resetAttempts += 1;
      if (resetAttempts === 1)
        throw new Error("native-reset-before-delete-secret");
      keychain.values.delete(options.service);
      return true;
    };

    const results = await Promise.allSettled([
      firstStore.consumeOAuthTransaction(
        begun.id,
        transactionInput().expectedState,
        { configId: "config-1", provider: OAuthProviders.GOOGLE },
      ),
      secondStore.consumeOAuthTransaction(
        begun.id,
        transactionInput().expectedState,
        { configId: "config-1", provider: OAuthProviders.GOOGLE },
      ),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const fulfilled = results.find((result) => result.status === "fulfilled");
    const rejected = results.find((result) => result.status === "rejected");
    if (!fulfilled || fulfilled.status !== "fulfilled")
      throw new Error("expected one fulfilled consume");
    if (!rejected || rejected.status !== "rejected")
      throw new Error("expected one rejected consume");
    expect(fulfilled.value).toMatchObject({
      codeVerifier: "verifier-secret-1",
    });
    expect(rejected.reason).toMatchObject({
      message: "OAuth transaction persistence failed",
    });
    expect(resetAttempts).toBe(2);
    await expect(
      firstStore.consumeOAuthTransaction(
        begun.id,
        transactionInput().expectedState,
        { configId: "config-1", provider: OAuthProviders.GOOGLE },
      ),
    ).rejects.toThrow("OAuth transaction unavailable");
  });

  it("integrates exact cancellation with key cleanup and idempotent storage removal", async () => {
    const keychain = createSyntheticKeychain();
    const storage = loadModule().createOAuthKeychainStorage(keychain);
    const cleaned: string[] = [];
    const store = createTransactionStore(storage, 5, async (publicKey) => {
      cleaned.push(publicKey);
    });
    const begun = await store.beginOAuthTransaction(transactionInput());

    await expect(
      store.cancelOAuthTransaction(begun.id),
    ).resolves.toBeUndefined();
    expect(cleaned).toEqual(["public-key-1"]);
    expect(keychain.values.size).toBe(0);
    await expect(
      store.cancelOAuthTransaction(begun.id),
    ).resolves.toBeUndefined();
    expect(cleaned).toEqual(["public-key-1"]);
  });
});
