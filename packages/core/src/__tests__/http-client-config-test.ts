import { afterEach, describe, expect, it, jest } from "@jest/globals";
import WindowWrapper from "@polyfills/window";
import { ZeroXKeyClient } from "../__clients__/core";
import * as utils from "../utils";

const ORGANIZATION_ID = "synthetic-organization-id";

function useEmptyBrowserStorage(): void {
  (globalThis as any).window = {};
  jest.spyOn(utils, "isWeb").mockReturnValue(true);
  jest.spyOn(utils, "isReactNative").mockReturnValue(false);

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
}

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as any).window;
});

describe("HTTP client configuration", () => {
  it("uses the platform endpoints after real initialization and stays closed before initialization", async () => {
    useEmptyBrowserStorage();
    const client = new ZeroXKeyClient({ organizationId: ORGANIZATION_ID });

    expect(() => client.createHttpClient()).toThrow();

    await client.init();

    expect(client.httpClient.config).toMatchObject({
      apiBaseUrl: "https://api.0xkey.io",
      authProxyUrl: "https://authproxy.0xkey.io",
      organizationId: ORGANIZATION_ID,
    });
    expect(client.createHttpClient().config).toMatchObject({
      apiBaseUrl: "https://api.0xkey.io",
      authProxyUrl: "https://authproxy.0xkey.io",
      organizationId: ORGANIZATION_ID,
    });
  });

  it("preserves exact constructor endpoints", async () => {
    useEmptyBrowserStorage();
    const config = {
      organizationId: ORGANIZATION_ID,
      apiBaseUrl: "https://customer.example",
      authProxyUrl: "https://auth.customer.com/proxy/?next=%2Fcallback&empty=",
    };
    const client = new ZeroXKeyClient(config);

    await client.init();

    expect(client.httpClient.config).toMatchObject(config);
    expect(client.createHttpClient().config).toMatchObject(config);
  });

  it("uses exact per-call endpoints without mutating constructor or initialized configuration", async () => {
    useEmptyBrowserStorage();
    const config = {
      organizationId: ORGANIZATION_ID,
      apiBaseUrl: "https://configured.customer.com/root/",
      authProxyUrl: "https://configured-proxy.example/path/?tenant=a%2Fb",
    };
    const client = new ZeroXKeyClient(config);
    await client.init();

    const overridden = client.createHttpClient({
      apiBaseUrl: "https://override.example/api/?raw=a%2Fb&empty=",
      authProxyUrl: "https://override-proxy.customer.com",
    });

    expect(overridden.config).toMatchObject({
      apiBaseUrl: "https://override.example/api/?raw=a%2Fb&empty=",
      authProxyUrl: "https://override-proxy.customer.com",
      organizationId: ORGANIZATION_ID,
    });
    expect(client.httpClient.config).toMatchObject(config);
    expect(client.config).toEqual(config);
    expect(client.createHttpClient().config).toMatchObject(config);
  });

  it("retains empty-string fallback semantics", async () => {
    useEmptyBrowserStorage();
    const configured = new ZeroXKeyClient({
      organizationId: ORGANIZATION_ID,
      apiBaseUrl: "https://configured.example",
      authProxyUrl: "https://configured-proxy.example",
    });
    await configured.init();

    expect(
      configured.createHttpClient({ apiBaseUrl: "", authProxyUrl: "" }).config,
    ).toMatchObject({
      apiBaseUrl: "https://configured.example",
      authProxyUrl: "https://configured-proxy.example",
    });

    const defaults = new ZeroXKeyClient({
      organizationId: ORGANIZATION_ID,
      apiBaseUrl: "",
      authProxyUrl: "",
    });
    await defaults.init();

    expect(defaults.httpClient.config).toMatchObject({
      apiBaseUrl: "https://api.0xkey.io",
      authProxyUrl: "https://authproxy.0xkey.io",
    });
    expect(
      defaults.createHttpClient({ apiBaseUrl: "", authProxyUrl: "" }).config,
    ).toMatchObject({
      apiBaseUrl: "https://api.0xkey.io",
      authProxyUrl: "https://authproxy.0xkey.io",
    });
  });
});
