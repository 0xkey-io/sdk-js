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
