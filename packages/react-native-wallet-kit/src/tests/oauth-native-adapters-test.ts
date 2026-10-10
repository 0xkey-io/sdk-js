import { describe, expect, it } from "@jest/globals";
import { NATIVE_OAUTH_CANCELLED } from "../utils/oauth-native-flow";
import {
  NativeOAuthError,
  type NativeBinding,
} from "../utils/oauth-native-store";
import { createGoogleIosNativeAdapter } from "../native/google-ios";
import { createGoogleAndroidNativeAdapter } from "../native/google-android";
import { createAppleIosNativeAdapter } from "../native/apple-ios";
import { createAppleAndroidNativeAdapter } from "../native/apple-android";

const publicKey = `02${"12".repeat(32)}`;
const expectedNonce =
  "df483b5bef3df3c1032a4bead51e97ffaadabdb12960a3cc888388555b8b7ac9";

function binding(
  provider: NativeBinding["provider"],
  platform: NativeBinding["platform"],
): NativeBinding {
  return {
    organizationId: "org-1",
    apiBaseUrl: "https://api.example/",
    authProxyUrl: "https://proxy.example/",
    authProxyConfigId: "config-1",
    provider,
    platform,
    clientId:
      provider === "google"
        ? platform === "ios"
          ? "google-ios-client"
          : "google-server-client"
        : platform === "ios"
          ? "com.example.app"
          : "com.example.web",
    redirectUri:
      provider === "google"
        ? platform === "ios"
          ? "com.googleusercontent.apps.example:/oauthredirect"
          : null
        : platform === "ios"
          ? null
          : "https://login.example/apple-return",
    completion: "internal",
    keyNamespace: "auth-v2",
  };
}

function entropy(length: number): Uint8Array {
  return new Uint8Array(length).fill(length === 16 ? 1 : 2);
}

describe("Google iOS private native adapter", () => {
  it("binds a fresh Code+S256 system session to exact state, redirect and nonce", async () => {
    let opened: Record<string, string> | undefined;
    let exchanged: Record<string, string> | undefined;
    const adapter = createGoogleIosNativeAdapter({
      binding: binding("google", "ios"),
      randomBytes: entropy,
      bridge: {
        async openAuthorization(request) {
          opened = request;
          return {
            type: "callback" as const,
            url: `${request.redirectUri}?code=code-1&state=${request.state}`,
          };
        },
        async exchangeCode(request) {
          exchanged = request;
          return { oidcToken: "signed-google-token" };
        },
      },
    });

    await expect(
      adapter.authenticate({ publicKey, expectedNonce }),
    ).resolves.toEqual({
      oidcToken: "signed-google-token",
    });
    expect(opened).toEqual({
      clientId: "google-ios-client",
      redirectUri: "com.googleusercontent.apps.example:/oauthredirect",
      state: "AQEBAQEBAQEBAQEBAQEBAQ",
      codeChallenge: "bB1ju9q0N8VDaMu9iIaohqea2XcpfiZe6_H19fAVM7k",
      codeChallengeMethod: "S256",
      nonce: expectedNonce,
    });
    expect(exchanged).toEqual({
      clientId: "google-ios-client",
      redirectUri: "com.googleusercontent.apps.example:/oauthredirect",
      code: "code-1",
      verifier: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
    });
  });

  it.each([
    ["wrong state", "?code=code-1&state=attacker"],
    ["wrong redirect", "?code=code-1&state=AQEBAQEBAQEBAQEBAQEBAQ"],
    ["duplicate code", "?code=a&code=b&state=AQEBAQEBAQEBAQEBAQEBAQ"],
  ])("rejects %s before code exchange", async (kind, suffix) => {
    let exchanges = 0;
    const redirect =
      kind === "wrong redirect"
        ? "com.attacker.app:/oauthredirect"
        : "com.googleusercontent.apps.example:/oauthredirect";
    const adapter = createGoogleIosNativeAdapter({
      binding: binding("google", "ios"),
      randomBytes: entropy,
      bridge: {
        async openAuthorization() {
          return { type: "callback" as const, url: `${redirect}${suffix}` };
        },
        async exchangeCode() {
          exchanges++;
          return { oidcToken: "should-not-be-used" };
        },
      },
    });
    await expect(
      adapter.authenticate({ publicKey, expectedNonce }),
    ).rejects.toMatchObject({
      code: "result-invalid",
    });
    expect(exchanges).toBe(0);
  });

  it("propagates cancellation without exchanging", async () => {
    const adapter = createGoogleIosNativeAdapter({
      binding: binding("google", "ios"),
      randomBytes: entropy,
      bridge: {
        async openAuthorization() {
          return { type: "cancel" as const };
        },
        async exchangeCode() {
          throw new Error("exchange after cancel");
        },
      },
    });
    await expect(
      adapter.authenticate({ publicKey, expectedNonce }),
    ).rejects.toBe(NATIVE_OAUTH_CANCELLED);
  });
});

