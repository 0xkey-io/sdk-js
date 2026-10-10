import { afterEach, describe, expect, test } from "@jest/globals";
import { ZeroXKeySDKClientBase } from "../__generated__/sdk-client-base";
import { getClientParams } from "../index";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("Captcha client params", () => {
  test("generated low-level method posts only to the selected Auth Proxy config", async () => {
    let request: { url: string; init: RequestInit | undefined } | undefined;
    global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      request = { url: String(url), init };
      return {
        ok: true,
        json: async () => ({ turnstileSiteKey: "site-a" }),
      } as Response;
    }) as typeof fetch;

    const client = new ZeroXKeySDKClientBase({
      apiBaseUrl: "https://api.example.test",
      organizationId: "org-a",
      authProxyUrl: "https://auth-a.example.test",
      authProxyConfigId: "cfg-a",
    });
    const result = await client.proxyGetWalletKitClientParams({});

    expect(result).toEqual({ turnstileSiteKey: "site-a" });
    expect(request?.url).toBe(
      "https://auth-a.example.test/v1/wallet_kit_client_params",
    );
    expect(request?.init?.method).toBe("POST");
    expect(request?.init?.headers).toEqual({
      "Content-Type": "application/json",
      "X-Auth-Proxy-Config-ID": "cfg-a",
    });
    expect(request?.init?.body).toBe("{}");
  });

  test("public API fetches each URL and config selection afresh across off, on, and rotation", async () => {
    const requests: Array<{ url: string; configId: string }> = [];
    const replies = [
      {},
      { turnstileSiteKey: "site-a" },
      { turnstileSiteKey: "site-b" },
    ];
    global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        configId:
          (init?.headers as Record<string, string>)["X-Auth-Proxy-Config-ID"] ??
          "",
      });
      return { ok: true, json: async () => replies.shift() } as Response;
    }) as typeof fetch;

    expect(
      await getClientParams("cfg-a", "https://auth-a.example.test"),
    ).toEqual({});
    expect(
      await getClientParams("cfg-a", "https://auth-a.example.test"),
    ).toEqual({ turnstileSiteKey: "site-a" });
    expect(
      await getClientParams("cfg-b", "https://auth-b.example.test"),
    ).toEqual({ turnstileSiteKey: "site-b" });
    expect(requests).toEqual([
      {
        url: "https://auth-a.example.test/v1/wallet_kit_client_params",
        configId: "cfg-a",
      },
      {
        url: "https://auth-a.example.test/v1/wallet_kit_client_params",
        configId: "cfg-a",
      },
      {
        url: "https://auth-b.example.test/v1/wallet_kit_client_params",
        configId: "cfg-b",
      },
    ]);
  });

  test("503 and malformed responses fail closed without exposing response content", async () => {
    global.fetch = (async () =>
      ({
        ok: false,
        status: 503,
        text: async () => "private-resource-ref",
      }) as Response) as typeof fetch;
    await expect(
      getClientParams("cfg-a", "https://auth-a.example.test"),
    ).rejects.toThrow("Client params unavailable");

    global.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({ turnstileSiteKey: "" }),
      }) as Response) as typeof fetch;
    await expect(
      getClientParams("cfg-a", "https://auth-a.example.test"),
    ).rejects.toThrow("Invalid client params response");
  });

  test("joins path and query without putting site key or config ID in URL", async () => {
    let request: { url: string; init: RequestInit | undefined } | undefined;
    global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      request = { url: String(url), init };
      return {
        ok: true,
        json: async () => ({ turnstileSiteKey: "site-a" }),
      } as Response;
    }) as typeof fetch;

    await getClientParams(
      "config /雪",
      "https://auth.example.test/proxy/?tenant=a%2Fb&empty=",
    );
    expect(request?.url).toBe(
      "https://auth.example.test/proxy/v1/wallet_kit_client_params?tenant=a%2Fb&empty=",
    );
    expect(request?.url).not.toContain("config");
    expect(request?.url).not.toContain("site-a");
    expect(request?.init?.cache).toBe("no-store");
    expect(request?.init?.headers).toEqual({
      "Content-Type": "application/json",
      "X-Auth-Proxy-Config-ID": "config /雪",
    });
  });

  test.each([
    ["", "https://auth.example.test"],
    ["cfg-a", "https://user:password@auth.example.test"],
    ["cfg-a", "https://auth.example.test/#fragment"],
    ["cfg-a", "file:///auth-proxy"],
  ])("rejects invalid selection before fetch", async (configId, url) => {
    let calls = 0;
    global.fetch = (async () => {
      calls += 1;
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
    await expect(getClientParams(configId, url)).rejects.toThrow();
    expect(calls).toBe(0);
  });

  test.each([null, [], { enabled: true }, { turnstileSiteKey: " site-a " }])(
    "rejects an ambiguous success body %#",
    async (body) => {
      global.fetch = (async () =>
        ({ ok: true, json: async () => body }) as Response) as typeof fetch;
      await expect(
        getClientParams("cfg-a", "https://auth.example.test"),
      ).rejects.toThrow("Invalid client params response");
    },
  );
});
