/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://app.example.test/"}
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { createHash } from "node:crypto";
import { act } from "react";
import type {
  StamperType,
  ZeroXKeyCallbacks,
  ZeroXKeyClient,
  ZeroXKeyProviderConfig,
} from "../index";
import { installOAuthPopups } from "./fixtures/oauth-popup";
import {
  setupProviderDom,
  type MountedProvider,
} from "./fixtures/provider-dom";

type CoreClient = Pick<
  ZeroXKeyClient,
  | "init"
  | "getAllSessions"
  | "getActiveSessionKey"
  | "createApiKeyPair"
  | "completeOauth"
  | "getSession"
  | "addOauthProvider"
>;
type ProxyOauth = ZeroXKeyClient["httpClient"]["proxyOAuth2Authenticate"];
type ProxyOauthParams = Parameters<ProxyOauth>[0];
type CompleteOauthParams = Parameters<CoreClient["completeOauth"]>[0];
type AddOauthProviderParams = Parameters<CoreClient["addOauthProvider"]>[0];

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

type Outcome<T> =
  | { status: "pending" }
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function observe<T>(promise: Promise<T>) {
  let outcome: Outcome<T> = { status: "pending" };
  const settled = promise.then(
    (value) => {
      outcome = { status: "fulfilled", value };
      return outcome;
    },
    (reason: unknown) => {
      outcome = { status: "rejected", reason };
      return outcome;
    },
  );
  return { outcome: () => outcome, settled };
}

type ClientSpec = {
  keys: string[];
  proxy?: (params: ProxyOauthParams) => ReturnType<ProxyOauth>;
  completeOauth?: (
    params: CompleteOauthParams,
  ) => ReturnType<CoreClient["completeOauth"]>;
  getSession?: (
    ...params: Parameters<CoreClient["getSession"]>
  ) => ReturnType<CoreClient["getSession"]>;
  addOauthProvider?: (
    params: AddOauthProviderParams,
  ) => ReturnType<CoreClient["addOauthProvider"]>;
};

let mockSpec: ClientSpec;
const mockConstructedConfigs: unknown[] = [];
const mockCreatedKeys: Array<{ client: number; publicKey: string }> = [];
const mockProxyCalls: Array<{ client: number; params: ProxyOauthParams }> = [];
const mockCompleteOauth =
  jest.fn<
    (params: CompleteOauthParams) => ReturnType<CoreClient["completeOauth"]>
  >();
const mockGetSession = jest.fn<CoreClient["getSession"]>();
const mockAddOauthProvider = jest.fn<CoreClient["addOauthProvider"]>();
const mockInit = jest.fn(async () => undefined);
const mockGetAllSessions = jest.fn(async () => ({}));
const mockGetActiveSessionKey = jest.fn(async () => undefined);
const mockZeroXKeyClient = jest.fn((config: unknown) => {
  const client = mockConstructedConfigs.length;
  mockConstructedConfigs.push(config);
  const base = {
    init: mockInit,
    getAllSessions: mockGetAllSessions,
    getActiveSessionKey: mockGetActiveSessionKey,
  } satisfies Pick<
    ZeroXKeyClient,
    "init" | "getAllSessions" | "getActiveSessionKey"
  >;
  const instance: Record<string, unknown> = { ...base };

  if (mockSpec.keys.length > 0) {
    instance.createApiKeyPair = async () => {
      const publicKey = mockSpec.keys.shift();
      if (!publicKey) throw new Error("No synthetic public key remains");
      mockCreatedKeys.push({ client, publicKey });
      return publicKey;
    };
  }
  if (mockSpec.proxy) {
    instance.httpClient = {
      proxyOAuth2Authenticate: async (params: ProxyOauthParams) => {
        mockProxyCalls.push({ client, params });
        return mockSpec.proxy!(params);
      },
    } satisfies Pick<ZeroXKeyClient["httpClient"], "proxyOAuth2Authenticate">;
  }
  if (mockSpec.completeOauth) {
    mockCompleteOauth.mockImplementation(mockSpec.completeOauth);
    instance.completeOauth = mockCompleteOauth;
  }
  if (mockSpec.getSession) {
    mockGetSession.mockImplementation(mockSpec.getSession);
    instance.getSession = mockGetSession;
  }
  if (mockSpec.addOauthProvider) {
    mockAddOauthProvider.mockImplementation(mockSpec.addOauthProvider);
    instance.addOauthProvider = mockAddOauthProvider;
  }
  return instance as unknown as ZeroXKeyClient;
});

