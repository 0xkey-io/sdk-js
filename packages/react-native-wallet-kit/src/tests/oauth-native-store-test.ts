import { describe, expect, it, jest } from "@jest/globals";
import {
  canonicalizeNativeBinding,
  createNativeOAuthStore,
  nativeOAuthError,
  parseNativeRecord,
  serializeNativeRecord,
  type NativeBinding,
  type NativeRecord,
  type NativeSlotStorage,
} from "../utils/oauth-native-store";

const compressedKey = `02${"11".repeat(32)}`;
const uncompressedKey = `04${"22".repeat(64)}`;

function binding(overrides: Partial<NativeBinding> = {}): NativeBinding {
  return {
    organizationId: "organization-1",
    apiBaseUrl: "https://API.example:443/a/../v1",
    authProxyUrl: "http://localhost:8080/proxy",
    authProxyConfigId: "proxy-1",
    provider: "google",
    platform: "ios",
    clientId: "google-client-1",
    redirectUri: "com.googleusercontent.apps.example:/oauthredirect",
    completion: "internal",
    keyNamespace: "auth-v2",
    ...overrides,
  };
}

function record(overrides: Partial<NativeRecord> = {}): NativeRecord {
  return {
    kind: "native-oauth",
    version: 1,
    operationId: "11".repeat(16),
    binding: canonicalizeNativeBinding(binding()),
    publicKey: compressedKey,
    createdAt: 1_000,
    phase: "awaiting_native",
    ...overrides,
  };
}

function storageFixture(initial: string | null = null): {
  storage: NativeSlotStorage;
  value(): string | null;
} {
  let value = initial;
  return {
    value: () => value,
    storage: {
      async read() {
        return value;
      },
      async write(next) {
        value = next;
      },
      async remove() {
        value = null;
      },
    },
  };
}

