import { describe, expect, it, jest } from "@jest/globals";
import { OAuthProviders } from "@0xkey-io/sdk-types";
import type { ZeroXKeyProviderConfig } from "../types/base";
import {
  createOAuthProviderFlowRuntime,
  type CurrentOAuthProviderContext,
  type OAuthProviderClient,
} from "../utils/oauth-provider-flow";

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    source: {
      get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: string) => void values.set(key, value),
      remove: async (key: string) => void values.delete(key),
    },
  };
}

function config(overrides: Partial<ZeroXKeyProviderConfig> = {}) {
  return {
    organizationId: "organization-1",
    authProxyConfigId: "proxy-config-1",
    auth: {
      oauth: {
        appScheme: "example",
        redirectUri: "https://oauth.example/callback?static=one",
        google: { primaryClientId: { webClientId: "google-client" } },
        apple: { primaryClientId: { serviceId: "apple-service" } },
        facebook: { primaryClientId: "facebook-client" },
        x: {
          primaryClientId: "x-client",
          redirectUri: "example://x/callback",
        },
        discord: {
          primaryClientId: "discord-client",
          redirectUri: "example://discord/callback",
        },
      },
    },
    ...overrides,
  } as ZeroXKeyProviderConfig;
}

function client() {
  const proxyOAuth2Authenticate = jest.fn(async () => ({
    oidcToken: "proxy-token",
  }));
  const created = new Set<string>();
  let nextKey = 0;
  const value = {
    config: {
      organizationId: "organization-1",
      authProxyConfigId: "proxy-config-1",
    },
    httpClient: {
      config: {
        organizationId: "organization-1",
        apiBaseUrl: "https://api.0xkey.com",
        authProxyUrl: "https://authproxy.0xkey.io",
        authProxyConfigId: "proxy-config-1",
      },
      proxyOAuth2Authenticate,
    },
    createApiKeyPair: jest.fn(async () => {
      const key = `public-key-${++nextKey}`;
      created.add(key);
      return key;
    }),
    discardUncommittedApiKeyPair: jest.fn(async (key: string) => {
      created.delete(key);
    }),
  } as unknown as OAuthProviderClient;
  return { value, proxyOAuth2Authenticate, created };
}

function runtimeFixture(providerConfig = config()) {
  const stored = storage();
  const sdkClient = client();
  const completeOauth = jest.fn(async () => ({ action: "login" }) as never);
  const context: CurrentOAuthProviderContext = {
    client: sdkClient.value,
    config: providerConfig,
    masterConfig: providerConfig,
    proxyConfig: {
      enabledProviders: ["google", "apple", "facebook", "x", "discord"],
      oauthClientIds: {},
      organizationId: "organization-1",
      sessionExpirationSeconds: "900",
    },
    callbacks: undefined,
    completeOauth,
  };
  const openAuth = jest.fn(async (url: string, target: string) => {
    const state = new URL(url).searchParams.get("state")!;
    const direct = target.includes("/callback");
    return {
      type: "success",
      url: `${target}${direct ? "?" : "?"}code=authorization-code&id_token=identity-token&state=${encodeURIComponent(state)}`,
    };
  });
  const facebookExchange = jest.fn(async () => ({
    id_token: "facebook-token",
  }));
  let random = 0;
  const providerRuntime = createOAuthProviderFlowRuntime({
    client: sdkClient.value,
    initializedConfig: providerConfig,
    secureStorage: stored.source,
    getCurrent: () => context,
    isBrowserAvailable: async () => true,
    openAuth,
    generatePkce: async () => ({
      verifier: "verifier",
      codeChallenge: "challenge",
    }),
    randomBytes: (length) =>
      Uint8Array.from({ length }, () => (random = (random + 1) % 255)),
    now: () => 1_000,
    facebookExchange,
  });
  return {
    context,
    providerRuntime,
    openAuth,
    facebookExchange,
    completeOauth,
    stored,
    ...sdkClient,
  };
}