describe("Google Android private native adapter", () => {
  it("passes the server client and exact public-key nonce to the credential bridge", async () => {
    let requested: Record<string, string> | undefined;
    const adapter = createGoogleAndroidNativeAdapter({
      binding: binding("google", "android"),
      bridge: {
        async requestIdToken(request) {
          requested = request;
          return {
            type: "success" as const,
            oidcToken: "signed-android-token",
          };
        },
      },
    });
    await expect(
      adapter.authenticate({ publicKey, expectedNonce }),
    ).resolves.toEqual({
      oidcToken: "signed-android-token",
    });
    expect(requested).toEqual({
      serverClientId: "google-server-client",
      nonce: expectedNonce,
    });
  });

  it("rejects a missing nonce-capable bridge before an attempt can allocate a key", () => {
    expect(() =>
      createGoogleAndroidNativeAdapter({
        binding: binding("google", "android"),
        bridge: {} as never,
      }),
    ).toThrow(NativeOAuthError);
  });

  it("does not accept empty results or a mismatched lifecycle nonce", async () => {
    const adapter = createGoogleAndroidNativeAdapter({
      binding: binding("google", "android"),
      bridge: {
        async requestIdToken() {
          return { type: "success" as const, oidcToken: "" };
        },
      },
    });
    await expect(
      adapter.authenticate({ publicKey, expectedNonce }),
    ).rejects.toMatchObject({
      code: "result-invalid",
    });
    await expect(
      adapter.authenticate({ publicKey, expectedNonce: "00" }),
    ).rejects.toMatchObject({
      code: "config-invalid",
    });
  });
});

describe("Apple iOS private native adapter", () => {
  it("passes the raw public key for the fixed bridge nonce transform and checks state", async () => {
    let requested: Record<string, string> | undefined;
    const adapter = createAppleIosNativeAdapter({
      binding: binding("apple", "ios"),
      randomBytes: entropy,
      bridge: {
        nonceTransform: "sha256-raw-input",
        async requestIdentity(request) {
          requested = request;
          return {
            type: "success" as const,
            state: request.state,
            oidcToken: "signed-apple-ios-token",
          };
        },
      },
    });
    await expect(
      adapter.authenticate({ publicKey, expectedNonce }),
    ).resolves.toEqual({
      oidcToken: "signed-apple-ios-token",
    });
    expect(requested).toEqual({
      bundleId: "com.example.app",
      nonceSource: publicKey,
      state: "AQEBAQEBAQEBAQEBAQEBAQ",
    });
  });

  it("rejects missing nonce transform capability and wrong returned state", async () => {
    expect(() =>
      createAppleIosNativeAdapter({
        binding: binding("apple", "ios"),
        randomBytes: entropy,
        bridge: { requestIdentity: async () => ({ type: "cancel" }) } as never,
      }),
    ).toThrow(NativeOAuthError);
    const adapter = createAppleIosNativeAdapter({
      binding: binding("apple", "ios"),
      randomBytes: entropy,
      bridge: {
        nonceTransform: "sha256-raw-input",
        async requestIdentity() {
          return {
            type: "success" as const,
            state: "other",
            oidcToken: "token",
          };
        },
      },
    });
    await expect(
      adapter.authenticate({ publicKey, expectedNonce }),
    ).rejects.toMatchObject({
      code: "result-invalid",
    });
  });
});

describe("Apple Android private native adapter", () => {
  it("does not trust a bridge success without an observed exact form POST", async () => {
    const adapter = createAppleAndroidNativeAdapter({
      binding: binding("apple", "android"),
      randomBytes: entropy,
      allowedOrigins: ["https://appleid.apple.com"],
      bridge: {
        nonceTransform: "sha256-raw-input",
        async requestIdentity() {
          return { type: "success" as const };
        },
      },
    });
    await expect(
      adapter.authenticate({ publicKey, expectedNonce }),
    ).rejects.toMatchObject({
      code: "result-invalid",
    });
  });

  it("uses a query-free registered HTTPS return and accepts only its exact callback and state", async () => {
    let requested: Record<string, string> | undefined;
    const adapter = createAppleAndroidNativeAdapter({
      binding: binding("apple", "android"),
      randomBytes: entropy,
      allowedOrigins: ["https://appleid.apple.com"],
      bridge: {
        nonceTransform: "sha256-raw-input",
        async requestIdentity(request, callback) {
          requested = request;
          callback.capturePost({
            method: "POST",
            url: request.returnUrl,
            body: `state=${request.state}&id_token=signed-apple-android-token`,
          });
          return { type: "success" as const };
        },
      },
    });
    await expect(
      adapter.authenticate({ publicKey, expectedNonce }),
    ).resolves.toEqual({
      oidcToken: "signed-apple-android-token",
    });
    expect(requested).toEqual({
      serviceId: "com.example.web",
      returnUrl: "https://login.example/apple-return",
      nonceSource: publicKey,
      state: "AQEBAQEBAQEBAQEBAQEBAQ",
    });
  });

  it("rejects unregistered callback and legacy query return", async () => {
    expect(() =>
      createAppleAndroidNativeAdapter({
        binding: {
          ...binding("apple", "android"),
          redirectUri: "https://login.example/apple-return?scheme=app",
        },
        randomBytes: entropy,
        allowedOrigins: ["https://appleid.apple.com"],
        bridge: {
          nonceTransform: "sha256-raw-input",
          requestIdentity: async () => ({ type: "cancel" }),
        },
      }),
    ).toThrow(NativeOAuthError);
    const adapter = createAppleAndroidNativeAdapter({
      binding: binding("apple", "android"),
      randomBytes: entropy,
      allowedOrigins: ["https://appleid.apple.com"],
      bridge: {
        nonceTransform: "sha256-raw-input",
        async requestIdentity(request, callback) {
          callback.capturePost({
            method: "POST",
            url: "https://attacker.example/apple-return",
            body: `state=${request.state}&id_token=token`,
          });
          return { type: "success" as const };
        },
      },
    });
    await expect(
      adapter.authenticate({ publicKey, expectedNonce }),
    ).rejects.toMatchObject({
      code: "result-invalid",
    });
  });
});
