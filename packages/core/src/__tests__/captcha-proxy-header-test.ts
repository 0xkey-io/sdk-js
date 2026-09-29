import { afterEach, describe, expect, test } from "@jest/globals";
import { ZeroXKeySDKClientBase } from "../__generated__/sdk-client-base";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

const client = (
  authProxyConfigId = "config-1",
  authProxyUrl = "https://auth.example.test",
) =>
  new ZeroXKeySDKClientBase({
    apiBaseUrl: "https://api.example.test",
    organizationId: "parent-org",
    authProxyUrl,
    authProxyConfigId,
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
  >)(
    "%s sends a token header with only the config hint in URL",
    async (method, path) => {
      let request: { url: string; init: RequestInit } | undefined;
      global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
        request = { url: String(url), init: init! };
        return { ok: true, json: async () => ({}) } as Response;
      }) as typeof fetch;

      const body = { marker: "body-only" };
      await (
        client()[method] as (body: any, token?: string) => Promise<unknown>
      )(body, "opaque-captcha-token");

      expect(request?.url).toBe(
        `https://auth.example.test${path}?captcha_config_id=config-1`,
      );
      expect(request?.url).not.toContain("opaque-captcha-token");
      expect(request?.init.headers).toEqual({
        "Content-Type": "application/json",
        "X-Auth-Proxy-Config-ID": "config-1",
        "X-Captcha-Token": "opaque-captcha-token",
      });
      expect(JSON.parse(String(request?.init.body))).toEqual(body);
    },
  );

  test("omits Captcha header when no token is supplied", async () => {
    let headers: HeadersInit | undefined;
    let requestUrl: string | undefined;
    global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(url);
      headers = init?.headers;
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    await client().proxyInitOtp({ marker: "legacy" } as any);
    expect(requestUrl).toBe("https://auth.example.test/v1/otp_init");
    expect(headers).toEqual({
      "Content-Type": "application/json",
      "X-Auth-Proxy-Config-ID": "config-1",
    });
  });

  test("encodes a nonstandard config ID without putting the token in the URL", async () => {
    let requestUrl: string | undefined;
    global.fetch = (async (url: RequestInfo | URL) => {
      requestUrl = String(url);
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    await client("test /&?=雪#").proxySignup(
      { marker: "body-only" } as any,
      "opaque-captcha-token",
    );
    expect(requestUrl).toBe(
      "https://auth.example.test/v1/signup?captcha_config_id=test+%2F%26%3F%3D%E9%9B%AA%23",
    );
    expect(new URL(requestUrl!).searchParams.get("captcha_config_id")).toBe(
      "test /&?=雪#",
    );
    expect(requestUrl).not.toContain("opaque-captcha-token");
  });

  test.each([
    [
      "https://auth.example.test/proxy?tenant=a%2Fb&empty=",
      "https://auth.example.test/proxy/v1/signup?tenant=a%2Fb&empty=&captcha_config_id=config-1",
    ],
    [
      "https://auth.example.test/proxy/?tenant=a%2Fb&captcha_config_id=stale&empty=",
      "https://auth.example.test/proxy/v1/signup?tenant=a%2Fb&captcha_config_id=config-1&empty=",
    ],
    [
      "https://auth.example.test?tenant=a",
      "https://auth.example.test/v1/signup?tenant=a&captcha_config_id=config-1",
    ],
  ])(
    "joins route before base query and sets one hint for %s",
    async (base, expected) => {
      let requestUrl: string | undefined;
      global.fetch = (async (url: RequestInfo | URL) => {
        requestUrl = String(url);
        return { ok: true, json: async () => ({}) } as Response;
      }) as typeof fetch;

      await client("config-1", base).proxySignup(
        { marker: "body-only" } as any,
        "opaque-captcha-token",
      );
      expect(requestUrl).toBe(expected);
      expect(requestUrl).not.toContain("opaque-captcha-token");
    },
  );

  test("rejects a fragment on a protected token request before fetch", async () => {
    let fetchCount = 0;
    global.fetch = (async () => {
      fetchCount += 1;
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    await expect(
      client(
        "config-1",
        "https://auth.example.test/proxy?tenant=a#ignored",
      ).proxySignup({ marker: "body-only" } as any, "opaque-captcha-token"),
    ).rejects.toThrow("Auth Proxy URL is invalid for Captcha request");
    expect(fetchCount).toBe(0);
  });

  test("preserves legacy no-token URL concatenation for a base with query and fragment", async () => {
    let requestUrl: string | undefined;
    global.fetch = (async (url: RequestInfo | URL) => {
      requestUrl = String(url);
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    await client(
      "config-1",
      "https://auth.example.test/proxy?tenant=a#ignored",
    ).proxySignup({ marker: "body-only" } as any);
    expect(requestUrl).toBe(
      "https://auth.example.test/proxy?tenant=a#ignored/v1/signup",
    );
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
