/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://app.example.test/"}
 */
import "fake-indexeddb/auto";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { createHash } from "node:crypto";
import {
  AuthAction,
  OAuthProviders,
  SessionType,
  type Session,
} from "@0xkey-io/sdk-types";
import { act, useLayoutEffect } from "react";
import type {
  StamperType,
  ZeroXKeyCallbacks,
  ZeroXKeyClient,
  ZeroXKeyProviderConfig,
} from "../index";
import { persistRedirectTransaction } from "../utils/oauth/redirect-transaction";
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
  | "discardUncommittedApiKeyPair"
  | "completeOauth"
  | "getSession"
  | "addOauthProvider"
>;
type ProxyOauth = ZeroXKeyClient["httpClient"]["proxyOAuth2Authenticate"];
type ProxyOauthParams = Parameters<ProxyOauth>[0];
type CompleteOauthParams = Parameters<CoreClient["completeOauth"]>[0];
type CompleteOauthGate = NonNullable<
  Parameters<CoreClient["completeOauth"]>[1]
>;
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
    gate?: CompleteOauthGate,
  ) => ReturnType<CoreClient["completeOauth"]>;
  getSession?: (
    ...params: Parameters<CoreClient["getSession"]>
  ) => ReturnType<CoreClient["getSession"]>;
  addOauthProvider?: (
    params: AddOauthProviderParams,
  ) => ReturnType<CoreClient["addOauthProvider"]>;
};

let mockSpec: ClientSpec;
const mockClientSpecs: ClientSpec[] = [];
const mockClientInstances: ZeroXKeyClient[] = [];
const mockConstructedConfigs: unknown[] = [];
const mockCreatedKeys: Array<{ client: number; publicKey: string }> = [];
const mockDiscardedKeys: Array<{ client: number; publicKey: string }> = [];
const mockProxyCalls: Array<{ client: number; params: ProxyOauthParams }> = [];
const mockCompleteOauth = jest.fn<(params: CompleteOauthParams) => void>();
const mockGetClientParams = jest.fn(
  async (_configId: string, _url?: string) => ({
    turnstileSiteKey: undefined as string | undefined,
  }),
);
const mockChallengeCalls: Array<{
  siteKey: string;
  signal: AbortSignal;
  result: Deferred<{ token: string; reset(): void }>;
}> = [];
const mockCreateTurnstileChallengeRenderer = jest.fn(() => ({
  challenge(siteKey: string, signal: AbortSignal) {
    const result = deferred<{ token: string; reset(): void }>();
    mockChallengeCalls.push({ siteKey, signal, result });
    return result.promise;
  },
  dispose() {},
}));
const mockVerifyPage = jest.fn((_props: { onSuccess?: () => void }) => null);
const mockGetSession =
  jest.fn<(...params: Parameters<CoreClient["getSession"]>) => void>();
const mockAddOauthProvider =
  jest.fn<(params: AddOauthProviderParams) => void>();
const mockInit = jest.fn(async () => undefined);
const mockGetAllSessions = jest.fn(async () => ({}));
const mockGetActiveSessionKey = jest.fn(async () => undefined);
const mockZeroXKeyClient = jest.fn((config: unknown) => {
  const client = mockConstructedConfigs.length;
  const selectedSpec = mockClientSpecs[client] ?? mockSpec;
  const clientSpec = {
    ...selectedSpec,
    keys: [...selectedSpec.keys],
  };
  mockConstructedConfigs.push(config);
  const constructorConfig = config as ZeroXKeyProviderConfig;
  let initialized = false;
  let currentHttpClient = {
    config: {
      organizationId: constructorConfig.organizationId,
      apiBaseUrl: constructorConfig.apiBaseUrl ?? "https://api.0xkey.io",
      authProxyUrl:
        constructorConfig.authProxyUrl ?? "https://authproxy.0xkey.io",
      authProxyConfigId: constructorConfig.authProxyConfigId,
    },
    proxyOAuth2Authenticate: async (params: ProxyOauthParams) => {
      mockProxyCalls.push({ client, params });
      if (!clientSpec.proxy) throw new Error("Unexpected OAuth exchange call");
      return clientSpec.proxy(params);
    },
  } as unknown as ZeroXKeyClient["httpClient"];
  const base = {
    async init() {
      await mockInit();
      initialized = true;
    },
    getAllSessions: mockGetAllSessions,
    getActiveSessionKey: mockGetActiveSessionKey,
  } satisfies Pick<
    ZeroXKeyClient,
    "init" | "getAllSessions" | "getActiveSessionKey"
  >;
  const instance: Record<string, unknown> = {
    ...base,
    restrictPersistedCredentialsToNewSessions: () => undefined,
    setAuthContextGuard: () => undefined,
    config: constructorConfig,
  };
  Object.defineProperty(instance, "httpClient", {
    configurable: true,
    enumerable: true,
    get() {
      if (!initialized) throw new Error("Synthetic client is not initialized");
      return currentHttpClient;
    },
    set(value: ZeroXKeyClient["httpClient"]) {
      currentHttpClient = value;
    },
  });

  if (clientSpec.keys.length > 0) {
    instance.createApiKeyPair = async () => {
      const publicKey = clientSpec.keys.shift();
      if (!publicKey) throw new Error("No synthetic public key remains");
      mockCreatedKeys.push({ client, publicKey });
      return publicKey;
    };
  }
  instance.discardUncommittedApiKeyPair = async (publicKey: string) => {
    mockDiscardedKeys.push({ client, publicKey });
  };
  if (clientSpec.completeOauth) {
    instance.completeOauth = (
      params: CompleteOauthParams,
      gate?: CompleteOauthGate,
    ) => {
      mockCompleteOauth(params);
      return clientSpec.completeOauth!(params, gate);
    };
  }
  if (clientSpec.getSession) {
    instance.getSession = (...params: Parameters<CoreClient["getSession"]>) => {
      mockGetSession(...params);
      return clientSpec.getSession!(...params);
    };
  }
  if (clientSpec.addOauthProvider) {
    instance.addOauthProvider = (params: AddOauthProviderParams) => {
      mockAddOauthProvider(params);
      return clientSpec.addOauthProvider!(params);
    };
  }
  const clientInstance = instance as unknown as ZeroXKeyClient;
  mockClientInstances.push(clientInstance);
  return clientInstance;
});

jest.mock("@0xkey-io/core", () => {
  const actual =
    jest.requireActual<typeof import("@0xkey-io/core")>("@0xkey-io/core");
  return {
    ...actual,
    ZeroXKeyClient: mockZeroXKeyClient,
    getClientParams: mockGetClientParams,
  };
});

jest.mock("../utils/captcha-turnstile-renderer", () => ({
  createTurnstileChallengeRenderer: mockCreateTurnstileChallengeRenderer,
}));

jest.mock("../components/verify/Verify", () => ({
  VerifyPage: mockVerifyPage,
}));

jest.mock("../providers/modal/Root", () => ({
  ModalRoot: () => {
    const { useModal } = jest.requireActual<
      typeof import("../providers/modal/Hook")
    >("../providers/modal/Hook");
    return useModal().modalStack.at(-1)?.content ?? null;
  },
}));

const redirectUri = "https://app.example.test/oauth/callback";

if (typeof globalThis.structuredClone !== "function") {
  globalThis.structuredClone = <T,>(value: T): T =>
    JSON.parse(JSON.stringify(value)) as T;
}

async function seedRedirectLogin(input: {
  provider: OAuthProviders;
  clientId: string;
  expectedState: string;
  keyRef: string;
  verifier: string | null;
  configId?: string;
}): Promise<void> {
  await persistRedirectTransaction({
    organizationId: baseConfig.organizationId,
    configId: input.configId ?? null,
    apiBaseUrl: baseConfig.apiBaseUrl ?? "https://api.example.test",
    authProxyUrl: baseConfig.authProxyUrl ?? "https://auth.example.test",
    provider: input.provider,
    clientId: input.clientId,
    redirectUri,
    expectedState: input.expectedState,
    keyRef: input.keyRef,
    verifier: input.verifier,
    async discardFreshKey() {},
  });
}

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

function proofSession(): Session {
  return {
    sessionType: SessionType.READ_WRITE,
    organizationId: "proof-org-A",
    userId: "proof-user-A",
    expiry: 4_102_444_800,
    token: "proof-session-A",
  };
}

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
let expectedAuthProxyConfigCalls: number;

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

