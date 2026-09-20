import { describe, expect, it, jest } from "@jest/globals";
import {
  AuthAction,
  OAuthProviders,
  ZeroXKeyError,
  ZeroXKeyErrorCodes,
} from "@0xkey-io/sdk-types";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import type { ClientContextType } from "../providers/Types";
import type { ZeroXKeyCallbacks, ZeroXKeyProviderConfig } from "../types/base";
import { buildOAuthState } from "../utils/oauth";
import { oauthTransactionSecureStorage } from "../utils/oauth-keychain-storage";
import {
  createOauthRoutingSnapshot,
  validateOauthCallbackUrl,
} from "../utils/oauth-routing";
import { createOAuthTransactionStore } from "../utils/oauth-transaction";

type Effect = () => void | (() => void);
type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function sameDeps(a: readonly unknown[] | undefined, b: readonly unknown[]) {
  return (
    a?.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  );
}

class ProviderHarness {
  private state: Array<{ value: unknown }> = [];
  private refs: Array<{ current: unknown }> = [];
  private callbacks: Array<{
    value: unknown;
    deps: readonly unknown[];
  }> = [];
  private effects: Array<{
    deps: readonly unknown[] | undefined;
    pending: Effect | undefined;
    cleanup: (() => void) | undefined;
  }> = [];
  private stateIndex = 0;
  private refIndex = 0;
  private callbackIndex = 0;
  private effectIndex = 0;
  private dirty = false;
  private mounted = true;
  context!: ClientContextType;

  constructor(
    public config: ZeroXKeyProviderConfig,
    public callbacksProp?: ZeroXKeyCallbacks,
  ) {}

  useState<T>(initial?: T) {
    const index = this.stateIndex++;
    if (!this.state[index]) {
      this.state[index] = {
        value: typeof initial === "function" ? (initial as () => T)() : initial,
      };
    }
    const set = (next: T | ((current: T) => T)) => {
      if (!this.mounted) return;
      const current = this.state[index]!.value as T;
      this.state[index]!.value =
        typeof next === "function" ? (next as (value: T) => T)(current) : next;
      this.dirty = true;
    };
    return [this.state[index]!.value as T, set] as const;
  }

  useRef<T>(initial: T): { current: T } {
    const index = this.refIndex++;
    this.refs[index] ??= { current: initial };
    return this.refs[index] as { current: T };
  }

  useCallback<T>(callback: T, deps: readonly unknown[]): T {
    const index = this.callbackIndex++;
    const slot = this.callbacks[index];
    if (!slot || !sameDeps(slot.deps, deps)) {
      this.callbacks[index] = { value: callback, deps: [...deps] };
    }
    return this.callbacks[index]!.value as T;
  }

  useEffect(effect: Effect, deps?: readonly unknown[]) {
    const index = this.effectIndex++;
    const slot = (this.effects[index] ??= {
      deps: undefined,
      pending: undefined,
      cleanup: undefined,
    });
    if (deps === undefined || !sameDeps(slot.deps, deps)) {
      slot.deps = deps ? [...deps] : undefined;
      slot.pending = effect;
    }
  }

  render() {
    this.stateIndex = 0;
    this.refIndex = 0;
    this.callbackIndex = 0;
    this.effectIndex = 0;
    this.dirty = false;
    mockActiveHarness = this;
    const element = ZeroXKeyProvider({
      config: this.config,
      callbacks: this.callbacksProp,
      children: null,
    }) as unknown as { props: { value: ClientContextType } };
    this.context = element.props.value;
    mockActiveHarness = undefined;
  }

  async runEffects() {
    for (const slot of this.effects) {
      if (!slot?.pending) continue;
      slot.cleanup?.();
      const effect = slot.pending;
      slot.pending = undefined;
      slot.cleanup = effect() ?? undefined;
    }
    await Promise.resolve();
    await Promise.resolve();
  }

  async settle(limit = 30) {
    for (let attempt = 0; attempt < limit; attempt += 1) {
      if (!this.context || this.dirty) this.render();
      await this.runEffects();
      if (!this.dirty && !this.effects.some((slot) => slot?.pending)) return;
    }
    throw new Error("Provider harness did not settle");
  }

  renderOnly(config = this.config, callbacks = this.callbacksProp) {
    this.config = config;
    this.callbacksProp = callbacks;
    this.render();
  }

  unmount() {
    this.mounted = false;
    for (const slot of this.effects) slot?.cleanup?.();
  }
}

let mockActiveHarness: ProviderHarness | undefined;
const mockOpenAuth = jest.fn();
const mockIsAvailable = jest.fn(async () => true);
const mockGetAuthProxyConfig = jest.fn();
const mockAsyncGet = jest.fn();
const mockAsyncSet = jest.fn();
const mockAsyncRemove = jest.fn();
const mockKeychain = new Map<string, { username: string; password: string }>();
const mockKeychainCalls = { get: 0, set: 0, remove: 0 };
const mockLinkListeners: Array<{
  removed: boolean;
  listener(event: { url: string }): void;
}> = [];
let mockInitialURL: Promise<string | null> = Promise.resolve(null);

type ClientPlan = {
  init: Promise<void>;
  keys?: Set<string>;
  completeOauth?: (...args: unknown[]) => Promise<unknown>;
  discard?: (publicKey: string) => Promise<void>;
};
const mockClientPlans: ClientPlan[] = [];
const mockClients: ReturnType<typeof mockMakeClient>[] = [];

jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  const harness = () => {
    if (!mockActiveHarness) throw new Error("No active Provider harness");
    return mockActiveHarness;
  };
  return {
    ...actual,
    useState: <T>(initial?: T) => harness().useState(initial),
    useRef: <T>(initial: T) => harness().useRef(initial),
    useCallback: <T>(callback: T, deps: readonly unknown[]) =>
      harness().useCallback(callback, deps),
    useEffect: (effect: Effect, deps?: readonly unknown[]) =>
      harness().useEffect(effect, deps),
  };
});

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Linking: {
    getInitialURL: () => mockInitialURL,
    addEventListener: (
      _type: "url",
      listener: (event: { url: string }) => void,
    ) => {
      const entry = { removed: false, listener };
      mockLinkListeners.push(entry);
      return { remove: () => void (entry.removed = true) };
    },
  },
}));
jest.mock("react-native-device-info", () => ({
  __esModule: true,
  default: {},
}));
jest.mock("react-native-inappbrowser-reborn", () => ({
  InAppBrowser: {
    isAvailable: () => mockIsAvailable(),
    openAuth: (url: string, target: string, options: unknown) =>
      mockOpenAuth(url, target, options),
  },
}));
jest.mock(
  "react-native-keychain",
  () => ({
    getGenericPassword: async ({ service }: { service: string }) => {
      mockKeychainCalls.get += 1;
      return mockKeychain.get(service) ?? false;
    },
    setGenericPassword: async (
      username: string,
      password: string,
      { service }: { service: string },
    ) => {
      mockKeychainCalls.set += 1;
      mockKeychain.set(service, { username, password });
      return { service };
    },
    resetGenericPassword: async ({ service }: { service: string }) => {
      mockKeychainCalls.remove += 1;
      mockKeychain.delete(service);
      return true;
    },
  }),
  { virtual: true },
);
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: (...args: unknown[]) => mockAsyncGet(...args),
  setItem: (...args: unknown[]) => mockAsyncSet(...args),
  removeItem: (...args: unknown[]) => mockAsyncRemove(...args),
}));
jest.mock("@0xkey-io/core", () => {
  const actual =
    jest.requireActual<typeof import("@0xkey-io/core")>("@0xkey-io/core");
  return {
    ...actual,
    getAuthProxyConfig: (...args: unknown[]) => mockGetAuthProxyConfig(...args),
    ZeroXKeyClient: jest.fn((config: ZeroXKeyProviderConfig) => {
      const created = mockMakeClient(config, mockClientPlans.shift());
      mockClients.push(created);
      return created;
    }),
  };
});

import { ZeroXKeyProvider } from "../providers/ZeroXKeyProvider";

function mockMakeClient(
  config: ZeroXKeyProviderConfig,
  plan: ClientPlan = { init: Promise.resolve() },
) {
  let initialized = false;
  const keys = plan.keys ?? new Set<string>();
  let keyNumber = 0;
  const httpClient = {
    config: {
      organizationId: config.organizationId,
      apiBaseUrl: config.apiBaseUrl || "https://api.0xkey.com",
      authProxyUrl: config.authProxyUrl || "https://authproxy.0xkey.io",
      ...(config.authProxyConfigId
        ? { authProxyConfigId: config.authProxyConfigId }
        : {}),
    },
    proxyOAuth2Authenticate: jest.fn(async () => ({
      oidcToken: "proxy-token",
    })),
  };
  const client = {
    config,
    init: jest.fn(async () => {
      await plan.init;
      initialized = true;
    }),
    get httpClient() {
      if (!initialized) throw new Error("Client is not initialized");
      return httpClient;
    },
    createApiKeyPair: jest.fn(async () => {
      const publicKey = `provider-key-${++keyNumber}`;
      keys.add(publicKey);
      return publicKey;
    }),
    discardUncommittedApiKeyPair: jest.fn(async (publicKey: string) => {
      if (plan.discard) await plan.discard(publicKey);
      keys.delete(publicKey);
    }),
    completeOauth: jest.fn(
      plan.completeOauth ?? (async () => ({ action: AuthAction.LOGIN })),
    ),
    getAllSessions: jest.fn(async () => undefined),
    getActiveSessionKey: jest.fn(async () => undefined),
    getSession: jest.fn(async () => undefined),
    fetchWallets: jest.fn(async () => []),
    fetchUser: jest.fn(async () => undefined),
    keys,
  };
  return client;
}

function baseConfig(overrides: Partial<ZeroXKeyProviderConfig> = {}) {
  return {
    organizationId: "organization-id",
    auth: {
      oauth: {
        appScheme: "example",
        redirectUri: "https://oauth.example/callback?static=%2Fkeep",
        google: { primaryClientId: { webClientId: "google-client" } },
        apple: { primaryClientId: { serviceId: "apple-client" } },
        facebook: { primaryClientId: "facebook-client" },
        x: { primaryClientId: "x-client", redirectUri: "example://x/cb" },
        discord: {
          primaryClientId: "discord-client",
          redirectUri: "example://discord/cb",
        },
      },
      createSuborgParams: { oauth: { custom: "configured" } as never },
    },
    autoRefreshManagedState: false,
    ...overrides,
  } as ZeroXKeyProviderConfig;
}

function reset() {
  mockOpenAuth.mockReset();
  mockIsAvailable.mockClear();
  mockGetAuthProxyConfig.mockReset();
  mockClientPlans.length = 0;
  mockClients.length = 0;
  mockKeychain.clear();
  mockKeychainCalls.get = 0;
  mockKeychainCalls.set = 0;
  mockKeychainCalls.remove = 0;
  mockLinkListeners.length = 0;
  mockInitialURL = Promise.resolve(null);
  mockAsyncGet.mockReset();
  mockAsyncSet.mockReset();
  mockAsyncRemove.mockReset();
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: jest.fn(async () => ({
      ok: true,
      json: async () => ({ id_token: "facebook-token" }),
    })),
  });
}