jest.mock("@0xkey-io/core", () => {
  const actual =
    jest.requireActual<typeof import("@0xkey-io/core")>("@0xkey-io/core");
  return {
    ...actual,
    ZeroXKeyClient: mockZeroXKeyClient,
  };
});

const redirectUri = "https://app.example.test/oauth/callback";
const baseConfig: ZeroXKeyProviderConfig = {
  organizationId: "org-oauth",
  apiBaseUrl: "https://api.example.test",
  authProxyUrl: "https://auth.example.test",
  autoFetchWalletKitConfig: false,
  autoRefreshManagedState: false,
  auth: {
    methods: { walletAuthEnabled: false },
    autoRefreshSession: false,
    oauthConfig: {
      googleClientId: "google-A",
      appleClientId: "apple-A",
      facebookClientId: "facebook-A",
      xClientId: "x-A",
      discordClientId: "discord-A",
      oauthRedirectUri: redirectUri,
    },
  },
  walletConfig: {
    features: { auth: false, connecting: false },
    chains: {
      ethereum: { native: false },
      solana: { native: false },
    },
  },
};

let activeFetch: (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<unknown>;
const fetchBoundary = async (input: RequestInfo | URL, init?: RequestInit) =>
  activeFetch(input, init);

let dom: ReturnType<typeof setupProviderDom>;
let popups: ReturnType<typeof installOAuthPopups>;
let publicExports: typeof import("../index");
let mounts: MountedProvider[];
let expectedFetchCalls: number;

async function flush(rounds = 12): Promise<void> {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) {
      await Promise.resolve();
    }
  });
}

async function waitFor(
  predicate: () => boolean,
  description: string,
): Promise<void> {
  for (let index = 0; index < 80; index += 1) {
    await flush(2);
    if (predicate()) return;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function mountReady(callbacks?: ZeroXKeyCallbacks) {
  const mounted = await dom.mount(baseConfig, callbacks);
  mounts.push(mounted);
  await waitFor(
    () => mounted.context()?.clientState === publicExports.ClientState.Ready,
    "Provider Ready",
  );
  expect(mounted.context()?.clientState).toBe(publicExports.ClientState.Ready);
  expect(mounted.context()?.authState).toBe(
    publicExports.AuthState.Unauthenticated,
  );
  return mounted;
}

async function startPopup(action: () => Promise<void>): Promise<{
  observed: ReturnType<typeof observe<void>>;
  authorizationUrl: URL;
  popup: (typeof popups.handles)[number];
}> {
  const previousHandleCount = popups.handles.length;
  const promise = action();
  const observed = observe(promise);
  await waitFor(
    () =>
      popups.handles.length === previousHandleCount + 1 &&
      popups.handles[popups.handles.length - 1]!.assignedUrls.length === 1,
    "OAuth authorization URL assignment",
  );
  const popup = popups.handles[popups.handles.length - 1]!;
  return {
    observed,
    popup,
    authorizationUrl: new URL(popup.assignedUrls[0]!),
  };
}

async function deliver(
  popup: (typeof popups.handles)[number],
  callbackUrl: string,
): Promise<void> {
  popup.deliver(callbackUrl);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
    await Promise.resolve();
  });
  await flush();
}

