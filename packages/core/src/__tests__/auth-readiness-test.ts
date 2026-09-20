import { afterEach, expect, it, jest } from "@jest/globals";
import { ZeroXKeyClient } from "../__clients__/core";
import { CrossPlatformApiKeyStamper } from "../__stampers__/api/base";
import * as factory from "../__storage__/base";
import * as utils from "../utils";
import WindowWrapper from "@polyfills/window";

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as any).window;
});

it("allows configuring an MFA handler before initialization without exposing HTTP", () => {
  const client = new ZeroXKeyClient({ organizationId: "org" });
  const handler = async () => undefined;
  client.setMfaHandler(handler);
  expect(client.config.onMfaRequired).toBe(handler);
  expect(() => client.httpClient).toThrow();
});

it("constructor injection cannot create keys, store sessions or expose HTTP before init", async () => {
  const injected = {
    createKeyPair: async () => "old-injected-key",
  } as CrossPlatformApiKeyStamper;
  const client = new ZeroXKeyClient({ organizationId: "org" }, injected);
  await expect(client.createApiKeyPair()).rejects.toMatchObject({
    code: "CLIENT_NOT_INITIALIZED",
  });
  await expect(
    client.storeSession({ sessionToken: "synthetic" }),
  ).rejects.toMatchObject({ code: "CLIENT_NOT_INITIALIZED" });
  expect(() => client.createHttpClient()).toThrow();
  expect(() => client.httpClient).toThrow();
});

it("coalesces pending init, fails closed, retries real preparation, then is idempotent", async () => {
  (globalThis as any).window = {};
  jest.spyOn(utils, "isWeb").mockReturnValue(true);
  jest.spyOn(utils, "isReactNative").mockReturnValue(false);
  const raw = new Map<string, string>();
  let failRead = true;
  jest
    .spyOn(WindowWrapper.localStorage, "getItem")
    .mockImplementation((key) => {
      if (failRead) throw new Error("secret-storage-value");
      return raw.get(key) ?? null;
    });
  jest
    .spyOn(WindowWrapper.localStorage, "setItem")
    .mockImplementation((key, value) => {
      raw.set(key, value);
    });
  jest
    .spyOn(WindowWrapper.localStorage, "removeItem")
    .mockImplementation((key) => {
      raw.delete(key);
    });
  const originalFactory = factory.createStorageManager;
  let reentrant: Promise<void> | undefined;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  jest.spyOn(factory, "createStorageManager").mockImplementation(async () => {
    await gate;
    reentrant = client.init();
    return originalFactory();
  });
  jest
    .spyOn(CrossPlatformApiKeyStamper.prototype, "createKeyPair")
    .mockResolvedValue("new-key");
  const client = new ZeroXKeyClient({ organizationId: "org" }, {
    createKeyPair: async () => "old-key",
  } as CrossPlatformApiKeyStamper);
  const first = client.init();
  const same = client.init();
  expect(first).toBe(same);
  await expect(client.createApiKeyPair()).rejects.toMatchObject({
    code: "CLIENT_NOT_INITIALIZED",
  });
  release();
  await expect(first).rejects.toMatchObject({
    code: "LOCAL_AUTH_RESET_FAILED",
    stage: "read_marker",
    retryable: true,
  });
  await expect(same).rejects.toThrow("Local authentication reset failed");
  expect(reentrant).toBe(first);
  expect(raw.has("@0xkey-io/auth-reset/v2")).toBe(false);
  await expect(client.createApiKeyPair()).rejects.toMatchObject({
    code: "CLIENT_NOT_INITIALIZED",
  });
  expect(() => client.createHttpClient()).toThrow();
  failRead = false;
  const actualStamperInit = CrossPlatformApiKeyStamper.prototype.init;
  const stamperInit = jest
    .spyOn(CrossPlatformApiKeyStamper.prototype, "init")
    .mockRejectedValueOnce(new Error("stamper init failed"));
  await expect(client.init()).rejects.toThrow("stamper init failed");
  await expect(client.createApiKeyPair()).rejects.toMatchObject({
    code: "CLIENT_NOT_INITIALIZED",
  });
  expect(() => client.httpClient).toThrow();
  stamperInit.mockImplementation(actualStamperInit);
  await client.init();
  expect(raw.get("@0xkey-io/auth-reset/v2")).toBe("complete");
  expect(await client.createApiKeyPair()).toBe("new-key");
  const http = client.httpClient;
  await client.init();
  expect(client.httpClient).toBe(http);
  expect(client.createHttpClient()).toBeDefined();
});
