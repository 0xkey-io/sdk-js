import { describe, expect, it } from "@jest/globals";
import {
  ZeroXKeyError,
  ZeroXKeyErrorCodes,
  type Session,
} from "@0xkey-io/sdk-types";
import {
  ZeroXKeyClient,
  type ZeroXKeyClientMethods,
} from "../__clients__/core";
import { CrossPlatformApiKeyStamper } from "../__stampers__/api/base";
import type {
  ApiKeyStamperBase,
  DeleteKeyPairOptions,
  StorageBase,
  TStamp,
} from "../__types__";

type Expect<T extends true> = T;
type DiscardExistsOnCoreClient = Expect<
  "discardUncommittedApiKeyPair" extends keyof ZeroXKeyClient ? true : false
>;
type DiscardIsExcludedFromConvenienceMethods = Expect<
  "discardUncommittedApiKeyPair" extends keyof ZeroXKeyClientMethods
    ? false
    : true
>;

const compileTimeContract: [
  DiscardExistsOnCoreClient,
  DiscardIsExcludedFromConvenienceMethods,
] = [true, true];

void compileTimeContract;

class StatefulKeyStore implements ApiKeyStamperBase {
  readonly keys = new Set<string>();
  readonly legacyKeys = new Set<string>();
  deleteError?: Error;

  async listKeyPairs(): Promise<string[]> {
    return [...this.keys];
  }

  async createKeyPair(): Promise<string> {
    throw new Error("not used by this test");
  }

  async deleteKeyPair(
    publicKeyHex: string,
    options?: DeleteKeyPairOptions,
  ): Promise<void> {
    if (this.deleteError) throw this.deleteError;
    if (this.keys.delete(publicKeyHex)) return;
    if (options?.legacyFallback !== false) {
      this.legacyKeys.delete(publicKeyHex);
    }
  }

  async stamp(): Promise<TStamp> {
    throw new Error("not used by this test");
  }

  async sign(): Promise<string> {
    throw new Error("not used by this test");
  }
}

class StatefulSessionStore implements StorageBase {
  readonly sessions = new Map<string, Session>();
  readonly tokenPublicKeys = new Map<string, string>();
  storeError?: ZeroXKeyError;
  failAfterSessionWrite = false;
  activeSessionKey?: string;

  async getStorageValue(sessionKey: string): Promise<unknown> {
    return this.sessions.get(sessionKey);
  }

  async setStorageValue(): Promise<void> {
    throw new Error("not used by this test");
  }

  async setActiveSessionKey(sessionKey: string): Promise<void> {
    this.activeSessionKey = sessionKey;
  }

  async removeStorageValue(sessionKey: string): Promise<void> {
    this.sessions.delete(sessionKey);
  }

  async storeSession(session: string, sessionKey = "default"): Promise<void> {
    const publicKey = this.tokenPublicKeys.get(session);
    if (!publicKey) throw new Error(`unknown session token: ${session}`);

    if (this.storeError && !this.failAfterSessionWrite) throw this.storeError;

    this.sessions.set(sessionKey, {
      token: session,
      publicKey,
    } as Session);

    if (this.storeError) throw this.storeError;
    this.activeSessionKey = sessionKey;
  }

  async getSession(sessionKey = "default"): Promise<Session | undefined> {
    return this.sessions.get(sessionKey);
  }

  async getActiveSessionKey(): Promise<string | undefined> {
    return this.activeSessionKey;
  }

  async getActiveSession(): Promise<Session | undefined> {
    return this.activeSessionKey
      ? this.sessions.get(this.activeSessionKey)
      : undefined;
  }

  async listSessionKeys(): Promise<string[]> {
    return [...this.sessions.keys()];
  }

  async clearSession(sessionKey: string): Promise<void> {
    this.sessions.delete(sessionKey);
  }

  async clearAllSessions(): Promise<void> {
    this.sessions.clear();
  }
}

function createHarness() {
  const storage = new StatefulSessionStore();
  const keyStore = new StatefulKeyStore();
  const stamper = new CrossPlatformApiKeyStamper(storage);
  (stamper as any).stamper = keyStore;

  const client = new ZeroXKeyClient({ organizationId: "org-id" }, stamper);
  (client as any).storageManager = storage;
  (client as any).authReady = true;

  return { client, keyStore, stamper, storage };
}

