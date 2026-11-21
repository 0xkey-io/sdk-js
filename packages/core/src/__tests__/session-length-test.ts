import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  parseSessionExpirationSeconds,
  resolveSessionExpirationSeconds,
} from "../utils";
import { createReadyClient } from "./test-support/ready-client";

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as any).document;
  delete (globalThis as any).window;
});

// Values that must count as "not set" at any layer.
const UNSET_VALUES: unknown[] = [
  undefined,
  null,
  "",
  "   ",
  "0",
  0,
  "-5",
  -1,
  "abc",
  "NaN",
  "Infinity",
  "0.5",
  Number.NaN,
  Number.POSITIVE_INFINITY,
  {},
  [],
  true,
];

describe("parseSessionExpirationSeconds", () => {
  test.each(UNSET_VALUES.map((value) => [String(value), value]))(
    "treats %s as unset",
    (_label, value) => {
      expect(parseSessionExpirationSeconds(value)).toBeUndefined();
    },
  );

  test.each<[unknown, string]>([
    ["3600", "3600"],
    [3600, "3600"],
    [" 120 ", "120"],
    ["1", "1"],
    ["90.9", "90"],
  ])("reads %p as %s", (value, expected) => {
    expect(parseSessionExpirationSeconds(value)).toBe(expected);
  });
});

describe("resolveSessionExpirationSeconds", () => {
  test("falls back to 900 seconds when no layer is set", () => {
    expect(resolveSessionExpirationSeconds()).toBe("900");
    expect(resolveSessionExpirationSeconds(...UNSET_VALUES)).toBe("900");
  });

  test("takes caller, then Dashboard, then local config", () => {
    expect(resolveSessionExpirationSeconds("60", "120", "180")).toBe("60");
    expect(resolveSessionExpirationSeconds(undefined, "120", "180")).toBe(
      "120",
    );
    expect(resolveSessionExpirationSeconds(undefined, undefined, "180")).toBe(
      "180",
    );
  });

  test.each(UNSET_VALUES.map((value) => [String(value), value]))(
    "an unset caller value (%s) defers to the Dashboard value",
    (_label, value) => {
      expect(resolveSessionExpirationSeconds(value, "120", "180")).toBe("120");
    },
  );

  test.each(UNSET_VALUES.map((value) => [String(value), value]))(
    "an unset Dashboard value (%s) defers to the local config",
    (_label, value) => {
      expect(resolveSessionExpirationSeconds(undefined, value, "180")).toBe(
        "180",
      );
    },
  );

  test.each(UNSET_VALUES.map((value) => [String(value), value]))(
    "an unset local value (%s) defers to 900",
    (_label, value) => {
      expect(resolveSessionExpirationSeconds(undefined, undefined, value)).toBe(
        "900",
      );
    },
  );
});

const BAD_CALLER_VALUES = ["0", "-5", "abc", "", "NaN"];

async function clientWithStampLogin() {
  const client = await createReadyClient();
  const stampLogin = jest.fn(async (_body: any, _stamper?: unknown) => ({
    session: "session-jwt",
  }));
  const stampStampLogin = jest.fn(async (_body: any, _stamper?: unknown) => ({
    body: "{}",
    stamp: {
      stampHeaderName: "X-Stamp",
      stampHeaderValue: Buffer.from(
        JSON.stringify({
          publicKey: "wallet-key",
          scheme: "x",
          signature: "y",
        }),
      ).toString("base64url"),
    },
    url: "https://api.example.test/public/v1/submit/stamp_login",
  }));
  Object.assign(client, {
    config: { organizationId: "org-id", defaultStamperType: "api-key" },
    apiKeyStamper: {
      createKeyPair: async () => "generated-public-key",
      deleteKeyPair: async () => undefined,
    },
    walletManager: { stamper: { setProvider: () => undefined } },
    httpClient: { stampLogin, stampStampLogin },
    storeSession: async () => undefined,
    getSession: async () => ({ publicKey: "old-key" }),
  });
  (client as any).storageManager = {
    getActiveSessionKey: async () => "session-key",
  };
  return { client, stampLogin, stampStampLogin };
}

describe("core session length", () => {
  test("loginWithPasskey uses a valid caller value and otherwise 900", async () => {
    const { client, stampLogin } = await clientWithStampLogin();
    await client.loginWithPasskey({ expirationSeconds: "3600" });
    expect(stampLogin.mock.calls[0]![0]).toMatchObject({
      expirationSeconds: "3600",
    });
    for (const value of BAD_CALLER_VALUES) {
      stampLogin.mockClear();
      await client.loginWithPasskey({ expirationSeconds: value });
      expect(stampLogin.mock.calls[0]![0]).toMatchObject({
        expirationSeconds: "900",
      });
    }
  });

  test("buildWalletLoginRequest uses a valid caller value and otherwise 900", async () => {
    const { client, stampStampLogin } = await clientWithStampLogin();
    const base = { walletProvider: { interfaceType: "ethereum" } } as any;
    await client.buildWalletLoginRequest({
      ...base,
      expirationSeconds: "3600",
    });
    expect(stampStampLogin.mock.calls[0]![0]).toMatchObject({
      expirationSeconds: "3600",
    });
    for (const value of BAD_CALLER_VALUES) {
      stampStampLogin.mockClear();
      await client.buildWalletLoginRequest({
        ...base,
        expirationSeconds: value,
      });
      expect(stampStampLogin.mock.calls[0]![0]).toMatchObject({
        expirationSeconds: "900",
      });
    }
  });

  test("refreshSession uses a valid caller value and otherwise 900", async () => {
    const { client, stampLogin } = await clientWithStampLogin();
    await client.refreshSession({ expirationSeconds: "3600" });
    expect(stampLogin.mock.calls[0]![0]).toMatchObject({
      expirationSeconds: "3600",
    });
    for (const value of [...BAD_CALLER_VALUES, undefined]) {
      stampLogin.mockClear();
      await client.refreshSession(
        value === undefined ? {} : { expirationSeconds: value },
      );
      expect(stampLogin.mock.calls[0]![0]).toMatchObject({
        expirationSeconds: "900",
      });
    }
  });
});
