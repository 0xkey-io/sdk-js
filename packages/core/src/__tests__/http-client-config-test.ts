import { afterEach, describe, expect, it, jest } from "@jest/globals";
import WindowWrapper from "@polyfills/window";
import { ZeroXKeyClient } from "../__clients__/core";
import { WebStorageManager } from "../__storage__/web/storage";
import { StamperType } from "../__types__";
import * as utils from "../utils";
import { installBoundWebStore } from "./test-support/bound-web-store";

const ORGANIZATION_ID = "synthetic-organization-id";

function useEmptyBrowserStorage(): void {
  installBoundWebStore();
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
  it("blocks retained auth proxy requests before fetch when its target changes", async () => {
    useEmptyBrowserStorage();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);
    const client = new ZeroXKeyClient({
      organizationId: "org-A",
      authProxyConfigId: "config-A",
      authProxyUrl: "https://auth.example.test",
    });
    await client.init();
    let currentTarget = "org-A";
    client.setAuthContextGuard(() => currentTarget === "org-A");
    const retainedHttp = client.createHttpClient();

    currentTarget = "org-B";
    await expect(
      retainedHttp.authProxyRequest("/v1/otp_init", {}),
    ).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("revokes a retained non-API stamper, including a stamp already in flight", async () => {
    useEmptyBrowserStorage();
    const client = new ZeroXKeyClient({ organizationId: ORGANIZATION_ID });
    await client.init();
    let startStamp: (() => void) | undefined;
    const stampStarted = new Promise<void>((resolve) => {
      startStamp = resolve;
    });
    let finishStamp: (() => void) | undefined;
    const stampHeld = new Promise<void>((resolve) => {
      finishStamp = resolve;
    });
    let calls = 0;
    (client as any).authDependencies.passkeyStamper = {
      stamp: async () => {
        calls += 1;
        startStamp?.();
        await stampHeld;
        return { stampHeaderName: "X-Test-Stamp", stampHeaderValue: "A-key" };
      },
    };
    const retainedHttp = client.createHttpClient();
    const inFlight = retainedHttp.stampGetActivity(
      { activityId: "in-flight" },
      StamperType.Passkey,
    );
    await stampStarted;
    client.retireAuthWrites();
    finishStamp?.();

    await expect(inFlight).rejects.toBeDefined();
    await expect(
      retainedHttp.stampGetActivity(
        { activityId: "after-retirement" },
        StamperType.Passkey,
      ),
    ).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  it("fails closed on a cold Core client with an unbound persisted session", async () => {
    useEmptyBrowserStorage();
    const token = `header.${Buffer.from(
      JSON.stringify({
        exp: 2_000_000_000,
        public_key: "A-key",
        session_type: "SESSION_TYPE_READ_WRITE",
        user_id: "A-user",
        organization_id: "org-A",
      }),
    ).toString("base64url")}.signature`;
    const prior = new WebStorageManager();
    await prior.storeSession(token);
    const client = new ZeroXKeyClient({ organizationId: "org-B" });
    await client.init();

    const scopedStorage = (client as any).authDependencies.storageManager;
    expect((client.httpClient as any).storageManager).toBe(scopedStorage);
    expect((client.createHttpClient() as any).storageManager).toBe(
      scopedStorage,
    );
    expect((client as any).authDependencies.apiKeyStamper.storageManager).toBe(
      scopedStorage,
    );

    expect(await client.getSession()).toBeUndefined();
    await expect(client.fetchUser()).rejects.toBeDefined();
    await expect(
      client.httpClient.stampGetActivity({ activityId: "test" }),
    ).rejects.toBeDefined();
    await expect(
      client.createHttpClient().stampGetActivity({ activityId: "test" }),
    ).rejects.toBeDefined();
    expect((await prior.getSession())?.token).toBe(token);
  });

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
