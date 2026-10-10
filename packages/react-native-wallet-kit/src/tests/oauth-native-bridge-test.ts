import { describe, expect, it } from "@jest/globals";
import { createGoogleIosSystemBridge } from "../native/google-ios-system";
import { createAppleAndroidCallbackGate } from "../native/apple-android-callback";

describe("Google iOS system browser and token bridge", () => {
  const authorization = {
    clientId: "ios-client.apps.googleusercontent.com",
    redirectUri: "com.googleusercontent.apps.example:/oauthredirect",
    state: "state-1",
    codeChallenge: "challenge-1",
    codeChallengeMethod: "S256" as const,
    nonce: "nonce-1",
  };
  const exchange = {
    clientId: authorization.clientId,
    redirectUri: authorization.redirectUri,
    code: "code-1",
    verifier: "verifier-1",
  };

  it("uses the installed system auth API and exchanges Code+S256 without a client secret", async () => {
    let opened: { url: string; redirect: string } | undefined;
    let posted: { url: string; init: RequestInit } | undefined;
    const bridge = createGoogleIosSystemBridge({
      browser: {
        isAvailable: async () => true,
        openAuth: async (url, redirect) => {
          opened = { url, redirect };
          return {
            type: "success" as const,
            url: `${redirect}?code=code-1&state=state-1`,
          };
        },
      },
      fetcher: async (url, init) => {
        posted = { url, init };
        return {
          ok: true,
          json: async () => ({ id_token: "signed-id-token" }),
        };
      },
    });
    await expect(bridge.openAuthorization(authorization)).resolves.toEqual({
      type: "callback",
      url: "com.googleusercontent.apps.example:/oauthredirect?code=code-1&state=state-1",
    });
    const url = new URL(opened!.url);
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: authorization.clientId,
      redirect_uri: authorization.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: "state-1",
      code_challenge: "challenge-1",
      code_challenge_method: "S256",
      nonce: "nonce-1",
    });
    expect(opened!.redirect).toBe(authorization.redirectUri);
    await expect(bridge.exchangeCode(exchange)).resolves.toEqual({
      oidcToken: "signed-id-token",
    });
    expect(posted!.url).toBe("https://oauth2.googleapis.com/token");
    expect(posted!.init.method).toBe("POST");
    expect(posted!.init.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(
      Object.fromEntries(new URLSearchParams(posted!.init.body as string)),
    ).toEqual({
      client_id: exchange.clientId,
      redirect_uri: exchange.redirectUri,
      code: "code-1",
      code_verifier: "verifier-1",
      grant_type: "authorization_code",
    });
  });

  it("fails closed when system auth is unavailable or dismissed", async () => {
    let opens = 0;
    const unavailable = createGoogleIosSystemBridge({
      browser: {
        isAvailable: async () => false,
        openAuth: async () => {
          opens++;
          return { type: "cancel" as const };
        },
      },
      fetcher: async () => {
        throw new Error("must not exchange");
      },
    });
    await expect(
      unavailable.openAuthorization(authorization),
    ).rejects.toMatchObject({
      code: "adapter-failed",
    });
    expect(opens).toBe(0);
    const dismissed = createGoogleIosSystemBridge({
      browser: {
        isAvailable: async () => true,
        openAuth: async () => ({ type: "dismiss" as const }),
      },
      fetcher: async () => {
        throw new Error("must not exchange");
      },
    });
    await expect(dismissed.openAuthorization(authorization)).resolves.toEqual({
      type: "cancel",
    });
  });

  it("does not accept missing or failed ID-token exchange", async () => {
    const bridge = createGoogleIosSystemBridge({
      browser: {
        isAvailable: async () => true,
        openAuth: async () => ({ type: "cancel" as const }),
      },
      fetcher: async () => ({
        ok: true,
        json: async () => ({ access_token: "access" }),
      }),
    });
    await expect(bridge.exchangeCode(exchange)).rejects.toMatchObject({
      code: "result-invalid",
    });
    const failed = createGoogleIosSystemBridge({
      browser: {
        isAvailable: async () => true,
        openAuth: async () => ({ type: "cancel" as const }),
      },
      fetcher: async () => ({
        ok: false,
        json: async () => ({ id_token: "fake" }),
      }),
    });
    await expect(failed.exchangeCode(exchange)).rejects.toMatchObject({
      code: "adapter-failed",
    });
  });
});