async function waitFor(predicate: () => boolean, limit = 100) {
  for (let attempt = 0; attempt < limit; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Expected asynchronous Provider work did not complete");
}

function emit(url: string) {
  for (const entry of mockLinkListeners) {
    if (!entry.removed) entry.listener({ url });
  }
}

function callbackFor(
  url: string,
  target: string,
  token = "identity-token",
  authCode = "authorization-code",
) {
  const state = new URL(url).searchParams.get("state")!;
  return `${target}?code=${encodeURIComponent(authCode)}&id_token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}`;
}

type StoredFixtureRecord = {
  id: string;
  publicKey: string;
  expectedState: string;
  codeVerifier?: string;
};

function storedRecordForAuthorization(url: string): StoredFixtureRecord {
  const state = new URL(url).searchParams.get("state");
  const id = state ? new URLSearchParams(state).get("transactionId") : null;
  const stored = [...mockKeychain.values()]
    .map(({ password }) => JSON.parse(password) as StoredFixtureRecord)
    .find((record) => record.id === id);
  if (!stored) throw new Error("Stored OAuth fixture record not found");
  return stored;
}

async function mountReady(
  config = baseConfig(),
  callbacks?: ZeroXKeyCallbacks,
  plan: ClientPlan = { init: Promise.resolve() },
) {
  const clientsBefore = mockClients.length;
  mockClientPlans.push(plan);
  const harness = new ProviderHarness(config, callbacks);
  harness.render();
  await harness.settle();
  expect(mockClients).toHaveLength(clientsBefore + 1);
  return { harness, client: mockClients.at(-1)! };
}

async function seedCold(input: {
  provider: OAuthProviders;
  clientId: string;
  redirectUri: string;
  organizationId?: string;
  appScheme?: string;
  completion?: "internal" | "onOauthRedirect" | "onOauthSuccess";
  publicKey?: string;
  verifier?: string;
  authProxyConfigId?: string;
}) {
  const snapshot = createOauthRoutingSnapshot({
    organizationId: input.organizationId ?? "organization-id",
    apiBaseUrl: "https://api.0xkey.com",
    authProxyUrl: "https://authproxy.0xkey.io",
    ...(input.authProxyConfigId
      ? { authProxyConfigId: input.authProxyConfigId }
      : {}),
    provider: input.provider,
    completion: input.completion ?? "onOauthRedirect",
    settings: {
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      appScheme: input.appScheme ?? "example",
    },
  });
  const store = createOAuthTransactionStore({
    secureStorage: oauthTransactionSecureStorage,
    randomBytes: (length) => new Uint8Array(length).fill(9),
    now: Date.now,
    cleanupTemporaryKey: async () => undefined,
  });
  const publicKey = input.publicKey ?? "cold-public-key";
  let expectedState = "";
  await store.beginOAuthTransaction({
    configId: snapshot.configId,
    provider: input.provider,
    binding: snapshot.binding,
    publicKey,
    ...(input.verifier ? { codeVerifier: input.verifier } : {}),
    createExpectedState: (transactionId) => {
      expectedState = buildOAuthState({
        provider: input.provider,
        flow: "redirect",
        publicKey,
        nonce: bytesToHex(sha256(publicKey)),
        transactionId,
      });
      return expectedState;
    },
  });
  const target = snapshot.appReturnTarget;
  const callback = `${target}?code=cold-code&id_token=cold-token&state=${encodeURIComponent(expectedState)}`;
  return { snapshot, callback, publicKey };
}

describe("OAuth Provider initialization and Linking barrier", () => {
  it("buffers initial and event URLs through proxy config and deferred init, then consumes once", async () => {
    reset();
    const cold = await seedCold({
      provider: OAuthProviders.X,
      clientId: "x-client",
      redirectUri: "example://x/cb",
      verifier: "cold-verifier",
      authProxyConfigId: "proxy-config",
    });
    const initial = deferred<string | null>();
    expect(
      validateOauthCallbackUrl(cold.snapshot, cold.callback),
    ).toBeDefined();
    const proxy = deferred<{
      enabledProviders: string[];
      sessionExpirationSeconds: string;
      organizationId: string;
      oauthClientIds: Record<string, string>;
      oauthRedirectUrl: string;
    }>();
    const init = deferred<void>();
    mockInitialURL = initial.promise;
    mockGetAuthProxyConfig.mockImplementation(() => proxy.promise);
    mockClientPlans.push({
      init: init.promise,
      keys: new Set([cold.publicKey]),
    });
    const storageReadsBeforeMount = mockKeychainCalls.get;
    const redirects: Array<{ idToken: string; publicKey: string }> = [];
    const errors: unknown[] = [];
    const harness = new ProviderHarness(
      baseConfig({ authProxyConfigId: "proxy-config" }),
      {
        onOauthRedirect: (value) => redirects.push(value),
        onError: (error) => errors.push(error),
      },
    );
    harness.render();
    await harness.runEffects();
    emit(cold.callback);
    initial.resolve(cold.callback);
    await Promise.resolve();
    expect(mockKeychainCalls.get).toBe(storageReadsBeforeMount);
    expect(mockClients).toHaveLength(0);

    proxy.resolve({
      enabledProviders: ["x"],
      sessionExpirationSeconds: "900",
      organizationId: "organization-id",
      oauthClientIds: { x: "x-client" },
      oauthRedirectUrl: "https://oauth.example/callback",
    });
    await waitFor(() => (harness as unknown as { dirty: boolean }).dirty);
    harness.render();
    await harness.runEffects();
    expect(mockClients).toHaveLength(1);
    expect(mockKeychainCalls.get).toBe(storageReadsBeforeMount);

    init.resolve();
    await waitFor(() => (harness as unknown as { dirty: boolean }).dirty);
    await harness.settle();
    await waitFor(() => redirects.length === 1 || errors.length > 0);
    expect(errors).toEqual([]);

    expect(
      mockClients[0]!.httpClient.proxyOAuth2Authenticate,
    ).toHaveBeenCalledTimes(1);
    expect(
      mockClients[0]!.httpClient.proxyOAuth2Authenticate,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        authCode: "cold-code",
        codeVerifier: "cold-verifier",
        clientId: "x-client",
        redirectUri: "example://x/cb",
      }),
    );
    expect(mockKeychain.size).toBe(0);
  });

  it("keeps buffered recovery untouched after failed init and removes the listener on unmount", async () => {
    reset();
    const cold = await seedCold({
      provider: OAuthProviders.GOOGLE,
      clientId: "google-client",
      redirectUri: "https://oauth.example/callback?static=%2Fkeep",
    });
    const initial = deferred<string | null>();
    const init = deferred<void>();
    mockInitialURL = initial.promise;
    mockClientPlans.push({
      init: init.promise,
      keys: new Set([cold.publicKey]),
    });
    const storageReadsBeforeMount = mockKeychainCalls.get;
    const harness = new ProviderHarness(baseConfig());
    harness.render();
    await harness.settle();
    init.reject(new Error("migration failed"));
    await Promise.resolve();
    await Promise.resolve();
    emit(cold.callback);
    expect(mockKeychainCalls.get).toBe(storageReadsBeforeMount);
    harness.unmount();
    initial.resolve(cold.callback);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockLinkListeners.every((entry) => entry.removed)).toBe(true);
    expect(mockKeychain.size).toBe(1);
    expect(mockClients[0]!.discardUncommittedApiKeyPair).not.toHaveBeenCalled();
  });
});

