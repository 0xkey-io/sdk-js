/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://app.example.test/"}
 */
import "fake-indexeddb/auto";
import { describe, expect, it, jest } from "@jest/globals";
import { OAuthProviders } from "@0xkey-io/sdk-types";
import { act } from "react";
import type { ZeroXKeyClient, ZeroXKeyProviderConfig } from "../index";
import { getPKCEVerifierKey } from "../utils/oauth/storage";
import {
  createOAuthTransactionStore,
  OAUTH_TRANSACTION_DATABASE_NAME,
} from "../utils/oauth/transaction-store";
import {
  setupProviderDom,
  type MountedProvider,
} from "./fixtures/provider-dom";

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

const redirectUri = "https://app.example.test/oauth/callback";
const publicKey = `02${"ab".repeat(32)}`;
let mockInitDeferred: Deferred<void>;
let mockActiveSessionDeferred: Deferred<string | undefined>;
const navigations: string[] = [];
const proxyCalls: Array<{ codeVerifier: string }> = [];
const facebookExchanges: string[] = [];

jest.mock("../utils/oauth", () => {
  const actual =
    jest.requireActual<typeof import("../utils/oauth")>("../utils/oauth");
  return {
    ...actual,
    redirectToOAuthProvider(url: string): Promise<never> {
      navigations.push(url);
      return new Promise(() => {});
    },
    async exchangeFacebookCodeForToken(
      _clientId: string,
      _redirectUri: string,
      _code: string,
      codeVerifier: string,
    ): Promise<{ id_token: string }> {
      facebookExchanges.push(codeVerifier);
      return { id_token: "synthetic-facebook-token" };
    },
  };
});

const mockZeroXKeyClient = jest.fn((config: unknown) => {
  const constructorConfig = config as ZeroXKeyProviderConfig;
  let initialized = false;
  const httpClient = {
    config: {
      organizationId: constructorConfig.organizationId,
      apiBaseUrl: constructorConfig.apiBaseUrl ?? "https://api.0xkey.io",
      authProxyUrl:
        constructorConfig.authProxyUrl ?? "https://authproxy.0xkey.io",
      authProxyConfigId: constructorConfig.authProxyConfigId,
    },
  };
  return {
    config: constructorConfig,
    async init() {
      await mockInitDeferred.promise;
      initialized = true;
    },
    restrictPersistedCredentialsToNewSessions: () => undefined,
    setAuthContextGuard: () => undefined,
    getAllSessions: async () => ({}),
    getActiveSessionKey: () => mockActiveSessionDeferred.promise,
    async createApiKeyPair() {
      return publicKey;
    },
    get httpClient() {
      if (!initialized) throw new Error("Synthetic client is not initialized");
      return {
        ...httpClient,
        async proxyOAuth2Authenticate(params: { codeVerifier: string }) {
          proxyCalls.push({ codeVerifier: params.codeVerifier });
          return { oidcToken: "synthetic-discord-token" };
        },
      };
    },
  } as unknown as ZeroXKeyClient;
});

jest.mock("@0xkey-io/core", () => {
  const actual =
    jest.requireActual<typeof import("@0xkey-io/core")>("@0xkey-io/core");
  return {
    ...actual,
    ZeroXKeyClient: mockZeroXKeyClient,
  };
});

const config: ZeroXKeyProviderConfig = {
  organizationId: "org-oauth",
  apiBaseUrl: "https://api.example.test",
  authProxyUrl: "https://auth.example.test",
  autoFetchWalletKitConfig: false,
  autoRefreshManagedState: false,
  auth: {
    methods: { walletAuthEnabled: false },
    autoRefreshSession: false,
    oauthConfig: {
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

function redirectBinding(input?: {
  organizationId?: string;
  provider?: "discord" | "x" | "facebook" | "google" | "apple";
  clientId?: string;
}) {
  return {
    organizationId: input?.organizationId ?? "org-oauth",
    configId: null,
    apiBaseUrl: "https://api.example.test/",
    authProxyUrl: "https://auth.example.test/",
    provider: input?.provider ?? ("discord" as const),
    clientId: input?.clientId ?? "discord-A",
    redirectUri,
    route: {
      origin: "https://app.example.test",
      pathname: "/oauth/callback",
      staticQuery: [] as Array<[string, string]>,
    },
    completion: { kind: "redirect" as const },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      const schedule = new (Node.constructor as FunctionConstructor)(
        "return setImmediate",
      )() as (callback: () => void) => void;
      schedule(() => resolve());
    });
  });
}

