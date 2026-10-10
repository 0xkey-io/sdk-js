import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-native-keychain", () => ({
  getAllGenericPasswordServices: jest.fn(),
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));

import { ReactNativeKeychainStamper } from "../__stampers__/api/mobile/stamper";

const Keychain = jest.requireMock("react-native-keychain") as {
  getGenericPassword: jest.Mock<
    (options: {
      service: string;
    }) => Promise<false | { username: string; password: string }>
  >;
  resetGenericPassword: jest.Mock<
    (options: { service: string }) => Promise<boolean>
  >;
};

const MODERN_PREFIX = "com.0xkey.auth.v2.keypair:";

describe("ReactNativeKeychainStamper key deletion", () => {
  const services = new Set<string>();

  beforeEach(() => {
    services.clear();
    Keychain.getGenericPassword.mockReset();
    Keychain.resetGenericPassword.mockReset();
    Keychain.getGenericPassword.mockImplementation(
      async ({ service }: { service: string }) =>
        services.has(service)
          ? { username: "public-key", password: "private-key" }
          : false,
    );
    Keychain.resetGenericPassword.mockImplementation(
      async ({ service }: { service: string }) => {
        services.delete(service);
        return true;
      },
    );
  });

  it("does not fall back to a same-name legacy entry on an exact deletion retry", async () => {
    services.add(`${MODERN_PREFIX}public-key`);
    services.add("public-key");
    const stamper = new ReactNativeKeychainStamper();

    await stamper.deleteKeyPair("public-key", { legacyFallback: false });
    await stamper.deleteKeyPair("public-key", { legacyFallback: false });

    expect(services).toEqual(new Set(["public-key"]));
  });

  it("rejects an exact deletion when reset reports false and the modern entry remains", async () => {
    services.add(`${MODERN_PREFIX}public-key`);
    Keychain.resetGenericPassword.mockResolvedValueOnce(false);
    const stamper = new ReactNativeKeychainStamper();

    await expect(
      stamper.deleteKeyPair("public-key", { legacyFallback: false }),
    ).rejects.toThrow("Failed to delete exact key pair");

    expect(services).toEqual(new Set([`${MODERN_PREFIX}public-key`]));
  });

  it("treats an already-missing exact entry as an idempotent success without legacy fallback", async () => {
    services.add("public-key");
    Keychain.resetGenericPassword.mockResolvedValueOnce(false);
    const stamper = new ReactNativeKeychainStamper();

    await expect(
      stamper.deleteKeyPair("public-key", { legacyFallback: false }),
    ).resolves.toBeUndefined();

    expect(services).toEqual(new Set(["public-key"]));
  });

  it("never falls back to a legacy service, including default callers", async () => {
    services.add("legacy-public-key");
    const stamper = new ReactNativeKeychainStamper();

    await stamper.deleteKeyPair("legacy-public-key");

    expect(services).toEqual(new Set(["legacy-public-key"]));
  });
});