async function mountReady(
  callbacks?: ZeroXKeyCallbacks,
  config: ZeroXKeyProviderConfig = baseConfig,
) {
  const mounted = await dom.mount(config, callbacks);
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

function LayoutInvoker(props: {
  invoke(): Promise<void>;
  onInvoked(observed: ReturnType<typeof observe<void>>): void;
  onLayout(): void;
}) {
  useLayoutEffect(() => {
    props.onInvoked(observe(props.invoke()));
    props.onLayout();
  }, []);
  return null;
}

function LayoutResponseDeliverer(props: { deliver(): void; onLayout(): void }) {
  useLayoutEffect(() => {
    props.deliver();
    jest.advanceTimersByTime(500);
    props.onLayout();
  }, []);
  return null;
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
  fragmentCode?: string;
}): string {
  if (params.code) {
    const query = new URLSearchParams({ code: params.code });
    if (params.state !== undefined) query.set("state", params.state);
    return `${redirectUri}?${query.toString()}`;
  }
  const hash = new URLSearchParams({ id_token: params.token! });
  if (params.state !== undefined) hash.set("state", params.state);
  if (params.fragmentCode !== undefined) {
    hash.set("code", params.fragmentCode);
  }
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
  mockClientSpecs.length = 0;
  mockClientInstances.length = 0;
  mockConstructedConfigs.length = 0;
  mockCreatedKeys.length = 0;
  mockDiscardedKeys.length = 0;
  mockProxyCalls.length = 0;
  mockCompleteOauth.mockReset();
  mockGetClientParams.mockReset();
  mockChallengeCalls.length = 0;
  mockCreateTurnstileChallengeRenderer.mockClear();
  mockVerifyPage.mockClear();
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
  expectedAuthProxyConfigCalls = 0;
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
    expect(dom.observations.getAuthProxyConfig).toHaveBeenCalledTimes(
      expectedAuthProxyConfigCalls,
    );
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
      let facebookVerifier: string | undefined;
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
          const body = Object.fromEntries(
            new URLSearchParams(String(init?.body)),
          );
          expect(body).toEqual({
            client_id: "override-facebook",
            redirect_uri: redirectUri,
            code_verifier: expect.any(String),
            code: authCode,
            grant_type: "authorization_code",
          });
          facebookVerifier = body.code_verifier;
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
        transactionId: expect.stringMatching(/^[0-9a-f]{32}$/),
        ...(provider === "x" || provider === "discord"
          ? {
              nonce: createHash("sha256").update(publicKey).digest("hex"),
            }
          : {}),
        ...(sessionKey ? { sessionKey } : {}),
      });
      expect(mockCreatedKeys).toEqual([{ client: 0, publicKey }]);

      if (pkce) {
        expect(localStorage.getItem(`${provider}_verifier`)).toBeNull();
        expect(
          authorizationUrl.searchParams.get("code_challenge"),
        ).toBeTruthy();
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
          ...(provider === "apple" ? { fragmentCode: authCode } : {}),
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
              codeVerifier: expect.any(String),
              clientId: `override-${provider}`,
              nonce: stateFields.get("nonce"),
            },
          },
        ]);
        expect(expectedChallenge(mockProxyCalls[0]!.params.codeVerifier)).toBe(
          authorizationUrl.searchParams.get("code_challenge"),
        );
      } else if (provider === "facebook") {
        expect(facebookVerifier).toBeTruthy();
        expect(expectedChallenge(facebookVerifier!)).toBe(
          authorizationUrl.searchParams.get("code_challenge"),
        );
      } else {
        expect(mockProxyCalls).toHaveLength(0);
      }
    },
  );

  it("[I1] binds key creation before asynchronous popup preparation", async () => {
    mockSpec.keys = ["original-public-key"];
    mockSpec.proxy = async () => ({ oidcToken: "original-token" });
    const onOauthSuccess = jest.fn();
    const mounted = await mountReady({ onError: jest.fn() });
    const context = mounted.context()!;
    const observed = observe(
      context.handleDiscordOauth({ openInPage: false, onOauthSuccess }),
    );
    const replacementCreate = jest.fn(async () => "replacement-public-key");
    mockClientInstances[0]!.createApiKeyPair = replacementCreate;

    await waitFor(
      () =>
        popups.handles.length === 1 &&
        popups.handles[0]!.assignedUrls.length === 1,
      "OAuth authorization URL assignment",
    );
    const popup = popups.handles[0]!;
    const authorizationUrl = new URL(popup.assignedUrls[0]!);

    expect(mockCreatedKeys).toEqual([
      { client: 0, publicKey: "original-public-key" },
    ]);
    expect(replacementCreate).not.toHaveBeenCalled();
    expect(stateFrom(authorizationUrl).get("publicKey")).toBe(
      "original-public-key",
    );

    await deliver(
      popup,
      callbackUrl({
        provider: "discord",
        code: "original-code",
        state: authorizationUrl.searchParams.get("state")!,
      }),
    );
    await observed.settled;
    expect(onOauthSuccess).toHaveBeenCalledWith({
      publicKey: "original-public-key",
      oidcToken: "original-token",
      providerName: "discord",
    });
  });

  it("[I1] binds the initiating transport before popup delivery", async () => {
    mockSpec.keys = ["transport-public-key"];
    mockSpec.proxy = async () => ({ oidcToken: "initiating-token" });
    const onOauthSuccess = jest.fn();
    const mounted = await mountReady({ onError: jest.fn() });
    const started = await startPopup(() =>
      mounted.context()!.handleDiscordOauth({
        openInPage: false,
        onOauthSuccess,
      }),
    );
    const replacementExchange = jest.fn(async () => ({
      oidcToken: "replacement-token",
    }));
    mockClientInstances[0]!.httpClient.proxyOAuth2Authenticate =
      replacementExchange;

    await deliver(
      started.popup,
      callbackUrl({
        provider: "discord",
        code: "transport-code",
        state: started.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await started.observed.settled;

    expect(replacementExchange).not.toHaveBeenCalled();
    expect(mockProxyCalls).toEqual([
      {
        client: 0,
        params: expect.objectContaining({
          authCode: "transport-code",
          clientId: "discord-A",
        }),
      },
    ]);
    expect(onOauthSuccess).toHaveBeenCalledWith({
      publicKey: "transport-public-key",
      oidcToken: "initiating-token",
      providerName: "discord",
    });
  });

  it("[I1] binds exact discard before popup delivery", async () => {
    mockSpec.keys = ["discard-public-key"];
    const mounted = await mountReady({ onError: jest.fn() });
    const started = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({ openInPage: false }),
    );
    const replacementDiscard = jest.fn(async () => undefined);
    mockClientInstances[0]!.discardUncommittedApiKeyPair = replacementDiscard;

    await deliver(
      started.popup,
      callbackUrl({
        provider: "google",
        token: "untrusted-token",
        state: `${started.authorizationUrl.searchParams.get("state")!}-wrong`,
      }),
    );
    await started.observed.settled;

    expect(started.observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.any(Error),
    });
    expect(replacementDiscard).not.toHaveBeenCalled();
    expect(mockDiscardedKeys).toEqual([
      { client: 0, publicKey: "discard-public-key" },
    ]);
  });

  it("[I3] preserves initiating capability receivers and downstream error identity", async () => {
    const downstream = new Error("downstream exchange sentinel");
    const mounted = await mountReady({ onError: jest.fn() });
    const client = mockClientInstances[0]!;
    const httpClient = client.httpClient;
    let createReceiver: unknown;
    let exchangeReceiver: unknown;
    let discardReceiver: unknown;
    client.createApiKeyPair = async function () {
      createReceiver = this;
      return "receiver-public-key";
    };
    client.discardUncommittedApiKeyPair = async function () {
      discardReceiver = this;
    };
    httpClient.proxyOAuth2Authenticate = async function () {
      exchangeReceiver = this;
      throw downstream;
    };

    const started = await startPopup(() =>
      mounted.context()!.handleDiscordOauth({
        openInPage: false,
        onOauthSuccess: jest.fn(),
      }),
    );
    await deliver(
      started.popup,
      callbackUrl({
        provider: "discord",
        code: "receiver-code",
        state: started.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await started.observed.settled;

    expect(started.observed.outcome()).toEqual({
      status: "rejected",
      reason: downstream,
    });
    expect(createReceiver).toBe(client);
    expect(exchangeReceiver).toBe(httpClient);
    expect(discardReceiver).toBe(client);
  });

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

  it("snapshots the global OAuth callback before popup preparation", async () => {
    mockSpec.keys = ["public-global-snapshot"];
    const originalCallback = jest.fn();
    const replacementCallback = jest.fn();
    const callbacks: ZeroXKeyCallbacks = {
      onOauthRedirect: originalCallback,
      onError: jest.fn(),
    };
    const mounted = await mountReady(callbacks);
    const started = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({ openInPage: false }),
    );
    callbacks.onOauthRedirect = replacementCallback;

    await deliver(
      started.popup,
      callbackUrl({
        provider: "google",
        state: started.authorizationUrl.searchParams.get("state")!,
        token: "global-snapshot-token",
      }),
    );
    await started.observed.settled;

    expect(originalCallback).toHaveBeenCalledWith({
      idToken: "global-snapshot-token",
      publicKey: "public-global-snapshot",
    });
    expect(replacementCallback).not.toHaveBeenCalled();
  });

  it("snapshots the per-call OAuth callback before popup preparation", async () => {
    mockSpec.keys = ["public-per-call-snapshot"];
    const originalCallback = jest.fn();
    const replacementCallback = jest.fn();
    const params = {
      openInPage: false,
      onOauthSuccess: originalCallback,
    };
    const mounted = await mountReady({ onError: jest.fn() });
    const started = await startPopup(() =>
      mounted.context()!.handleGoogleOauth(params),
    );
    params.onOauthSuccess = replacementCallback;

    await deliver(
      started.popup,
      callbackUrl({
        provider: "google",
        state: started.authorizationUrl.searchParams.get("state")!,
        token: "per-call-snapshot-token",
      }),
    );
    await started.observed.settled;

    expect(originalCallback).toHaveBeenCalledWith({
      oidcToken: "per-call-snapshot-token",
      providerName: "google",
      publicKey: "public-per-call-snapshot",
    });
    expect(replacementCallback).not.toHaveBeenCalled();
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
    expect(mockDiscardedKeys).toHaveLength(0);
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
    expect(mockDiscardedKeys).toHaveLength(0);
  });

  it("internal popup requests Captcha only after Core finds no account", async () => {
    const lookup = deferred<void>();
    const submitted: Array<string | undefined> = [];
    mockSpec.keys = ["captcha-popup-key"];
    mockSpec.getSession = async () => undefined;
    mockSpec.completeOauth = async (_params, gate) => {
      await lookup.promise;
      if (!gate) throw new Error("Missing popup signup gate");
      const signup = await gate(async (token) => {
        submitted.push(token);
        return { sessionToken: "captcha-popup-session" };
      });
      return { ...signup, action: AuthAction.SIGNUP };
    };
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    const mounted = await mountReady(
      { onError: jest.fn() },
      { ...baseConfig, authProxyConfigId: "config-A" },
    );
    const started = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({ openInPage: false }),
    );
    await deliver(
      started.popup,
      callbackUrl({
        provider: "google",
        token: "captcha-popup-oidc",
        state: started.authorizationUrl.searchParams.get("state")!,
      }),
    );
    expect(mockCompleteOauth).toHaveBeenCalledTimes(1);
    expect(mockGetClientParams).not.toHaveBeenCalled();
    expect(mockChallengeCalls).toHaveLength(0);
    await act(async () => lookup.resolve());
    await waitFor(() => mockChallengeCalls.length === 1, "popup challenge");
    expect(mockGetClientParams).toHaveBeenCalledWith(
      "config-A",
      "https://auth.example.test",
    );
    expect(submitted).toEqual([]);
    await act(async () => {
      mockChallengeCalls[0]!.result.resolve({
        token: "fresh-popup-token",
        reset: jest.fn(),
      });
      await started.observed.settled;
    });
    expect(started.observed.outcome()).toEqual({
      status: "fulfilled",
      value: undefined,
    });
    expect(submitted).toEqual(["fresh-popup-token"]);
  });

  it("internal popup login and custom completion do not request Captcha", async () => {
    let loginGate: CompleteOauthGate | undefined;
    mockSpec.keys = ["existing-popup-key", "custom-popup-key"];
    mockSpec.getSession = async () => undefined;
    mockSpec.completeOauth = async (_params, gate) => {
      loginGate = gate;
      return { action: AuthAction.LOGIN, sessionToken: "existing-session" };
    };
    const mounted = await mountReady(
      { onError: jest.fn() },
      { ...baseConfig, authProxyConfigId: "config-A" },
    );
    const existing = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({ openInPage: false }),
    );
    await deliver(
      existing.popup,
      callbackUrl({
        provider: "google",
        token: "existing-oidc",
        state: existing.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await existing.observed.settled;
    expect(loginGate).toEqual(expect.any(Function));
    const custom = jest.fn();
    const customPopup = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({
        openInPage: false,
        onOauthSuccess: custom,
      }),
    );
    await deliver(
      customPopup.popup,
      callbackUrl({
        provider: "google",
        token: "custom-oidc",
        state: customPopup.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await customPopup.observed.settled;
    expect(custom).toHaveBeenCalledTimes(1);
    expect(mockCompleteOauth).toHaveBeenCalledTimes(1);
    expect(mockGetClientParams).not.toHaveBeenCalled();
    expect(mockChallengeCalls).toHaveLength(0);
  });

  it("public completeOauth keeps its single-argument Core path", async () => {
    let receivedGate: CompleteOauthGate | undefined;
    mockSpec.getSession = async () => undefined;
    mockSpec.completeOauth = async (_params, gate) => {
      receivedGate = gate;
      return { action: AuthAction.LOGIN, sessionToken: "existing-session" };
    };
    const mounted = await mountReady(
      { onError: jest.fn() },
      { ...baseConfig, authProxyConfigId: "config-A" },
    );
    await act(async () => {
      await mounted.context()!.completeOauth({
        oidcToken: "public-oidc",
        publicKey: "public-key",
      });
    });
    expect(receivedGate).toBeUndefined();
    expect(mockGetClientParams).not.toHaveBeenCalled();
    expect(mockChallengeCalls).toHaveLength(0);
  });

  it("internal popup refuses a changed OAuth binding before Captcha", async () => {
    const lookup = deferred<void>();
    let capturedGate: CompleteOauthGate | undefined;
    const submitted = jest.fn(async (_token?: string) => ({
      sessionToken: "never-submitted",
    }));
    mockSpec.keys = ["drift-popup-key"];
    mockSpec.completeOauth = async (_params, gate) => {
      capturedGate = gate;
      await lookup.promise;
      if (!gate) throw new Error("Missing popup signup gate");
      const signup = await gate(submitted);
      return { ...signup, action: AuthAction.SIGNUP };
    };
    const config = { ...baseConfig, authProxyConfigId: "config-A" };
    const mounted = await mountReady({ onError: jest.fn() }, config);
    const started = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({ openInPage: false }),
    );
    await deliver(
      started.popup,
      callbackUrl({
        provider: "google",
        token: "drift-oidc",
        state: started.authorizationUrl.searchParams.get("state")!,
      }),
    );
    expect(mockCompleteOauth).toHaveBeenCalledTimes(1);
    expect(capturedGate).toEqual(expect.any(Function));
    await mounted.rerender({
      ...config,
      auth: {
        ...config.auth,
        oauthConfig: {
          ...config.auth?.oauthConfig,
          googleClientId: "google-other",
        },
      },
    });
    await act(async () => lookup.resolve());
    await started.observed.settled;
    expect(started.observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.any(Error),
    });
    expect(mockGetClientParams).not.toHaveBeenCalled();
    expect(mockChallengeCalls).toHaveLength(0);
    expect(submitted).not.toHaveBeenCalled();
  });

  it.each(popupCases)(
    "$provider internal popup passes its signup gate to Core while login skips Captcha",
    async ({ provider, handler, pkce }) => {
      mockSpec.keys = [`internal-${provider}-key`];
      mockSpec.proxy = async () => ({ oidcToken: `internal-${provider}-oidc` });
      mockSpec.getSession = async () => undefined;
      const gates: Array<CompleteOauthGate | undefined> = [];
      mockSpec.completeOauth = async (_params, gate) => {
        gates.push(gate);
        return { action: AuthAction.LOGIN, sessionToken: "existing-session" };
      };
      if (provider === "facebook") {
        expectedFetchCalls = 1;
        activeFetch = async () => ({
          ok: true,
          json: async () => ({ id_token: "internal-facebook-oidc" }),
        });
      }
      const mounted = await mountReady(
        { onError: jest.fn() },
        { ...baseConfig, authProxyConfigId: "config-A" },
      );
      const action = mounted.context()![handler] as (params: {
        openInPage: boolean;
      }) => Promise<void>;
      const started = await startPopup(() => action({ openInPage: false }));
      await deliver(
        started.popup,
        callbackUrl({
          provider,
          state: started.authorizationUrl.searchParams.get("state")!,
          ...(pkce
            ? { code: `internal-${provider}-code` }
            : { token: `internal-${provider}-oidc` }),
          ...(provider === "apple" && { fragmentCode: "apple-code" }),
        }),
      );
      await started.observed.settled;
      expect(started.observed.outcome()).toEqual({
        status: "fulfilled",
        value: undefined,
      });
      expect(gates).toEqual([expect.any(Function)]);
      expect(mockGetClientParams).not.toHaveBeenCalled();
      expect(mockChallengeCalls).toHaveLength(0);
    },
  );

  it("concurrent internal popups admit one active challenge without crossing tokens", async () => {
    mockSpec.keys = ["popup-A-key", "popup-B-key"];
    mockSpec.getSession = async () => undefined;
    const submissions: Array<{
      publicKey: string;
      token: string | undefined;
    }> = [];
    mockSpec.completeOauth = async (params, gate) => {
      if (!gate) throw new Error("Missing popup signup gate");
      const signup = await gate(async (token) => {
        submissions.push({ publicKey: params.publicKey, token });
        return { sessionToken: `session-${params.publicKey}` };
      });
      return { ...signup, action: AuthAction.SIGNUP };
    };
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    const mounted = await mountReady(
      { onError: jest.fn() },
      { ...baseConfig, authProxyConfigId: "config-A" },
    );
    const popupA = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({ openInPage: false }),
    );
    const popupB = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({ openInPage: false }),
    );
    expect(stateFrom(popupA.authorizationUrl).get("transactionId")).not.toBe(
      stateFrom(popupB.authorizationUrl).get("transactionId"),
    );
    await deliver(
      popupA.popup,
      callbackUrl({
        provider: "google",
        token: "oidc-A",
        state: popupA.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await waitFor(() => mockChallengeCalls.length === 1, "first challenge");
    await deliver(
      popupB.popup,
      callbackUrl({
        provider: "google",
        token: "oidc-B",
        state: popupB.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await popupB.observed.settled;
    expect(popupB.observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.any(Error),
    });
    expect(mockChallengeCalls).toHaveLength(1);
    expect(submissions).toEqual([]);
    await act(async () => {
      mockChallengeCalls[0]!.result.resolve({
        token: "token-for-A",
        reset: jest.fn(),
      });
      await popupA.observed.settled;
    });
    expect(popupA.observed.outcome()).toEqual({
      status: "fulfilled",
      value: undefined,
    });
    expect(submissions).toEqual([
      { publicKey: "popup-A-key", token: "token-for-A" },
    ]);
  });

  it("Discord popup exchanges before account lookup and challenges only before signup", async () => {
    const lookup = deferred<void>();
    const order: string[] = [];
    mockSpec.keys = ["discord-signup-key"];
    mockSpec.proxy = async () => {
      order.push("exchange");
      return { oidcToken: "discord-oidc" };
    };
    mockSpec.getSession = async () => undefined;
    mockSpec.completeOauth = async (_params, gate) => {
      order.push("account lookup");
      await lookup.promise;
      if (!gate) throw new Error("Missing popup signup gate");
      const signup = await gate(async () => {
        order.push("signup");
        return { sessionToken: "discord-session" };
      });
      return { ...signup, action: AuthAction.SIGNUP };
    };
    mockGetClientParams.mockImplementation(async () => {
      order.push("C3 capability");
      return { turnstileSiteKey: "site-A" };
    });
    const mounted = await mountReady(
      { onError: jest.fn() },
      { ...baseConfig, authProxyConfigId: "config-A" },
    );
    const started = await startPopup(() =>
      mounted.context()!.handleDiscordOauth({ openInPage: false }),
    );
    await deliver(
      started.popup,
      callbackUrl({
        provider: "discord",
        code: "discord-code",
        state: started.authorizationUrl.searchParams.get("state")!,
      }),
    );
    expect(order).toEqual(["exchange", "account lookup"]);
    expect(mockChallengeCalls).toHaveLength(0);
    await act(async () => lookup.resolve());
    await waitFor(() => mockChallengeCalls.length === 1, "Discord challenge");
    expect(order).toEqual(["exchange", "account lookup", "C3 capability"]);
    await act(async () => {
      mockChallengeCalls[0]!.result.resolve({
        token: "discord-fresh-token",
        reset: jest.fn(),
      });
      await started.observed.settled;
    });
    expect(order).toEqual([
      "exchange",
      "account lookup",
      "C3 capability",
      "signup",
    ]);
  });

  it("global onOauthRedirect popup bypasses the internal Captcha gate", async () => {
    mockSpec.keys = ["custom-global-key"];
    const onOauthRedirect = jest.fn();
    const mounted = await mountReady(
      { onOauthRedirect, onError: jest.fn() },
      { ...baseConfig, authProxyConfigId: "config-A" },
    );
    const started = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({ openInPage: false }),
    );
    await deliver(
      started.popup,
      callbackUrl({
        provider: "google",
        token: "custom-global-oidc",
        state: started.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await started.observed.settled;
    expect(onOauthRedirect).toHaveBeenCalledTimes(1);
    expect(mockCompleteOauth).not.toHaveBeenCalled();
    expect(mockGetClientParams).not.toHaveBeenCalled();
    expect(mockChallengeCalls).toHaveLength(0);
  });

  it("OAuth-only binding change during challenge prevents signup", async () => {
    const submitted = jest.fn(async (_token?: string) => ({
      sessionToken: "never-submitted",
    }));
    mockSpec.keys = ["challenge-drift-key"];
    mockSpec.completeOauth = async (_params, gate) => {
      if (!gate) throw new Error("Missing popup signup gate");
      const signup = await gate(submitted);
      return { ...signup, action: AuthAction.SIGNUP };
    };
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    const config = { ...baseConfig, authProxyConfigId: "config-A" };
    const mounted = await mountReady({ onError: jest.fn() }, config);
    const started = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({ openInPage: false }),
    );
    await deliver(
      started.popup,
      callbackUrl({
        provider: "google",
        token: "challenge-drift-oidc",
        state: started.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await waitFor(() => mockChallengeCalls.length === 1, "pending challenge");
    await mounted.rerender({
      ...config,
      auth: {
        ...config.auth,
        oauthConfig: {
          ...config.auth?.oauthConfig,
          googleClientId: "google-other",
        },
      },
    });
    await act(async () => {
      mockChallengeCalls[0]!.result.resolve({
        token: "fresh-but-stale-binding",
        reset: jest.fn(),
      });
      await started.observed.settled;
    });
    expect(started.observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.any(Error),
    });
    expect(submitted).not.toHaveBeenCalled();
    expect(mockGetClientParams).toHaveBeenCalledTimes(1);
  });

  it("[P2] a synchronous per-call callback throw rejects after irreversible handoff", async () => {
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
    expect(mockDiscardedKeys).toHaveLength(0);
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
    await seedRedirectLogin({
      provider: OAuthProviders.GOOGLE,
      clientId: "google-A",
      expectedState: state,
      keyRef: "url-derived-google-key",
      verifier: null,
    });
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
    const state = new URLSearchParams({
      provider: "discord",
      flow: "redirect",
      publicKey: "url-derived-discord-key",
      nonce: "url-derived-discord-nonce",
      sessionKey: "url-derived-discord-session",
    }).toString();
    await seedRedirectLogin({
      provider: OAuthProviders.DISCORD,
      clientId: "discord-A",
      expectedState: state,
      keyRef: "url-derived-discord-key",
      verifier: "seeded-discord-verifier",
    });
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

  it.each([
    { provider: OAuthProviders.GOOGLE, clientId: "google-A", pkce: false },
    { provider: OAuthProviders.DISCORD, clientId: "discord-A", pkce: true },
  ])(
    "$provider internal redirect return requests Captcha only after Core finds no account",
    async ({ provider, clientId, pkce }) => {
      const lookup = deferred<void>();
      const submitted: Array<string | undefined> = [];
      const onError = jest.fn();
      if (pkce)
        mockSpec.proxy = async () => ({ oidcToken: "synthetic-redirect-oidc" });
      mockSpec.getSession = async () => undefined;
      mockSpec.completeOauth = async (_params, gate) => {
        await lookup.promise;
        if (!gate) throw new Error("Missing redirect signup gate");
        const signup = await gate(async (token) => {
          submitted.push(token);
          return { sessionToken: "captcha-redirect-session" };
        });
        return { ...signup, action: AuthAction.SIGNUP };
      };
      mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
      const state = new URLSearchParams({
        provider,
        flow: "redirect",
        publicKey: `redirect-${provider}-key`,
        ...(pkce && { nonce: `redirect-${provider}-nonce` }),
      }).toString();
      await seedRedirectLogin({
        provider,
        clientId,
        expectedState: state,
        keyRef: `redirect-${provider}-key`,
        verifier: pkce ? `redirect-${provider}-verifier` : null,
        configId: "config-A",
      });
      window.history.replaceState(
        null,
        document.title,
        pkce
          ? `/oauth/callback?${new URLSearchParams({
              code: "synthetic-redirect-code",
              state,
            }).toString()}`
          : `/oauth/callback#${new URLSearchParams({
              id_token: "synthetic-redirect-oidc",
              state,
            }).toString()}`,
      );

      mounts.push(
        await dom.mount(
          { ...baseConfig, authProxyConfigId: "config-A" },
          {
            onError,
          },
        ),
      );
      await waitFor(
        () => mockCompleteOauth.mock.calls.length === 1,
        "redirect completion",
      );
      expect(mockGetClientParams).not.toHaveBeenCalled();
      expect(mockChallengeCalls).toHaveLength(0);

      await act(async () => lookup.resolve());
      await waitFor(
        () => mockChallengeCalls.length === 1,
        "redirect challenge",
      );
      expect(mockGetClientParams).toHaveBeenCalledWith(
        "config-A",
        "https://auth.example.test",
      );
      expect(submitted).toEqual([]);
      await act(async () => {
        mockChallengeCalls[0]!.result.resolve({
          token: "fresh-redirect-token",
          reset: jest.fn(),
        });
      });
      await waitFor(() => submitted.length === 1, "redirect signup");
      expect(submitted).toEqual(["fresh-redirect-token"]);
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it("[P4 no-modal] Discord seeded add-provider return awaits add and preserves routing precedence", async () => {
    const addition = deferred<string[]>();
    mockSpec.proxy = async () => ({ oidcToken: "synthetic-add-token" });
    mockSpec.addOauthProvider = () => addition.promise;
    mockSpec.completeOauth = async () => {
      throw new Error("login completion must not run");
    };
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
    await seedRedirectLogin({
      provider: OAuthProviders.DISCORD,
      clientId: "discord-A",
      expectedState: state,
      keyRef: "url-derived-add-key",
      verifier: "seeded-add-verifier",
    });
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
    "[S1 safety] Discord popup operations retain distinct verifiers in %s order",
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
      const verifierSlotAfterA = localStorage.getItem("discord_verifier");
      const startedB = await startPopup(() =>
        context.handleDiscordOauth({
          openInPage: false,
          onOauthSuccess: callbackB,
        }),
      );
      const verifierSlotAfterB = localStorage.getItem("discord_verifier");

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

      expect(mockProxyCalls).toHaveLength(2);
      for (const label of ["A", "B"] as const) {
        const record = records[label];
        const exchange = mockProxyCalls.find(
          ({ params }) => params.authCode === record.code,
        );
        expect(exchange).toEqual({
          client: 0,
          params: expect.objectContaining({
            provider: "OAUTH2_PROVIDER_DISCORD",
            authCode: record.code,
            redirectUri,
            clientId: "discord-A",
            nonce: stateFrom(record.authorizationUrl).get("nonce"),
          }),
        });
        expect(expectedChallenge(exchange!.params.codeVerifier)).toBe(
          record.authorizationUrl.searchParams.get("code_challenge"),
        );
        expect(record.callback).toHaveBeenCalledTimes(1);
        expect(record.callback).toHaveBeenCalledWith({
          publicKey: `public-${label}`,
          providerName: "discord",
          oidcToken: `token-for-${record.code}`,
        });
        expect(record.observed.outcome()).toEqual({
          status: "fulfilled",
          value: undefined,
        });
      }
      expect(verifierSlotAfterA).toBeNull();
      expect(verifierSlotAfterB).toBeNull();
      expect(mockDiscardedKeys).toHaveLength(0);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it("[S1 safety] same-provider popups retain their initiating client and callback capabilities", async () => {
    mockClientSpecs.push(
      {
        keys: ["public-owner-A"],
        proxy: async (params) => ({
          oidcToken: `client-A-token-for-${params.authCode}`,
        }),
      },
      {
        keys: ["public-owner-B"],
        proxy: async (params) => ({
          oidcToken: `client-B-token-for-${params.authCode}`,
        }),
      },
    );
    const callbackA = jest.fn();
    const callbackB = jest.fn();
    const providerA = await mountReady({ onError: jest.fn() });
    const startedA = await startPopup(() =>
      providerA.context()!.handleDiscordOauth({
        openInPage: false,
        onOauthSuccess: callbackA,
      }),
    );
    const providerB = await mountReady({ onError: jest.fn() });
    const startedB = await startPopup(() =>
      providerB.context()!.handleDiscordOauth({
        openInPage: false,
        onOauthSuccess: callbackB,
      }),
    );

    await deliver(
      startedB.popup,
      callbackUrl({
        provider: "discord",
        code: "code-owner-B",
        state: startedB.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await deliver(
      startedA.popup,
      callbackUrl({
        provider: "discord",
        code: "code-owner-A",
        state: startedA.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await Promise.all([startedA.observed.settled, startedB.observed.settled]);

    expect(mockProxyCalls).toHaveLength(2);
    const exchangeA = mockProxyCalls.find(
      ({ params }) => params.authCode === "code-owner-A",
    );
    const exchangeB = mockProxyCalls.find(
      ({ params }) => params.authCode === "code-owner-B",
    );
    expect(exchangeA?.client).toBe(0);
    expect(exchangeB?.client).toBe(1);
    expect(expectedChallenge(exchangeA!.params.codeVerifier)).toBe(
      startedA.authorizationUrl.searchParams.get("code_challenge"),
    );
    expect(expectedChallenge(exchangeB!.params.codeVerifier)).toBe(
      startedB.authorizationUrl.searchParams.get("code_challenge"),
    );
    expect(callbackA).toHaveBeenCalledWith({
      publicKey: "public-owner-A",
      oidcToken: "client-A-token-for-code-owner-A",
      providerName: "discord",
    });
    expect(callbackB).toHaveBeenCalledWith({
      publicKey: "public-owner-B",
      oidcToken: "client-B-token-for-code-owner-B",
      providerName: "discord",
    });
    expect(mockDiscardedKeys).toHaveLength(0);
    expect(localStorage.getItem("discord_verifier")).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("attributes a rejected owner's cleanup to its initiating client only", async () => {
    mockClientSpecs.push(
      { keys: ["public-rejected-owner"] },
      { keys: ["public-successful-owner"] },
    );
    const callbackA = jest.fn();
    const callbackB = jest.fn();
    const providerA = await mountReady({ onError: jest.fn() });
    const startedA = await startPopup(() =>
      providerA.context()!.handleGoogleOauth({
        openInPage: false,
        onOauthSuccess: callbackA,
      }),
    );
    const providerB = await mountReady({ onError: jest.fn() });
    const startedB = await startPopup(() =>
      providerB.context()!.handleGoogleOauth({
        openInPage: false,
        onOauthSuccess: callbackB,
      }),
    );

    await deliver(
      startedA.popup,
      callbackUrl({
        provider: "google",
        token: "rejected-owner-token",
        state: `${startedA.authorizationUrl.searchParams.get("state")!}-wrong`,
      }),
    );
    await deliver(
      startedB.popup,
      callbackUrl({
        provider: "google",
        token: "successful-owner-token",
        state: startedB.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await Promise.all([startedA.observed.settled, startedB.observed.settled]);

    expect(startedA.observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.any(Error),
    });
    expect(startedB.observed.outcome()).toEqual({
      status: "fulfilled",
      value: undefined,
    });
    expect(mockDiscardedKeys).toEqual([
      { client: 0, publicKey: "public-rejected-owner" },
    ]);
    expect(callbackA).not.toHaveBeenCalled();
    expect(callbackB).toHaveBeenCalledWith({
      publicKey: "public-successful-owner",
      oidcToken: "successful-owner-token",
      providerName: "google",
    });
  });

  it("[S2 safety] a second Provider cannot erase another Provider's pending verifier", async () => {
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
    const challengeA =
      startedA.authorizationUrl.searchParams.get("code_challenge");
    const verifierSlotAfterA = localStorage.getItem("discord_verifier");
    localStorage.setItem("unrelated-sentinel", "keep-me");

    const providerB = await mountReady({ onError: jest.fn() });
    expect(mockZeroXKeyClient).toHaveBeenCalledTimes(2);
    expect(providerB.context()?.clientState).toBe(
      publicExports.ClientState.Ready,
    );
    const verifierAfterProviderBReady =
      localStorage.getItem("discord_verifier");
    expect(startedA.observed.outcome()).toEqual({ status: "pending" });
    expect(mockProxyCalls).toHaveLength(0);
    expect(callbackA).not.toHaveBeenCalled();

    await deliver(
      startedA.popup,
      callbackUrl({
        provider: "discord",
        code: "code-provider-A",
        state: startedA.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await startedA.observed.settled;

    expect(verifierSlotAfterA).toBeNull();
    expect(verifierAfterProviderBReady).toBeNull();
    expect(localStorage.getItem("discord_verifier")).toBeNull();
    expect(mockProxyCalls).toHaveLength(1);
    expect(expectedChallenge(mockProxyCalls[0]!.params.codeVerifier)).toBe(
      challengeA,
    );
    expect(mockProxyCalls[0]).toEqual({
      client: 0,
      params: expect.objectContaining({
        authCode: "code-provider-A",
        clientId: "discord-A",
      }),
    });
    expect(callbackA).toHaveBeenCalledWith({
      publicKey: "public-provider-A",
      oidcToken: "token-provider-A",
      providerName: "discord",
    });
    expect(startedA.observed.outcome()).toEqual({
      status: "fulfilled",
      value: undefined,
    });
    expect(mockDiscardedKeys).toHaveLength(0);
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
    "[S3 safety] Google popup rejects $label before dispatch",
    async ({ state }) => {
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

      await started.observed.settled;

      expect(callback).not.toHaveBeenCalled();
      expect(mockCompleteOauth).not.toHaveBeenCalled();
      expect(started.observed.outcome()).toEqual({
        status: "rejected",
        reason: expect.objectContaining({
          message: expect.stringContaining("OAuth popup response"),
        }),
      });
      expect(mockDiscardedKeys).toEqual([
        { client: 0, publicKey: "initiating-google-key" },
      ]);
    },
  );

  it("[S3 safety] swapped operation state disposes only the rejected operation's key", async () => {
    mockSpec.keys = ["google-key-A", "google-key-B"];
    const callbackA = jest.fn();
    const callbackB = jest.fn();
    const mounted = await mountReady({ onError: jest.fn() });
    const startedA = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({
        openInPage: false,
        onOauthSuccess: callbackA,
      }),
    );
    const startedB = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({
        openInPage: false,
        onOauthSuccess: callbackB,
      }),
    );

    await deliver(
      startedA.popup,
      callbackUrl({
        provider: "google",
        token: "token-A",
        state: startedB.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await startedA.observed.settled;
    expect(startedA.observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.any(Error),
    });
    expect(startedB.observed.outcome()).toEqual({ status: "pending" });
    expect(callbackA).not.toHaveBeenCalled();
    expect(callbackB).not.toHaveBeenCalled();
    expect(mockDiscardedKeys).toEqual([
      { client: 0, publicKey: "google-key-A" },
    ]);

    await deliver(
      startedB.popup,
      callbackUrl({
        provider: "google",
        token: "token-B",
        state: startedB.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await startedB.observed.settled;
    expect(startedB.observed.outcome()).toEqual({
      status: "fulfilled",
      value: undefined,
    });
    expect(callbackB).toHaveBeenCalledWith({
      publicKey: "google-key-B",
      oidcToken: "token-B",
      providerName: "google",
    });
    expect(mockDiscardedKeys).toEqual([
      { client: 0, publicKey: "google-key-A" },
    ]);
  });

  it.each([
    {
      label: "wrong same-origin path",
      callback: (state: string) =>
        `https://app.example.test/other?tenant=one&code=code&state=${encodeURIComponent(state)}`,
    },
    {
      label: "missing configured static query",
      callback: (state: string) =>
        `${redirectUri}?code=code&state=${encodeURIComponent(state)}`,
    },
    {
      label: "changed configured static query",
      callback: (state: string) =>
        `${redirectUri}?tenant=two&code=code&state=${encodeURIComponent(state)}`,
    },
    {
      label: "duplicated configured static query",
      callback: (state: string) =>
        `${redirectUri}?tenant=one&tenant=one&code=code&state=${encodeURIComponent(state)}`,
    },
  ])(
    "[B1 mounted] rejects $label before exchange or completion",
    async ({ callback }) => {
      mockSpec.keys = ["route-key"];
      mockSpec.proxy = async () => ({ oidcToken: "must-not-exchange" });
      const completion = jest.fn();
      const config: ZeroXKeyProviderConfig = {
        ...baseConfig,
        auth: {
          ...baseConfig.auth,
          oauthConfig: {
            ...baseConfig.auth?.oauthConfig,
            oauthRedirectUri: `${redirectUri}?tenant=one`,
          },
        },
      };
      const mounted = await mountReady({ onError: jest.fn() }, config);
      const started = await startPopup(() =>
        mounted.context()!.handleDiscordOauth({
          openInPage: false,
          onOauthSuccess: completion,
        }),
      );
      expect(started.authorizationUrl.searchParams.get("redirect_uri")).toBe(
        `${redirectUri}?tenant=one`,
      );

      await deliver(
        started.popup,
        callback(started.authorizationUrl.searchParams.get("state")!),
      );
      await started.observed.settled;

      expect(started.observed.outcome()).toEqual({
        status: "rejected",
        reason: expect.objectContaining({
          reason: "callback-route-mismatch",
        }),
      });
      expect(mockProxyCalls).toHaveLength(0);
      expect(completion).not.toHaveBeenCalled();
      expect(mockDiscardedKeys).toEqual([
        { client: 0, publicKey: "route-key" },
      ]);
    },
  );

  it("[B1 mounted] admits Google's origin-only emitted route after root serialization", async () => {
    mockSpec.keys = ["google-root-key"];
    const completion = jest.fn();
    const config: ZeroXKeyProviderConfig = {
      ...baseConfig,
      auth: {
        ...baseConfig.auth,
        oauthConfig: {
          ...baseConfig.auth?.oauthConfig,
          oauthRedirectUri: "https://app.example.test/",
        },
      },
    };
    const mounted = await mountReady({ onError: jest.fn() }, config);
    const started = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({
        openInPage: false,
        onOauthSuccess: completion,
      }),
    );
    expect(started.authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://app.example.test",
    );
    const response = new URL("https://app.example.test");
    response.hash = new URLSearchParams({
      id_token: "google-root-token",
      state: started.authorizationUrl.searchParams.get("state")!,
    }).toString();
    await deliver(started.popup, response.href);
    await started.observed.settled;

    expect(started.observed.outcome()).toEqual({
      status: "fulfilled",
      value: undefined,
    });
    expect(completion).toHaveBeenCalledTimes(1);
    expect(mockDiscardedKeys).toHaveLength(0);
  });

  it("[B1 mounted] admits a reordered root static-query multiset and preserves emitted bytes", async () => {
    mockSpec.keys = ["discord-root-static-key"];
    mockSpec.proxy = async () => ({ oidcToken: "discord-root-static-token" });
    const completion = jest.fn();
    const emittedRedirectUri = "https://app.example.test?tenant=one&tenant=two";
    const config: ZeroXKeyProviderConfig = {
      ...baseConfig,
      auth: {
        ...baseConfig.auth,
        oauthConfig: {
          ...baseConfig.auth?.oauthConfig,
          oauthRedirectUri: emittedRedirectUri,
        },
      },
    };
    const mounted = await mountReady({ onError: jest.fn() }, config);
    const started = await startPopup(() =>
      mounted.context()!.handleDiscordOauth({
        openInPage: false,
        onOauthSuccess: completion,
      }),
    );
    expect(started.authorizationUrl.searchParams.get("redirect_uri")).toBe(
      emittedRedirectUri,
    );
    const response = new URL("https://app.example.test/?tenant=two&tenant=one");
    response.searchParams.set("code", "discord-root-static-code");
    response.searchParams.set(
      "state",
      started.authorizationUrl.searchParams.get("state")!,
    );
    response.searchParams.set("scope", "identify email");
    await deliver(started.popup, response.href);
    await started.observed.settled;

    expect(started.observed.outcome()).toEqual({
      status: "fulfilled",
      value: undefined,
    });
    expect(mockProxyCalls).toEqual([
      {
        client: 0,
        params: expect.objectContaining({
          redirectUri: emittedRedirectUri,
          authCode: "discord-root-static-code",
        }),
      },
    ]);
    expect(completion).toHaveBeenCalledTimes(1);
    expect(mockDiscardedKeys).toHaveLength(0);
  });

  it("[B2 mounted] rejects an actual HTTP scalar mutation before exchange", async () => {
    mockSpec.keys = ["http-key"];
    mockSpec.proxy = async () => ({ oidcToken: "must-not-exchange" });
    const completion = jest.fn();
    const mounted = await mountReady({ onError: jest.fn() });
    const started = await startPopup(() =>
      mounted.context()!.handleDiscordOauth({
        openInPage: false,
        onOauthSuccess: completion,
      }),
    );
    mockClientInstances[0]!.httpClient.config.apiBaseUrl =
      "https://sensitive-new-api.example.test";

    await deliver(
      started.popup,
      callbackUrl({
        provider: "discord",
        code: "code",
        state: started.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await started.observed.settled;

    expect(started.observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.objectContaining({ reason: "context-changed" }),
    });
    expect(mockProxyCalls).toHaveLength(0);
    expect(completion).not.toHaveBeenCalled();
    expect(mockDiscardedKeys).toEqual([{ client: 0, publicKey: "http-key" }]);
  });

  it.each([
    {
      label: "organization ID",
      oldValue: "org-oauth",
      change: (config: ZeroXKeyProviderConfig) => ({
        ...config,
        organizationId: "org-changed-before-passive",
      }),
      observe: (config: ZeroXKeyProviderConfig) => config.organizationId,
    },
    {
      label: "auth proxy config ID",
      oldValue: undefined,
      change: (config: ZeroXKeyProviderConfig) => ({
        ...config,
        authProxyConfigId: "proxy-changed-before-passive",
      }),
      observe: (config: ZeroXKeyProviderConfig) => config.authProxyConfigId,
    },
    {
      label: "API endpoint",
      oldValue: "https://api.example.test",
      change: (config: ZeroXKeyProviderConfig) => ({
        ...config,
        apiBaseUrl: "https://api-changed.example.test",
      }),
      observe: (config: ZeroXKeyProviderConfig) => config.apiBaseUrl,
    },
    {
      label: "auth proxy endpoint",
      oldValue: "https://auth.example.test",
      change: (config: ZeroXKeyProviderConfig) => ({
        ...config,
        authProxyUrl: "https://auth-changed.example.test",
      }),
      observe: (config: ZeroXKeyProviderConfig) => config.authProxyUrl,
    },
    {
      label: "selected client ID",
      oldValue: "discord-A",
      change: (config: ZeroXKeyProviderConfig) => ({
        ...config,
        auth: {
          ...config.auth,
          oauthConfig: {
            ...config.auth?.oauthConfig,
            discordClientId: "discord-changed-before-passive",
          },
        },
      }),
      observe: (config: ZeroXKeyProviderConfig) =>
        config.auth?.oauthConfig?.discordClientId,
    },
    {
      label: "redirect URI",
      oldValue: redirectUri,
      change: (config: ZeroXKeyProviderConfig) => ({
        ...config,
        auth: {
          ...config.auth,
          oauthConfig: {
            ...config.auth?.oauthConfig,
            oauthRedirectUri: "https://app.example.test/changed-before-passive",
          },
        },
      }),
      observe: (config: ZeroXKeyProviderConfig) =>
        config.auth?.oauthConfig?.oauthRedirectUri,
    },
  ])(
    "[B3 mounted] rejects stale $label in the layout-before-passive window",
    async ({ oldValue, change, observe: observeConfig }) => {
      mockSpec.keys = ["must-not-allocate"];
      const digest = jest.spyOn(window.crypto.subtle, "digest");
      const mounted = await mountReady({ onError: jest.fn() });
      const retainedHandler = mounted.context()!.handleDiscordOauth;
      const changedConfig = change(baseConfig);
      let observed: ReturnType<typeof observe<void>> | undefined;
      let layoutSnapshot:
        | {
            oldMasterValue: unknown;
            keys: number;
            pkceEntries: number;
            popups: number;
          }
        | undefined;

      await mounted.rerender(
        changedConfig,
        { onError: jest.fn() },
        <LayoutInvoker
          invoke={() => retainedHandler({ openInPage: false })}
          onInvoked={(value) => {
            observed = value;
          }}
          onLayout={() => {
            layoutSnapshot = {
              oldMasterValue: observeConfig(mounted.context()!.config!),
              keys: mockCreatedKeys.length,
              pkceEntries: digest.mock.calls.length,
              popups: popups.handles.length,
            };
          }}
        />,
      );

      expect(layoutSnapshot).toEqual({
        oldMasterValue: oldValue,
        keys: 0,
        pkceEntries: 0,
        popups: 0,
      });
      await observed!.settled;
      expect(observed!.outcome()).toEqual({
        status: "rejected",
        reason: expect.objectContaining({ reason: "context-changed" }),
      });
      expect(mockCreatedKeys).toHaveLength(0);
      expect(digest).not.toHaveBeenCalled();
      expect(popups.handles).toHaveLength(0);
    },
  );

  it.each([
    {
      label: "client ID",
      changedConfig: {
        ...baseConfig,
        auth: {
          ...baseConfig.auth,
          oauthConfig: {
            ...baseConfig.auth?.oauthConfig,
            discordClientId: "discord-B",
          },
        },
      },
    },
    {
      label: "redirect URI",
      changedConfig: {
        ...baseConfig,
        auth: {
          ...baseConfig.auth,
          oauthConfig: {
            ...baseConfig.auth?.oauthConfig,
            oauthRedirectUri: "https://app.example.test/oauth/new-callback",
          },
        },
      },
    },
  ])(
    "[I1 mounted] rejects a retained handler's stale actual $label after effects settle",
    async ({ changedConfig }) => {
      mockSpec.keys = ["must-not-allocate-stale-operation"];
      const digest = jest.spyOn(window.crypto.subtle, "digest");
      const mounted = await mountReady({ onError: jest.fn() });
      const retainedHandler = mounted.context()!.handleDiscordOauth;
      await mounted.rerender(changedConfig, { onError: jest.fn() });
      await waitFor(
        () =>
          mounted.context()?.config?.auth?.oauthConfig?.discordClientId ===
            changedConfig.auth?.oauthConfig?.discordClientId &&
          mounted.context()?.config?.auth?.oauthConfig?.oauthRedirectUri ===
            changedConfig.auth?.oauthConfig?.oauthRedirectUri,
        "changed master config after passive effects",
      );

      const observed = observe(retainedHandler({ openInPage: false }));
      await flush();

      expect(observed.outcome()).toEqual({
        status: "rejected",
        reason: expect.objectContaining({ reason: "context-changed" }),
      });
      expect(mockCreatedKeys).toHaveLength(0);
      expect(digest).not.toHaveBeenCalled();
      expect(popups.handles).toHaveLength(0);
    },
  );

  it("[I1 mounted] permits a retained handler's explicit launch tuple after effects settle", async () => {
    mockSpec.keys = ["explicit-retained-key"];
    mockSpec.proxy = async () => ({ oidcToken: "explicit-retained-token" });
    const completion = jest.fn();
    const mounted = await mountReady({ onError: jest.fn() });
    const retainedHandler = mounted.context()!.handleDiscordOauth;
    const changedConfig: ZeroXKeyProviderConfig = {
      ...baseConfig,
      auth: {
        ...baseConfig.auth,
        oauthConfig: {
          ...baseConfig.auth?.oauthConfig,
          discordClientId: "discord-B",
          openOauthInPage: true,
        },
      },
    };
    await mounted.rerender(changedConfig, { onError: jest.fn() });
    await waitFor(
      () =>
        mounted.context()?.config?.auth?.oauthConfig?.discordClientId ===
          "discord-B" &&
        mounted.context()?.config?.auth?.oauthConfig?.openOauthInPage === true,
      "changed master config after passive effects",
    );

    const started = await startPopup(() =>
      retainedHandler({
        clientId: "immutable-explicit-client",
        openInPage: false,
        onOauthSuccess: completion,
      }),
    );
    expect(started.authorizationUrl.searchParams.get("client_id")).toBe(
      "immutable-explicit-client",
    );
    expect(started.authorizationUrl.searchParams.get("redirect_uri")).toBe(
      redirectUri,
    );
    await deliver(
      started.popup,
      callbackUrl({
        provider: "discord",
        code: "explicit-retained-code",
        state: started.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await started.observed.settled;
    expect(started.observed.outcome()).toEqual({
      status: "fulfilled",
      value: undefined,
    });
    expect(completion).toHaveBeenCalledTimes(1);
  });

  it.each([
    "key creation capability",
    "key discard capability",
    "http client",
    "exchange capability",
  ] as const)(
    "[I3 mounted] bounds a throwing initiating $label getter",
    async (target) => {
      mockSpec.keys = ["must-not-allocate-getter"];
      const sentinel = `sensitive ${target} getter`;
      const mounted = await mountReady({ onError: jest.fn() });
      const client = mockClientInstances[0]!;
      if (target === "key creation capability") {
        Object.defineProperty(client, "createApiKeyPair", {
          configurable: true,
          get() {
            throw new Error(sentinel);
          },
        });
      } else if (target === "key discard capability") {
        Object.defineProperty(client, "discardUncommittedApiKeyPair", {
          configurable: true,
          get() {
            throw new Error(sentinel);
          },
        });
      } else if (target === "http client") {
        Object.defineProperty(client, "httpClient", {
          configurable: true,
          get() {
            throw new Error(sentinel);
          },
        });
      } else {
        const httpClient = client.httpClient;
        Object.defineProperty(httpClient, "proxyOAuth2Authenticate", {
          configurable: true,
          get() {
            throw new Error(sentinel);
          },
        });
      }

      const observed = observe(
        mounted.context()!.handleDiscordOauth({ openInPage: false }),
      );
      await observed.settled;

      expect(observed.outcome()).toEqual({
        status: "rejected",
        reason: expect.objectContaining({
          reason: "context-unavailable",
          message: "OAuth popup context is unavailable.",
        }),
      });
      expect(
        String((observed.outcome() as { reason: unknown }).reason),
      ).not.toContain(sentinel);
      expect(mockCreatedKeys).toHaveLength(0);
      expect(popups.handles).toHaveLength(0);
    },
  );

  it("[B3 mounted] rejects a terminal response in the layout-before-passive window", async () => {
    mockSpec.keys = ["layout-response-key"];
    mockSpec.proxy = async () => ({ oidcToken: "must-not-exchange" });
    const completion = jest.fn();
    const mounted = await mountReady({ onError: jest.fn() });
    const started = await startPopup(() =>
      mounted.context()!.handleDiscordOauth({
        openInPage: false,
        onOauthSuccess: completion,
      }),
    );
    let layoutSnapshot:
      | { organizationId: string | undefined; exchanges: number }
      | undefined;

    await mounted.rerender(
      { ...baseConfig, organizationId: "org-response-before-passive" },
      { onError: jest.fn() },
      <LayoutResponseDeliverer
        deliver={() =>
          started.popup.deliver(
            callbackUrl({
              provider: "discord",
              code: "layout-response-code",
              state: started.authorizationUrl.searchParams.get("state")!,
            }),
          )
        }
        onLayout={() => {
          layoutSnapshot = {
            organizationId: mounted.context()?.config?.organizationId,
            exchanges: mockProxyCalls.length,
          };
        }}
      />,
    );

    expect(layoutSnapshot).toEqual({
      organizationId: "org-oauth",
      exchanges: 0,
    });
    await started.observed.settled;
    expect(started.observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.objectContaining({ reason: "context-changed" }),
    });
    expect(mockProxyCalls).toHaveLength(0);
    expect(completion).not.toHaveBeenCalled();
    expect(mockDiscardedKeys).toEqual([
      { client: 0, publicKey: "layout-response-key" },
    ]);
  });

  it("[B3 mounted] keeps a delayed A init from replacing the ready B client", async () => {
    const initGate = deferred<undefined>();
    mockInit.mockImplementationOnce(() => initGate.promise);
    mockSpec.keys = ["must-not-allocate-after-init"];
    const mounted = await dom.mount(baseConfig, { onError: jest.fn() });
    mounts.push(mounted);
    await waitFor(
      () => mockInit.mock.calls.length === 1,
      "pending client init",
    );

    await mounted.rerender(
      { ...baseConfig, organizationId: "org-after-init-start" },
      { onError: jest.fn() },
    );
    await waitFor(
      () =>
        mounted.context()?.clientState === publicExports.ClientState.Ready &&
        mockConstructedConfigs.length === 2,
      "new client ready after changed props",
    );
    initGate.resolve(undefined);
    await flush();

    expect(mockConstructedConfigs[0]).toEqual(
      expect.objectContaining({ organizationId: "org-oauth" }),
    );
    expect(mockConstructedConfigs[1]).toEqual(
      expect.objectContaining({ organizationId: "org-after-init-start" }),
    );
    expect(mounted.context()?.httpClient?.config.organizationId).toBe(
      "org-after-init-start",
    );
    const completion = jest.fn();
    const started = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({
        openInPage: false,
        onOauthSuccess: completion,
      }),
    );
    await deliver(
      started.popup,
      callbackUrl({
        provider: "google",
        token: "B-token",
        state: started.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await started.observed.settled;
    expect(started.observed.outcome()).toEqual({
      status: "fulfilled",
      value: undefined,
    });
    expect(mockCreatedKeys).toEqual([
      { client: 1, publicKey: "must-not-allocate-after-init" },
    ]);
    expect(completion).toHaveBeenCalledTimes(1);
  });

  it("[B3 mounted] ignores delayed A proxy payload and initializes from B", async () => {
    const fetchGateA = deferred<Response>();
    const fetchGateB = deferred<Response>();
    let fetchIndex = 0;
    activeFetch = () => {
      fetchIndex += 1;
      return fetchIndex === 1 ? fetchGateA.promise : fetchGateB.promise;
    };
    expectedFetchCalls = 2;
    expectedAuthProxyConfigCalls = 2;
    mockSpec.keys = ["must-not-allocate-after-proxy"];
    const proxyConfig: ZeroXKeyProviderConfig = {
      ...baseConfig,
      authProxyConfigId: "proxy-A",
      autoFetchWalletKitConfig: true,
      auth: {
        ...baseConfig.auth,
        methods: { walletAuthEnabled: false },
        oauthConfig: { openOauthInPage: false },
      },
    };
    const mounted = await dom.mount(proxyConfig, { onError: jest.fn() });
    mounts.push(mounted);
    await waitFor(
      () => dom.observations.fetch!.mock.calls.length === 1,
      "pending proxy fetch",
    );

    await mounted.rerender(
      { ...proxyConfig, authProxyConfigId: "proxy-B" },
      { onError: jest.fn() },
    );
    await waitFor(() => fetchIndex === 2, "B proxy fetch");
    fetchGateA.resolve({
      ok: true,
      json: async () => ({
        enabledProviders: ["google"],
        sessionExpirationSeconds: "900",
        organizationId: "org-oauth",
        oauthClientIds: { google: "proxy-google" },
        oauthRedirectUrl: redirectUri,
      }),
    } as Response);
    await flush();
    expect(mockConstructedConfigs).toHaveLength(0);
    fetchGateB.resolve({
      ok: true,
      json: async () => ({
        enabledProviders: ["google"],
        sessionExpirationSeconds: "900",
        organizationId: "org-oauth",
        oauthClientIds: { google: "proxy-google-B" },
        oauthRedirectUrl: redirectUri,
      }),
    } as Response);
    await waitFor(
      () => mounted.context()?.clientState === publicExports.ClientState.Ready,
      "B proxy client ready after config ID change",
    );
    expect(mockConstructedConfigs[0]).toEqual(
      expect.objectContaining({ authProxyConfigId: "proxy-B" }),
    );
    expect(mounted.context()?.httpClient?.config.authProxyConfigId).toBe(
      "proxy-B",
    );
    const completion = jest.fn();
    const started = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({
        openInPage: false,
        onOauthSuccess: completion,
      }),
    );
    expect(started.authorizationUrl.searchParams.get("client_id")).toBe(
      "proxy-google-B",
    );
    await deliver(
      started.popup,
      callbackUrl({
        provider: "google",
        token: "B-token",
        state: started.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await started.observed.settled;
    expect(started.observed.outcome()).toEqual({
      status: "fulfilled",
      value: undefined,
    });
    expect(completion).toHaveBeenCalledTimes(1);
  });

  it("[B3 mounted] does not dispatch a delayed A redirect token after B becomes ready", async () => {
    const exchange = deferred<{ oidcToken: string }>();
    mockSpec.proxy = () => exchange.promise;
    const onOauthRedirect = jest.fn();
    const state = new URLSearchParams({
      provider: "discord",
      flow: "redirect",
      publicKey: "redirect-A-key",
      nonce: "redirect-A-nonce",
    }).toString();
    await seedRedirectLogin({
      provider: OAuthProviders.DISCORD,
      clientId: "discord-A",
      expectedState: state,
      keyRef: "redirect-A-key",
      verifier: "seeded-A-verifier",
    });
    window.history.replaceState(
      null,
      document.title,
      `/oauth/callback?${new URLSearchParams({ code: "A-code", state }).toString()}`,
    );
    const mounted = await dom.mount(baseConfig, {
      onOauthRedirect,
      onError: jest.fn(),
    });
    mounts.push(mounted);
    await waitFor(() => mockProxyCalls.length === 1, "A redirect exchange");
    await mounted.rerender(
      { ...baseConfig, organizationId: "org-B" },
      { onOauthRedirect, onError: jest.fn() },
    );
    await waitFor(
      () => mounted.context()?.clientState === publicExports.ClientState.Ready,
      "B ready while A redirect is in flight",
    );
    exchange.resolve({ oidcToken: "stale-A-token" });
    await flush();
    expect(onOauthRedirect).not.toHaveBeenCalled();
    expect(mockCompleteOauth).not.toHaveBeenCalled();
    expect(mounted.context()?.httpClient?.config.organizationId).toBe("org-B");
  });

  it("[B3 mounted] rejects an A popup after A→B→A and accepts the new A popup", async () => {
    mockSpec.keys = ["old-A-key"];
    mockClientSpecs[2] = { keys: ["new-A-key"] };
    const oldCompletion = jest.fn();
    const newCompletion = jest.fn();
    const mounted = await mountReady({ onError: jest.fn() });
    const old = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({
        openInPage: false,
        onOauthSuccess: oldCompletion,
      }),
    );

    await mounted.rerender(
      { ...baseConfig, organizationId: "org-B" },
      { onError: jest.fn() },
    );
    await waitFor(
      () =>
        mounted.context()?.clientState === publicExports.ClientState.Ready &&
        mockConstructedConfigs.length === 2,
      "B ready",
    );
    await mounted.rerender(baseConfig, { onError: jest.fn() });
    await waitFor(
      () =>
        mounted.context()?.clientState === publicExports.ClientState.Ready &&
        mockConstructedConfigs.length === 3,
      "new A ready",
    );

    await deliver(
      old.popup,
      callbackUrl({
        provider: "google",
        token: "stale-A-token",
        state: old.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await old.observed.settled;
    expect(old.observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.objectContaining({ reason: "context-changed" }),
    });
    expect(oldCompletion).not.toHaveBeenCalled();
    expect(mockDiscardedKeys).toEqual([{ client: 0, publicKey: "old-A-key" }]);

    const current = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({
        openInPage: false,
        onOauthSuccess: newCompletion,
      }),
    );
    await deliver(
      current.popup,
      callbackUrl({
        provider: "google",
        token: "new-A-token",
        state: current.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await current.observed.settled;
    expect(current.observed.outcome()).toEqual({
      status: "fulfilled",
      value: undefined,
    });
    expect(mockCreatedKeys).toEqual([
      { client: 0, publicKey: "old-A-key" },
      { client: 2, publicKey: "new-A-key" },
    ]);
    expect(newCompletion).toHaveBeenCalledTimes(1);
  });

  it("[B3 mounted] cannot complete A post-auth after switching to B", async () => {
    mockSpec.keys = ["A-post-auth-key"];
    const completion = deferred<{
      action: AuthAction;
      sessionToken: string;
    }>();
    mockSpec.completeOauth = () => completion.promise;
    mockSpec.getSession = async () => undefined;
    const onAuthenticationSuccess = jest.fn();
    const mounted = await mountReady({
      onAuthenticationSuccess,
      onError: jest.fn(),
    });
    const started = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({ openInPage: false }),
    );
    await deliver(
      started.popup,
      callbackUrl({
        provider: "google",
        token: "A-post-auth-token",
        state: started.authorizationUrl.searchParams.get("state")!,
      }),
    );
    expect(started.observed.outcome()).toEqual({ status: "pending" });
    await mounted.rerender(
      { ...baseConfig, organizationId: "org-B" },
      { onAuthenticationSuccess, onError: jest.fn() },
    );
    await waitFor(
      () => mounted.context()?.clientState === publicExports.ClientState.Ready,
      "B ready before A Core completion",
    );
    await act(async () => {
      completion.resolve({
        action: AuthAction.LOGIN,
        sessionToken: "old-session",
      });
      await started.observed.settled;
    });
    expect(onAuthenticationSuccess).not.toHaveBeenCalled();
    expect(mounted.context()?.httpClient?.config.organizationId).toBe("org-B");
  });

  it("[B3 proof] suppresses A authentication success after proof settles under B", async () => {
    mockSpec.keys = ["A-proof-key"];
    mockSpec.completeOauth = async () => ({
      action: AuthAction.SIGNUP,
      sessionToken: "proof-signup-session",
      appProofs: [{} as any],
    });
    mockSpec.getSession = async () => proofSession();
    const onAuthenticationSuccess = jest.fn();
    const config = {
      ...baseConfig,
      auth: { ...baseConfig.auth, verifyWalletOnSignup: true },
    };
    const mounted = await mountReady(
      { onAuthenticationSuccess, onError: jest.fn() },
      config,
    );
    const started = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({ openInPage: false }),
    );
    await deliver(
      started.popup,
      callbackUrl({
        provider: "google",
        token: "A-proof-oidc",
        state: started.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await waitFor(() => mockVerifyPage.mock.calls.length > 0, "A proof page");
    expect(onAuthenticationSuccess).not.toHaveBeenCalled();
    await mounted.rerender(
      { ...config, organizationId: "org-B" },
      { onAuthenticationSuccess, onError: jest.fn() },
    );
    await act(async () => {
      mockVerifyPage.mock.calls[0]![0].onSuccess?.();
      await started.observed.settled;
    });
    expect(onAuthenticationSuccess).not.toHaveBeenCalled();
    expect(started.observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.objectContaining({ reason: "context-changed" }),
    });
  });

  it("[B3 proof] refuses A proof modal after its session lookup settles under B", async () => {
    const sessionLookup = deferred<Session | undefined>();
    mockSpec.getSession = () => sessionLookup.promise;
    const mounted = await mountReady({ onError: jest.fn() });
    const observed = observe(
      mounted.context()!.handleVerifyAppProofs({ appProofs: [{} as any] }),
    );
    await waitFor(() => mockGetSession.mock.calls.length > 0, "proof lookup");
    await mounted.rerender(
      { ...baseConfig, organizationId: "org-B" },
      { onError: jest.fn() },
    );
    await act(async () => sessionLookup.resolve(proofSession()));
    await flush();
    expect(observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.any(Error),
    });
    expect(mockVerifyPage).not.toHaveBeenCalled();
  });

  it("[B3 proof] refuses an open proof modal after the organization changes", async () => {
    mockSpec.getSession = async () => proofSession();
    const mounted = await mountReady({ onError: jest.fn() });
    const observed = observe(
      mounted.context()!.handleVerifyAppProofs({ appProofs: [{} as any] }),
    );
    await waitFor(() => mockVerifyPage.mock.calls.length > 0, "proof page");
    await mounted.rerender(
      { ...baseConfig, organizationId: "org-B" },
      { onError: jest.fn() },
    );
    await act(async () => {
      mockVerifyPage.mock.calls[0]![0].onSuccess?.();
      await observed.settled;
    });
    expect(observed.outcome()).toEqual({
      status: "rejected",
      reason: expect.objectContaining({
        message: "Verification context changed.",
      }),
    });
  });

  it.each(["replacement", "stable-new-object", "removal"] as const)(
    "[B4 mounted] keeps the original global callback across a same-root %s rerender",
    async (change) => {
      mockSpec.keys = [`callback-key-${change}`];
      const original = jest.fn();
      const replacement = jest.fn();
      const mounted = await mountReady({
        onOauthRedirect: original,
        onError: jest.fn(),
      });
      const started = await startPopup(() =>
        mounted.context()!.handleGoogleOauth({ openInPage: false }),
      );

      await mounted.rerender(
        {
          ...baseConfig,
          auth: {
            ...baseConfig.auth,
            oauthConfig: { ...baseConfig.auth?.oauthConfig },
          },
        },
        change === "removal"
          ? undefined
          : {
              onOauthRedirect:
                change === "stable-new-object" ? original : replacement,
              onError: jest.fn(),
            },
      );
      await deliver(
        started.popup,
        callbackUrl({
          provider: "google",
          token: `callback-token-${change}`,
          state: started.authorizationUrl.searchParams.get("state")!,
        }),
      );
      await started.observed.settled;

      expect(original).toHaveBeenCalledTimes(1);
      expect(original).toHaveBeenCalledWith({
        idToken: `callback-token-${change}`,
        publicKey: `callback-key-${change}`,
      });
      expect(replacement).not.toHaveBeenCalled();
      expect(mockDiscardedKeys).toHaveLength(0);
    },
  );

  it("[B4 mounted] keeps an originally internal completion when a global callback arrives", async () => {
    mockSpec.keys = ["internal-arrival-key"];
    mockSpec.completeOauth = async () => ({
      action: AuthAction.LOGIN,
      sessionToken: "internal-arrival-session",
    });
    mockSpec.getSession = async () => undefined;
    const arrived = jest.fn();
    const mounted = await mountReady({ onError: jest.fn() });
    const started = await startPopup(() =>
      mounted.context()!.handleGoogleOauth({ openInPage: false }),
    );

    await mounted.rerender(
      { ...baseConfig },
      { onOauthRedirect: arrived, onError: jest.fn() },
    );
    await deliver(
      started.popup,
      callbackUrl({
        provider: "google",
        token: "internal-arrival-token",
        state: started.authorizationUrl.searchParams.get("state")!,
      }),
    );
    await started.observed.settled;

    expect(started.observed.outcome()).toEqual({
      status: "fulfilled",
      value: undefined,
    });
    expect(mockCompleteOauth).toHaveBeenCalledTimes(1);
    expect(mockCompleteOauth).toHaveBeenCalledWith({
      oidcToken: "internal-arrival-token",
      providerName: "google",
      publicKey: "internal-arrival-key",
    });
    expect(arrived).not.toHaveBeenCalled();
    expect(mockDiscardedKeys).toHaveLength(0);
  });

  it.each(["replacement", "removal", "arrival"] as const)(
    "[B4 mounted] keeps per-call completion across global callback %s",
    async (change) => {
      mockSpec.keys = [`per-call-key-${change}`];
      const initialGlobal = jest.fn();
      const nextGlobal = jest.fn();
      const perCall = jest.fn();
      const mounted = await mountReady(
        change === "arrival"
          ? { onError: jest.fn() }
          : { onOauthRedirect: initialGlobal, onError: jest.fn() },
      );
      const started = await startPopup(() =>
        mounted.context()!.handleGoogleOauth({
          openInPage: false,
          onOauthSuccess: perCall,
        }),
      );

      await mounted.rerender(
        { ...baseConfig },
        change === "removal"
          ? undefined
          : { onOauthRedirect: nextGlobal, onError: jest.fn() },
      );
      await deliver(
        started.popup,
        callbackUrl({
          provider: "google",
          token: `per-call-token-${change}`,
          state: started.authorizationUrl.searchParams.get("state")!,
        }),
      );
      await started.observed.settled;

      expect(perCall).toHaveBeenCalledTimes(1);
      expect(perCall).toHaveBeenCalledWith({
        oidcToken: `per-call-token-${change}`,
        providerName: "google",
        publicKey: `per-call-key-${change}`,
      });
      expect(initialGlobal).not.toHaveBeenCalled();
      expect(nextGlobal).not.toHaveBeenCalled();
      expect(mockDiscardedKeys).toHaveLength(0);
    },
  );

  it("[B5 mounted] lets immutable per-call settings mask lagging raw defaults", async () => {
    mockSpec.keys = ["override-key"];
    mockSpec.proxy = async () => ({ oidcToken: "override-token" });
    const completion = jest.fn();
    const mounted = await mountReady({ onError: jest.fn() });
    const retainedHandler = mounted.context()!.handleDiscordOauth;
    const changedConfig: ZeroXKeyProviderConfig = {
      ...baseConfig,
      auth: {
        ...baseConfig.auth,
        oauthConfig: {
          ...baseConfig.auth?.oauthConfig,
          discordClientId: "changed-default",
          openOauthInPage: true,
        },
      },
    };
    let observed: ReturnType<typeof observe<void>> | undefined;
    const digest = jest.spyOn(window.crypto.subtle, "digest");
    let layoutSnapshot:
      | {
          clientId: string | undefined;
          openInPage: boolean | undefined;
          keys: number;
          pkceEntries: number;
          popups: number;
        }
      | undefined;
    await mounted.rerender(
      changedConfig,
      { onError: jest.fn() },
      <LayoutInvoker
        invoke={() =>
          retainedHandler({
            clientId: "immutable-override",
            openInPage: false,
            onOauthSuccess: completion,
          })
        }
        onInvoked={(value) => {
          observed = value;
        }}
        onLayout={() => {
          layoutSnapshot = {
            clientId:
              mounted.context()?.config?.auth?.oauthConfig?.discordClientId,
            openInPage:
              mounted.context()?.config?.auth?.oauthConfig?.openOauthInPage,
            keys: mockCreatedKeys.length,
            pkceEntries: digest.mock.calls.length,
            popups: popups.handles.length,
          };
        }}
      />,
    );
    expect(layoutSnapshot).toEqual({
      clientId: "discord-A",
      openInPage: undefined,
      keys: 0,
      pkceEntries: 1,
      popups: 0,
    });
    await waitFor(() => popups.handles.length === 1, "override popup");
    const popup = popups.handles[0]!;
    const authorizationUrl = new URL(popup.assignedUrls[0]!);
    expect(digest).toHaveBeenCalledTimes(1);
    expect(authorizationUrl.searchParams.get("client_id")).toBe(
      "immutable-override",
    );
    await deliver(
      popup,
      callbackUrl({
        provider: "discord",
        code: "override-code",
        state: authorizationUrl.searchParams.get("state")!,
      }),
    );
    await observed!.settled;
    expect(observed!.outcome()).toEqual({
      status: "fulfilled",
      value: undefined,
    });
    expect(completion).toHaveBeenCalledTimes(1);
  });

  it("[B6 mounted] rejects changed raw signup defaults for an originally internal completion", async () => {
    mockSpec.keys = ["must-not-allocate"];
    mockSpec.completeOauth = async () => ({
      action: AuthAction.LOGIN,
      sessionToken: "internal-session",
      session: undefined,
    });
    const mounted = await mountReady({ onError: jest.fn() });
    const retainedHandler = mounted.context()!.handleGoogleOauth;
    const changedConfig: ZeroXKeyProviderConfig = {
      ...baseConfig,
      auth: {
        ...baseConfig.auth,
        createSuborgParams: {
          ...baseConfig.auth?.createSuborgParams,
          oauth: { userName: "changed-before-passive" },
        },
      },
    };
    let observed: ReturnType<typeof observe<void>> | undefined;
    let layoutSnapshot:
      | { signupDefaults: unknown; keys: number; popups: number }
      | undefined;
    await mounted.rerender(
      changedConfig,
      { onOauthRedirect: jest.fn(), onError: jest.fn() },
      <LayoutInvoker
        invoke={() => retainedHandler({ openInPage: false })}
        onInvoked={(value) => {
          observed = value;
        }}
        onLayout={() => {
          layoutSnapshot = {
            signupDefaults:
              mounted.context()?.config?.auth?.createSuborgParams?.oauth,
            keys: mockCreatedKeys.length,
            popups: popups.handles.length,
          };
        }}
      />,
    );
    expect(layoutSnapshot).toEqual({
      signupDefaults: undefined,
      keys: 0,
      popups: 0,
    });
    await observed!.settled;
    expect(observed!.outcome()).toEqual({
      status: "rejected",
      reason: expect.objectContaining({ reason: "context-changed" }),
    });
    expect(mockCompleteOauth).not.toHaveBeenCalled();
    expect(mockCreatedKeys).toHaveLength(0);
  });
});
