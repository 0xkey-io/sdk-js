import { describe, expect, it } from "@jest/globals";
import { OAuthProviders } from "@0xkey-io/sdk-types";
import { buildOAuthUrl } from "../utils/oauth";
import {
  createOauthRoutingSnapshot,
  validateOauthCallbackUrl,
} from "../utils/oauth-routing";
import { resolveOauthProviderSettings } from "../utils/oauth-provider-settings";

const transactionId = "0123456789abcdef0123456789abcdef";
const returnedState = `transactionId=${transactionId}&note=a%2526b+word`;
const response = `code=synthetic-code&state=${encodeURIComponent(returnedState)}`;
const base = {
  organizationId: "org-one",
  apiBaseUrl: "https://api.example",
  authProxyUrl: "https://proxy.example",
  provider: OAuthProviders.GOOGLE,
  completion: "internal" as const,
  settings: {
    clientId: "client-one",
    redirectUri: "https://relay.example?tag=a%20b&mark=%7e",
    appScheme: "myapp",
  },
};

describe("trusted OAuth routing", () => {
  it.each([
    [
      OAuthProviders.GOOGLE,
      "https://relay.example?tag=a%20b&mark=%7e&scheme=myapp",
      "myapp://",
    ],
    [
      OAuthProviders.APPLE,
      "https://relay.example?tag=a%20b&mark=%7e&scheme=myapp",
      "myapp://",
    ],
    [
      OAuthProviders.FACEBOOK,
      "https://relay.example?tag=a%20b&mark=%7e&scheme=myapp",
      "myapp://",
    ],
    [
      OAuthProviders.X,
      "provider://auth:123/callback?tag=a%20b",
      "provider://auth:123/callback?tag=a%20b",
    ],
    [
      OAuthProviders.DISCORD,
      "provider://auth:123/callback?tag=a%20b",
      "provider://auth:123/callback?tag=a%20b",
    ],
  ])(
    "keeps %s exact provider and app targets through the authorization builder",
    (provider, redirect, target) => {
      const direct =
        provider === OAuthProviders.X || provider === OAuthProviders.DISCORD;
      const settings = resolveOauthProviderSettings({
        provider,
        oauth: {
          appScheme: "myapp",
          [provider]: {
            clientId: "client-one",
            ...(direct ? { redirectUri: target } : {}),
          },
        },
        defaultRedirectUri: base.settings.redirectUri,
      });
      const snapshot = createOauthRoutingSnapshot({
        ...base,
        provider,
        settings,
      });
      expect(snapshot.providerRedirectUri).toBe(redirect);
      expect(snapshot.appReturnTarget).toBe(target);
      const auth = new URL(
        buildOAuthUrl({
          provider,
          clientId: snapshot.clientId,
          redirectUri: snapshot.providerRedirectUri,
          nonce: "synthetic-nonce",
          publicKey: "synthetic-public-key",
          transactionId,
          useOauthProxyOrigin: !direct,
        }),
      );
      expect(
        auth.searchParams.get(direct ? "redirect_uri" : "redirectUri"),
      ).toBe(redirect);
      const state = auth.searchParams.get("state")!;
      const callback = `${target}${target.includes("?") ? "&" : "?"}state=${encodeURIComponent(state)}&code=synthetic-code`;
      expect(validateOauthCallbackUrl(snapshot, callback)).toEqual({
        transactionId,
        returnedState: state,
      });
    },
  );

  it.each([OAuthProviders.X, OAuthProviders.DISCORD])(
    "keeps %s resolved bare fallback without an invented callback path",
    (provider) => {
      const settings = resolveOauthProviderSettings({
        provider,
        oauth: { appScheme: "myapp", [provider]: { clientId: "client-one" } },
        defaultRedirectUri: "https://relay.example",
      });
      const snapshot = createOauthRoutingSnapshot({
        ...base,
        provider,
        settings,
      });
      expect(snapshot.providerRedirectUri).toBe("myapp://");
      expect(snapshot.appReturnTarget).toBe("myapp://");
      expect(
        validateOauthCallbackUrl(snapshot, `myapp://?${response}`),
      ).toEqual({ transactionId, returnedState });
      expect(() =>
        validateOauthCallbackUrl(snapshot, `myapp:///?${response}`),
      ).toThrow("Invalid OAuth callback route");
    },
  );

  it.each([
    ["https://relay.example", "https://relay.example?scheme=myapp"],
    ["https://relay.example/", "https://relay.example/?scheme=myapp"],
    ["https://relay.example/cb?", "https://relay.example/cb?scheme=myapp"],
    [
      "https://relay.example/cb?tag=%7e&",
      "https://relay.example/cb?tag=%7e&scheme=myapp",
    ],
    [
      "https://relay.example?sch%65me=my%61pp&tag=a%20b",
      "https://relay.example?sch%65me=my%61pp&tag=a%20b",
    ],
  ])("preserves accepted callback bytes: %s", (redirectUri, expected) => {
    expect(
      createOauthRoutingSnapshot({
        ...base,
        settings: { ...base.settings, redirectUri },
      }).providerRedirectUri,
    ).toBe(expected);
  });

  it("encodes a valid bare scheme using form encoding", () => {
    const snapshot = createOauthRoutingSnapshot({
      ...base,
      settings: { ...base.settings, appScheme: "my+app" },
    });
    expect(snapshot.providerRedirectUri).toBe(
      "https://relay.example?tag=a%20b&mark=%7e&scheme=my%2Bapp",
    );
    expect(snapshot.appReturnTarget).toBe("my+app://");
  });

  it("preserves a legal double-slash path after a nonempty authority", () => {
    const relay = createOauthRoutingSnapshot({
      ...base,
      settings: {
        ...base.settings,
        redirectUri: "https://relay.example//callback",
      },
    });
    expect(relay.providerRedirectUri).toBe(
      "https://relay.example//callback?scheme=myapp",
    );
    const direct = createOauthRoutingSnapshot({
      ...base,
      provider: OAuthProviders.X,
      settings: { ...base.settings, redirectUri: "myapp://auth//callback" },
    });
    expect(
      validateOauthCallbackUrl(direct, `myapp://auth//callback?${response}`),
    ).toEqual({ transactionId, returnedState });
    expect(() =>
      validateOauthCallbackUrl(direct, `myapp://auth/callback?${response}`),
    ).toThrow("Invalid OAuth callback route");
  });

  it("rejects trailing newline in shared scheme even when the direct override is valid", () => {
    expect(() =>
      createOauthRoutingSnapshot({
        ...base,
        provider: OAuthProviders.X,
        settings: {
          ...base.settings,
          appScheme: "myapp\n",
          redirectUri: "provider://auth/callback",
        },
      }),
    ).toThrow("Invalid OAuth routing configuration");
  });

  it.each([
    "https://relay.example?scheme=other",
    "https://relay.example?scheme=myapp&sch%65me=myapp",
    "https://relay.example#",
    "https://relay.example#fragment",
    "http://relay.example",
    "https:////relay.example",
    "https:/relay.example",
    "https://@relay.example",
    "https://user:pass@relay.example",
    "https://relay.example\\callback",
    "https://relay.example/../callback",
    "https://relay.example/%2e/callback",
    "https://relay.example/a/.%2E/callback",
    "https://relay.example/%GG",
    "https://relay.example/%C0%AF",
    "https://relay.example?tag=%",
    "https://relay.example?%GG=value",
    "https://relay.example?tag=%ED%A0%80",
    "https://relay.example?tag=raw space",
    "https://relay.example\n",
  ])(
    "rejects invalid configured Relay route without echoing it: %s",
    (redirectUri) => {
      expect(() =>
        createOauthRoutingSnapshot({
          ...base,
          settings: { ...base.settings, redirectUri },
        }),
      ).toThrow("Invalid OAuth routing configuration");
    },
  );

  it.each([
    "state",
    "code",
    "id_token",
    "access_token",
    "refresh_token",
    "token_type",
    "expires_in",
    "expires_at",
    "error",
    "error_description",
    "error_uri",
    "session_state",
    "scheme",
    "transactionId",
    "provider",
    "publicKey",
    "nonce",
    "configId",
    "registrationId",
    "organizationId",
    "client_id",
    "clientId",
    "redirect_uri",
    "redirectUri",
  ])(
    "rejects configured reserved static field %s including encoded names",
    (name) => {
      const encoded = `%${name.charCodeAt(0).toString(16)}${name.slice(1)}`;
      for (const provider of [OAuthProviders.GOOGLE, OAuthProviders.X]) {
        const prefix =
          provider === OAuthProviders.X
            ? "myapp://auth"
            : "https://relay.example";
        expect(() =>
          createOauthRoutingSnapshot({
            ...base,
            provider,
            settings: {
              ...base.settings,
              redirectUri: `${prefix}?${encoded}=untrusted`,
            },
          }),
        ).toThrow("Invalid OAuth routing configuration");
      }
    },
  );

  it.each([
    "",
    "myapp://",
    "myapp:",
    "1app",
    "my app",
    "myapp\n",
    "javascript",
    "data",
    "file",
    "http",
    "https",
    "ftp",
    "about",
    "blob",
    "intent",
    "chrome",
    "HTTPS",
  ])(
    "rejects unsafe or non-bare appScheme %s for every provider",
    (appScheme) => {
      for (const provider of Object.values(OAuthProviders)) {
        expect(() =>
          createOauthRoutingSnapshot({
            ...base,
            provider,
            settings: { ...base.settings, appScheme },
          }),
        ).toThrow("Invalid OAuth routing configuration");
      }
    },
  );

  it.each([
    "https://app.example/cb",
    "javascript://auth/cb",
    "myapp:callback",
    "myapp:////auth",
    "myapp://@auth/cb",
    "myapp://auth/cb#",
    "myapp://auth/a/../cb",
    "myapp://auth/%2e%2e/cb",
  ])("rejects invalid direct target %s", (redirectUri) => {
    expect(() =>
      createOauthRoutingSnapshot({
        ...base,
        provider: OAuthProviders.X,
        settings: { ...base.settings, redirectUri },
      }),
    ).toThrow("Invalid OAuth routing configuration");
  });

  it.each([
    "myapp-evil://",
    "other://",
    "myapp://host",
    "myapp:///",
    "myapp://@",
    "myapp://user@",
    "myapp://\\",
    "myapp:////",
    "myapp://\n",
    "myapp:// ",
  ])(
    "rejects wrong bare callback route %s even with matching state",
    (route) => {
      const snapshot = createOauthRoutingSnapshot(base);
      expect(() =>
        validateOauthCallbackUrl(snapshot, `${route}?${response}`),
      ).toThrow("Invalid OAuth callback route");
    },
  );

  it.each([
    "other://auth:123/callback",
    "provider://auth.evil:123/callback",
    "provider://auth:124/callback",
    "provider://auth:123/callback/",
    "provider://auth:123/callback-evil",
    "provider://auth:123/%63allback",
    "provider://auth:123/a/../callback",
    "provider://auth:123/%2e/callback",
    "provider://@auth:123/callback",
    "provider://auth:123/%GG",
  ])(
    "rejects wrong explicit route %s before extracting even malformed state",
    (route) => {
      const snapshot = createOauthRoutingSnapshot({
        ...base,
        provider: OAuthProviders.X,
        settings: {
          ...base.settings,
          redirectUri: "provider://auth:123/callback",
        },
      });
      expect(() =>
        validateOauthCallbackUrl(snapshot, `${route}?${response}`),
      ).toThrow("Invalid OAuth callback route");
      expect(() =>
        validateOauthCallbackUrl(snapshot, `${route}?state=%GG`),
      ).toThrow("Invalid OAuth callback route");
    },
  );

  it.each([
    ["myapp://auth/a%2Fb", "myapp://auth/a/b"],
    ["myapp://auth/a%2Fb", "myapp://auth/a%2fb"],
    ["myapp://auth/%63allback", "myapp://auth/callback"],
  ])("does not conflate raw paths %s and %s", (target, different) => {
    const snapshot = createOauthRoutingSnapshot({
      ...base,
      provider: OAuthProviders.DISCORD,
      settings: { ...base.settings, redirectUri: target },
    });
    expect(validateOauthCallbackUrl(snapshot, `${target}?${response}`)).toEqual(
      { transactionId, returnedState },
    );
    expect(() =>
      validateOauthCallbackUrl(snapshot, `${different}?${response}`),
    ).toThrow("Invalid OAuth callback route");
  });

  it("matches direct static query as a decoded multiset including duplicate counts", () => {
    const snapshot = createOauthRoutingSnapshot({
      ...base,
      provider: OAuthProviders.X,
      settings: {
        ...base.settings,
        redirectUri: "myapp://auth?tag=a%20b&tag=a+b&mark=%7e",
      },
    });
    expect(
      validateOauthCallbackUrl(
        snapshot,
        `myapp://auth?mark=~&tag=a+b&tag=a%20b&extension=ok&${response}`,
      ),
    ).toEqual({ transactionId, returnedState });
    for (const query of [
      "",
      "tag=a+b&mark=~&",
      "tag=changed&tag=a+b&mark=~&",
      "tag=a+b&tag=a+b&tag=a+b&mark=~&",
    ]) {
      expect(() =>
        validateOauthCallbackUrl(snapshot, `myapp://auth?${query}${response}`),
      ).toThrow("Invalid OAuth callback route");
    }
  });

  it("accepts Relay static forwarding in full or absent but rejects partial and tampered copies", () => {
    const snapshot = createOauthRoutingSnapshot(base);
    for (const query of [
      "",
      "mark=~&tag=a+b&",
      "tag=a%20b&mark=%7E&extension=ok&",
    ]) {
      expect(
        validateOauthCallbackUrl(snapshot, `myapp://?${query}${response}`),
      ).toEqual({ transactionId, returnedState });
    }
    for (const query of [
      "tag=a+b&",
      "mark=~&",
      "tag=changed&mark=~&",
      "tag=a+b&tag=a+b&mark=~&",
    ]) {
      expect(() =>
        validateOauthCallbackUrl(snapshot, `myapp://?${query}${response}`),
      ).toThrow("Invalid OAuth callback route");
    }
  });

  it("preserves extractor once-decoding and conservative security-envelope rejection", () => {
    const snapshot = createOauthRoutingSnapshot(base);
    expect(
      validateOauthCallbackUrl(
        snapshot,
        `myapp://?${response}&provider=untrusted&publicKey=untrusted&configId=untrusted#screen`,
      ),
    ).toEqual({ transactionId, returnedState });
    for (const callback of [
      `myapp://?${response}&state=duplicate`,
      `myapp://?${response}&%63ode=duplicate`,
      `myapp://?${response}&error=secret`,
      `myapp://?state=${encodeURIComponent(returnedState)}&error=secret`,
      `myapp://?${response}#state=other`,
      `myapp://?${response}#id_token=other`,
      "myapp://?state=%GG",
      `myapp://?state=${encodeURIComponent(`transactionId=${transactionId}&transactionId=${transactionId}`)}`,
    ])
      expect(() => validateOauthCallbackUrl(snapshot, callback)).toThrow(
        "Invalid OAuth transaction callback",
      );
  });

  it("binds every trust-relevant field deterministically without proxy/local namespace collisions", () => {
    const original = createOauthRoutingSnapshot(base);
    expect(
      createOauthRoutingSnapshot({ ...base, settings: { ...base.settings } })
        .binding,
    ).toBe(original.binding);
    const variants = [
      { ...base, organizationId: "org-two" },
      { ...base, apiBaseUrl: "https://api-two.example" },
      { ...base, authProxyUrl: "https://proxy-two.example" },
      { ...base, authProxyConfigId: "proxy-id" },
      { ...base, provider: OAuthProviders.APPLE },
      { ...base, settings: { ...base.settings, clientId: "client-two" } },
      {
        ...base,
        settings: {
          ...base.settings,
          redirectUri: "https://relay.example/?tag=a%20b&mark=%7e",
        },
      },
      { ...base, settings: { ...base.settings, appScheme: "anotherapp" } },
      { ...base, completion: "onOauthRedirect" as const },
      { ...base, completion: "onOauthSuccess" as const },
    ];
    const bindings = variants.map(
      (input) => createOauthRoutingSnapshot(input).binding,
    );
    expect(new Set([original.binding, ...bindings]).size).toBe(
      variants.length + 1,
    );
    expect(original.mode).toBe("relay");
    expect(
      createOauthRoutingSnapshot({ ...base, organizationId: "org-two" })
        .configId,
    ).not.toBe(original.configId);
    expect(
      createOauthRoutingSnapshot({
        ...base,
        authProxyConfigId: original.configId,
      }).configId,
    ).not.toBe(original.configId);
    expect(JSON.parse(original.binding)).toContain(null);
    expect(JSON.parse(original.binding)).toContain("relay");
  });

  it.each([
    "organizationId",
    "apiBaseUrl",
    "authProxyUrl",
    "authProxyConfigId",
    "provider",
    "completion",
  ])("rejects empty required identity/selection %s", (key) => {
    expect(() => createOauthRoutingSnapshot({ ...base, [key]: "" })).toThrow(
      "Invalid OAuth routing configuration",
    );
  });

  it.each(["clientId", "redirectUri", "appScheme"])(
    "rejects missing/empty resolved field %s",
    (key) => {
      for (const value of [undefined, ""]) {
        expect(() =>
          createOauthRoutingSnapshot({
            ...base,
            settings: { ...base.settings, [key]: value },
          }),
        ).toThrow("Invalid OAuth routing configuration");
      }
    },
  );

  it("owns immutable nested constraints and isolates subsequent input/result mutation", () => {
    const input = { ...base, settings: { ...base.settings } };
    const snapshot = createOauthRoutingSnapshot(input);
    const binding = snapshot.binding;
    input.settings.redirectUri = "https://changed.example";
    input.organizationId = "changed";
    expect(Reflect.set(snapshot, "binding", "changed")).toBe(false);
    expect(Reflect.set(snapshot.appRoute, "path", "/changed")).toBe(false);
    expect(Reflect.set(snapshot.staticQuery[0]!, "0", "changed")).toBe(false);
    expect(Reflect.set(snapshot.staticQuery, "0", ["changed", "value"])).toBe(
      false,
    );
    expect(snapshot.binding).toBe(binding);
    expect(
      validateOauthCallbackUrl(snapshot, `myapp://?tag=a+b&mark=~&${response}`),
    ).toEqual({ transactionId, returnedState });
  });
});