function callbackUrl(params: {
  provider: string;
  state?: string;
  token?: string;
  code?: string;
}): string {
  if (params.code) {
    const query = new URLSearchParams({ code: params.code });
    if (params.state !== undefined) query.set("state", params.state);
    return `${redirectUri}?${query.toString()}`;
  }
  const hash = new URLSearchParams({ id_token: params.token! });
  if (params.state !== undefined) hash.set("state", params.state);
  return `${redirectUri}#${hash.toString()}`;
}

function expectedChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function stateFrom(url: URL): URLSearchParams {
  return new URLSearchParams(url.searchParams.get("state") ?? "");
}

beforeEach(() => {
  mockSpec = { keys: [] };
  mockConstructedConfigs.length = 0;
  mockCreatedKeys.length = 0;
  mockProxyCalls.length = 0;
  mockCompleteOauth.mockReset();
  mockGetSession.mockReset();
  mockAddOauthProvider.mockReset();
  mockInit.mockClear();
  mockGetAllSessions.mockClear();
  mockGetActiveSessionKey.mockClear();
  mockZeroXKeyClient.mockClear();
  activeFetch = async (input) => {
    throw new Error(`Unexpected fetch: ${String(input)}`);
  };
  expectedFetchCalls = 0;
  mounts = [];
  dom = setupProviderDom({ fetchImpl: fetchBoundary as typeof fetch });
  popups = installOAuthPopups();
  publicExports = dom.loadPublicExports();
});

afterEach(async () => {
  try {
    for (const popup of popups.handles) popup.close();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
      await Promise.resolve();
    });
    for (const mounted of [...mounts]) await dom.unmount(mounted);
    expect(jest.getTimerCount()).toBe(0);
    expect(dom.observations.consoleError).not.toHaveBeenCalled();
    expect(dom.observations.consoleWarn).not.toHaveBeenCalled();
    expect(dom.observations.getAuthProxyConfig).not.toHaveBeenCalled();
    expect(dom.observations.xhrSend).not.toHaveBeenCalled();
    expect(dom.observations.fetch).toHaveBeenCalledTimes(expectedFetchCalls);
  } finally {
    await dom.restore();
  }
});