describe("full-page OAuth redirect transactions", () => {
  it("persists a Discord login the shared verifier slot cannot see", async () => {
    mockInitDeferred = deferred<void>();
    mockActiveSessionDeferred = deferred<string | undefined>();
    navigations.length = 0;
    if (typeof globalThis.structuredClone !== "function") {
      globalThis.structuredClone = <T,>(value: T): T =>
        JSON.parse(JSON.stringify(value)) as T;
    }
    const dom = setupProviderDom();
    let mounted: MountedProvider | undefined;
    const verifierKey = getPKCEVerifierKey(OAuthProviders.DISCORD);
    try {
      const { ClientState } = dom.loadPublicExports();
      mounted = await dom.mount(config);
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (mounted.context()?.clientState === ClientState.Ready) break;
        await flush();
      }
      expect(mounted.context()?.clientState).toBe(ClientState.Ready);

      let settled: "pending" | "resolved" | unknown = "pending";
      const pending = mounted.context()!.handleDiscordOauth({
        openInPage: true,
      });
      void pending.then(
        () => {
          settled = "resolved";
        },
        (error: unknown) => {
          settled = error;
        },
      );
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (
          localStorage.getItem(verifierKey) !== null ||
          navigations.length > 0 ||
          settled !== "pending"
        )
          break;
        await flush();
      }

      expect(localStorage.getItem(verifierKey)).toBeNull();
      expect(navigations).toHaveLength(1);
      const authUrl = new URL(navigations[0]!);
      expect(authUrl.searchParams.has("transactionId")).toBe(false);
      expect(authUrl.hash).toBe("");
      expect(authUrl.searchParams.has("code_verifier")).toBe(false);
      const state = authUrl.searchParams.get("state");
      expect(state).toEqual(expect.any(String));
      expect(state).not.toContain("captcha");
      expect(authUrl.toString().toLowerCase()).not.toContain("captcha");

      await import("fake-indexeddb/auto");
      const store = createOAuthTransactionStore({
        databaseName: OAUTH_TRANSACTION_DATABASE_NAME,
        now: () => Date.now(),
        randomBytes: () => crypto.getRandomValues(new Uint8Array(16)),
        async discardFreshKey() {},
      });
      const claimed = await store.claimReturned({
        returnedState: state!,
        binding: redirectBinding(),
      });
      expect(claimed.verifier).toEqual(expect.any(String));
      expect(claimed.verifier!.length).toBeGreaterThan(0);
      expect(claimed.keyRef).toBe(publicKey);
      expect(claimed.binding.completion).toEqual({ kind: "redirect" });
      expect(authUrl.toString()).not.toContain(claimed.verifier!);
      await expect(
        store.claimReturned({
          returnedState: state!,
          binding: redirectBinding(),
        }),
      ).rejects.toMatchObject({ reason: "unavailable" });
    } finally {
      jest.clearAllTimers();
      if (mounted) await dom.unmount(mounted);
      await dom.restore();
    }
  });

  it("exchanges a Discord return with the stored verifier instead of the shared slot", async () => {
    mockInitDeferred = deferred<void>();
    mockActiveSessionDeferred = deferred<string | undefined>();
    navigations.length = 0;
    proxyCalls.length = 0;
    if (typeof globalThis.structuredClone !== "function") {
      globalThis.structuredClone = <T,>(value: T): T =>
        JSON.parse(JSON.stringify(value)) as T;
    }
    const dom = setupProviderDom();
    let mounted: MountedProvider | undefined;
    const verifierKey = getPKCEVerifierKey(OAuthProviders.DISCORD);
    try {
      const { ClientState } = dom.loadPublicExports();
      mounted = await dom.mount(config);
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (mounted.context()?.clientState === ClientState.Ready) break;
        await flush();
      }
      expect(mounted.context()?.clientState).toBe(ClientState.Ready);

      const pending = mounted.context()!.handleDiscordOauth({
        openInPage: true,
      });
      void pending.catch(() => undefined);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (navigations.length > 0) break;
        await flush();
      }
      expect(navigations).toHaveLength(1);
      const state = new URL(navigations[0]!).searchParams.get("state");
      expect(state).toEqual(expect.any(String));

      const storedVerifier = await readStoredVerifier(state!);
      expect(storedVerifier).not.toBe("decoy-verifier");

      await dom.unmount(mounted);
      mounted = undefined;
      localStorage.setItem(verifierKey, "decoy-verifier");
      window.history.replaceState(
        null,
        document.title,
        `/oauth/callback?${new URLSearchParams({
          code: "synthetic-discord-code",
          state: state!,
        }).toString()}`,
      );

      mockInitDeferred = deferred<void>();
      mockActiveSessionDeferred = deferred<string | undefined>();
      proxyCalls.length = 0;
      const onOauthRedirect = jest.fn();
      mounted = await dom.mount(config, {
        onOauthRedirect,
        onError: jest.fn(),
      });
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (
          mounted.context()?.clientState === ClientState.Ready ||
          proxyCalls.length > 0
        )
          break;
        await flush();
      }

      expect(proxyCalls).toHaveLength(1);
      expect(proxyCalls[0]?.codeVerifier).toBe(storedVerifier);
      expect(window.location.search).not.toContain(storedVerifier);
      expect(window.location.hash).not.toContain("captcha");
      const store = createOAuthTransactionStore({
        databaseName: OAUTH_TRANSACTION_DATABASE_NAME,
        now: () => Date.now(),
        randomBytes: () => crypto.getRandomValues(new Uint8Array(16)),
        async discardFreshKey() {},
      });
      await expect(
        store.claimReturned({
          returnedState: state!,
          binding: redirectBinding(),
        }),
      ).rejects.toMatchObject({ reason: "unavailable" });
    } finally {
      jest.clearAllTimers();
      if (mounted) await dom.unmount(mounted);
      await dom.restore();
    }
  });

  it("does not exchange a Discord return whose state does not match the stored login", async () => {
    mockInitDeferred = deferred<void>();
    mockActiveSessionDeferred = deferred<string | undefined>();
    navigations.length = 0;
    proxyCalls.length = 0;
    if (typeof globalThis.structuredClone !== "function") {
      globalThis.structuredClone = <T,>(value: T): T =>
        JSON.parse(JSON.stringify(value)) as T;
    }
    const dom = setupProviderDom();
    let mounted: MountedProvider | undefined;
    const verifierKey = getPKCEVerifierKey(OAuthProviders.DISCORD);
    try {
      const { ClientState } = dom.loadPublicExports();
      mounted = await dom.mount(config);
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (mounted.context()?.clientState === ClientState.Ready) break;
        await flush();
      }
      expect(mounted.context()?.clientState).toBe(ClientState.Ready);

      const pending = mounted.context()!.handleDiscordOauth({
        openInPage: true,
      });
      void pending.catch(() => undefined);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (navigations.length > 0) break;
        await flush();
      }
      expect(navigations).toHaveLength(1);
      const state = new URL(navigations[0]!).searchParams.get("state");
      expect(state).toEqual(expect.any(String));
      const forgedState = state!.replace(
        /nonce=[^&]+/,
        "nonce=forged-nonce-value",
      );
      expect(forgedState).not.toBe(state);

      await dom.unmount(mounted);
      mounted = undefined;
      localStorage.setItem(verifierKey, "decoy-verifier");
      window.history.replaceState(
        null,
        document.title,
        `/oauth/callback?${new URLSearchParams({
          code: "synthetic-discord-code",
          state: forgedState,
        }).toString()}`,
      );

      mockInitDeferred = deferred<void>();
      mockActiveSessionDeferred = deferred<string | undefined>();
      proxyCalls.length = 0;
      mounted = await dom.mount(config, { onError: jest.fn() });
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (mounted.context()?.clientState === ClientState.Ready) break;
        await flush();
      }
      expect(mounted.context()?.clientState).toBe(ClientState.Ready);
      expect(proxyCalls).toHaveLength(0);

      const store = createOAuthTransactionStore({
        databaseName: OAUTH_TRANSACTION_DATABASE_NAME,
        now: () => Date.now(),
        randomBytes: () => crypto.getRandomValues(new Uint8Array(16)),
        async discardFreshKey() {},
      });
      const claimed = await store.claimReturned({
        returnedState: state!,
        binding: redirectBinding(),
      });
      expect(claimed.verifier).toEqual(expect.any(String));
      expect(claimed.verifier).not.toBe("decoy-verifier");
    } finally {
      jest.clearAllTimers();
      if (mounted) await dom.unmount(mounted);
      await dom.restore();
    }
  });

  it("does not exchange a Discord return after the organization changes", async () => {
    mockInitDeferred = deferred<void>();
    mockActiveSessionDeferred = deferred<string | undefined>();
    navigations.length = 0;
    proxyCalls.length = 0;
    ensureStructuredClone();
    const dom = setupProviderDom();
    let mounted: MountedProvider | undefined;
    const verifierKey = getPKCEVerifierKey(OAuthProviders.DISCORD);
    try {
      const { ClientState } = dom.loadPublicExports();
      mounted = await dom.mount(config);
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (mounted.context()?.clientState === ClientState.Ready) break;
        await flush();
      }
      expect(mounted.context()?.clientState).toBe(ClientState.Ready);
      const pending = mounted.context()!.handleDiscordOauth({
        openInPage: true,
      });
      void pending.catch(() => undefined);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (navigations.length > 0) break;
        await flush();
      }
      const state = new URL(navigations[0]!).searchParams.get("state");
      expect(state).toEqual(expect.any(String));
      await dom.unmount(mounted);
      mounted = undefined;
      localStorage.setItem(verifierKey, "decoy-verifier");
      window.history.replaceState(
        null,
        document.title,
        `/oauth/callback?${new URLSearchParams({
          code: "synthetic-discord-code",
          state: state!,
        }).toString()}`,
      );
      mockInitDeferred = deferred<void>();
      mockActiveSessionDeferred = deferred<string | undefined>();
      proxyCalls.length = 0;
      mounted = await dom.mount(
        { ...config, organizationId: "org-other" },
        { onError: jest.fn() },
      );
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (mounted.context()?.clientState === ClientState.Ready) break;
        await flush();
      }
      expect(mounted.context()?.clientState).toBe(ClientState.Ready);
      expect(proxyCalls).toHaveLength(0);
      const store = createOAuthTransactionStore({
        databaseName: OAUTH_TRANSACTION_DATABASE_NAME,
        now: () => Date.now(),
        randomBytes: () => crypto.getRandomValues(new Uint8Array(16)),
        async discardFreshKey() {},
      });
      const claimed = await store.claimReturned({
        returnedState: state!,
        binding: redirectBinding(),
      });
      expect(claimed.verifier).not.toBe("decoy-verifier");
    } finally {
      jest.clearAllTimers();
      if (mounted) await dom.unmount(mounted);
      await dom.restore();
    }
  });

  it("persists an X login the shared verifier slot cannot see", async () => {
    mockInitDeferred = deferred<void>();
    mockActiveSessionDeferred = deferred<string | undefined>();
    navigations.length = 0;
    ensureStructuredClone();
    const dom = setupProviderDom();
    let mounted: MountedProvider | undefined;
    const verifierKey = getPKCEVerifierKey(OAuthProviders.X);
    const xConfig: ZeroXKeyProviderConfig = {
      ...config,
      auth: {
        ...config.auth,
        oauthConfig: {
          xClientId: "x-A",
          oauthRedirectUri: redirectUri,
        },
      },
    };
    try {
      const { ClientState } = dom.loadPublicExports();
      mounted = await dom.mount(xConfig);
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (mounted.context()?.clientState === ClientState.Ready) break;
        await flush();
      }
      expect(mounted.context()?.clientState).toBe(ClientState.Ready);
      const pending = mounted.context()!.handleXOauth({ openInPage: true });
      void pending.catch(() => undefined);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (
          localStorage.getItem(verifierKey) !== null ||
          navigations.length > 0
        )
          break;
        await flush();
      }
      expect(localStorage.getItem(verifierKey)).toBeNull();
      expect(navigations).toHaveLength(1);
      const authUrl = new URL(navigations[0]!);
      expect(authUrl.searchParams.has("transactionId")).toBe(false);
      expect(authUrl.hash).toBe("");
      expect(authUrl.searchParams.has("code_verifier")).toBe(false);
      const state = authUrl.searchParams.get("state");
      expect(state).toEqual(expect.any(String));
      expect(authUrl.toString().toLowerCase()).not.toContain("captcha");
      const store = createOAuthTransactionStore({
        databaseName: OAUTH_TRANSACTION_DATABASE_NAME,
        now: () => Date.now(),
        randomBytes: () => crypto.getRandomValues(new Uint8Array(16)),
        async discardFreshKey() {},
      });
      const claimed = await store.claimReturned({
        returnedState: state!,
        binding: redirectBinding({ provider: "x", clientId: "x-A" }),
      });
      expect(claimed.verifier).toEqual(expect.any(String));
      expect(claimed.keyRef).toBe(publicKey);
      expect(authUrl.toString()).not.toContain(claimed.verifier!);
    } finally {
      jest.clearAllTimers();
      if (mounted) await dom.unmount(mounted);
      await dom.restore();
    }
  });

  it("persists a Facebook login the shared verifier slot cannot see", async () => {
    mockInitDeferred = deferred<void>();
    mockActiveSessionDeferred = deferred<string | undefined>();
    navigations.length = 0;
    ensureStructuredClone();
    const dom = setupProviderDom();
    let mounted: MountedProvider | undefined;
    const verifierKey = getPKCEVerifierKey(OAuthProviders.FACEBOOK);
    const facebookConfig: ZeroXKeyProviderConfig = {
      ...config,
      auth: {
        ...config.auth,
        oauthConfig: {
          facebookClientId: "facebook-A",
          oauthRedirectUri: redirectUri,
        },
      },
    };
    try {
      const { ClientState } = dom.loadPublicExports();
      mounted = await dom.mount(facebookConfig);
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (mounted.context()?.clientState === ClientState.Ready) break;
        await flush();
      }
      expect(mounted.context()?.clientState).toBe(ClientState.Ready);
      const pending = mounted.context()!.handleFacebookOauth({
        openInPage: true,
      });
      void pending.catch(() => undefined);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (
          localStorage.getItem(verifierKey) !== null ||
          navigations.length > 0
        )
          break;
        await flush();
      }
      expect(localStorage.getItem(verifierKey)).toBeNull();
      expect(navigations).toHaveLength(1);
      const authUrl = new URL(navigations[0]!);
      expect(authUrl.searchParams.has("transactionId")).toBe(false);
      expect(authUrl.hash).toBe("");
      expect(authUrl.searchParams.has("code_verifier")).toBe(false);
      const state = authUrl.searchParams.get("state");
      expect(state).toEqual(expect.any(String));
      expect(authUrl.toString().toLowerCase()).not.toContain("captcha");
      const store = createOAuthTransactionStore({
        databaseName: OAUTH_TRANSACTION_DATABASE_NAME,
        now: () => Date.now(),
        randomBytes: () => crypto.getRandomValues(new Uint8Array(16)),
        async discardFreshKey() {},
      });
      const claimed = await store.claimReturned({
        returnedState: state!,
        binding: redirectBinding({
          provider: "facebook",
          clientId: "facebook-A",
        }),
      });
      expect(claimed.verifier).toEqual(expect.any(String));
      expect(claimed.keyRef).toBe(publicKey);
      expect(authUrl.toString()).not.toContain(claimed.verifier!);
    } finally {
      jest.clearAllTimers();
      if (mounted) await dom.unmount(mounted);
      await dom.restore();
    }
  });

  it("persists a Google login without a verifier", async () => {
    mockInitDeferred = deferred<void>();
    mockActiveSessionDeferred = deferred<string | undefined>();
    navigations.length = 0;
    ensureStructuredClone();
    const dom = setupProviderDom();
    let mounted: MountedProvider | undefined;
    const googleConfig: ZeroXKeyProviderConfig = {
      ...config,
      auth: {
        ...config.auth,
        oauthConfig: {
          googleClientId: "google-A",
          oauthRedirectUri: redirectUri,
        },
      },
    };
    try {
      const { ClientState } = dom.loadPublicExports();
      mounted = await dom.mount(googleConfig);
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (mounted.context()?.clientState === ClientState.Ready) break;
        await flush();
      }
      expect(mounted.context()?.clientState).toBe(ClientState.Ready);
      const pending = mounted
        .context()!
        .handleGoogleOauth({ openInPage: true });
      void pending.catch(() => undefined);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (navigations.length > 0) break;
        await flush();
      }
      expect(navigations).toHaveLength(1);
      const authUrl = new URL(navigations[0]!);
      expect(authUrl.searchParams.has("transactionId")).toBe(false);
      expect(authUrl.hash).toBe("");
      expect(authUrl.searchParams.has("code_verifier")).toBe(false);
      const state = authUrl.searchParams.get("state");
      expect(state).toEqual(expect.any(String));
      expect(authUrl.toString().toLowerCase()).not.toContain("captcha");
      const store = createOAuthTransactionStore({
        databaseName: OAUTH_TRANSACTION_DATABASE_NAME,
        now: () => Date.now(),
        randomBytes: () => crypto.getRandomValues(new Uint8Array(16)),
        async discardFreshKey() {},
      });
      const claimed = await store.claimReturned({
        returnedState: state!,
        binding: redirectBinding({ provider: "google", clientId: "google-A" }),
      });
      expect(claimed.verifier).toBeNull();
      expect(claimed.keyRef).toBe(publicKey);
    } finally {
      jest.clearAllTimers();
      if (mounted) await dom.unmount(mounted);
      await dom.restore();
    }
  });

  it("persists an Apple login without a verifier", async () => {
    mockInitDeferred = deferred<void>();
    mockActiveSessionDeferred = deferred<string | undefined>();
    navigations.length = 0;
    ensureStructuredClone();
    const dom = setupProviderDom();
    let mounted: MountedProvider | undefined;
    const appleConfig: ZeroXKeyProviderConfig = {
      ...config,
      auth: {
        ...config.auth,
        oauthConfig: {
          appleClientId: "apple-A",
          oauthRedirectUri: redirectUri,
        },
      },
    };
    try {
      const { ClientState } = dom.loadPublicExports();
      mounted = await dom.mount(appleConfig);
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (mounted.context()?.clientState === ClientState.Ready) break;
        await flush();
      }
      expect(mounted.context()?.clientState).toBe(ClientState.Ready);
      const pending = mounted.context()!.handleAppleOauth({ openInPage: true });
      void pending.catch(() => undefined);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (navigations.length > 0) break;
        await flush();
      }
      expect(navigations).toHaveLength(1);
      const authUrl = new URL(navigations[0]!);
      expect(authUrl.searchParams.has("transactionId")).toBe(false);
      expect(authUrl.hash).toBe("");
      expect(authUrl.searchParams.has("code_verifier")).toBe(false);
      const state = authUrl.searchParams.get("state");
      expect(state).toEqual(expect.any(String));
      expect(authUrl.toString().toLowerCase()).not.toContain("captcha");
      const store = createOAuthTransactionStore({
        databaseName: OAUTH_TRANSACTION_DATABASE_NAME,
        now: () => Date.now(),
        randomBytes: () => crypto.getRandomValues(new Uint8Array(16)),
        async discardFreshKey() {},
      });
      const claimed = await store.claimReturned({
        returnedState: state!,
        binding: redirectBinding({ provider: "apple", clientId: "apple-A" }),
      });
      expect(claimed.verifier).toBeNull();
      expect(claimed.keyRef).toBe(publicKey);
    } finally {
      jest.clearAllTimers();
      if (mounted) await dom.unmount(mounted);
      await dom.restore();
    }
  });

  it("exchanges an X return with the stored verifier instead of the shared slot", async () => {
    mockInitDeferred = deferred<void>();
    mockActiveSessionDeferred = deferred<string | undefined>();
    navigations.length = 0;
    proxyCalls.length = 0;
    ensureStructuredClone();
    const dom = setupProviderDom();
    let mounted: MountedProvider | undefined;
    const verifierKey = getPKCEVerifierKey(OAuthProviders.X);
    const xConfig: ZeroXKeyProviderConfig = {
      ...config,
      auth: {
        ...config.auth,
        oauthConfig: {
          xClientId: "x-A",
          oauthRedirectUri: redirectUri,
        },
      },
    };
    try {
      const { ClientState } = dom.loadPublicExports();
      mounted = await dom.mount(xConfig);
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (mounted.context()?.clientState === ClientState.Ready) break;
        await flush();
      }
      expect(mounted.context()?.clientState).toBe(ClientState.Ready);
      const pending = mounted.context()!.handleXOauth({ openInPage: true });
      void pending.catch(() => undefined);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (navigations.length > 0) break;
        await flush();
      }
      const state = new URL(navigations[0]!).searchParams.get("state");
      expect(state).toEqual(expect.any(String));
      const storedVerifier = await readStoredVerifier(state!);
      await dom.unmount(mounted);
      mounted = undefined;
      localStorage.setItem(verifierKey, "decoy-verifier");
      window.history.replaceState(
        null,
        document.title,
        `/oauth/callback?${new URLSearchParams({
          code: "synthetic-x-code",
          state: state!,
        }).toString()}`,
      );
      mockInitDeferred = deferred<void>();
      mockActiveSessionDeferred = deferred<string | undefined>();
      proxyCalls.length = 0;
      mounted = await dom.mount(xConfig, {
        onOauthRedirect: jest.fn(),
        onError: jest.fn(),
      });
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (
          mounted.context()?.clientState === ClientState.Ready ||
          proxyCalls.length > 0
        )
          break;
        await flush();
      }
      expect(proxyCalls).toHaveLength(1);
      expect(proxyCalls[0]?.codeVerifier).toBe(storedVerifier);
      const store = createOAuthTransactionStore({
        databaseName: OAUTH_TRANSACTION_DATABASE_NAME,
        now: () => Date.now(),
        randomBytes: () => crypto.getRandomValues(new Uint8Array(16)),
        async discardFreshKey() {},
      });
      await expect(
        store.claimReturned({
          returnedState: state!,
          binding: redirectBinding({ provider: "x", clientId: "x-A" }),
        }),
      ).rejects.toMatchObject({ reason: "unavailable" });
    } finally {
      jest.clearAllTimers();
      if (mounted) await dom.unmount(mounted);
      await dom.restore();
    }
  });

  it("exchanges a Facebook return with the stored verifier instead of the shared slot", async () => {
    mockInitDeferred = deferred<void>();
    mockActiveSessionDeferred = deferred<string | undefined>();
    navigations.length = 0;
    facebookExchanges.length = 0;
    ensureStructuredClone();
    const dom = setupProviderDom();
    let mounted: MountedProvider | undefined;
    const verifierKey = getPKCEVerifierKey(OAuthProviders.FACEBOOK);
    const facebookConfig: ZeroXKeyProviderConfig = {
      ...config,
      auth: {
        ...config.auth,
        oauthConfig: {
          facebookClientId: "facebook-A",
          oauthRedirectUri: redirectUri,
        },
      },
    };
    try {
      const { ClientState } = dom.loadPublicExports();
      mounted = await dom.mount(facebookConfig);
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (mounted.context()?.clientState === ClientState.Ready) break;
        await flush();
      }
      expect(mounted.context()?.clientState).toBe(ClientState.Ready);
      const pending = mounted.context()!.handleFacebookOauth({
        openInPage: true,
      });
      void pending.catch(() => undefined);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (navigations.length > 0) break;
        await flush();
      }
      const state = new URL(navigations[0]!).searchParams.get("state");
      expect(state).toEqual(expect.any(String));
      const storedVerifier = await readStoredVerifier(state!);
      await dom.unmount(mounted);
      mounted = undefined;
      localStorage.setItem(verifierKey, "decoy-verifier");
      window.history.replaceState(
        null,
        document.title,
        `/oauth/callback?${new URLSearchParams({
          code: "synthetic-facebook-code",
          state: state!,
        }).toString()}`,
      );
      mockInitDeferred = deferred<void>();
      mockActiveSessionDeferred = deferred<string | undefined>();
      facebookExchanges.length = 0;
      mounted = await dom.mount(facebookConfig, {
        onOauthRedirect: jest.fn(),
        onError: jest.fn(),
      });
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (
          mounted.context()?.clientState === ClientState.Ready ||
          facebookExchanges.length > 0
        )
          break;
        await flush();
      }
      expect(facebookExchanges).toEqual([storedVerifier]);
      const store = createOAuthTransactionStore({
        databaseName: OAUTH_TRANSACTION_DATABASE_NAME,
        now: () => Date.now(),
        randomBytes: () => crypto.getRandomValues(new Uint8Array(16)),
        async discardFreshKey() {},
      });
      await expect(
        store.claimReturned({
          returnedState: state!,
          binding: redirectBinding({
            provider: "facebook",
            clientId: "facebook-A",
          }),
        }),
      ).rejects.toMatchObject({ reason: "unavailable" });
    } finally {
      jest.clearAllTimers();
      if (mounted) await dom.unmount(mounted);
      await dom.restore();
    }
  });

  it("completes a Google return only after claiming the stored login", async () => {
    mockInitDeferred = deferred<void>();
    mockActiveSessionDeferred = deferred<string | undefined>();
    navigations.length = 0;
    ensureStructuredClone();
    const dom = setupProviderDom();
    let mounted: MountedProvider | undefined;
    const googleConfig: ZeroXKeyProviderConfig = {
      ...config,
      auth: {
        ...config.auth,
        oauthConfig: {
          googleClientId: "google-A",
          oauthRedirectUri: redirectUri,
        },
      },
    };
    try {
      const { ClientState } = dom.loadPublicExports();
      mounted = await dom.mount(googleConfig);
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (mounted.context()?.clientState === ClientState.Ready) break;
        await flush();
      }
      const pending = mounted
        .context()!
        .handleGoogleOauth({ openInPage: true });
      void pending.catch(() => undefined);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (navigations.length > 0) break;
        await flush();
      }
      const state = new URL(navigations[0]!).searchParams.get("state");
      expect(state).toEqual(expect.any(String));
      await dom.unmount(mounted);
      mounted = undefined;
      window.history.replaceState(
        null,
        document.title,
        `/oauth/callback#${new URLSearchParams({
          id_token: "synthetic-google-token",
          state: state!,
        }).toString()}`,
      );
      mockInitDeferred = deferred<void>();
      mockActiveSessionDeferred = deferred<string | undefined>();
      const onOauthRedirect = jest.fn();
      mounted = await dom.mount(googleConfig, {
        onOauthRedirect,
        onError: jest.fn(),
      });
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (mounted.context()?.clientState === ClientState.Ready) break;
        await flush();
      }
      expect(mounted.context()?.clientState).toBe(ClientState.Ready);
      expect(onOauthRedirect).toHaveBeenCalledTimes(1);
      expect(onOauthRedirect).toHaveBeenCalledWith({
        idToken: "synthetic-google-token",
        publicKey,
      });
      const store = createOAuthTransactionStore({
        databaseName: OAUTH_TRANSACTION_DATABASE_NAME,
        now: () => Date.now(),
        randomBytes: () => crypto.getRandomValues(new Uint8Array(16)),
        async discardFreshKey() {},
      });
      await expect(
        store.claimReturned({
          returnedState: state!,
          binding: redirectBinding({
            provider: "google",
            clientId: "google-A",
          }),
        }),
      ).rejects.toMatchObject({ reason: "unavailable" });
    } finally {
      jest.clearAllTimers();
      if (mounted) await dom.unmount(mounted);
      await dom.restore();
    }
  });

  it("completes an Apple return only after claiming the stored login", async () => {
    mockInitDeferred = deferred<void>();
    mockActiveSessionDeferred = deferred<string | undefined>();
    navigations.length = 0;
    ensureStructuredClone();
    const dom = setupProviderDom();
    let mounted: MountedProvider | undefined;
    const appleConfig: ZeroXKeyProviderConfig = {
      ...config,
      auth: {
        ...config.auth,
        oauthConfig: {
          appleClientId: "apple-A",
          oauthRedirectUri: redirectUri,
        },
      },
    };
    try {
      const { ClientState } = dom.loadPublicExports();
      mounted = await dom.mount(appleConfig);
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (mounted.context()?.clientState === ClientState.Ready) break;
        await flush();
      }
      const pending = mounted.context()!.handleAppleOauth({ openInPage: true });
      void pending.catch(() => undefined);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (navigations.length > 0) break;
        await flush();
      }
      const state = new URL(navigations[0]!).searchParams.get("state");
      expect(state).toEqual(expect.any(String));
      expect(state).toContain("provider=apple");
      await dom.unmount(mounted);
      mounted = undefined;
      window.history.replaceState(
        null,
        document.title,
        `/oauth/callback#state=${state}&code=synthetic-apple-code&id_token=synthetic-apple-token`,
      );
      mockInitDeferred = deferred<void>();
      mockActiveSessionDeferred = deferred<string | undefined>();
      const onOauthRedirect = jest.fn();
      mounted = await dom.mount(appleConfig, {
        onOauthRedirect,
        onError: jest.fn(),
      });
      await act(async () => {
        mockInitDeferred.resolve();
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (mounted.context()?.clientState === ClientState.Ready) break;
        await flush();
      }
      expect(mounted.context()?.clientState).toBe(ClientState.Ready);
      expect(onOauthRedirect).toHaveBeenCalledTimes(1);
      expect(onOauthRedirect).toHaveBeenCalledWith({
        idToken: "synthetic-apple-token",
        publicKey,
      });
      const store = createOAuthTransactionStore({
        databaseName: OAUTH_TRANSACTION_DATABASE_NAME,
        now: () => Date.now(),
        randomBytes: () => crypto.getRandomValues(new Uint8Array(16)),
        async discardFreshKey() {},
      });
      await expect(
        store.claimReturned({
          returnedState: state!,
          binding: redirectBinding({ provider: "apple", clientId: "apple-A" }),
        }),
      ).rejects.toMatchObject({ reason: "unavailable" });
    } finally {
      jest.clearAllTimers();
      if (mounted) await dom.unmount(mounted);
      await dom.restore();
    }
  });
});

function ensureStructuredClone(): void {
  if (typeof globalThis.structuredClone !== "function") {
    globalThis.structuredClone = <T,>(value: T): T =>
      JSON.parse(JSON.stringify(value)) as T;
  }
}

function readStoredVerifier(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OAUTH_TRANSACTION_DATABASE_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("transactions", "readonly");
      const rows = transaction.objectStore("transactions").getAll();
      rows.onerror = () => reject(rows.error);
      rows.onsuccess = () => {
        database.close();
        const match = (
          rows.result as Array<{
            expectedState?: string;
            verifier?: string | null;
          }>
        ).find((row) => row.expectedState === expectedState);
        if (
          typeof match?.verifier !== "string" ||
          match.verifier.length === 0
        ) {
          reject(new Error("stored Discord verifier is missing"));
          return;
        }
        resolve(match.verifier);
      };
    };
  });
}