describe("OAuth exposed handler ownership and completion", () => {
  it("persists and completes all five exposed handlers with exact boundaries and no verifier globals", async () => {
    reset();
    const redirects: unknown[] = [];
    const { harness, client } = await mountReady(baseConfig(), {
      onOauthRedirect: (value) => redirects.push(value),
    });
    const cases: Array<{
      name: keyof Pick<
        ClientContextType,
        | "handleGoogleOauth"
        | "handleAppleOauth"
        | "handleFacebookOauth"
        | "handleXOauth"
        | "handleDiscordOauth"
      >;
      params: never;
      target: string;
      verifier: boolean;
    }> = [
      {
        name: "handleGoogleOauth",
        params: {
          primaryClientId: { webClientId: "google-call" },
          additionalState: { sessionKey: "session/key?next=%2F" },
        } as never,
        target: "example://",
        verifier: false,
      },
      {
        name: "handleAppleOauth",
        params: { primaryClientId: { serviceId: "apple-call" } } as never,
        target: "example://",
        verifier: false,
      },
      {
        name: "handleFacebookOauth",
        params: { primaryClientId: "facebook-call" } as never,
        target: "example://",
        verifier: true,
      },
      {
        name: "handleXOauth",
        params: { primaryClientId: "x-call" } as never,
        target: "example://x/cb",
        verifier: true,
      },
      {
        name: "handleDiscordOauth",
        params: { primaryClientId: "discord-call" } as never,
        target: "example://discord/cb",
        verifier: true,
      },
    ];
    const traces: Array<{
      name: (typeof cases)[number]["name"];
      record: {
        id: string;
        publicKey: string;
        expectedState: string;
        codeVerifier?: string;
      };
    }> = [];
    for (const testCase of cases) {
      const browser = deferred<{ type: string; url?: string }>();
      mockOpenAuth.mockImplementationOnce(() => browser.promise);
      const pending = (
        harness.context[testCase.name] as (params: never) => Promise<void>
      )(testCase.params);
      await waitFor(
        () => mockOpenAuth.mock.calls.length === redirects.length + 1,
      );
      const [url, target] = mockOpenAuth.mock.calls.at(-1)! as [string, string];
      expect(target).toBe(testCase.target);
      expect(mockKeychain.size).toBe(1);
      const record = JSON.parse([...mockKeychain.values()][0]!.password) as {
        id: string;
        publicKey: string;
        expectedState: string;
        codeVerifier?: string;
      };
      expect(record.expectedState).toBe(new URL(url).searchParams.get("state"));
      expect(
        new URLSearchParams(record.expectedState).get("transactionId"),
      ).toBe(record.id);
      expect(Boolean(record.codeVerifier)).toBe(testCase.verifier);
      expect(client.keys.has(record.publicKey)).toBe(true);
      traces.push({ name: testCase.name, record });
      browser.resolve({ type: "success", url: callbackFor(url, target) });
      await pending;
      expect(mockKeychain.size).toBe(0);
      expect(client.keys.has(record.publicKey)).toBe(true);
    }
    expect(redirects).toHaveLength(5);
    expect(redirects).toEqual(
      traces.map(({ record }, index) =>
        expect.objectContaining({
          idToken:
            index === 2
              ? "facebook-token"
              : index >= 3
                ? "proxy-token"
                : "identity-token",
          publicKey: record.publicKey,
        }),
      ),
    );
    expect(redirects[0]).toEqual(
      expect.objectContaining({ sessionKey: "session/key?next=%2F" }),
    );
    const facebook = traces.find(
      ({ name }) => name === "handleFacebookOauth",
    )!.record;
    const x = traces.find(({ name }) => name === "handleXOauth")!.record;
    const discord = traces.find(
      ({ name }) => name === "handleDiscordOauth",
    )!.record;
    expect(
      new Set([facebook.codeVerifier, x.codeVerifier, discord.codeVerifier])
        .size,
    ).toBe(3);
    expect(client.httpClient.proxyOAuth2Authenticate.mock.calls).toEqual([
      [
        {
          provider: "OAUTH2_PROVIDER_X",
          authCode: "authorization-code",
          redirectUri: "example://x/cb",
          clientId: "x-call",
          codeVerifier: x.codeVerifier,
          nonce: bytesToHex(sha256(x.publicKey)),
        },
      ],
      [
        {
          provider: "OAUTH2_PROVIDER_DISCORD",
          authCode: "authorization-code",
          redirectUri: "example://discord/cb",
          clientId: "discord-call",
          codeVerifier: discord.codeVerifier,
          nonce: bytesToHex(sha256(discord.publicKey)),
        },
      ],
    ]);
    const facebookRequest = (globalThis.fetch as jest.Mock).mock.calls[0]!;
    expect(facebookRequest[0]).toBe(
      "https://graph.facebook.com/v23.0/oauth/access_token",
    );
    const facebookBody = new URLSearchParams(
      (facebookRequest[1] as { body: string }).body,
    );
    expect(facebookBody.get("client_id")).toBe("facebook-call");
    expect(facebookBody.get("redirect_uri")).toBe(
      "https://oauth.example/callback?static=%2Fkeep&scheme=example",
    );
    expect(facebookBody.get("code")).toBe("authorization-code");
    expect(facebookBody.get("code_verifier")).toBe(facebook.codeVerifier);
    expect(mockAsyncGet).not.toHaveBeenCalled();
    expect(mockAsyncSet).not.toHaveBeenCalled();
    expect(mockAsyncRemove).not.toHaveBeenCalled();
  });

  it.each([
    ["Google", (context: ClientContextType) => context.handleGoogleOauth()],
    ["Apple", (context: ClientContextType) => context.handleAppleOauth()],
    ["Facebook", (context: ClientContextType) => context.handleFacebookOauth()],
    ["X", (context: ClientContextType) => context.handleXOauth()],
    ["Discord", (context: ClientContextType) => context.handleDiscordOauth()],
  ])(
    "cancels only the %s operation key while handed-off and unrelated keys survive",
    async (_provider, startCancellation) => {
      reset();
      const completions: Array<{ publicKey: string }> = [];
      const { harness, client } = await mountReady(baseConfig(), {
        onOauthRedirect: (value) => completions.push(value),
      });
      client.keys.add("unrelated-key");
      mockOpenAuth.mockImplementationOnce(async (...args: unknown[]) => {
        const [url, target] = args as [string, string];
        return { type: "success", url: callbackFor(url, target) };
      });
      await harness.context.handleGoogleOauth();
      const handedOffKey = completions[0]!.publicKey;

      const browser = deferred<{ type: string }>();
      mockOpenAuth.mockImplementationOnce(() => browser.promise);
      const pending = startCancellation(harness.context);
      await waitFor(() => mockKeychain.size === 1);
      const cancelledRecord = JSON.parse(
        [...mockKeychain.values()][0]!.password,
      ) as { publicKey: string };
      expect(cancelledRecord.publicKey).not.toBe(handedOffKey);

      browser.resolve({ type: "cancel" });
      await expect(pending).rejects.toThrow("OAuth browser cancelled");
      expect(mockKeychain.size).toBe(0);
      expect(client.keys).toEqual(new Set(["unrelated-key", handedOffKey]));
      expect(client.discardUncommittedApiKeyPair).toHaveBeenCalledTimes(1);
      expect(client.discardUncommittedApiKeyPair).toHaveBeenCalledWith(
        cancelledRecord.publicKey,
      );
    },
  );

  it("completes same-provider starts out of order with isolated keys and verifiers", async () => {
    reset();
    const completed: Array<{ idToken: string; publicKey: string }> = [];
    const { harness, client } = await mountReady(baseConfig(), {
      onOauthRedirect: (value) => completed.push(value),
    });
    const browsers = [
      deferred<{ type: string; url: string }>(),
      deferred<{ type: string; url: string }>(),
    ];
    mockOpenAuth
      .mockImplementationOnce(() => browsers[0]!.promise)
      .mockImplementationOnce(() => browsers[1]!.promise);
    const first = harness.context.handleXOauth({ primaryClientId: "x-client" });
    const second = harness.context.handleXOauth({
      primaryClientId: "x-client",
    });
    await waitFor(() => mockOpenAuth.mock.calls.length === 2);
    const [urlA, targetA] = mockOpenAuth.mock.calls[0]! as [string, string];
    const [urlB, targetB] = mockOpenAuth.mock.calls[1]! as [string, string];
    expect(mockKeychain.size).toBe(2);
    const recordA = storedRecordForAuthorization(urlA);
    const recordB = storedRecordForAuthorization(urlB);
    expect(recordA.id).not.toBe(recordB.id);
    expect(recordA.publicKey).not.toBe(recordB.publicKey);
    expect(recordA.codeVerifier).toBeTruthy();
    expect(recordB.codeVerifier).toBeTruthy();
    expect(recordA.codeVerifier).not.toBe(recordB.codeVerifier);
    browsers[1]!.resolve({
      type: "success",
      url: callbackFor(urlB, targetB, "unused", "second-code"),
    });
    await second;
    browsers[0]!.resolve({
      type: "success",
      url: callbackFor(urlA, targetA, "unused", "first-code"),
    });
    await first;
    expect(client.httpClient.proxyOAuth2Authenticate.mock.calls).toEqual([
      [
        {
          provider: "OAUTH2_PROVIDER_X",
          authCode: "second-code",
          redirectUri: "example://x/cb",
          clientId: "x-client",
          codeVerifier: recordB.codeVerifier,
          nonce: bytesToHex(sha256(recordB.publicKey)),
        },
      ],
      [
        {
          provider: "OAUTH2_PROVIDER_X",
          authCode: "first-code",
          redirectUri: "example://x/cb",
          clientId: "x-client",
          codeVerifier: recordA.codeVerifier,
          nonce: bytesToHex(sha256(recordA.publicKey)),
        },
      ],
    ]);
    expect(completed).toEqual([
      { idToken: "proxy-token", publicKey: recordB.publicKey },
      { idToken: "proxy-token", publicKey: recordA.publicKey },
    ]);
    expect(client.keys).toEqual(
      new Set([recordA.publicKey, recordB.publicKey]),
    );
  });

  it("uses the actual internal completeOauth wrapper, configured suborg params, and tolerates no session", async () => {
    reset();
    mockOpenAuth.mockImplementation(async (...args: unknown[]) => {
      const [url, target] = args as [string, string];
      return { type: "success", url: callbackFor(url, target) };
    });
    const { harness, client } = await mountReady();
    await harness.context.handleGoogleOauth();
    expect(client.completeOauth).toHaveBeenCalledWith({
      oidcToken: "identity-token",
      providerName: "google",
      publicKey: "provider-key-1",
      createSubOrgParams: { custom: "configured" },
    });
    expect(client.getSession).toHaveBeenCalled();
    expect(client.keys).toEqual(new Set(["provider-key-1"]));
  });

  it("retains the handed-off key when the global success callback throws and ignores per-call success", async () => {
    reset();
    mockOpenAuth.mockImplementation(async (...args: unknown[]) => {
      const [url, target] = args as [string, string];
      return { type: "success", url: callbackFor(url, target) };
    });
    const globalError = new Error("customer continuation");
    const globalSuccess = jest.fn(() => {
      throw globalError;
    });
    const redirect = jest.fn();
    const perCall = jest.fn();
    const callbacks = {
      onOauthSuccess: globalSuccess,
      onOauthRedirect: redirect,
    } as unknown as ZeroXKeyCallbacks;
    const { harness, client } = await mountReady(baseConfig(), callbacks);
    await expect(
      harness.context.handleGoogleOauth({ onOauthSuccess: perCall }),
    ).rejects.toBe(globalError);
    expect(globalSuccess).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
    expect(perCall).not.toHaveBeenCalled();
    expect(client.keys).toEqual(new Set(["provider-key-1"]));
    expect(client.discardUncommittedApiKeyPair).not.toHaveBeenCalled();
  });

  it("retains the handed-off key while a customer callback remains delayed", async () => {
    reset();
    mockOpenAuth.mockImplementation(async (...args: unknown[]) => {
      const [url, target] = args as [string, string];
      return { type: "success", url: callbackFor(url, target) };
    });
    const continuation = deferred<void>();
    const redirect = jest.fn(() => continuation.promise);
    const { harness, client } = await mountReady(baseConfig(), {
      onOauthRedirect: redirect,
    });

    await harness.context.handleGoogleOauth();
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(client.keys).toEqual(new Set(["provider-key-1"]));
    expect(client.discardUncommittedApiKeyPair).not.toHaveBeenCalled();

    continuation.resolve();
    await continuation.promise;
  });

  it("delegates a receiver-first duplicate to the originating Provider capabilities", async () => {
    reset();
    const ownerResults: Array<{ idToken: string; publicKey: string }> = [];
    const receiverResults: Array<{ idToken: string; publicKey: string }> = [];
    const owner = await mountReady(baseConfig(), {
      onOauthRedirect: (value) => ownerResults.push(value),
    });
    const receiver = await mountReady(baseConfig(), {
      onOauthRedirect: (value) => receiverResults.push(value),
    });
    receiver.client.keys.add("receiver-unrelated-key");
    expect(mockLinkListeners).toHaveLength(2);
    const browser = deferred<{ type: string }>();
    mockOpenAuth.mockImplementationOnce(() => browser.promise);
    const pending = owner.harness.context.handleXOauth();
    await waitFor(() => mockOpenAuth.mock.calls.length === 1);
    const [url, target] = mockOpenAuth.mock.calls[0]! as [string, string];
    const record = storedRecordForAuthorization(url);
    const callback = callbackFor(url, target);
    mockLinkListeners[1]!.listener({ url: callback });
    await waitFor(() => ownerResults.length === 1);
    mockLinkListeners[0]!.listener({ url: callback });
    await Promise.resolve();
    await Promise.resolve();
    browser.resolve({ type: "cancel" });
    await pending;

    expect(ownerResults).toEqual([
      { idToken: "proxy-token", publicKey: record.publicKey },
    ]);
    expect(receiverResults).toEqual([]);
    expect(
      owner.client.httpClient.proxyOAuth2Authenticate,
    ).toHaveBeenCalledWith({
      provider: "OAUTH2_PROVIDER_X",
      authCode: "authorization-code",
      redirectUri: "example://x/cb",
      clientId: "x-client",
      codeVerifier: record.codeVerifier,
      nonce: bytesToHex(sha256(record.publicKey)),
    });
    expect(
      receiver.client.httpClient.proxyOAuth2Authenticate,
    ).not.toHaveBeenCalled();
    expect(owner.client.keys).toEqual(new Set([record.publicKey]));
    expect(receiver.client.keys).toEqual(new Set(["receiver-unrelated-key"]));
    expect(owner.client.discardUncommittedApiKeyPair).not.toHaveBeenCalled();
    expect(receiver.client.discardUncommittedApiKeyPair).not.toHaveBeenCalled();
  });

  it("rejects a rendered endpoint change on the old initialized client before effects", async () => {
    reset();
    const initial = baseConfig({
      authProxyConfigId: "stable-config",
      autoFetchWalletKitConfig: false,
    });
    const { harness, client } = await mountReady(initial);
    const changed = baseConfig({
      authProxyConfigId: "stable-config",
      autoFetchWalletKitConfig: false,
      apiBaseUrl: "https://changed-api.example",
    });
    harness.renderOnly(changed);

    await expect(harness.context.handleGoogleOauth()).rejects.toThrow(
      "OAuth context changed",
    );
    expect(client.createApiKeyPair).not.toHaveBeenCalled();
    expect(mockKeychain.size).toBe(0);
  });

  it("rejects a rendered organization change on the old initialized client before effects", async () => {
    reset();
    const initial = baseConfig({
      authProxyConfigId: "stable-config",
      autoFetchWalletKitConfig: false,
    });
    const { harness, client } = await mountReady(initial);
    harness.renderOnly(
      baseConfig({
        authProxyConfigId: "stable-config",
        autoFetchWalletKitConfig: false,
        organizationId: "changed-org",
      }),
    );

    await expect(harness.context.handleGoogleOauth()).rejects.toThrow(
      "OAuth context changed",
    );
    expect(client.createApiKeyPair).not.toHaveBeenCalled();
  });

  it.each([
    [
      "client ID",
      (config: ZeroXKeyProviderConfig) => ({
        ...config,
        auth: {
          ...config.auth,
          oauth: {
            ...config.auth?.oauth,
            google: { primaryClientId: { webClientId: "changed-client" } },
          },
        },
      }),
      undefined,
    ],
    [
      "route",
      (config: ZeroXKeyProviderConfig) => ({
        ...config,
        auth: {
          ...config.auth,
          oauth: { ...config.auth?.oauth, appScheme: "changed-scheme" },
        },
      }),
      undefined,
    ],
    ["completion selection", (config: ZeroXKeyProviderConfig) => config, {}],
  ])(
    "invalidates an active exposed flow after rendered %s changes before effects",
    async (_kind, changeConfig, changeCallbacks) => {
      reset();
      const callbacks = { onOauthRedirect: jest.fn() };
      const initial = baseConfig({
        authProxyConfigId: "stable-config",
        autoFetchWalletKitConfig: false,
      });
      const { harness, client } = await mountReady(initial, callbacks);
      const browser = deferred<{ type: string; url: string }>();
      mockOpenAuth.mockImplementationOnce(() => browser.promise);
      const pending = harness.context.handleGoogleOauth();
      await waitFor(() => mockOpenAuth.mock.calls.length === 1);
      const [url, target] = mockOpenAuth.mock.calls[0]! as [string, string];
      harness.renderOnly(
        changeConfig(initial),
        (changeCallbacks ?? callbacks) as ZeroXKeyCallbacks,
      );
      browser.resolve({ type: "success", url: callbackFor(url, target) });

      await expect(pending).rejects.toThrow("OAuth context changed");
      expect(mockKeychain.size).toBe(0);
      expect(client.keys.size).toBe(0);
    },
  );

  it("preserves exact custom endpoints and a host-only HTTPS provider redirect", async () => {
    reset();
    const config = baseConfig({
      apiBaseUrl: "https://api.custom.example/v1/",
      authProxyUrl: "https://proxy.custom.example/root/",
      auth: {
        ...baseConfig().auth,
        oauth: {
          ...baseConfig().auth?.oauth,
          redirectUri: "https://oauth.example",
        },
      },
    });
    const browser = deferred<{ type: string }>();
    mockOpenAuth.mockImplementationOnce(() => browser.promise);
    const { harness } = await mountReady(config, {
      onOauthRedirect: jest.fn(),
    });
    const pending = harness.context.handleGoogleOauth();
    await waitFor(() => mockOpenAuth.mock.calls.length === 1);
    const authorization = new URL(mockOpenAuth.mock.calls[0]![0] as string);
    expect(authorization.searchParams.get("redirectUri")).toBe(
      "https://oauth.example?scheme=example",
    );
    const record = JSON.parse([...mockKeychain.values()][0]!.password) as {
      binding: string;
    };
    expect(record.binding).toContain("https://api.custom.example/v1/");
    expect(record.binding).toContain("https://proxy.custom.example/root/");
    browser.resolve({ type: "cancel" });
    await expect(pending).rejects.toThrow("OAuth browser cancelled");
  });

  it("preserves an SDK typed continuation through an installed-Linking and warm-browser race", async () => {
    reset();
    const completion = deferred<unknown>();
    const browser = deferred<{ type: string; url: string }>();
    mockOpenAuth.mockImplementationOnce(() => browser.promise);
    const reported: ZeroXKeyError[] = [];
    const { harness, client } = await mountReady(
      baseConfig(),
      { onError: (error) => reported.push(error) },
      {
        init: Promise.resolve(),
        completeOauth: () => completion.promise,
      },
    );
    const pending = harness.context.handleGoogleOauth();
    await waitFor(() => mockOpenAuth.mock.calls.length === 1);
    const [url, target] = mockOpenAuth.mock.calls[0]! as [string, string];
    const callback = callbackFor(url, target);
    mockLinkListeners[0]!.listener({ url: callback });
    await waitFor(() => client.completeOauth.mock.calls.length === 1);
    expect(client.keys).toEqual(new Set(["provider-key-1"]));
    browser.resolve({ type: "success", url: callback });
    const classification = {
      status: "ACTIVITY_STATUS_REQUIRES_ADDITIONAL_AUTH",
    } as const;
    const continuation = new ZeroXKeyError(
      "Synthetic pending continuation",
      ZeroXKeyErrorCodes.OAUTH_LOGIN_ERROR,
      classification,
    );
    completion.reject(continuation);
    await expect(pending).rejects.toBe(continuation);
    expect(continuation.code).toBe(ZeroXKeyErrorCodes.OAUTH_LOGIN_ERROR);
    expect(continuation.cause).toBe(classification);
    await waitFor(() => reported.length >= 2);
    expect(reported[0]).toBe(continuation);
    expect(reported[1]).toEqual(
      expect.objectContaining({
        code: ZeroXKeyErrorCodes.OAUTH_SIGNUP_ERROR,
        message: "Failed to handle OAuth callback",
      }),
    );
    expect(client.keys).toEqual(new Set(["provider-key-1"]));
    expect(client.discardUncommittedApiKeyPair).not.toHaveBeenCalled();
  });

  it.each([
    [
      "synchronous throw",
      () => {
        throw new Error("reporter throw");
      },
    ],
    ["rejected Promise", () => Promise.reject(new Error("reporter reject"))],
  ])(
    "contains a %s from cleanup-failure notification",
    async (_kind, report) => {
      reset();
      const reporter = jest.fn(report);
      const callbacks = { onError: reporter } as unknown as ZeroXKeyCallbacks;
      let discardAttempts = 0;
      const { harness, client } = await mountReady(baseConfig(), callbacks, {
        init: Promise.resolve(),
        discard: async () => {
          discardAttempts += 1;
          if (discardAttempts <= 2) throw new Error("key deletion failed");
        },
      });
      mockOpenAuth.mockImplementationOnce(async () => ({ type: "cancel" }));
      await expect(harness.context.handleGoogleOauth()).rejects.toThrow(
        "OAuth browser cancelled",
      );
      expect(client.keys).toEqual(new Set(["provider-key-1"]));

      harness.renderOnly(baseConfig(), { ...callbacks });
      await harness.runEffects();
      await waitFor(() => reporter.mock.calls.length === 1);
      expect(reporter).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Failed to clean up OAuth resources",
        }),
      );
      harness.renderOnly(baseConfig(), { ...callbacks });
      await harness.runEffects();
      await waitFor(() => client.keys.size === 0);
    },
  );
});

