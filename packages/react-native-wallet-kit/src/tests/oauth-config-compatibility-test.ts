import { describe, expect, it } from "@jest/globals";
import { OAuthProviders, ZeroXKeyErrorCodes } from "@0xkey-io/sdk-types";
import { resolveOauthProviderSettings } from "../utils/oauth-provider-settings";

const defaultRedirectUri = "https://oauth-redirect.0xkey.com/";

describe("OAuth provider settings compatibility", () => {
  it.each([
    {
      provider: OAuthProviders.GOOGLE,
      providerConfig: {
        primaryClientId: { webClientId: "google-provider" },
        clientId: "google-provider-legacy",
      },
      invocation: {
        primaryClientId: { webClientId: "google-invocation" },
        clientId: "google-invocation-legacy",
      },
      expectedClientId: "google-invocation",
    },
    {
      provider: OAuthProviders.APPLE,
      providerConfig: {
        primaryClientId: {
          serviceId: "apple-provider-service",
          iosBundleId: "apple.provider.bundle",
        },
        clientId: "apple-provider-legacy",
      },
      invocation: {
        primaryClientId: {
          serviceId: "apple-invocation-service",
          iosBundleId: "apple.invocation.bundle",
        },
        clientId: "apple-invocation-legacy",
      },
      expectedClientId: "apple-invocation-service",
    },
    {
      provider: OAuthProviders.FACEBOOK,
      providerConfig: {
        primaryClientId: "facebook-provider",
        clientId: "facebook-provider-legacy",
      },
      invocation: {
        primaryClientId: "facebook-invocation",
        clientId: "facebook-invocation-legacy",
      },
      expectedClientId: "facebook-invocation",
    },
    {
      provider: OAuthProviders.X,
      providerConfig: {
        primaryClientId: "x-provider",
        clientId: "x-provider-legacy",
      },
      invocation: {
        primaryClientId: "x-invocation",
        clientId: "x-invocation-legacy",
      },
      expectedClientId: "x-invocation",
    },
    {
      provider: OAuthProviders.DISCORD,
      providerConfig: {
        primaryClientId: "discord-provider",
        clientId: "discord-provider-legacy",
      },
      invocation: {
        primaryClientId: "discord-invocation",
        clientId: "discord-invocation-legacy",
      },
      expectedClientId: "discord-invocation",
    },
  ])(
    "uses canonical invocation settings for the $provider handler",
    ({ provider, providerConfig, invocation, expectedClientId }) => {
      const resolved = resolveOauthProviderSettings({
        provider,
        oauth: { [provider]: providerConfig },
        invocation,
        proxyClientIds: { [provider]: `${provider}-proxy` },
        defaultRedirectUri,
      });

      expect(resolved.clientId).toBe(expectedClientId);
    },
  );

  it("applies canonical and deprecated client ID precedence without treating an explicit empty ID as absent", () => {
    const base = {
      provider: OAuthProviders.GOOGLE,
      oauth: {
        google: {
          primaryClientId: { webClientId: "provider-canonical" },
          clientId: "provider-legacy",
        },
      },
      proxyClientIds: { google: "proxy" },
      defaultRedirectUri,
    } as const;

    expect(
      resolveOauthProviderSettings({
        ...base,
        invocation: {
          primaryClientId: { webClientId: undefined },
          clientId: "invocation-legacy",
        },
      }).clientId,
    ).toBe("invocation-legacy");
    expect(
      resolveOauthProviderSettings({
        ...base,
        invocation: { primaryClientId: { webClientId: "" } },
      }).clientId,
    ).toBe("");
    expect(
      resolveOauthProviderSettings({
        ...base,
        oauth: { google: { clientId: "provider-legacy" } },
      }).clientId,
    ).toBe("provider-legacy");
    expect(resolveOauthProviderSettings(base).clientId).toBe(
      "provider-canonical",
    );
    expect(
      resolveOauthProviderSettings({
        ...base,
        oauth: { google: true },
      }).clientId,
    ).toBe("proxy");
  });

  it("keeps Apple browser and native identifiers distinct", () => {
    const resolved = resolveOauthProviderSettings({
      provider: OAuthProviders.APPLE,
      oauth: {
        apple: {
          primaryClientId: {
            serviceId: "com.example.web",
            iosBundleId: "com.example.ios",
          },
        },
      },
      defaultRedirectUri,
    });

    expect(resolved.clientId).toBe("com.example.web");
    expect(resolved.iosBundleId).toBe("com.example.ios");

    const nativeOnly = resolveOauthProviderSettings({
      provider: OAuthProviders.APPLE,
      oauth: {
        apple: { primaryClientId: { iosBundleId: "com.example.ios" } },
      },
      defaultRedirectUri,
    });
    expect(nativeOnly.clientId).toBeUndefined();
    expect(nativeOnly.iosBundleId).toBe("com.example.ios");
  });

  it.each([
    [
      OAuthProviders.GOOGLE,
      { google: { primaryClientId: { serviceId: "apple-service" } } },
      undefined,
      "Invalid OAuth google primaryClientId configuration.",
    ],
    [
      OAuthProviders.APPLE,
      undefined,
      { primaryClientId: { webClientId: "google-web" } },
      "Invalid OAuth apple primaryClientId configuration.",
    ],
  ])(
    "rejects cross-provider primary client ID keys for %s",
    (provider, oauth, invocation, message) => {
      expect(() =>
        resolveOauthProviderSettings({
          provider,
          oauth: oauth as any,
          invocation,
          defaultRedirectUri,
        }),
      ).toThrow(message);
    },
  );

  it.each([
    [OAuthProviders.GOOGLE, {}],
    [OAuthProviders.GOOGLE, { webClientId: undefined }],
    [OAuthProviders.APPLE, {}],
    [OAuthProviders.APPLE, { serviceId: undefined, iosBundleId: undefined }],
  ])(
    "accepts empty or explicitly undefined documented primary fields for %s",
    (provider, primaryClientId) => {
      expect(
        resolveOauthProviderSettings({
          provider,
          oauth: { [provider]: { primaryClientId } } as any,
          proxyClientIds: { [provider]: "proxy-client" },
          defaultRedirectUri,
        }).clientId,
      ).toBe("proxy-client");
    },
  );

  it.each([
    [
      "invocation legacy alias",
      {
        invocation: {
          primaryClientId: { webClientId: "valid-invocation" },
          clientId: { secret: "hidden-invocation-secret" },
        },
      },
      "Invalid OAuth google clientId configuration.",
      "hidden-invocation-secret",
    ],
    [
      "provider legacy alias",
      {
        oauth: {
          google: {
            primaryClientId: { webClientId: "valid-provider" },
            clientId: { secret: "hidden-provider-secret" },
          },
        },
      },
      "Invalid OAuth google clientId configuration.",
      "hidden-provider-secret",
    ],
    [
      "proxy client ID",
      {
        oauth: {
          google: { primaryClientId: { webClientId: "valid-provider" } },
        },
        proxyClientIds: { google: { secret: "hidden-proxy-secret" } },
      },
      "Invalid OAuth google proxy clientId configuration.",
      "hidden-proxy-secret",
    ],
  ])(
    "validates a malformed lower-priority %s even when a canonical ID wins",
    (_source, partial, expectedMessage, secret) => {
      let thrown: unknown;
      try {
        resolveOauthProviderSettings({
          provider: OAuthProviders.GOOGLE,
          defaultRedirectUri,
          ...(partial as any),
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({
        code: ZeroXKeyErrorCodes.INVALID_CONFIGURATION,
        message: expectedMessage,
      });
      expect((thrown as Error | undefined)?.message).not.toContain(secret);
    },
  );

  it("honors an explicit empty secondary list and owns immutable copies", () => {
    const providerSecondary = ["provider-secondary"];
    const invocationSecondary: string[] = [];
    const resolved = resolveOauthProviderSettings({
      provider: OAuthProviders.FACEBOOK,
      oauth: {
        facebook: {
          primaryClientId: "facebook-client",
          secondaryClientIds: providerSecondary,
        },
      },
      invocation: { secondaryClientIds: invocationSecondary },
      defaultRedirectUri,
    });

    providerSecondary.push("late-provider-mutation");
    invocationSecondary.push("late-invocation-mutation");

    expect(resolved.secondaryClientIds).toEqual([]);
    expect(Object.isFrozen(resolved.secondaryClientIds)).toBe(true);
    expect(Object.isFrozen(resolved)).toBe(true);

    const providerResolved = resolveOauthProviderSettings({
      provider: OAuthProviders.FACEBOOK,
      oauth: {
        facebook: {
          primaryClientId: "facebook-client",
          secondaryClientIds: providerSecondary,
        },
      },
      defaultRedirectUri,
    });
    providerSecondary.push("another-late-provider-mutation");
    expect(providerResolved.secondaryClientIds).toEqual([
      "provider-secondary",
      "late-provider-mutation",
    ]);
  });

  it.each([
    [
      "provider",
      { redirectUri: "provider://callback" },
      "shared://callback",
      "proxy://callback",
      "provider://callback",
    ],
    [
      "shared",
      {},
      "shared://callback",
      "proxy://callback",
      "shared://callback",
    ],
    ["proxy", {}, undefined, "proxy://callback", "proxy://callback"],
    ["default", {}, undefined, undefined, defaultRedirectUri],
  ])(
    "uses the %s redirect for Google/Apple/Facebook",
    (
      _source,
      providerConfig,
      sharedRedirectUri,
      proxyRedirectUri,
      expected,
    ) => {
      for (const provider of [
        OAuthProviders.GOOGLE,
        OAuthProviders.APPLE,
        OAuthProviders.FACEBOOK,
      ]) {
        expect(
          resolveOauthProviderSettings({
            provider,
            oauth: {
              ...(sharedRedirectUri === undefined
                ? {}
                : { redirectUri: sharedRedirectUri }),
              [provider]: providerConfig,
            },
            proxyRedirectUri,
            defaultRedirectUri,
          }).redirectUri,
        ).toBe(expected);
      }
    },
  );

  it.each([OAuthProviders.X, OAuthProviders.DISCORD])(
    "uses the bare app scheme before shared/proxy/default redirects for %s",
    (provider) => {
      expect(
        resolveOauthProviderSettings({
          provider,
          oauth: {
            appScheme: "example",
            redirectUri: "shared://callback",
            [provider]: {},
          },
          proxyRedirectUri: "proxy://callback",
          defaultRedirectUri,
        }).redirectUri,
      ).toBe("example://");

      expect(
        resolveOauthProviderSettings({
          provider,
          oauth: {
            appScheme: "example",
            [provider]: { redirectUri: "provider://callback" },
          },
          defaultRedirectUri,
        }).redirectUri,
      ).toBe("provider://callback");

      expect(
        resolveOauthProviderSettings({
          provider,
          oauth: { redirectUri: "shared://callback", [provider]: {} },
          proxyRedirectUri: "proxy://callback",
          defaultRedirectUri,
        }).redirectUri,
      ).toBe("shared://callback");

      expect(
        resolveOauthProviderSettings({
          provider,
          oauth: { [provider]: {} },
          proxyRedirectUri: "proxy://callback",
          defaultRedirectUri,
        }).redirectUri,
      ).toBe("proxy://callback");

      expect(
        resolveOauthProviderSettings({
          provider,
          oauth: { [provider]: {} },
          defaultRedirectUri,
        }).redirectUri,
      ).toBe(defaultRedirectUri);
    },
  );

  it.each([
    [
      "Invalid OAuth google primaryClientId configuration.",
      {
        provider: OAuthProviders.GOOGLE,
        invocation: { primaryClientId: "not-an-object" },
      },
    ],
    [
      "Invalid OAuth apple primaryClientId configuration.",
      {
        provider: OAuthProviders.APPLE,
        oauth: { apple: { primaryClientId: { serviceId: 42 } } },
      },
    ],
    [
      "Invalid OAuth facebook clientId configuration.",
      {
        provider: OAuthProviders.FACEBOOK,
        invocation: { clientId: { secret: "must-not-appear" } },
      },
    ],
    [
      "Invalid OAuth x secondaryClientIds configuration.",
      {
        provider: OAuthProviders.X,
        oauth: { x: { secondaryClientIds: ["valid", 7] } },
      },
    ],
    [
      "Invalid OAuth discord provider configuration.",
      { provider: OAuthProviders.DISCORD, oauth: { discord: [] } },
    ],
    [
      "Invalid OAuth google handler parameters configuration.",
      { provider: OAuthProviders.GOOGLE, invocation: [] },
    ],
  ])(
    "rejects malformed runtime settings with a fixed error",
    (message, partial) => {
      expect(() =>
        resolveOauthProviderSettings({
          defaultRedirectUri,
          ...(partial as any),
        }),
      ).toThrow(message);
    },
  );
});
