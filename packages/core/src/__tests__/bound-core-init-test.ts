import { afterEach, expect, it, jest } from "@jest/globals";
import { ZeroXKeyClient } from "../__clients__/core";
import { AuthStorageManager } from "../__storage__/auth-storage";
import * as storageFactory from "../__storage__/base";
import * as utils from "../utils";

const token = `header.${Buffer.from(
  JSON.stringify({
    exp: 2_000_000_000,
    public_key: "A-key",
    session_type: "SESSION_TYPE_READ_WRITE",
    user_id: "A-user",
    organization_id: "child-org",
  }),
).toString("base64url")}.signature`;

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as any).window;
});

it("Core cold init restores only a target-bound session from an atomic adapter", async () => {
  (globalThis as any).window = {};
  jest.spyOn(utils, "isWeb").mockReturnValue(true);
  jest.spyOn(utils, "isReactNative").mockReturnValue(false);
  const rawValues = new Map<string, string>();
  const raw = {
    identity: rawValues,
    get: async (key: string) => rawValues.get(key) ?? null,
    set: async (key: string, value: string) => {
      rawValues.set(key, value);
    },
    remove: async (key: string) => {
      rawValues.delete(key);
    },
    cleanup: async () => undefined,
  };
  const records = new Map<string, unknown>();
  let tail = Promise.resolve();
  const atomic = {
    read: async (key: string) => records.get(key),
    transact: (key: string, update: (current: unknown) => unknown) => {
      const work = tail.then(() => {
        const next = update(records.get(key));
        if (next === undefined) records.delete(key);
        else records.set(key, next);
        return next;
      });
      tail = work.then(
        () => undefined,
        () => undefined,
      );
      return work;
    },
  };
  jest
    .spyOn(storageFactory, "createStorageManager")
    .mockImplementation(async () => new AuthStorageManager(raw, atomic));
  const config = {
    organizationId: "org-A",
    apiBaseUrl: "https://api.example.test",
    authProxyUrl: "https://auth.example.test",
    authProxyConfigId: "config-A",
  };

  const firstA = new ZeroXKeyClient(config);
  await firstA.init();
  await firstA.storeSession({ sessionToken: token });
  const reloadedA = new ZeroXKeyClient(config);
  await reloadedA.init();
  expect((await reloadedA.getSession())?.token).toBe(token);

  const firstB = new ZeroXKeyClient({ ...config, organizationId: "org-B" });
  await firstB.init();
  expect(await firstB.getSession()).toBeUndefined();
});

it("does not delete a key reused by another tab when stale clear loses the record race", async () => {
  (globalThis as any).window = {};
  jest.spyOn(utils, "isWeb").mockReturnValue(true);
  jest.spyOn(utils, "isReactNative").mockReturnValue(false);
  const rawValues = new Map<string, string>();
  const raw = {
    identity: rawValues,
    get: async (key: string) => rawValues.get(key) ?? null,
    set: async (key: string, value: string) => {
      rawValues.set(key, value);
    },
    remove: async (key: string) => {
      rawValues.delete(key);
    },
    cleanup: async () => undefined,
  };
  const records = new Map<string, unknown>();
  let tail = Promise.resolve();
  const atomic = {
    read: async (key: string) => records.get(key),
    transact: (key: string, update: (current: unknown) => unknown) => {
      const work = tail.then(() => {
        const next = update(records.get(key));
        records.set(key, next);
        return next;
      });
      tail = work.then(
        () => undefined,
        () => undefined,
      );
      return work;
    },
  };
  jest
    .spyOn(storageFactory, "createStorageManager")
    .mockImplementation(async () => new AuthStorageManager(raw, atomic));
  const config = {
    organizationId: "org-A",
    apiBaseUrl: "https://api.example.test",
    authProxyUrl: "https://auth.example.test",
    authProxyConfigId: "config-A",
  };
  const first = new ZeroXKeyClient(config);
  await first.init();
  await first.storeSession({ sessionToken: token });
  const second = new ZeroXKeyClient(config);
  await second.init();

  const deleted: string[] = [];
  (first as any).apiKeyStamper = {
    deleteKeyPair: async (publicKey: string) => {
      deleted.push(publicKey);
    },
  };
  const storage = (first as any).storageManager as AuthStorageManager;
  const originalClear = storage.clearSession.bind(storage);
  let clearEntered!: () => void;
  let releaseClear!: () => void;
  const entered = new Promise<void>((resolve) => {
    clearEntered = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseClear = resolve;
  });
  storage.clearSession = async (key) => {
    clearEntered();
    await released;
    return originalClear(key);
  };
  const pendingClear = first.clearSession();
  await entered;
  const replacementToken = `header.${Buffer.from(
    JSON.stringify({
      exp: 2_000_000_000,
      public_key: "A-key",
      session_type: "SESSION_TYPE_READ_WRITE",
      user_id: "B-user",
      organization_id: "child-org",
    }),
  ).toString("base64url")}.signature`;
  // A separate tab has its own Core mutation queue but shares the IDB record.
  await (second as any).storageManager.storeSession(replacementToken);
  releaseClear();
  await pendingClear;

  expect((await second.getSession())?.token).toBe(replacementToken);
  expect(deleted).toEqual([]);
});
