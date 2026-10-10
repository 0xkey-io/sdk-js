import { describe, expect, it } from "@jest/globals";
import {
  createNativeOAuthKeychainStorage,
  type NativeOAuthKeychainModule,
} from "../utils/oauth-native-keychain-storage";

const service = "com.0xkey.oauth.native.v1:nativeUI";
const username = "0xkey-oauth-native-v1";

function bridgeFixture(): NativeOAuthKeychainModule & {
  values: Map<string, { username: string; password: string }>;
  calls: unknown[][];
  setResult: false | { service: string };
  resetResult: boolean;
} {
  const values = new Map<string, { username: string; password: string }>();
  const calls: unknown[][] = [];
  return {
    values,
    calls,
    setResult: { service },
    resetResult: true,
    async getGenericPassword(options) {
      calls.push(["get", options]);
      return values.get(options.service) ?? false;
    },
    async setGenericPassword(nextUsername, password, options) {
      calls.push(["set", nextUsername, password, options]);
      values.set(options.service, { username: nextUsername, password });
      return this.setResult;
    },
    async resetGenericPassword(options) {
      calls.push(["reset", options]);
      if (this.resetResult) values.delete(options.service);
      return this.resetResult;
    },
  };
}

describe("native OAuth fixed-slot Keychain storage", () => {
  it("loads the bridge lazily and uses only the fixed service and username", async () => {
    const bridge = bridgeFixture();
    let loads = 0;
    const storage = createNativeOAuthKeychainStorage(() => {
      loads += 1;
      return bridge;
    });
    expect(loads).toBe(0);
    await storage.write("record-canary");
    expect(loads).toBe(1);
    await expect(storage.read()).resolves.toBe("record-canary");
    await storage.remove();
    expect(bridge.calls).toEqual([
      ["get", { service }],
      ["set", username, "record-canary", { service }],
      ["get", { service }],
      ["get", { service }],
      ["reset", { service }],
    ]);
    expect([...bridge.values]).toEqual([]);
  });

  it("leaves browser transactions and API key services untouched", async () => {
    const bridge = bridgeFixture();
    const browserService = `com.0xkey.oauth.transaction.v1:${"1".repeat(32)}`;
    const keyService = "com.0xkey.auth.v2.keypair:public-key-canary";
    bridge.values.set(browserService, {
      username: "0xkey-oauth-transaction-v1",
      password: "browser-record-sensitive-canary",
    });
    bridge.values.set(keyService, {
      username: "0xkey-auth-v2",
      password: "private-key-sensitive-canary",
    });
    const storage = createNativeOAuthKeychainStorage(bridge);
    await storage.write("native-record");
    await storage.remove();
    expect(bridge.values.get(browserService)?.password).toBe(
      "browser-record-sensitive-canary",
    );
    expect(bridge.values.get(keyService)?.password).toBe(
      "private-key-sensitive-canary",
    );
    expect(
      bridge.calls.every((call) =>
        JSON.stringify(call).includes("com.0xkey.oauth.native.v1:nativeUI"),
      ),
    ).toBe(true);
  });

  it("preserves foreign credentials and sanitizes their contents", async () => {
    const bridge = bridgeFixture();
    bridge.values.set(service, {
      username: "foreign-username-secret",
      password: "foreign-password-secret",
    });
    const storage = createNativeOAuthKeychainStorage(bridge);
    for (const action of [
      () => storage.read(),
      () => storage.write("new-record"),
      () => storage.remove(),
    ]) {
      const failure = await action().catch((error) => error);
      expect(failure).toMatchObject({
        name: "NativeOAuthError",
        code: "recovery-required",
        message: "Native OAuth recovery required",
      });
      expect(String(failure)).not.toContain("foreign-username-secret");
      expect(String(failure)).not.toContain("foreign-password-secret");
    }
    expect(bridge.values.get(service)?.password).toBe(
      "foreign-password-secret",
    );
  });

  it("treats only native false as absence", async () => {
    const bridge = bridgeFixture();
    const storage = createNativeOAuthKeychainStorage(bridge);
    await expect(storage.read()).resolves.toBeNull();
    bridge.getGenericPassword = async () => null as never;
    await expect(storage.read()).rejects.toThrow(
      "Native OAuth recovery required",
    );
  });

  it("rejects false set results even when the native call mutated", async () => {
    const bridge = bridgeFixture();
    bridge.setResult = false;
    const storage = createNativeOAuthKeychainStorage(bridge);
    await expect(storage.write("record-canary")).rejects.toThrow(
      "Native OAuth recovery required",
    );
    expect(bridge.values.get(service)?.password).toBe("record-canary");
  });

  it.each(["false", "throw"])(
    "accepts a %s reset outcome only when exact readback proves absence",
    async (kind) => {
      const bridge = bridgeFixture();
      bridge.values.set(service, { username, password: "record-canary" });
      if (kind === "false") {
        bridge.resetResult = false;
        bridge.resetGenericPassword = async (options) => {
          bridge.calls.push(["reset", options]);
          bridge.values.delete(options.service);
          return false;
        };
      } else {
        bridge.resetGenericPassword = async (options) => {
          bridge.calls.push(["reset", options]);
          bridge.values.delete(options.service);
          throw new Error("native-reset-secret");
        };
      }
      const storage = createNativeOAuthKeychainStorage(bridge);
      await expect(storage.remove()).resolves.toBeUndefined();
      expect(bridge.values.size).toBe(0);
    },
  );

  it("rejects failed removal when the exact owned credential remains", async () => {
    const bridge = bridgeFixture();
    bridge.values.set(service, { username, password: "record-canary" });
    bridge.resetResult = false;
    const storage = createNativeOAuthKeychainStorage(bridge);
    await expect(storage.remove()).rejects.toThrow(
      "Native OAuth recovery required",
    );
    expect(bridge.values.get(service)?.password).toBe("record-canary");
  });

  it("sanitizes lazy bridge load and native read failures", async () => {
    const unavailable = createNativeOAuthKeychainStorage(() => {
      throw new Error("bridge-load-sensitive-canary");
    });
    const loadFailure = await unavailable.read().catch((error) => error);
    expect(loadFailure).toMatchObject({
      code: "recovery-required",
      message: "Native OAuth recovery required",
    });
    expect(String(loadFailure)).not.toContain("bridge-load-sensitive-canary");

    const bridge = bridgeFixture();
    bridge.getGenericPassword = async () => {
      throw new Error("credential-read-sensitive-canary");
    };
    const readFailure = await createNativeOAuthKeychainStorage(bridge)
      .read()
      .catch((error) => error);
    expect(String(readFailure)).not.toContain(
      "credential-read-sensitive-canary",
    );
    expect(readFailure).toMatchObject({ code: "recovery-required" });
  });
});