describe("mounted public OAuth handlers", () => {
  const popupCases = [
    {
      provider: "google",
      handler: "handleGoogleOauth",
      endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      pkce: false,
      responseType: "id_token",
      scope: "openid email profile",
    },
    {
      provider: "apple",
      handler: "handleAppleOauth",
      endpoint: "https://account.apple.com/auth/authorize",
      pkce: false,
      responseType: "code id_token",
      scope: null,
    },
    {
      provider: "facebook",
      handler: "handleFacebookOauth",
      endpoint: "https://www.facebook.com/v11.0/dialog/oauth",
      pkce: true,
      responseType: "code",
      scope: "openid",
    },
    {
      provider: "x",
      handler: "handleXOauth",
      endpoint: "https://x.com/i/oauth2/authorize",
      pkce: true,
      responseType: "code",
      scope: "tweet.read users.read",
    },
    {
      provider: "discord",
      handler: "handleDiscordOauth",
      endpoint: "https://discord.com/oauth2/authorize",
      pkce: true,
      responseType: "code",
      scope: "identify email",
    },
  ] as const;

  it.each(popupCases)(
    "[P1] $provider popup preserves URL, exchange, and per-call dispatch shape",
    async ({ provider, handler, endpoint, pkce, responseType, scope }) => {
      const publicKey = `public-${provider}`;
      const oidcToken = `oidc-${provider}`;
      const authCode = `code-${provider}`;
      const sessionKey =
        provider === "google" || provider === "discord"
          ? `session-${provider}`
          : undefined;
      mockSpec.keys = [publicKey];
      mockSpec.completeOauth = async () => {
        throw new Error("internal completion must not run");
      };
      mockSpec.proxy = async () => ({ oidcToken });
      let expectedFacebookVerifier: string | undefined;
      if (provider === "facebook") {
        expectedFetchCalls = 1;
        activeFetch = async (input, init) => {
          expect(String(input)).toBe(
            "https://graph.facebook.com/v11.0/oauth/access_token",
          );
          expect(init?.method).toBe("POST");
          expect(init?.headers).toEqual({
            "Content-Type": "application/x-www-form-urlencoded",
          });
          expect(
            Object.fromEntries(new URLSearchParams(String(init?.body))),
          ).toEqual({
            client_id: "override-facebook",
            redirect_uri: redirectUri,
            code_verifier: expectedFacebookVerifier,
            code: authCode,
            grant_type: "authorization_code",
          });
          return { ok: true, json: async () => ({ id_token: oidcToken }) };
        };
      }

      const globalCallback = jest.fn();
      const perCallCallback = jest.fn();
      const mounted = await mountReady({
        onOauthRedirect: globalCallback,
        onError: jest.fn(),
      });
      const context = mounted.context()!;
      const action = context[handler] as (params: unknown) => Promise<void>;
      const { observed, popup, authorizationUrl } = await startPopup(() =>
        action({
          clientId: `override-${provider}`,
          openInPage: false,
          additionalState: sessionKey ? { sessionKey } : undefined,
          onOauthSuccess: perCallCallback,
        }),
      );

      expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(
        endpoint,
      );
      expect(authorizationUrl.searchParams.get("client_id")).toBe(
        `override-${provider}`,
      );
      expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
        redirectUri,
      );
      expect(authorizationUrl.searchParams.get("response_type")).toBe(
        responseType,
      );
      expect(authorizationUrl.searchParams.get("scope")).toBe(scope);
      expect(authorizationUrl.searchParams.get("response_mode")).toBe(
        provider === "apple" ? "fragment" : null,
      );
      expect(authorizationUrl.searchParams.get("prompt")).toBe(
        provider === "google" ? "select_account" : null,
      );
      const state = authorizationUrl.searchParams.get("state")!;
      const stateFields = stateFrom(authorizationUrl);
      expect(Object.fromEntries(stateFields)).toEqual({
        provider,
        flow: "popup",
        publicKey,
        ...(provider === "x" || provider === "discord"
          ? {
              nonce: createHash("sha256").update(publicKey).digest("hex"),
            }
          : {}),
        ...(sessionKey ? { sessionKey } : {}),
      });
      expect(mockCreatedKeys).toEqual([{ client: 0, publicKey }]);

      let capturedVerifier: string | undefined;
      if (pkce) {
        const verifier = localStorage.getItem(`${provider}_verifier`);
        expect(verifier).toBeTruthy();
        capturedVerifier = verifier!;
        if (provider === "facebook") expectedFacebookVerifier = verifier!;
        expect(authorizationUrl.searchParams.get("code_challenge")).toBe(
          expectedChallenge(verifier!),
        );
        expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe(
          "S256",
        );
        expect(authorizationUrl.searchParams.get("nonce")).toBe(
          provider === "facebook"
            ? createHash("sha256").update(publicKey).digest("hex")
            : null,
        );
      } else {
        expect(authorizationUrl.searchParams.has("code_challenge")).toBe(false);
        expect(authorizationUrl.searchParams.get("nonce")).toBe(
          createHash("sha256").update(publicKey).digest("hex"),
        );
      }

      await deliver(
        popup,
        callbackUrl({
          provider,
          state,
          ...(pkce ? { code: authCode } : { token: oidcToken }),
        }),
      );
      await observed.settled;

      expect(observed.outcome()).toEqual({
        status: "fulfilled",
        value: undefined,
      });
      expect(perCallCallback).toHaveBeenCalledTimes(1);
      expect(perCallCallback).toHaveBeenCalledWith({
        publicKey,
        oidcToken,
        providerName: provider,
        ...(sessionKey ? { sessionKey } : {}),
      });
      expect(globalCallback).not.toHaveBeenCalled();
      expect(mockCompleteOauth).not.toHaveBeenCalled();
      expect(popup.close).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
      if (pkce) {
        expect(localStorage.getItem(`${provider}_verifier`)).toBeNull();
      }

      if (provider === "x" || provider === "discord") {
        expect(mockProxyCalls).toEqual([
          {
            client: 0,
            params: {
              provider:
                provider === "x"
                  ? "OAUTH2_PROVIDER_X"
                  : "OAUTH2_PROVIDER_DISCORD",
              authCode,
              redirectUri,
              codeVerifier: capturedVerifier,
              clientId: `override-${provider}`,
              nonce: stateFields.get("nonce"),
            },
          },
        ]);
      } else {
        expect(mockProxyCalls).toHaveLength(0);
      }
    },
  );

  it("[P1] Google popup uses the global callback shape when no per-call callback is supplied", async () => {
    mockSpec.keys = ["public-google-global"];
    mockSpec.completeOauth = async () => {
      throw new Error("internal completion must not run");
    };
    const onOauthRedirect = jest.fn();
    const mounted = await mountReady({ onOauthRedirect, onError: jest.fn() });
    const { observed, popup, authorizationUrl } = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({
        openInPage: false,
        additionalState: { sessionKey: "session-google-global" },
      }),
    );
    await deliver(
      popup,
      callbackUrl({
        provider: "google",
        state: authorizationUrl.searchParams.get("state")!,
        token: "oidc-google-global",
      }),
    );
    await observed.settled;

    expect(onOauthRedirect).toHaveBeenCalledTimes(1);
    expect(onOauthRedirect).toHaveBeenCalledWith({
      idToken: "oidc-google-global",
      publicKey: "public-google-global",
      sessionKey: "session-google-global",
    });
    expect(mockCompleteOauth).not.toHaveBeenCalled();
  });

  it("[P2] a pending per-call callback does not delay the public handler", async () => {
    mockSpec.keys = ["public-pending-callback"];
    const callback = deferred<void>();
    const onOauthSuccess = jest.fn(() => callback.promise);
    const mounted = await mountReady({ onError: jest.fn() });
    const { observed, popup, authorizationUrl } = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({
        openInPage: false,
        onOauthSuccess,
      }),
    );
    await deliver(
      popup,
      callbackUrl({
        provider: "google",
        state: authorizationUrl.searchParams.get("state")!,
        token: "oidc-pending-callback",
      }),
    );
    await observed.settled;

    expect(onOauthSuccess).toHaveBeenCalledTimes(1);
    expect(observed.outcome()).toEqual({
      status: "fulfilled",
      value: undefined,
    });
    callback.resolve();
    await callback.promise;
  });

  it("[P2] internal completion is awaited and its known rejection is propagated", async () => {
    mockSpec.keys = ["public-internal"];
    const completion = deferred<never>();
    mockSpec.completeOauth = () => completion.promise;
    const onError = jest.fn();
    const mounted = await mountReady({ onError });
    const { observed, popup, authorizationUrl } = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({ openInPage: false }),
    );
    await deliver(
      popup,
      callbackUrl({
        provider: "google",
        state: authorizationUrl.searchParams.get("state")!,
        token: "oidc-internal",
      }),
    );

    expect(mockCompleteOauth).toHaveBeenCalledWith({
      oidcToken: "oidc-internal",
      publicKey: "public-internal",
      providerName: "google",
    });
    expect(observed.outcome()).toEqual({ status: "pending" });
    completion.reject(new Error("synthetic internal completion failure"));
    await flush();
    await observed.settled;

    expect(observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.objectContaining({ message: "Failed to complete OAuth" }),
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Failed to complete OAuth" }),
    );
  });

  it("[P2] a synchronous per-call callback throw rejects without a key-disposal path", async () => {
    mockSpec.keys = ["public-sync-throw"];
    const thrown = new Error("synthetic callback throw");
    const onOauthSuccess = jest.fn(() => {
      throw thrown;
    });
    const mounted = await mountReady({ onError: jest.fn() });
    const { observed, popup, authorizationUrl } = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({
        openInPage: false,
        onOauthSuccess,
      }),
    );
    await deliver(
      popup,
      callbackUrl({
        provider: "google",
        state: authorizationUrl.searchParams.get("state")!,
        token: "oidc-sync-throw",
      }),
    );
    await observed.settled;

    expect(observed.outcome()).toEqual({ status: "rejected", reason: thrown });
    expect(mockCreatedKeys).toEqual([
      { client: 0, publicKey: "public-sync-throw" },
    ]);
  });

  it("[P3] Google seeded redirect return dispatches URL-derived state and preserves unrelated search", async () => {
    mockSpec.completeOauth = async () => {
      throw new Error("internal completion must not run");
    };
    const onOauthRedirect = jest.fn();
    const state = new URLSearchParams({
      provider: "google",
      flow: "redirect",
      publicKey: "url-derived-google-key",
      sessionKey: "url-derived-google-session",
    }).toString();
    window.history.replaceState(
      null,
      document.title,
      `/oauth/callback?keep=1#${new URLSearchParams({
        id_token: "synthetic-google",
        state,
      }).toString()}`,
    );

    await mountReady({ onOauthRedirect, onError: jest.fn() });

    expect(onOauthRedirect).toHaveBeenCalledTimes(1);
    expect(onOauthRedirect).toHaveBeenCalledWith({
      idToken: "synthetic-google",
      publicKey: "url-derived-google-key",
      sessionKey: "url-derived-google-session",
    });
    expect(mockCompleteOauth).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/oauth/callback");
    expect(window.location.search).toBe("?keep=1");
    expect(window.location.hash).toBe("");
  });

  it("[P3] Discord seeded redirect return consumes the real verifier and cleans the URL", async () => {
    mockSpec.proxy = async () => ({ oidcToken: "synthetic-discord-token" });
    mockSpec.completeOauth = async () => {
      throw new Error("internal completion must not run");
    };
    const onOauthRedirect = jest.fn();
    localStorage.setItem("discord_verifier", "seeded-discord-verifier");
    const state = new URLSearchParams({
      provider: "discord",
      flow: "redirect",
      publicKey: "url-derived-discord-key",
      nonce: "url-derived-discord-nonce",
      sessionKey: "url-derived-discord-session",
    }).toString();
    window.history.replaceState(
      null,
      document.title,
      `/oauth/callback?${new URLSearchParams({
        code: "synthetic-discord-code",
        state,
      }).toString()}`,
    );

    await mountReady({ onOauthRedirect, onError: jest.fn() });

    expect(mockProxyCalls).toEqual([
      {
        client: 0,
        params: {
          provider: "OAUTH2_PROVIDER_DISCORD",
          authCode: "synthetic-discord-code",
          redirectUri,
          codeVerifier: "seeded-discord-verifier",
          clientId: "discord-A",
          nonce: "url-derived-discord-nonce",
        },
      },
    ]);
    expect(onOauthRedirect).toHaveBeenCalledWith({
      idToken: "synthetic-discord-token",
      publicKey: "url-derived-discord-key",
      sessionKey: "url-derived-discord-session",
    });
    expect(localStorage.getItem("discord_verifier")).toBeNull();
    expect(window.location.pathname).toBe("/oauth/callback");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("[P4 no-modal] Discord seeded add-provider return awaits add and preserves routing precedence", async () => {
    const addition = deferred<string[]>();
    mockSpec.proxy = async () => ({ oidcToken: "synthetic-add-token" });
    mockSpec.addOauthProvider = () => addition.promise;
    mockSpec.completeOauth = async () => {
      throw new Error("login completion must not run");
    };
    localStorage.setItem("discord_verifier", "seeded-add-verifier");
    localStorage.setItem(
      "oauth_add_provider_metadata",
      JSON.stringify({
        organizationId: "add-org",
        userId: "add-user",
        stampWith: "api-key",
        successPageDuration: 0,
      }),
    );
    const state = new URLSearchParams({
      provider: "discord",
      flow: "redirect",
      publicKey: "url-derived-add-key",
      nonce: "url-derived-add-nonce",
      oauthIntent: "addProvider",
    }).toString();
    window.history.replaceState(
      null,
      document.title,
      `/oauth/callback?${new URLSearchParams({
        code: "synthetic-add-code",
        state,
      }).toString()}`,
    );
    const callbacks = { onOauthRedirect: jest.fn(), onError: jest.fn() };
    const mounted = await dom.mount(baseConfig, callbacks);
    mounts.push(mounted);

    await waitFor(
      () => mockAddOauthProvider.mock.calls.length === 1,
      "redirect addOauthProvider dispatch",
    );
    expect(mounted.context()?.clientState).toBe(
      publicExports.ClientState.Loading,
    );
    expect(mockAddOauthProvider).toHaveBeenCalledWith({
      providerName: "discord",
      oidcToken: "synthetic-add-token",
      organizationId: "add-org",
      userId: "add-user",
      stampWith: "api-key" as StamperType,
    });
    expect(callbacks.onOauthRedirect).not.toHaveBeenCalled();
    expect(mockCompleteOauth).not.toHaveBeenCalled();

    addition.resolve(["provider-added"]);
    await waitFor(
      () => mounted.context()?.clientState === publicExports.ClientState.Ready,
      "Provider Ready after redirect add",
    );
    expect(localStorage.getItem("oauth_add_provider_metadata")).toBeNull();
    expect(localStorage.getItem("discord_verifier")).toBeNull();
    expect(window.location.pathname).toBe("/oauth/callback");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it.each(["A-then-B", "B-then-A"] as const)(
    "[S1 baseline deficiency] shared Discord verifier interferes in %s order",
    async (order) => {
      mockSpec.keys = ["public-A", "public-B"];
      mockSpec.proxy = async (params) => ({
        oidcToken: `token-for-${params.authCode}`,
      });
      const callbackA = jest.fn();
      const callbackB = jest.fn();
      const mounted = await mountReady({ onError: jest.fn() });
      const context = mounted.context()!;
      const startedA = await startPopup(() =>
        context.handleDiscordOauth({
          openInPage: false,
          onOauthSuccess: callbackA,
        }),
      );
      const verifierA = localStorage.getItem("discord_verifier")!;
      const startedB = await startPopup(() =>
        context.handleDiscordOauth({
          openInPage: false,
          onOauthSuccess: callbackB,
        }),
      );
      const verifierB = localStorage.getItem("discord_verifier")!;
      expect(verifierA).not.toBe(verifierB);

      const records = {
        A: {
          ...startedA,
          callback: callbackA,
          code: "code-A",
        },
        B: {
          ...startedB,
          callback: callbackB,
          code: "code-B",
        },
      };
      const delivery =
        order === "A-then-B" ? (["A", "B"] as const) : (["B", "A"] as const);
      for (const label of delivery) {
        const record = records[label];
        await deliver(
          record.popup,
          callbackUrl({
            provider: "discord",
            code: record.code,
            state: record.authorizationUrl.searchParams.get("state")!,
          }),
        );
      }
      await Promise.all([startedA.observed.settled, startedB.observed.settled]);

      const first = records[delivery[0]];
      const second = records[delivery[1]];
      // Baseline oracle: replace this block with the preserved safety RED patch.
      expect(mockProxyCalls).toEqual([
        {
          client: 0,
          params: {
            provider: "OAUTH2_PROVIDER_DISCORD",
            authCode: first.code,
            redirectUri,
            codeVerifier: verifierB,
            clientId: "discord-A",
            nonce: stateFrom(first.authorizationUrl).get("nonce"),
          },
        },
      ]);
      expect(first.callback).toHaveBeenCalledTimes(1);
      expect(first.callback).toHaveBeenCalledWith(
        expect.objectContaining({
          publicKey: `public-${delivery[0]}`,
          providerName: "discord",
          oidcToken: `token-for-${first.code}`,
        }),
      );
      expect(first.observed.outcome()).toEqual({
        status: "fulfilled",
        value: undefined,
      });
      expect(second.callback).not.toHaveBeenCalled();
      expect(second.observed.outcome()).toEqual({
        status: "rejected",
        reason: expect.objectContaining({
          code: "NO_PKCE_VERIFIER_FOUND",
        }),
      });
      if (order === "A-then-B") {
        expect(mockProxyCalls[0]?.params.codeVerifier).toBe(verifierB);
        expect(mockProxyCalls[0]?.params.codeVerifier).not.toBe(verifierA);
      }
    },
  );

  it("[S2 baseline deficiency] a second Provider clears another Provider's pending verifier", async () => {
    mockSpec.keys = ["public-provider-A"];
    mockSpec.proxy = async () => ({ oidcToken: "token-provider-A" });
    const callbackA = jest.fn();
    const providerA = await mountReady({ onError: jest.fn() });
    const startedA = await startPopup(() =>
      providerA.context()!.handleDiscordOauth({
        openInPage: false,
        onOauthSuccess: callbackA,
      }),
    );
    const verifierA = localStorage.getItem("discord_verifier")!;
    localStorage.setItem("unrelated-sentinel", "keep-me");

    const providerB = await mountReady({ onError: jest.fn() });
    expect(mockZeroXKeyClient).toHaveBeenCalledTimes(2);
    expect(providerB.context()?.clientState).toBe(
      publicExports.ClientState.Ready,
    );
    const verifierAfterProviderBReady =
      localStorage.getItem("discord_verifier");

    await deliver(
      startedA.popup,
      callbackUrl({
        provider: "discord",
        code: "code-provider-A",
        state: startedA.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await startedA.observed.settled;

    expect(verifierA).toBeTruthy();
    // Baseline oracle: replace this block with the preserved safety RED patch.
    expect(verifierAfterProviderBReady).toBeNull();
    expect(localStorage.getItem("discord_verifier")).toBeNull();
    expect(mockProxyCalls).toHaveLength(0);
    expect(callbackA).not.toHaveBeenCalled();
    expect(startedA.observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.objectContaining({ code: "NO_PKCE_VERIFIER_FOUND" }),
    });
    expect(localStorage.getItem("unrelated-sentinel")).toBe("keep-me");
  });

  it.each([
    { label: "missing state", state: undefined, forwardedSession: undefined },
    {
      label: "mismatched state",
      state: new URLSearchParams({
        provider: "apple",
        flow: "redirect",
        publicKey: "attacker-key",
        sessionKey: "attacker-session",
      }).toString(),
      forwardedSession: "attacker-session",
    },
  ])(
    "[S3 baseline deficiency] Google popup accepts $label",
    async ({ state, forwardedSession }) => {
      mockSpec.keys = ["initiating-google-key"];
      mockSpec.completeOauth = async () => {
        throw new Error("internal completion must not run");
      };
      const callback = jest.fn();
      const mounted = await mountReady({ onError: jest.fn() });
      const started = await startPopup(() =>
        mounted.context()!.handleGoogleOauth({
          openInPage: false,
          onOauthSuccess: callback,
        }),
      );
      await deliver(
        started.popup,
        callbackUrl({
          provider: "google",
          token: "synthetic-untrusted-token",
          ...(state === undefined ? {} : { state }),
        }),
      );

      // Baseline oracle: replace this block with the preserved safety RED patch.
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({
        publicKey: "initiating-google-key",
        oidcToken: "synthetic-untrusted-token",
        providerName: "google",
        ...(forwardedSession ? { sessionKey: forwardedSession } : {}),
      });
      expect(mockCompleteOauth).not.toHaveBeenCalled();
      expect(started.observed.outcome()).toEqual({
        status: "fulfilled",
        value: undefined,
      });
    },
  );
});
