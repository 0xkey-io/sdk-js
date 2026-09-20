import { beforeEach, expect, it, jest } from "@jest/globals";
jest.mock("react-native-keychain", () => ({
  getAllGenericPasswordServices: jest.fn(),
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
import { ReactNativeKeychainStamper } from "../__stampers__/api/mobile/stamper";
import { SignatureFormat } from "@0xkey-io/api-key-stamper";
import * as utils from "../utils";
import { createStorageManager } from "../__storage__/base";
import { ZeroXKeyClient } from "../__clients__/core";

const services = new Map<string, { username: string; password: string }>();
const raw = new Map<string, string>();
const keychain: any = jest.requireMock("react-native-keychain");
const asyncStorage: any = jest.requireMock(
  "@react-native-async-storage/async-storage",
);
const pk = "036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296";
const other = "02" + "11".repeat(32);
beforeEach(() => {
  services.clear();
  raw.clear();
  jest.clearAllMocks();
  keychain.getAllGenericPasswordServices.mockImplementation(async () => [
    ...services.keys(),
  ]);
  keychain.getGenericPassword.mockImplementation(
    async ({ service }: any) => services.get(service) ?? false,
  );
  keychain.resetGenericPassword.mockImplementation(async ({ service }: any) =>
    services.delete(service),
  );
  keychain.setGenericPassword.mockImplementation(
    async (username: string, password: string, { service }: any) => {
      services.set(service, { username, password });
      return true;
    },
  );
  asyncStorage.getItem.mockImplementation(
    async (key: string) => raw.get(key) ?? null,
  );
  asyncStorage.setItem.mockImplementation(
    async (key: string, value: string) => {
      raw.set(key, value);
    },
  );
  asyncStorage.removeItem.mockImplementation(async (key: string) => {
    raw.delete(key);
  });
});
it("new native stamper neither reads nor deletes old key generations", async () => {
  services.set(pk, { username: pk, password: "old" });
  services.set(`com.0xkey.keypair:${pk}`, { username: pk, password: "old" });
  const stamper = new ReactNativeKeychainStamper();
  await expect(stamper.stamp("payload", pk)).rejects.toThrow();
  await stamper.deleteKeyPair(pk);
  expect(services.size).toBe(2);
  await stamper.createKeyPair({ publicKey: pk, privateKey: "new" });
  expect(services.get(`com.0xkey.auth.v2.keypair:${pk}`)?.password).toBe("new");
});

it("preserves sanitized diagnostics through native factory and core init", async () => {
  const native = jest.spyOn(utils, "isReactNative").mockReturnValue(true);
  keychain.getAllGenericPasswordServices.mockRejectedValue(
    new Error("synthetic-secret"),
  );
  try {
    await expect(createStorageManager()).rejects.toMatchObject({
      code: "LOCAL_AUTH_RESET_FAILED",
      stage: "clear_keys",
      retryable: true,
    });
    const client = new ZeroXKeyClient({ organizationId: "org" });
    await expect(client.init()).rejects.toMatchObject({
      code: "LOCAL_AUTH_RESET_FAILED",
      stage: "clear_keys",
      retryable: true,
    });
    await expect(client.createApiKeyPair()).rejects.toMatchObject({
      code: "CLIENT_NOT_INITIALIZED",
    });
    expect(raw.has("@0xkey-io/auth-reset/v2")).toBe(false);
  } finally {
    native.mockRestore();
  }
});
it("cleans only old prefix and associated matching unprefixed services", async () => {
  const { cleanupLegacyNativeKeys } = await import(
    "../__storage__/mobile/legacy-keys"
  );
  for (const key of [
    pk,
    other,
    "application",
    `com.0xkey.keypair:${other}`,
    `com.0xkey.auth.v2.keypair:${pk}`,
  ])
    services.set(key, { username: key, password: "synthetic" });
  await cleanupLegacyNativeKeys([pk, other]);
  expect([...services.keys()].sort()).toEqual(
    ["application", `com.0xkey.auth.v2.keypair:${pk}`].sort(),
  );
  services.set(pk, { username: "other-owner", password: "synthetic" });
  await cleanupLegacyNativeKeys([pk]);
  expect(services.has(pk)).toBe(true);
  services.set(other, { username: other, password: "unassociated" });
  await cleanupLegacyNativeKeys([]);
  expect(services.has(other)).toBe(true);
});

it.each([
  "getAllGenericPasswordServices",
  "getGenericPassword",
  "resetGenericPassword",
])(
  "rejects native %s failure without marker then retries",
  async (operation) => {
    const { MobileStorageManager } = await import(
      "../__storage__/mobile/storage"
    );
    services.set(`com.0xkey.keypair:${pk}`, {
      username: pk,
      password: "synthetic",
    });
    if (operation === "getGenericPassword")
      keychain.resetGenericPassword.mockResolvedValueOnce(false);
    keychain[operation].mockRejectedValueOnce(new Error("secret-native-error"));
    await expect(new MobileStorageManager().prepare()).rejects.toThrow(
      "Local authentication reset failed",
    );
    expect(raw.has("@0xkey-io/auth-reset/v2")).toBe(false);
    await new MobileStorageManager().prepare();
    expect(raw.get("@0xkey-io/auth-reset/v2")).toBe("complete");
  },
);

it("new native key signs after repeated preparation and marker-loss retry", async () => {
  const { MobileStorageManager } = await import(
    "../__storage__/mobile/storage"
  );
  await new MobileStorageManager().prepare();
  const stamper = new ReactNativeKeychainStamper();
  const publicKey = await stamper.createKeyPair();
  services.set(`com.0xkey.keypair:${pk}`, {
    username: pk,
    password: "old-tab-key",
  });
  raw.delete("@0xkey-io/auth-reset/v2");
  await new MobileStorageManager().prepare();
  expect(await stamper.listKeyPairs()).toEqual([publicKey]);
  expect(
    await stamper.sign("still-signs", publicKey, SignatureFormat.Raw),
  ).toBeTruthy();
});
it("fails on a native false reset while the exact service remains", async () => {
  const { cleanupLegacyNativeKeys } = await import(
    "../__storage__/mobile/legacy-keys"
  );
  services.set(`com.0xkey.keypair:${pk}`, {
    username: pk,
    password: "synthetic",
  });
  keychain.resetGenericPassword.mockResolvedValueOnce(false);
  await expect(cleanupLegacyNativeKeys([])).rejects.toThrow();
  expect(services.size).toBe(1);
  await cleanupLegacyNativeKeys([]);
  expect(services.size).toBe(0);
});
it("mobile clear-all removes mapped sessions and retains raw application names", async () => {
  const { MobileStorageManager } = await import(
    "../__storage__/mobile/storage"
  );
  const manager = new MobileStorageManager();
  raw.set("custom", "application");
  await manager.setStorageValue("custom", { token: "synthetic" });
  raw.set(
    "@0xkey-io/auth/v2/meta/all-session-keys",
    JSON.stringify(["custom"]),
  );
  await manager.clearAllSessions();
  expect(raw.get("custom")).toBe("application");
  expect(await manager.getStorageValue("custom")).toBeUndefined();
});