describe("native OAuth version-1 store", () => {
  it("canonicalizes only base URLs and emits the fixed field order", () => {
    const canonical = canonicalizeNativeBinding(binding());
    expect(canonical).toEqual({
      organizationId: "organization-1",
      apiBaseUrl: "https://api.example/v1",
      authProxyUrl: "http://localhost:8080/proxy",
      authProxyConfigId: "proxy-1",
      provider: "google",
      platform: "ios",
      clientId: "google-client-1",
      redirectUri: "com.googleusercontent.apps.example:/oauthredirect",
      completion: "internal",
      keyNamespace: "auth-v2",
    });
    expect(Object.isFrozen(canonical)).toBe(true);
    expect(serializeNativeRecord(record({ binding: canonical }))).toBe(
      `{"kind":"native-oauth","version":1,"operationId":"${"11".repeat(
        16,
      )}","binding":{"organizationId":"organization-1","apiBaseUrl":"https://api.example/v1","authProxyUrl":"http://localhost:8080/proxy","authProxyConfigId":"proxy-1","provider":"google","platform":"ios","clientId":"google-client-1","redirectUri":"com.googleusercontent.apps.example:/oauthredirect","completion":"internal","keyNamespace":"auth-v2"},"publicKey":"${compressedKey}","createdAt":1000,"phase":"awaiting_native"}`,
    );
  });

  it.each([
    ["organization empty", { organizationId: "" }],
    ["organization whitespace", { organizationId: "org id" }],
    ["organization non-ASCII", { organizationId: "组织" }],
    ["client too long", { clientId: "a".repeat(1_025) }],
    ["proxy id too long", { authProxyConfigId: "a".repeat(257) }],
    ["base credentials", { apiBaseUrl: "https://user@example.com/" }],
    ["base backslash", { apiBaseUrl: "https:\\example.com/" }],
    ["base query", { apiBaseUrl: "https://example.com/?" }],
    ["base malformed percent", { apiBaseUrl: "https://example.com/%Q0" }],
    ["non-loopback HTTP", { apiBaseUrl: "http://example.com/" }],
    ["Google iOS HTTPS redirect", { redirectUri: "https://example.com/" }],
    ["Google iOS uppercase scheme", { redirectUri: "Com.example:/callback" }],
    ["Google iOS authority", { redirectUri: "com.example://callback" }],
    [
      "Google Android redirect",
      { platform: "android", redirectUri: "com.example:/callback" },
    ],
    [
      "Apple iOS redirect",
      { provider: "apple", redirectUri: "https://example.com/" },
    ],
    [
      "Apple Android custom redirect",
      {
        provider: "apple",
        platform: "android",
        redirectUri: "com.example:/callback",
      },
    ],
    [
      "Apple Android noncanonical redirect",
      {
        provider: "apple",
        platform: "android",
        redirectUri: "https://APPLE.example",
      },
    ],
  ])("rejects invalid caller binding: %s", (_name, overrides) => {
    expect(() =>
      canonicalizeNativeBinding(binding(overrides as Partial<NativeBinding>)),
    ).toThrow("Native OAuth configuration invalid");
  });

  it("accepts exact identifier limits, loopback bases, and provider-specific redirects", () => {
    expect(
      canonicalizeNativeBinding(
        binding({
          organizationId: "a".repeat(256),
          clientId: "b".repeat(1_024),
          apiBaseUrl: "http://127.0.0.1:80/path",
        }),
      ).apiBaseUrl,
    ).toBe("http://127.0.0.1/path");
    expect(
      canonicalizeNativeBinding(
        binding({
          provider: "google",
          platform: "android",
          redirectUri: null,
        }),
      ).redirectUri,
    ).toBeNull();
    expect(
      canonicalizeNativeBinding(
        binding({ provider: "apple", platform: "ios", redirectUri: null }),
      ).redirectUri,
    ).toBeNull();
    expect(
      canonicalizeNativeBinding(
        binding({
          provider: "apple",
          platform: "android",
          redirectUri: "https://apple.example/callback",
        }),
      ).redirectUri,
    ).toBe("https://apple.example/callback");
  });

  it("accepts each exact binding byte limit and rejects one byte over", () => {
    const basePrefix = "https://a.co/";
    const baseAtLimit = `${basePrefix}${"p".repeat(2_048 - basePrefix.length)}`;
    const customPrefix = "com.example:/";
    const customAtLimit = `${customPrefix}${"r".repeat(
      2_048 - customPrefix.length,
    )}`;
    expect(
      canonicalizeNativeBinding(
        binding({
          organizationId: "o".repeat(256),
          authProxyConfigId: "p".repeat(256),
          clientId: "c".repeat(1_024),
          apiBaseUrl: baseAtLimit,
          authProxyUrl: baseAtLimit,
          redirectUri: customAtLimit,
        }),
      ),
    ).toMatchObject({
      organizationId: "o".repeat(256),
      authProxyConfigId: "p".repeat(256),
      clientId: "c".repeat(1_024),
      apiBaseUrl: baseAtLimit,
      authProxyUrl: baseAtLimit,
      redirectUri: customAtLimit,
    });
    expect(
      canonicalizeNativeBinding(
        binding({
          provider: "apple",
          platform: "android",
          redirectUri: baseAtLimit,
        }),
      ).redirectUri,
    ).toBe(baseAtLimit);
    for (const invalid of [
      { organizationId: "o".repeat(257) },
      { authProxyConfigId: "p".repeat(257) },
      { clientId: "c".repeat(1_025) },
      { apiBaseUrl: `${baseAtLimit}x` },
      { authProxyUrl: `${baseAtLimit}x` },
      { redirectUri: `${customAtLimit}x` },
      {
        provider: "apple" as const,
        platform: "android" as const,
        redirectUri: `${baseAtLimit}x`,
      },
    ]) {
      expect(() =>
        canonicalizeNativeBinding(binding(invalid as Partial<NativeBinding>)),
      ).toThrow("Native OAuth configuration invalid");
    }
  });

  it("applies the raw-record byte limit before JSON parsing", () => {
    const parse = jest.spyOn(JSON, "parse");
    try {
      expect(() => parseNativeRecord("x".repeat(16_384))).toThrow(
        "Native OAuth recovery required",
      );
      expect(parse).toHaveBeenCalledTimes(1);
      parse.mockClear();
      expect(() => parseNativeRecord("x".repeat(16_385))).toThrow(
        "Native OAuth recovery required",
      );
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it("sanitizes throwing configuration getters before allocation", () => {
    const source = binding() as NativeBinding & { organizationId: string };
    Object.defineProperty(source, "organizationId", {
      enumerable: true,
      get() {
        throw new Error("configuration-sensitive-canary");
      },
    });
    const failure = (() => {
      try {
        canonicalizeNativeBinding(source);
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(failure).toMatchObject({
      code: "config-invalid",
      message: "Native OAuth configuration invalid",
    });
    expect(String(failure)).not.toContain("configuration-sensitive-canary");
  });

  it.each([
    [compressedKey, 0],
    [uncompressedKey, Number.MAX_SAFE_INTEGER],
  ])("accepts SEC1 encoding %s at timestamp %s", (publicKey, createdAt) => {
    const encoded = serializeNativeRecord(record({ publicKey, createdAt }));
    expect(parseNativeRecord(encoded)).toEqual(
      record({ publicKey, createdAt }),
    );
  });

  it.each([
    ["uppercase key", `02${"AA".repeat(32)}`, 1_000],
    ["short key", `02${"11".repeat(31)}`, 1_000],
    ["fractional timestamp", compressedKey, 1.5],
    ["negative timestamp", compressedKey, -1],
    ["unsafe timestamp", compressedKey, Number.MAX_SAFE_INTEGER + 1],
  ])("rejects stored %s", (_name, publicKey, createdAt) => {
    const raw = JSON.stringify({ ...record(), publicKey, createdAt });
    expect(() => parseNativeRecord(raw)).toThrow(
      "Native OAuth recovery required",
    );
  });

  it("accepts an encoding-only off-curve public key", () => {
    const offCurve = `02${"00".repeat(32)}`;
    expect(
      parseNativeRecord(serializeNativeRecord(record({ publicKey: offCurve }))),
    ).toMatchObject({
      publicKey: offCurve,
    });
  });

  it.each([
    ["empty", ""],
    ["oversized before parse", " ".repeat(16_385)],
    ["whitespace serialization", ` ${serializeNativeRecord(record())}`],
    ["extra record field", JSON.stringify({ ...record(), extra: true })],
    [
      "extra binding field",
      JSON.stringify({
        ...record(),
        binding: { ...record().binding, extra: true },
      }),
    ],
    [
      "duplicate record field",
      serializeNativeRecord(record()).replace(
        `"version":1`,
        `"version":1,"version":1`,
      ),
    ],
    [
      "noncanonical stored base",
      JSON.stringify({
        ...record(),
        binding: {
          ...record().binding,
          apiBaseUrl: "https://API.example:443/v1",
        },
      }),
    ],
    ["unknown version", JSON.stringify({ ...record(), version: 2 })],
    ["unknown kind", JSON.stringify({ ...record(), kind: "browser-oauth" })],
    [
      "invalid operation id",
      JSON.stringify({ ...record(), operationId: "A".repeat(32) }),
    ],
    [
      "wrong property order",
      JSON.stringify({
        version: 1,
        kind: "native-oauth",
        operationId: record().operationId,
        binding: record().binding,
        publicKey: compressedKey,
        createdAt: 1_000,
        phase: "awaiting_native",
      }),
    ],
  ])("blocks a %s occupied record", (_name, raw) => {
    expect(() => parseNativeRecord(raw)).toThrow(
      "Native OAuth recovery required",
    );
  });

  it("writes, reads back, and removes only an exact recognized record", async () => {
    const fixture = storageFixture();
    const store = createNativeOAuthStore(fixture.storage);
    const expected = record();
    await store.write(expected);
    await expect(store.read()).resolves.toEqual(expected);
    await store.remove(expected);
    expect(fixture.value()).toBeNull();
  });

  it("preserves a changed occupant instead of removing it", async () => {
    const expected = record();
    const replacement = serializeNativeRecord(
      record({ operationId: "22".repeat(16) }),
    );
    const fixture = storageFixture(replacement);
    const store = createNativeOAuthStore(fixture.storage);
    await expect(store.remove(expected)).rejects.toMatchObject({
      name: "NativeOAuthError",
      code: "recovery-required",
      message: "Native OAuth recovery required",
    });
    expect(fixture.value()).toBe(replacement);
  });

  it("emits fixed sanitized lifecycle errors", () => {
    const error = nativeOAuthError("adapter-failed");
    expect(error).toMatchObject({
      name: "NativeOAuthError",
      code: "adapter-failed",
      message: "Native OAuth adapter failed",
    });
    expect(Object.keys(error)).not.toContain("cause");
    expect(String(error)).not.toContain("sensitive-token-canary");
  });
});