describe("OAuth Provider flow adapter", () => {
  it("uses effective initialized defaults and exact Facebook exchange/completion arguments", async () => {
    const fixture = runtimeFixture();

    await fixture.providerRuntime.start(OAuthProviders.FACEBOOK, {
      additionalState: { destination: "settings" },
      onOauthSuccess: jest.fn(),
    });

    expect(fixture.openAuth.mock.calls[0]?.[1]).toBe("example://");
    const authorizationUrl = new URL(fixture.openAuth.mock.calls[0]![0]);
    expect(authorizationUrl.searchParams.get("clientId")).toBe(
      "facebook-client",
    );
    const state = authorizationUrl.searchParams.get("state")!;
    expect(new URLSearchParams(state).get("destination")).toBe("settings");
    expect(fixture.facebookExchange).toHaveBeenCalledWith(
      "facebook-client",
      "https://oauth.example/callback?static=one&scheme=example",
      "authorization-code",
      "verifier",
    );
    expect(fixture.completeOauth).toHaveBeenCalledWith({
      oidcToken: "facebook-token",
      providerName: "facebook",
      publicKey: "public-key-1",
    });
    expect(fixture.stored.values.size).toBe(0);
    expect(fixture.created).toEqual(new Set(["public-key-1"]));
  });

  it("uses exact direct-provider redirect targets and proxy exchange arguments", async () => {
    const fixture = runtimeFixture();

    await fixture.providerRuntime.start(OAuthProviders.X, {
      primaryClientId: "x-call-client",
    });

    expect(fixture.openAuth.mock.calls[0]?.[1]).toBe("example://x/callback");
    expect(fixture.proxyOAuth2Authenticate).toHaveBeenCalledWith({
      provider: "OAUTH2_PROVIDER_X",
      authCode: "authorization-code",
      redirectUri: "example://x/callback",
      codeVerifier: "verifier",
      clientId: "x-call-client",
      nonce: expect.any(String),
    });
  });

  it("preserves global success-before-redirect completion precedence while ignoring per-call success", async () => {
    const fixture = runtimeFixture();
    const globalSuccess = jest.fn();
    const globalRedirect = jest.fn();
    const perCallSuccess = jest.fn();
    fixture.context.callbacks = {
      onOauthSuccess: globalSuccess,
      onOauthRedirect: globalRedirect,
    } as unknown as CurrentOAuthProviderContext["callbacks"];

    await fixture.providerRuntime.start(OAuthProviders.GOOGLE, {
      onOauthSuccess: perCallSuccess,
    });

    expect(globalSuccess).toHaveBeenCalledWith({
      oidcToken: "identity-token",
      providerName: "google",
      publicKey: "public-key-1",
    });
    expect(globalRedirect).not.toHaveBeenCalled();
    expect(perCallSuccess).not.toHaveBeenCalled();
    expect(fixture.completeOauth).not.toHaveBeenCalled();
  });

  it("selects only enabled configured recovery flows", () => {
    const configured = config({
      auth: {
        oauth: {
          appScheme: "example",
          redirectUri: "https://oauth.example/callback",
          google: false,
          apple: true,
        },
      },
    });
    const fixture = runtimeFixture(configured);
    fixture.context.proxyConfig = {
      ...fixture.context.proxyConfig!,
      enabledProviders: ["google", "discord"],
      oauthClientIds: {
        google: "proxy-google",
        discord: "proxy-discord",
      },
    };

    expect(
      fixture.providerRuntime
        .getConfiguredFlows()
        .map((flow) => flow.snapshot.provider),
    ).toEqual([OAuthProviders.DISCORD]);
  });

  it("fails closed when the rendered config changes before effects update master config", async () => {
    const fixture = runtimeFixture();
    fixture.context.config = config({ organizationId: "organization-2" });

    await expect(
      fixture.providerRuntime.start(OAuthProviders.GOOGLE),
    ).rejects.toThrow("OAuth context changed");
    expect(fixture.value.createApiKeyPair).not.toHaveBeenCalled();
  });

  it("invalidates an active flow on a rendered OAuth route change before master config catches up", async () => {
    const fixture = runtimeFixture();
    let finishBrowser!: (result: { type: string; url: string }) => void;
    fixture.openAuth.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishBrowser = resolve;
        }),
    );
    const pending = fixture.providerRuntime.start(OAuthProviders.GOOGLE);
    while (fixture.openAuth.mock.calls.length === 0) await Promise.resolve();
    const [authorizationUrl, returnTarget] = fixture.openAuth.mock.calls[0]!;
    fixture.context.config = config({
      auth: {
        oauth: {
          ...fixture.context.config.auth?.oauth,
          appScheme: "changed-example",
        },
      },
    });
    const state = new URL(authorizationUrl).searchParams.get("state")!;
    finishBrowser({
      type: "success",
      url: `${returnTarget}?id_token=identity-token&state=${encodeURIComponent(state)}`,
    });

    await expect(pending).rejects.toThrow("OAuth context changed");
    expect(fixture.value.discardUncommittedApiKeyPair).toHaveBeenCalledWith(
      "public-key-1",
    );
  });

  it("uses the initialized no-proxy HTTP defaults without inventing a proxy config ID", () => {
    const providerConfig = config({ authProxyConfigId: undefined });
    const sdkClient = client();
    delete (sdkClient.value.config as { authProxyConfigId?: string })
      .authProxyConfigId;
    delete (sdkClient.value.httpClient.config as { authProxyConfigId?: string })
      .authProxyConfigId;
    const context: CurrentOAuthProviderContext = {
      client: sdkClient.value,
      config: providerConfig,
      masterConfig: providerConfig,
      proxyConfig: null,
      callbacks: undefined,
      completeOauth: jest.fn(async () => ({ action: "login" }) as never),
    };
    const runtime = createOAuthProviderFlowRuntime({
      client: sdkClient.value,
      initializedConfig: providerConfig,
      secureStorage: storage().source,
      getCurrent: () => context,
      isBrowserAvailable: async () => true,
      openAuth: async () => ({ type: "cancel" }),
      generatePkce: async () => ({ verifier: "v", codeChallenge: "c" }),
      randomBytes: (length) => new Uint8Array(length).fill(7),
      now: () => 1_000,
    });

    const google = runtime
      .getConfiguredFlows()
      .find((flow) => flow.snapshot.provider === OAuthProviders.GOOGLE)!;
    expect(google.snapshot).toMatchObject({
      organizationId: "organization-1",
      apiBaseUrl: "https://api.0xkey.com",
      authProxyUrl: "https://authproxy.0xkey.io",
      authProxyConfigId: null,
    });
    expect(google.snapshot.configId).toContain('"local"');
  });
});