describe("conservative key retention", () => {
  it("retains an unrelated key when storing a session succeeds", async () => {
    const { client, keyStore, storage } = createHarness();
    keyStore.keys.add("key-a");
    keyStore.keys.add("key-b-pending");
    storage.tokenPublicKeys.set("session-a", "key-a");

    await client.storeSession({ sessionToken: "session-a" });

    expect([...keyStore.keys].sort()).toEqual(["key-a", "key-b-pending"]);
  });

  it("retains every key when session storage fails before persistence", async () => {
    const { client, keyStore, storage } = createHarness();
    const storageError = new ZeroXKeyError(
      "session index unavailable",
      ZeroXKeyErrorCodes.STORE_SESSION_ERROR,
    );
    keyStore.keys.add("key-a");
    keyStore.keys.add("key-b-pending");
    storage.tokenPublicKeys.set("session-a", "key-a");
    storage.storeError = storageError;

    await expect(
      client.storeSession({ sessionToken: "session-a" }),
    ).rejects.toBe(storageError);
    expect([...keyStore.keys].sort()).toEqual(["key-a", "key-b-pending"]);
  });

  it("makes legacy clearUnusedKeyPairs conservative for pending and callback-owned keys", async () => {
    const { client, keyStore } = createHarness();
    keyStore.keys.add("pending-key");
    keyStore.keys.add("callback-owned-key");

    await expect(client.clearUnusedKeyPairs()).resolves.toBeUndefined();

    expect([...keyStore.keys].sort()).toEqual([
      "callback-owned-key",
      "pending-key",
    ]);
  });

  it("preserves a caller-owned key and the original remote OAuth error", async () => {
    const { client, keyStore } = createHarness();
    const remoteError = new ZeroXKeyError(
      "remote OAuth failure",
      ZeroXKeyErrorCodes.OAUTH_LOGIN_ERROR,
    );
    keyStore.keys.add("caller-key");
    (client as any).httpClient = {
      proxyOAuthLogin: async () => {
        throw remoteError;
      },
    };

    await expect(
      client.loginWithOauth({ oidcToken: "oidc", publicKey: "caller-key" }),
    ).rejects.toBe(remoteError);
    expect(keyStore.keys).toEqual(new Set(["caller-key"]));
  });

  it("preserves a caller-owned key and storage error after partial session persistence", async () => {
    const { client, keyStore, storage } = createHarness();
    const storageError = new ZeroXKeyError(
      "active session update failed",
      ZeroXKeyErrorCodes.STORE_SESSION_ERROR,
    );
    keyStore.keys.add("caller-key");
    storage.tokenPublicKeys.set("oauth-session", "caller-key");
    storage.storeError = storageError;
    storage.failAfterSessionWrite = true;
    (client as any).httpClient = {
      proxyOAuthLogin: async () => ({ session: "oauth-session" }),
    };

    await expect(
      client.loginWithOauth({ oidcToken: "oidc", publicKey: "caller-key" }),
    ).rejects.toBe(storageError);
    expect([...storage.sessions.values()]).toEqual([
      expect.objectContaining({ publicKey: "caller-key" }),
    ]);
    expect(keyStore.keys).toEqual(new Set(["caller-key"]));
  });
});

describe("discardUncommittedApiKeyPair", () => {
  it("deletes only the exact designated key", async () => {
    const { client, keyStore } = createHarness();
    keyStore.keys.add("discard-me");
    keyStore.keys.add("keep-me");
    keyStore.legacyKeys.add("discard-me");

    await client.discardUncommittedApiKeyPair("discard-me");
    await client.discardUncommittedApiKeyPair("discard-me");

    expect(keyStore.keys).toEqual(new Set(["keep-me"]));
    expect(keyStore.legacyKeys).toEqual(new Set(["discard-me"]));
  });

  it("rejects an empty public key", async () => {
    const { client, keyStore } = createHarness();
    keyStore.keys.add("keep-me");

    await expect(client.discardUncommittedApiKeyPair("")).rejects.toMatchObject(
      { code: ZeroXKeyErrorCodes.MISSING_PARAMS },
    );
    expect(keyStore.keys).toEqual(new Set(["keep-me"]));
  });

  it("fails when the stamper is uninitialized", async () => {
    const client = new ZeroXKeyClient({ organizationId: "org-id" });

    await expect(
      client.discardUncommittedApiKeyPair("uncommitted-key"),
    ).rejects.toMatchObject({
      code: ZeroXKeyErrorCodes.CLIENT_NOT_INITIALIZED,
    });
  });

  it("preserves the temporary override when exact deletion fails", async () => {
    const { keyStore, stamper } = createHarness();
    keyStore.keys.add("temporary-key");
    keyStore.deleteError = new Error("key store unavailable");
    stamper.setTemporaryPublicKey("temporary-key");

    await expect(
      stamper.deleteKeyPair("temporary-key", { legacyFallback: false }),
    ).rejects.toThrow("key store unavailable");
    expect(stamper.getTemporaryPublicKey()).toBe("temporary-key");
  });
});

