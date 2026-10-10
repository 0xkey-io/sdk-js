import { afterEach, expect, it, jest } from "@jest/globals";
import { ZeroXKeyClient } from "../__clients__/core";
import { AuthStorageManager } from "../__storage__/auth-storage";
import * as storageFactory from "../__storage__/base";
import type { RawAuthStorage } from "../__storage__/auth-reset";
import * as utils from "../utils";

const target = {
  organizationId: "org-A",
  apiBaseUrl: "https://api.example.test",
  authProxyUrl: "https://auth.example.test",
};
const token = `header.${Buffer.from(
  JSON.stringify({
    exp: 2_000_000_000,
    public_key: "A-key",
    session_type: "SESSION_TYPE_READ_WRITE",
    user_id: "A-user",
    organization_id: "child-org",
  }),
).toString("base64url")}.signature`;
const emptyRaw = (): RawAuthStorage => ({
  identity: {},
  get: async () => null,
  set: async () => undefined,
  remove: async () => undefined,
  cleanup: async () => undefined,
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as any).window;
});

it("waits for a dispatched native write and durable retirement before replacement init", async () => {
  (globalThis as any).window = {};
  jest.spyOn(utils, "isWeb").mockReturnValue(true);
  jest.spyOn(utils, "isReactNative").mockReturnValue(false);
  const values = new Map<string, string>();
  const raw: RawAuthStorage = {
    identity: values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
    cleanup: async () => undefined,
  };
  let dispatched!: () => void;
  const writeDispatched = new Promise<void>((resolve) => {
    dispatched = resolve;
  });
  let commit!: () => void;
  const allowCommit = new Promise<void>((resolve) => {
    commit = resolve;
  });
  let nativeCommitted = false;
  let nativeRetired = false;
  const native = {
    read: async () => undefined,
    transact: async (_key: string, update: (current: unknown) => unknown) => {
      update(undefined);
      dispatched();
      await allowCommit;
      nativeCommitted = true;
    },
    retire: async () => {
      await allowCommit;
      nativeRetired = true;
    },
  };
  const oldStorage = new AuthStorageManager(raw, native);
  oldStorage.restrictToNewSessions();
  await oldStorage.bindTarget(target);
  const oldClient = new ZeroXKeyClient(target);
  (oldClient as any).authDependencies.storageManager = oldStorage;
  const oldWrite = oldStorage.storeSession(token).catch((error) => error);
  await writeDispatched;

  oldClient.retireAuthWrites();
  let retirementComplete = false;
  const retirement = oldClient.awaitAuthRetirement().then(() => {
    retirementComplete = true;
  });
  const factory = jest
    .spyOn(storageFactory, "createStorageManager")
    .mockImplementation(async () => new AuthStorageManager(raw));
  const replacement = new ZeroXKeyClient(target);
  const initialization = replacement.init();
  await Promise.resolve();
  await Promise.resolve();
  expect(factory).not.toHaveBeenCalled();
  expect(retirementComplete).toBe(false);
  expect(nativeRetired).toBe(false);

  commit();
  await retirement;
  await oldWrite;
  await initialization;
  expect(nativeCommitted).toBe(true);
  expect(nativeRetired).toBe(true);
  expect(factory).toHaveBeenCalledTimes(1);
});

it("waits when retirement starts while the old init is still obtaining storage", async () => {
  (globalThis as any).window = {};
  jest.spyOn(utils, "isWeb").mockReturnValue(true);
  jest.spyOn(utils, "isReactNative").mockReturnValue(false);
  const values = new Map<string, string>();
  const raw: RawAuthStorage = {
    identity: values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
    cleanup: async () => undefined,
  };
  let entered!: () => void;
  const factoryEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let finishFactory!: () => void;
  const allowFactory = new Promise<void>((resolve) => {
    finishFactory = resolve;
  });
  let finishRetirement!: () => void;
  const allowRetirement = new Promise<void>((resolve) => {
    finishRetirement = resolve;
  });
  let retirementStarted!: () => void;
  const didStartRetirement = new Promise<void>((resolve) => {
    retirementStarted = resolve;
  });
  let nativeRetirementStarted = false;
  const oldStorage = new AuthStorageManager(raw);
  oldStorage.retireAuthAccess = async () => {
    nativeRetirementStarted = true;
    retirementStarted();
    await allowRetirement;
  };
  const factory = jest
    .spyOn(storageFactory, "createStorageManager")
    .mockImplementationOnce(async () => {
      entered();
      await allowFactory;
      return oldStorage;
    })
    .mockImplementation(async () => new AuthStorageManager(raw));
  const oldClient = new ZeroXKeyClient(target);
  const oldInit = oldClient.init().catch((error) => error);
  await factoryEntered;
  oldClient.retireAuthWrites();
  const replacement = new ZeroXKeyClient(target);
  const replacementInit = replacement.init();
  await Promise.resolve();
  await Promise.resolve();
  expect(factory).toHaveBeenCalledTimes(1);

  finishFactory();
  await didStartRetirement;
  expect(nativeRetirementStarted).toBe(true);
  expect(factory).toHaveBeenCalledTimes(1);
  finishRetirement();
  await oldClient.awaitAuthRetirement();
  expect(await oldInit).toBeInstanceOf(Error);
  await replacementInit;
  expect(factory).toHaveBeenCalledTimes(2);
});

it("does not open storage when an already retired client calls init", async () => {
  const factory = jest
    .spyOn(storageFactory, "createStorageManager")
    .mockImplementation(async () => new AuthStorageManager(emptyRaw()));
  const client = new ZeroXKeyClient(target);
  client.retireAuthWrites();

  await expect(client.init()).rejects.toMatchObject({
    code: "CLIENT_NOT_INITIALIZED",
  });
  expect(factory).not.toHaveBeenCalled();
});

it("does not open storage when retired while awaiting an earlier barrier", async () => {
  let releaseRetirement!: () => void;
  const heldRetirement = new Promise<void>((resolve) => {
    releaseRetirement = resolve;
  });
  const old = new ZeroXKeyClient(target);
  (old as any).authDependencies.storageManager = {
    revokeAuthAccess: () => undefined,
    retireAuthAccess: () => heldRetirement,
  };
  old.retireAuthWrites();
  const factory = jest
    .spyOn(storageFactory, "createStorageManager")
    .mockImplementation(async () => new AuthStorageManager(emptyRaw()));
  const next = new ZeroXKeyClient(target);
  const initialization = next.init();
  next.retireAuthWrites();

  releaseRetirement();
  await expect(initialization).rejects.toMatchObject({
    code: "CLIENT_NOT_INITIALIZED",
  });
  await next.awaitAuthRetirement();
  expect(factory).not.toHaveBeenCalled();
});
