import { jest } from "@jest/globals";
import WindowWrapper from "@polyfills/window";
import { ZeroXKeyClient } from "../../__clients__/core";
import { installBoundWebStore } from "./bound-web-store";

export async function createReadyClient(): Promise<ZeroXKeyClient> {
  installBoundWebStore();
  (globalThis as any).window = {};
  (globalThis as any).document = {};

  const storage = new Map<string, string>();
  jest
    .spyOn(WindowWrapper.localStorage, "getItem")
    .mockImplementation((key) => storage.get(key) ?? null);
  jest
    .spyOn(WindowWrapper.localStorage, "setItem")
    .mockImplementation((key, value) => {
      storage.set(key, value);
    });
  jest
    .spyOn(WindowWrapper.localStorage, "removeItem")
    .mockImplementation((key) => {
      storage.delete(key);
    });

  const client = new ZeroXKeyClient({ organizationId: "org-id" });
  await client.init();
  return client;
}