describe("shared auth persistence", () => {
  const defaultSessionKey = "@0xkey-io/session/v3";

  it("does not clear a replacement session or its key when an old read finishes late", async () => {
    const { client: oldClient, keyStore, stamper, storage } = createHarness();
    const newClient = new ZeroXKeyClient(
      { organizationId: "org-new" },
      stamper,
    );
    (newClient as any).storageManager = storage;
    (newClient as any).authReady = true;
    storage.sessions.set(defaultSessionKey, {
      token: "old",
      publicKey: "old-key",
    } as Session);
    storage.tokenPublicKeys.set("new", "new-key");
    keyStore.keys.add("old-key");
    keyStore.keys.add("new-key");

    let releaseRead!: () => void;
    let readStarted!: () => void;
    const readStartedPromise = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    const blockedRead = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const originalGetSession = storage.getSession.bind(storage);
    let reads = 0;
    storage.getSession = async (key?: string) => {
      reads += 1;
      if (reads === 1) {
        const snapshot = await originalGetSession(key);
        readStarted();
        await blockedRead;
        return snapshot;
      }
      return originalGetSession(key);
    };

    const staleClear = oldClient.clearSession({
      sessionKey: defaultSessionKey,
    });
    await readStartedPromise;
    await newClient.storeSession({ sessionToken: "new" });
    releaseRead();
    await staleClear;

    expect(storage.sessions.get(defaultSessionKey)?.token).toBe("new");
    expect(keyStore.keys.has("new-key")).toBe(true);
  });

  it("lets a replacement commit last when an older commit is already in storage", async () => {
    const { client: oldClient, stamper, storage } = createHarness();
    const newClient = new ZeroXKeyClient(
      { organizationId: "org-new" },
      stamper,
    );
    (newClient as any).storageManager = storage;
    (newClient as any).authReady = true;
    storage.tokenPublicKeys.set("old", "old-key");
    storage.tokenPublicKeys.set("new", "new-key");

    let releaseStore!: () => void;
    let storeStarted!: () => void;
    const storeStartedPromise = new Promise<void>((resolve) => {
      storeStarted = resolve;
    });
    const blockedStore = new Promise<void>((resolve) => {
      releaseStore = resolve;
    });
    const originalStoreSession = storage.storeSession.bind(storage);
    storage.storeSession = async (token: string, key?: string) => {
      if (token === "old") {
        storeStarted();
        await blockedStore;
      }
      await originalStoreSession(token, key);
    };

    const oldStore = oldClient.storeSession({ sessionToken: "old" });
    await storeStartedPromise;
    oldClient.retireAuthWrites();
    const newStore = newClient.storeSession({ sessionToken: "new" });
    releaseStore();
    await Promise.all([oldStore, newStore]);

    expect(storage.sessions.get(defaultSessionKey)?.token).toBe("new");
    await expect(
      oldClient.storeSession({ sessionToken: "old" }),
    ).rejects.toMatchObject({
      code: ZeroXKeyErrorCodes.CLIENT_NOT_INITIALIZED,
    });
  });

  it("finishes an old key deletion before a replacement session commit", async () => {
    const { client: oldClient, keyStore, stamper, storage } = createHarness();
    const newClient = new ZeroXKeyClient(
      { organizationId: "org-new" },
      stamper,
    );
    (newClient as any).storageManager = storage;
    (newClient as any).authReady = true;
    storage.sessions.set(defaultSessionKey, {
      token: "old",
      publicKey: "old-key",
    } as Session);
    storage.tokenPublicKeys.set("new", "new-key");
    keyStore.keys.add("old-key");
    keyStore.keys.add("new-key");

    let releaseDelete!: () => void;
    let deleteStarted!: () => void;
    const deleteStartedPromise = new Promise<void>((resolve) => {
      deleteStarted = resolve;
    });
    const blockedDelete = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const originalDelete = keyStore.deleteKeyPair.bind(keyStore);
    keyStore.deleteKeyPair = async (publicKey, options) => {
      if (publicKey === "old-key") {
        deleteStarted();
        await blockedDelete;
      }
      await originalDelete(publicKey, options);
    };

    const oldClear = oldClient.clearSession({ sessionKey: defaultSessionKey });
    await deleteStartedPromise;
    oldClient.retireAuthWrites();
    const newStore = newClient.storeSession({ sessionToken: "new" });
    expect(storage.sessions.has(defaultSessionKey)).toBe(false);
    releaseDelete();
    await Promise.all([oldClear, newStore]);

    expect(storage.sessions.get(defaultSessionKey)?.token).toBe("new");
    expect(keyStore.keys.has("new-key")).toBe(true);
  });
});