describe("OAuth cold recovery through the actual Provider", () => {
  it("resumes an exact configured binding and retains unmatched override/category/disabled records", async () => {
    reset();
    const exact = await seedCold({
      provider: OAuthProviders.X,
      clientId: "x-client",
      redirectUri: "example://x/cb",
      verifier: "exact-verifier",
    });
    const redirects: unknown[] = [];
    const errors: unknown[] = [];
    mockInitialURL = Promise.resolve(exact.callback);
    const { client } = await mountReady(
      baseConfig(),
      {
        onOauthRedirect: (value) => redirects.push(value),
        onError: (error) => errors.push(error),
      },
      { init: Promise.resolve(), keys: new Set([exact.publicKey]) },
    );
    await waitFor(() => redirects.length === 1 || errors.length > 0);
    expect(errors).toEqual([]);
    expect(client.httpClient.proxyOAuth2Authenticate).toHaveBeenCalledWith({
      provider: "OAUTH2_PROVIDER_X",
      authCode: "cold-code",
      redirectUri: "example://x/cb",
      codeVerifier: "exact-verifier",
      clientId: "x-client",
      nonce: bytesToHex(sha256(exact.publicKey)),
    });
    expect(redirects).toEqual([
      { idToken: "proxy-token", publicKey: exact.publicKey },
    ]);
    expect(client.createApiKeyPair).not.toHaveBeenCalled();
    expect(client.keys).toEqual(new Set([exact.publicKey]));
    expect(mockKeychain.size).toBe(0);

    reset();
    const override = await seedCold({
      provider: OAuthProviders.X,
      clientId: "per-call-only",
      redirectUri: "example://x/cb",
      verifier: "override-verifier",
    });
    mockInitialURL = Promise.resolve(override.callback);
    const unmatchedResults: unknown[] = [];
    const readsBeforeUnmatched = mockKeychainCalls.get;
    const unmatched = await mountReady(
      baseConfig(),
      { onOauthRedirect: (value) => unmatchedResults.push(value) },
      {
        init: Promise.resolve(),
        keys: new Set([override.publicKey]),
      },
    );
    await waitFor(() => mockKeychainCalls.get > readsBeforeUnmatched);
    await Promise.resolve();
    expect(unmatchedResults).toEqual([]);
    expect(mockKeychain.size).toBe(1);
    expect(unmatched.client.keys.has(override.publicKey)).toBe(true);

    unmatched.harness.unmount();
    const exactOverrideResults: Array<{ idToken: string; publicKey: string }> =
      [];
    const exactOverrideConfig = baseConfig({
      auth: {
        ...baseConfig().auth,
        oauth: {
          ...baseConfig().auth?.oauth,
          x: {
            primaryClientId: "per-call-only",
            redirectUri: "example://x/cb",
          },
        },
      },
    });
    mockInitialURL = Promise.resolve(override.callback);
    const exactOverride = await mountReady(
      exactOverrideConfig,
      { onOauthRedirect: (value) => exactOverrideResults.push(value) },
      {
        init: Promise.resolve(),
        keys: new Set([override.publicKey]),
      },
    );
    await waitFor(() => exactOverrideResults.length === 1);
    expect(
      exactOverride.client.httpClient.proxyOAuth2Authenticate,
    ).toHaveBeenCalledWith({
      provider: "OAUTH2_PROVIDER_X",
      authCode: "cold-code",
      redirectUri: "example://x/cb",
      codeVerifier: "override-verifier",
      clientId: "per-call-only",
      nonce: bytesToHex(sha256(override.publicKey)),
    });
    expect(exactOverrideResults).toEqual([
      { idToken: "proxy-token", publicKey: override.publicKey },
    ]);
    expect(exactOverride.client.createApiKeyPair).not.toHaveBeenCalled();
    expect(exactOverride.client.keys).toEqual(new Set([override.publicKey]));
    expect(mockKeychain.size).toBe(0);

    reset();
    const category = await seedCold({
      provider: OAuthProviders.GOOGLE,
      clientId: "google-client",
      redirectUri: "https://oauth.example/callback?static=%2Fkeep",
      completion: "onOauthRedirect",
    });
    mockInitialURL = Promise.resolve(category.callback);
    const readsBeforeCategory = mockKeychainCalls.get;
    const absent = await mountReady(baseConfig(), undefined, {
      init: Promise.resolve(),
      keys: new Set([category.publicKey]),
    });
    await waitFor(() => mockKeychainCalls.get > readsBeforeCategory);
    await Promise.resolve();
    expect(mockKeychain.size).toBe(1);
    expect(absent.client.completeOauth).not.toHaveBeenCalled();

    absent.harness.unmount();
    const reinstatedResults: Array<{ idToken: string; publicKey: string }> = [];
    mockInitialURL = Promise.resolve(category.callback);
    const reinstated = await mountReady(
      baseConfig(),
      { onOauthRedirect: (value) => reinstatedResults.push(value) },
      { init: Promise.resolve(), keys: new Set([category.publicKey]) },
    );
    await waitFor(() => reinstatedResults.length === 1);
    expect(reinstatedResults).toEqual([
      { idToken: "cold-token", publicKey: category.publicKey },
    ]);
    expect(reinstated.client.createApiKeyPair).not.toHaveBeenCalled();
    expect(reinstated.client.keys).toEqual(new Set([category.publicKey]));
    expect(mockKeychain.size).toBe(0);

    reset();
    const disabled = await seedCold({
      provider: OAuthProviders.GOOGLE,
      clientId: "google-client",
      redirectUri: "https://oauth.example/callback?static=%2Fkeep",
    });
    mockInitialURL = Promise.resolve(disabled.callback);
    const readsBeforeDisabled = mockKeychainCalls.get;
    const disabledConfig = baseConfig({
      auth: {
        ...baseConfig().auth,
        oauth: { ...baseConfig().auth?.oauth, google: false },
      },
    });
    const ignored = await mountReady(
      disabledConfig,
      {
        onOauthRedirect: jest.fn(),
      },
      {
        init: Promise.resolve(),
        keys: new Set([disabled.publicKey]),
      },
    );
    await waitFor(() => mockKeychainCalls.get > readsBeforeDisabled);
    await Promise.resolve();
    expect(mockKeychain.size).toBe(1);
    expect(ignored.client.keys.has(disabled.publicKey)).toBe(true);

    reset();
    const foreign = await seedCold({
      provider: OAuthProviders.GOOGLE,
      clientId: "google-client",
      redirectUri: "https://oauth.example/callback?static=%2Fkeep",
      organizationId: "foreign-organization",
    });
    mockInitialURL = Promise.resolve(foreign.callback);
    const foreignResults: unknown[] = [];
    const readsBeforeForeign = mockKeychainCalls.get;
    const foreignMount = await mountReady(
      baseConfig(),
      { onOauthRedirect: (value) => foreignResults.push(value) },
      {
        init: Promise.resolve(),
        keys: new Set([foreign.publicKey]),
      },
    );
    await waitFor(() => mockKeychainCalls.get > readsBeforeForeign);
    await Promise.resolve();
    expect(foreignResults).toEqual([]);
    expect(mockKeychain.size).toBe(1);
    expect(foreignMount.client.keys.has(foreign.publicKey)).toBe(true);
    expect(foreignMount.client.completeOauth).not.toHaveBeenCalled();
  });
});