describe("Apple Android form POST callback gate", () => {
  function gate() {
    return createAppleAndroidCallbackGate({
      returnUrl: "https://login.example/apple-return",
      expectedState: "state-1",
      allowedOrigins: ["https://appleid.apple.com"],
    });
  }

  it("allows only pinned Apple navigation and blocks GET navigation to the return URL", () => {
    const callback = gate();
    expect(
      callback.navigation("https://appleid.apple.com/auth/authorize"),
    ).toBe("allow");
    expect(callback.navigation("https://login.example/apple-return")).toBe(
      "block",
    );
    expect(callback.navigation("https://login.example/apple-return.evil")).toBe(
      "block",
    );
    expect(
      callback.navigation("https://appleid.apple.com.attacker.test/"),
    ).toBe("block");
    expect(callback.navigation("javascript:alert(1)")).toBe("block");
  });

  it("accepts one exact form POST and rejects duplicate delivery", () => {
    const callback = gate();
    expect(
      callback.capturePost({
        method: "POST",
        url: "https://login.example/apple-return",
        body: "state=state-1&id_token=header.payload.signature&code=code-1",
      }),
    ).toBeUndefined();
    expect(callback.result()).toEqual({
      oidcToken: "header.payload.signature",
    });
    expect(() => callback.result()).toThrow();
    expect(() =>
      callback.capturePost({
        method: "POST",
        url: "https://login.example/apple-return",
        body: "state=state-1&id_token=second.token.value",
      }),
    ).toThrow();
    expect(
      callback.navigation("https://appleid.apple.com/auth/authorize"),
    ).toBe("block");
  });

  it("keeps the trusted callback and state snapshot when caller input mutates", () => {
    const config = {
      returnUrl: "https://login.example/apple-return",
      expectedState: "state-1",
      allowedOrigins: ["https://appleid.apple.com"],
    };
    const callback = createAppleAndroidCallbackGate(config);
    config.returnUrl = "https://attacker.example/return";
    config.expectedState = "attacker";
    config.allowedOrigins[0] = "https://attacker.example";
    expect(callback.navigation("https://attacker.example/return")).toBe(
      "block",
    );
    expect(
      callback.capturePost({
        method: "POST",
        url: "https://login.example/apple-return",
        body: "state=state-1&id_token=header.payload.signature",
      }),
    ).toBeUndefined();
    expect(callback.result()).toEqual({
      oidcToken: "header.payload.signature",
    });
    expect(() => callback.result()).toThrow();
  });

  it.each([
    [
      "wrong state",
      "https://login.example/apple-return",
      "state=other&id_token=a.b.c",
    ],
    [
      "duplicate state",
      "https://login.example/apple-return",
      "state=state-1&state=state-1&id_token=a.b.c",
    ],
    [
      "callback prefix",
      "https://login.example/apple-return.evil",
      "state=state-1&id_token=a.b.c",
    ],
    [
      "query return",
      "https://login.example/apple-return?x=1",
      "state=state-1&id_token=a.b.c",
    ],
  ])("rejects %s and seals the attempt", (_name, url, body) => {
    const callback = gate();
    expect(() => callback.capturePost({ method: "POST", url, body })).toThrow();
    expect(() =>
      callback.capturePost({
        method: "POST",
        url: "https://login.example/apple-return",
        body: "state=state-1&id_token=header.payload.signature",
      }),
    ).toThrow();
  });
});
