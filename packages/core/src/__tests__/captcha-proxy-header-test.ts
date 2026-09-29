import { afterEach, describe, expect, test } from "@jest/globals";
import { ZeroXKeySDKClientBase } from "../__generated__/sdk-client-base";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

const client = () =>
  new ZeroXKeySDKClientBase({
    apiBaseUrl: "https://api.example.test",
    organizationId: "parent-org",
    authProxyUrl: "https://auth.example.test",
    authProxyConfigId: "config-1",
  });

describe("Captcha Auth Proxy header", () => {
  test.each([
    ["proxyInitOtp", "/v1/otp_init"],
    ["proxyInitOtpV2", "/v1/otp_init_v2"],
    ["proxySignup", "/v1/signup"],
    ["proxySignupV2", "/v1/signup_v2"],
  ] as Array<
    [
      "proxyInitOtp" | "proxyInitOtpV2" | "proxySignup" | "proxySignupV2",
      string,
    ]
  >)("%s sends a supplied token only as a header", async (method, path) => {
    let request: { url: string; init: RequestInit } | undefined;
    global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      request = { url: String(url), init: init! };
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    const body = { marker: "body-only" };
    await (client()[method] as (body: any, token?: string) => Promise<unknown>)(
      body,
      "opaque-captcha-token",
    );

    expect(request?.url).toBe(`https://auth.example.test${path}`);
    expect(request?.init.headers).toEqual({
      "Content-Type": "application/json",
      "X-Auth-Proxy-Config-ID": "config-1",
      "X-Captcha-Token": "opaque-captcha-token",
    });
    expect(JSON.parse(String(request?.init.body))).toEqual(body);
  });

  test("omits Captcha header when no token is supplied", async () => {
    let headers: HeadersInit | undefined;
    global.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      headers = init?.headers;
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    await client().proxyInitOtp({ marker: "legacy" } as any);
    expect(headers).toEqual({
      "Content-Type": "application/json",
      "X-Auth-Proxy-Config-ID": "config-1",
    });
  });

  test.each(["/v1/account", "/v1/otp_login_v2", "/v1/unknown"])(
    "rejects a token for unprotected route %s before fetch",
    async (path) => {
      let fetchCount = 0;
      global.fetch = (async () => {
        fetchCount += 1;
        return { ok: true, json: async () => ({}) } as Response;
      }) as typeof fetch;

      await expect(
        client().authProxyRequest(path, {}, "opaque-captcha-token"),
      ).rejects.toThrow(
        "Captcha token is only supported on protected Auth Proxy routes",
      );
      expect(fetchCount).toBe(0);
    },
  );

  test("never sends Captcha header on any unprotected Auth Proxy method", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init: init! });
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    const sdk = client();
    const unprotected = [
      ["proxyGetAccount", "/v1/account"],
      ["proxyOAuth2Authenticate", "/v1/oauth2_authenticate"],
      ["proxyOAuthLogin", "/v1/oauth_login"],
      ["proxyOtpLogin", "/v1/otp_login"],
      ["proxyOtpLoginV2", "/v1/otp_login_v2"],
      ["proxyVerifyOtp", "/v1/otp_verify"],
      ["proxyVerifyOtpV2", "/v1/otp_verify_v2"],
      ["proxyGetWalletKitConfig", "/v1/wallet_kit_config"],
    ] as const;
    for (const [method] of unprotected) {
      await (sdk[method] as (body: any, token?: string) => Promise<unknown>)(
        {},
        "opaque-captcha-token",
      );
    }

    expect(requests.map(({ url }) => url)).toEqual(
      unprotected.map(([, path]) => `https://auth.example.test${path}`),
    );
    for (const { init } of requests) {
      expect(init.headers).toEqual({
        "Content-Type": "application/json",
        "X-Auth-Proxy-Config-ID": "config-1",
      });
    }
  });
});
