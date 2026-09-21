/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://app.example.test/"}
 */
import { describe, expect, it } from "@jest/globals";
import { OAuthProviders } from "@0xkey-io/sdk-types";
import type { ZeroXKeyProviderConfig } from "../types/base";
import {
  captureOAuthPopupBinding,
  createOAuthInitializationBinding,
  type OAuthPopupProviderView,
} from "../utils/oauth/popup-binding";

const constructorIdentity = {
  organizationId: "org-A",
  apiBaseUrl: "https://api.example.test",
  authProxyUrl: "https://auth.example.test",
  authProxyConfigId: "proxy-A",
};

function providerConfig(
  overrides: Partial<ZeroXKeyProviderConfig> = {},
): ZeroXKeyProviderConfig {
  return {
    ...constructorIdentity,
    autoFetchWalletKitConfig: false,
    auth: {
      methods: {
        googleOauthEnabled: true,
        discordOauthEnabled: true,
      },
      oauthConfig: {
        googleClientId: "google-A",
        discordClientId: "discord-A",
        oauthRedirectUri:
          "https://app.example.test/oauth/callback?tenant=one&tenant=two&mode=a%2Fb",
        openOauthInPage: false,
      },
      createSuborgParams: {
        oauth: { userName: "OAuth user" },
      },
    },
    ...overrides,
  };
}

function setup() {
  const config = providerConfig();
  const httpConfig = { ...constructorIdentity };
  const httpClient = { config: httpConfig };
  const coreConfig = { ...constructorIdentity };
  const client = { config: coreConfig, httpClient };
  const view: OAuthPopupProviderView = {
    rawConfig: config,
    masterConfig: config,
    proxy: undefined,
    isMobile: false,
    client,
  };
  const initialization = createOAuthInitializationBinding({
    constructorIdentity,
    client,
  });
  const capture = (
    input: Partial<Parameters<typeof captureOAuthPopupBinding>[0]> = {},
  ) => {
    const provider = input.provider ?? OAuthProviders.DISCORD;
    const invocation = input.invocation ?? {};
    const clientId =
      invocation.clientId ??
      (provider === OAuthProviders.GOOGLE
        ? config.auth?.oauthConfig?.googleClientId
        : config.auth?.oauthConfig?.discordClientId)!;
    const emittedRedirectUri =
      provider === OAuthProviders.GOOGLE
        ? config.auth?.oauthConfig?.oauthRedirectUri?.replace(/\/$/, "")
        : config.auth?.oauthConfig?.oauthRedirectUri;
    return captureOAuthPopupBinding({
      initialization,
      readCurrent: () => view,
      provider,
      invocation,
      completion: {
        category: "internal",
        internalSignupDefaults: config.auth?.createSuborgParams?.oauth,
      },
      openerOrigin: "https://app.example.test",
      operation: {
        clientId,
        openInPage: invocation.openInPage ?? false,
        emittedRedirectUri: emittedRedirectUri!,
      },
      ...input,
    });
  };
  return {
    capture,
    client,
    config,
    coreConfig,
    httpClient,
    httpConfig,
    initialization,
    view,
  };
}

function reason(error: unknown): unknown {
  return (error as { reason?: unknown }).reason;
}

