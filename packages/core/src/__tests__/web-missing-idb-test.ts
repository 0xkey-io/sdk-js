import { afterEach, expect, it, jest } from "@jest/globals";
import WindowWrapper from "@polyfills/window";
import { ZeroXKeyClient } from "../__clients__/core";
import { AuthStorageManager } from "../__storage__/auth-storage";
import * as utils from "../utils";

const token = `header.${Buffer.from(
  JSON.stringify({
    exp: 2_000_000_000,
    public_key: "test-key",
    session_type: "SESSION_TYPE_READ_WRITE",
    user_id: "test-user",
    organization_id: "test-org",
  }),
).toString("base64url")}.signature`;

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as any).window;
  delete (globalThis as any).indexedDB;
});

it("fails closed without IndexedDB instead of writing an unbound v2 Web session", async () => {
  (globalThis as any).window = {};
  delete (globalThis as any).indexedDB;
  jest.spyOn(utils, "isWeb").mockReturnValue(true);
  jest.spyOn(utils, "isReactNative").mockReturnValue(false);
  const raw = new Map<string, string>();
  jest
    .spyOn(WindowWrapper.localStorage, "getItem")
    .mockImplementation((key) => raw.get(key) ?? null);
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

  const client = new ZeroXKeyClient({ organizationId: "test-org" });
  const initialized = await client.init().then(
    () => true,
    () => false,
  );
  const stored = await client.storeSession({ sessionToken: token }).then(
    () => true,
    () => false,
  );

  expect(initialized).toBe(false);
  expect(stored).toBe(false);
  expect(
    [...raw.keys()].filter((key) => key.startsWith("@0xkey-io/auth/v2/")),
  ).toEqual([]);
});

it("keeps explicit legacy storage available without IndexedDB", async () => {
  delete (globalThis as any).indexedDB;
  const raw = new Map<string, string>();
  const manager = new AuthStorageManager({
    identity: raw,
    get: async (key) => raw.get(key) ?? null,
    set: async (key, value) => {
      raw.set(key, value);
    },
    remove: async (key) => {
      raw.delete(key);
    },
    cleanup: async () => undefined,
  });

  await manager.storeSession(token);

  expect((await manager.getActiveSession())?.token).toBe(token);
  expect(
    [...raw.keys()].some((key) => key.startsWith("@0xkey-io/auth/v2/")),
  ).toBe(true);
});