describe("OAuth popup binding", () => {
  it("captures the exact emitted route and decoded static-query multiset", () => {
    const { capture } = setup();
    const binding = capture();

    expect(binding.route).toEqual({
      emittedRedirectUri:
        "https://app.example.test/oauth/callback?tenant=one&tenant=two&mode=a%2Fb",
      origin: "https://app.example.test",
      observedPath: "/oauth/callback",
      staticQuery: [
        ["tenant", "one"],
        ["tenant", "two"],
        ["mode", "a/b"],
      ],
    });
    expect(() => binding.assertCurrent()).not.toThrow();
  });

  it("uses the root observation rule without rewriting Google's emitted string", () => {
    const { capture, config, view } = setup();
    config.auth!.oauthConfig!.oauthRedirectUri =
      "https://app.example.test/?tenant=one";
    view.masterConfig = providerConfig({
      auth: {
        ...config.auth,
        oauthConfig: { ...config.auth!.oauthConfig },
      },
    });
    const binding = capture({ provider: OAuthProviders.GOOGLE });

    expect(binding.route).toEqual({
      emittedRedirectUri: "https://app.example.test/?tenant=one",
      origin: "https://app.example.test",
      observedPath: "/",
      staticQuery: [["tenant", "one"]],
    });
  });

  it.each([
    ["userinfo", "https://@app.example.test/oauth/callback"],
    ["empty port", "https://app.example.test:/oauth/callback"],
    ["percent host", "https://app%2eexample.test/oauth/callback"],
    ["percent host letter", "https://%61pp.example.test/oauth/callback"],
    ["authority control", "https://app.example.test\t/oauth/callback"],
    ["backslash", "https://app.example.test\\oauth/callback"],
    ["fragment", "https://app.example.test/oauth/callback#fragment"],
    ["literal dot segment", "https://app.example.test/a/../callback"],
    ["encoded dot segment", "https://app.example.test/a/%2e%2e/callback"],
    ["malformed escape", "https://app.example.test/oauth/%zz"],
    ["wrong scheme", "custom://app.example.test/oauth/callback"],
    [
      "forbidden static key",
      "https://app.example.test/oauth/callback?state=static",
    ],
    [
      "reserved metadata key",
      "https://app.example.test/oauth/callback?scope=static",
    ],
  ])("rejects invalid callback configuration: %s", (_label, redirectUri) => {
    const { capture, config, view } = setup();
    config.auth!.oauthConfig!.oauthRedirectUri = redirectUri;
    view.masterConfig = config;

    expect(() => capture()).toThrow();
    try {
      capture();
    } catch (error) {
      expect(reason(error)).toBe("callback-config-invalid");
    }
  });

  it.each<[string, "raw" | "master" | "core" | "http", string, string]>([
    ["raw organization", "raw", "organizationId", "org-B"],
    ["raw API URL", "raw", "apiBaseUrl", "https://api-B.example.test"],
    ["master proxy URL", "master", "authProxyUrl", "https://auth-B.test"],
    ["core config ID", "core", "authProxyConfigId", "proxy-B"],
    ["HTTP API URL", "http", "apiBaseUrl", "https://api-B.example.test"],
  ])(
    "rejects a changed %s even when the same object is mutated",
    (_label, target, field, changed) => {
      const { capture, view, coreConfig, httpConfig } = setup();
      const binding = capture();
      const object =
        target === "raw"
          ? view.rawConfig
          : target === "master"
            ? view.masterConfig!
            : target === "core"
              ? coreConfig
              : httpConfig;
      Object.assign(object, { [field]: changed });

      expect(() => binding.assertCurrent()).toThrow();
      try {
        binding.assertCurrent();
      } catch (error) {
        expect(reason(error)).toBe("context-changed");
      }
    },
  );

  it("rejects client, HTTP client, and HTTP config replacement separately", () => {
    const { capture, view, client, httpClient, httpConfig } = setup();
    const bindings = [capture(), capture(), capture()];

    view.client = { ...client };
    expect(() => bindings[0]!.assertCurrent()).toThrow();
    view.client = client;
    client.httpClient = { config: httpConfig };
    expect(() => bindings[1]!.assertCurrent()).toThrow();
    client.httpClient = httpClient;
    httpClient.config = { ...httpConfig };
    expect(() => bindings[2]!.assertCurrent()).toThrow();
  });

  it("projects invocation overrides before comparing raw and resolved defaults", () => {
    const { capture, config } = setup();
    const binding = capture({
      invocation: { clientId: "override", openInPage: false },
    });
    config.auth!.oauthConfig!.discordClientId = "raw-new";
    config.auth!.oauthConfig!.openOauthInPage = true;

    expect(() => binding.assertCurrent()).not.toThrow();
  });

  it("rejects an actual launch tuple that differs from the validated projection", () => {
    const { capture } = setup();

    expect(() =>
      capture({
        operation: {
          clientId: "discord-stale",
          openInPage: false,
          emittedRedirectUri:
            "https://app.example.test/oauth/callback?tenant=one&tenant=two&mode=a%2Fb",
        },
      }),
    ).toThrow();
    try {
      capture({
        operation: {
          clientId: "discord-stale",
          openInPage: false,
          emittedRedirectUri:
            "https://app.example.test/oauth/callback?tenant=one&tenant=two&mode=a%2Fb",
        },
      });
    } catch (error) {
      expect(reason(error)).toBe("context-changed");
    }
  });

  it("accepts an actual launch tuple selected by an explicit invocation override", () => {
    const { capture, config } = setup();
    const binding = capture({
      invocation: { clientId: "explicit-client", openInPage: false },
      operation: {
        clientId: "explicit-client",
        openInPage: false,
        emittedRedirectUri:
          "https://app.example.test/oauth/callback?tenant=one&tenant=two&mode=a%2Fb",
      },
    });
    config.auth!.oauthConfig!.discordClientId = "changed-default";

    expect(() => binding.assertCurrent()).not.toThrow();
  });

  it("rejects selected redirect, enablement, and unmasked client ID changes", () => {
    const selectedFields = [
      (config: ZeroXKeyProviderConfig) => {
        config.auth!.oauthConfig!.oauthRedirectUri =
          "https://app.example.test/other";
      },
      (config: ZeroXKeyProviderConfig) => {
        config.auth!.methods!.discordOauthEnabled = false;
      },
      (config: ZeroXKeyProviderConfig) => {
        config.auth!.oauthConfig!.discordClientId = "discord-B";
      },
    ];
    for (const change of selectedFields) {
      const { capture, view } = setup();
      const binding = capture();
      change(view.rawConfig);
      view.masterConfig = view.rawConfig;
      expect(() => binding.assertCurrent()).toThrow();
    }
  });

  it("ignores unrelated provider, UI, and callback changes", () => {
    const { capture, view } = setup();
    const binding = capture();
    view.rawConfig.auth!.oauthConfig!.googleClientId = "google-B";
    view.rawConfig.ui = { darkMode: true };
    view.masterConfig = view.rawConfig;

    expect(() => binding.assertCurrent()).not.toThrow();
  });

  it("binds fetched proxy payload to its original fetch identity", () => {
    const proxyConfig = {
      enabledProviders: ["discord"],
      sessionExpirationSeconds: "900",
      organizationId: "org-A",
      oauthClientIds: { discord: "proxy-discord" },
      oauthRedirectUrl: "https://app.example.test/oauth/callback",
    };
    const raw = providerConfig({
      autoFetchWalletKitConfig: true,
      authProxyConfigId: "proxy-A",
      auth: { methods: { walletAuthEnabled: false } },
    });
    const resolved = providerConfig({
      autoFetchWalletKitConfig: true,
      authProxyConfigId: "proxy-A",
      auth: {
        methods: { walletAuthEnabled: false, discordOauthEnabled: true },
        oauthConfig: {
          discordClientId: "proxy-discord",
          oauthRedirectUri: "https://app.example.test/oauth/callback",
          openOauthInPage: false,
        },
      },
    });
    const { client, initialization } = setup();
    client.config.authProxyConfigId = "proxy-A";
    client.httpClient.config.authProxyConfigId = "proxy-A";
    const view: OAuthPopupProviderView = {
      rawConfig: raw,
      masterConfig: resolved,
      proxy: {
        value: proxyConfig,
        fetchedFor: {
          authProxyConfigId: "proxy-A",
          authProxyUrl: "https://auth.example.test",
          shouldFetch: true,
        },
      },
      isMobile: false,
      client,
    };
    const binding = captureOAuthPopupBinding({
      initialization,
      readCurrent: () => view,
      provider: OAuthProviders.DISCORD,
      invocation: {},
      operation: {
        clientId: "proxy-discord",
        openInPage: false,
        emittedRedirectUri: "https://app.example.test/oauth/callback",
      },
      completion: { category: "custom" },
      openerOrigin: "https://app.example.test",
    });
    raw.authProxyConfigId = "proxy-B";

    expect(() => binding.assertCurrent()).toThrow();
  });

  it("guards internal signup defaults but never treats callback identity as revocation", () => {
    const { capture, view } = setup();
    const custom = capture({ completion: { category: "custom" } });
    view.rawConfig.auth!.createSuborgParams!.oauth = { userName: "changed" };
    view.masterConfig = view.rawConfig;
    expect(() => custom.assertCurrent()).not.toThrow();

    const internalSetup = setup();
    const internal = internalSetup.capture();
    internalSetup.view.rawConfig.auth!.createSuborgParams!.oauth = {
      userName: "changed",
    };
    expect(() => internal.assertCurrent()).toThrow();
  });

  it("fails unavailable when initialization or the effective transport cannot be read", () => {
    expect(() =>
      captureOAuthPopupBinding({
        initialization: undefined,
        readCurrent: () => setup().view,
        provider: OAuthProviders.DISCORD,
        invocation: {},
        operation: {
          clientId: "discord-A",
          openInPage: false,
          emittedRedirectUri:
            "https://app.example.test/oauth/callback?tenant=one&tenant=two&mode=a%2Fb",
        },
        completion: { category: "custom" },
        openerOrigin: "https://app.example.test",
      }),
    ).toThrow();

    const getterFailure = new Error("sensitive endpoint sentinel");
    const client = {
      config: { ...constructorIdentity },
      get httpClient(): never {
        throw getterFailure;
      },
    };
    expect(() =>
      createOAuthInitializationBinding({ constructorIdentity, client }),
    ).toThrow("OAuth popup context is unavailable.");
  });

  it("bounds throwing internal-default getters without exposing their value", () => {
    const { capture } = setup();
    const sentinel = "sensitive signup-default getter";
    const defaults = {};
    Object.defineProperty(defaults, "userName", {
      enumerable: true,
      get() {
        throw new Error(sentinel);
      },
    });

    let caught: unknown;
    try {
      capture({
        completion: {
          category: "internal",
          internalSignupDefaults: defaults,
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(reason(caught)).toBe("context-unavailable");
    expect(String(caught)).not.toContain(sentinel);
  });
});
