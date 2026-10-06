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
import { Suspense, act, startTransition } from "react";
import { createRoot } from "react-dom/client";
import { SessionType, type Session } from "@0xkey-io/sdk-types";
import type { StorageBase, ZeroXKeySDKClientConfig } from "@0xkey-io/core";
import type { ZeroXKeyProviderConfig } from "../index";
import {
  setupProviderDom,
  type MountedProvider,
} from "./fixtures/provider-dom";

const defaultSessionKey = "@0xkey-io/session/v3";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function session(token: string, publicKey: string, valid = true): Session {
  return {
    sessionType: SessionType.READ_WRITE,
    userId: `user-${token}`,
    organizationId: `org-${token}`,
    expiry: Math.floor(Date.now() / 1000) + (valid ? 3600 : -3600),
    token,
    publicKey,
  };
}
const mockSession = session;

class SharedSessionStore implements StorageBase {
  sessions = new Map<string, Session>();
  active: string | undefined;
  keys = new Set<string>();
  blockedClearRead = deferred<void>();
  pauseClearRead = false;
  pauseReadAt = 2;
  clearReadStarted = false;
  sessionReads = 0;
  storeBOnInit = false;
  storeInvalidAOnInit = false;

  async getStorageValue(key: string) {
    return this.sessions.get(key);
  }
  async setStorageValue(key: string, value: Session) {
    this.sessions.set(key, value);
  }
  async setActiveSessionKey(key: string) {
    this.active = key;
  }
  async removeStorageValue(key: string) {
    this.sessions.delete(key);
  }
  async storeSession(token: string, key = defaultSessionKey) {
    const publicKey = `${token}-key`;
    this.keys.add(publicKey);
    this.sessions.set(key, session(token, publicKey));
    this.active = key;
  }
  async getSession(key = defaultSessionKey) {
    this.sessionReads += 1;
    if (this.pauseClearRead && this.sessionReads === this.pauseReadAt) {
      this.clearReadStarted = true;
      await this.blockedClearRead.promise;
    }
    return this.sessions.get(key);
  }
  async getActiveSessionKey() {
    return this.active;
  }
  async getActiveSession() {
    return this.active ? this.sessions.get(this.active) : undefined;
  }
  async listSessionKeys() {
    return [...this.sessions.keys()];
  }
  async clearSession(key: string) {
    this.sessions.delete(key);
    if (this.active === key) this.active = undefined;
  }
  async clearAllSessions() {
    this.sessions.clear();
    this.active = undefined;
  }
}

class MockClientSessionView implements StorageBase {
  private allowedTokens: Map<string, string> | undefined;
  constructor(private readonly shared: SharedSessionStore) {
    this.getActiveSession = this.getActiveSession.bind(this);
  }
  restrictToNewSessions() {
    this.allowedTokens = new Map();
  }
  async getStorageValue(key: string) {
    return this.getSession(key);
  }
  async setStorageValue(key: string, value: Session) {
    await this.shared.setStorageValue(key, value);
  }
  async setActiveSessionKey(key: string) {
    await this.shared.setActiveSessionKey(key);
  }
  async removeStorageValue(key: string) {
    await this.shared.removeStorageValue(key);
  }
  async storeSession(token: string, key = defaultSessionKey) {
    await this.shared.storeSession(token, key);
    this.allowedTokens?.set(key, token);
  }
  async getSession(key = defaultSessionKey) {
    const value = await this.shared.getSession(key);
    return this.allowedTokens && this.allowedTokens.get(key) !== value?.token
      ? undefined
      : value;
  }
  async getActiveSessionKey() {
    const key = await this.shared.getActiveSessionKey();
    return key && (await this.getSession(key)) ? key : undefined;
  }
  async getActiveSession() {
    const key = await this.getActiveSessionKey();
    return key ? this.getSession(key) : undefined;
  }
  async listSessionKeys() {
    const keys = await this.shared.listSessionKeys();
    return (
      await Promise.all(
        keys.map(async (key) =>
          (await this.getSession(key)) ? key : undefined,
        ),
      )
    ).filter((key): key is string => !!key);
  }
  async clearSession(key: string) {
    await this.shared.clearSession(key);
    this.allowedTokens?.delete(key);
  }
  async clearAllSessions() {
    await this.shared.clearAllSessions();
    this.allowedTokens?.clear();
  }
}

let mockStore: SharedSessionStore;
let mockOAuthLogin = deferred<{ session: string }>();
const mockGetUser = jest.fn(
  async (_input: { organizationId: string; userId: string }) => ({ user: {} }),
);
const mockFetch = jest.fn(async () => ({
  ok: true,
  json: async () => ({ activity: { status: "ACTIVITY_STATUS_COMPLETED" } }),
}));
const mockClients: Array<import("@0xkey-io/core").ZeroXKeyClient> = [];
let mockAInitGate: ReturnType<typeof deferred<void>> | undefined;
let mockAInitEntered: ReturnType<typeof deferred<void>> | undefined;
let mockARetirementGate: ReturnType<typeof deferred<void>> | undefined;
let mockARetirementEntered: ReturnType<typeof deferred<void>> | undefined;
let mockBInitGate: ReturnType<typeof deferred<void>> | undefined;
let mockBInitEntered: ReturnType<typeof deferred<void>> | undefined;
let mockBRetirementGate: ReturnType<typeof deferred<void>> | undefined;
let mockBRetirementEntered: ReturnType<typeof deferred<void>> | undefined;

jest.mock("@0xkey-io/core", () => {
  const actual =
    jest.requireActual<typeof import("@0xkey-io/core")>("@0xkey-io/core");
  const source = jest.requireActual<typeof import("@0xkey-io/core")>(
    "../../../core/src/__clients__/core",
  );
  const { CrossPlatformApiKeyStamper } = jest.requireActual<any>(
    "../../../core/src/__stampers__/api/base",
  );
  return {
    ...actual,
    ZeroXKeyClient: jest.fn((config: ZeroXKeySDKClientConfig) => {
      const client = new source.ZeroXKeyClient(config);
      const storageView = new MockClientSessionView(mockStore);
      if (config.organizationId === "org-A" && mockARetirementGate) {
        (storageView as any).retireAuthAccess = async () => {
          mockARetirementEntered?.resolve();
          await mockARetirementGate?.promise;
        };
      }
      if (config.organizationId === "org-B" && mockBRetirementGate) {
        (storageView as any).retireAuthAccess = async () => {
          mockBRetirementEntered?.resolve();
          await mockBRetirementGate?.promise;
        };
      }
      const stamper = new CrossPlatformApiKeyStamper(storageView);
      (stamper as any).stamper = {
        stamp: async (_payload: string, publicKey: string) => ({
          stampHeaderName: "X-Test-Stamp",
          stampHeaderValue: publicKey,
        }),
        deleteKeyPair: async (key: string) => {
          mockStore.keys.delete(key);
        },
      };
      const httpClient = (client as any).buildHttpClient({
        storageManager: storageView,
        apiKeyStamper: stamper,
      });
      httpClient.proxyOAuthLogin = async () => mockOAuthLogin.promise as any;
      httpClient.getUser = mockGetUser as any;
      (client as any).init = async () => {
        (client as any).authDependencies = {
          storageManager: storageView,
          httpClient,
          apiKeyStamper: stamper,
        };
        (client as any).authReady = true;
        if (config.organizationId === "org-A" && mockAInitGate) {
          mockAInitEntered?.resolve();
          await mockAInitGate.promise;
        }
        if (config.organizationId === "org-B" && mockBInitGate) {
          mockBInitEntered?.resolve();
          await mockBInitGate.promise;
        }
        if (
          config.organizationId === "org-A" &&
          mockStore.storeInvalidAOnInit
        ) {
          (
            client as typeof client & {
              restrictPersistedCredentialsToNewSessions: () => void;
            }
          ).restrictPersistedCredentialsToNewSessions();
          await storageView.storeSession("invalid-A");
          mockStore.sessions.set(
            defaultSessionKey,
            mockSession("invalid-A", "invalid-A-key", false),
          );
        }
        if (config.organizationId === "org-B" && mockStore.storeBOnInit) {
          await mockStore.storeSession("B");
        }
      };
      mockClients.push(client);
      return client;
    }),
  };
});

const config: ZeroXKeyProviderConfig = {
  organizationId: "org-A",
  apiBaseUrl: "https://api.example.test",
  authProxyUrl: "https://auth.example.test",
  autoFetchWalletKitConfig: false,
  autoRefreshManagedState: false,
  auth: { methods: { walletAuthEnabled: false }, autoRefreshSession: false },
  walletConfig: {
    features: { auth: false, connecting: false },
    chains: {
      ethereum: { native: false },
      solana: { native: false },
    },
  },
};

let dom: ReturnType<typeof setupProviderDom>;
let mounted: MountedProvider | undefined;

async function ready(target: string) {
  const { ClientState } = dom.loadPublicExports();
  for (let i = 0; i < 30; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
    if (
      mounted?.context()?.clientState === ClientState.Ready &&
      mounted.context()?.httpClient?.config.organizationId === target
    )
      return;
  }
  throw new Error(`Provider ${target} did not become ready`);
}

beforeEach(() => {
  mockStore = new SharedSessionStore();
  mockOAuthLogin = deferred<{ session: string }>();
  mockGetUser.mockClear();
  mockFetch.mockClear();
  mockClients.length = 0;
  mockAInitGate = undefined;
  mockAInitEntered = undefined;
  mockARetirementGate = undefined;
  mockARetirementEntered = undefined;
  mockBInitGate = undefined;
  mockBInitEntered = undefined;
  mockBRetirementGate = undefined;
  mockBRetirementEntered = undefined;
  dom = setupProviderDom({ fetchImpl: mockFetch as unknown as typeof fetch });
  mounted = undefined;
});

afterEach(async () => {
  if (mounted) await dom.unmount(mounted);
  await dom.restore();
});

describe("mounted Provider with real Core persistence methods", () => {
  it("keeps committed A credentials usable when a B transition suspends before commit", async () => {
    const { ZeroXKeyProvider, useZeroXKey, ClientState } =
      dom.loadPublicExports();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let currentContext: ReturnType<typeof useZeroXKey> | undefined;
    let bRenderCount = 0;
    const blocked = new Promise<never>(() => undefined);
    function Probe({ target }: { target: string }) {
      currentContext = useZeroXKey();
      if (target === "org-B") bRenderCount += 1;
      return null;
    }
    function SuspendedChild(): never {
      throw blocked;
    }
    function Screen({ target, suspend }: { target: string; suspend: boolean }) {
      return (
        <Suspense fallback={null}>
          <ZeroXKeyProvider config={{ ...config, organizationId: target }}>
            <Probe target={target} />
          </ZeroXKeyProvider>
          {suspend && <SuspendedChild />}
        </Suspense>
      );
    }
    try {
      await act(async () => {
        root.render(<Screen target="org-A" suspend={false} />);
      });
      for (
        let i = 0;
        i < 30 && currentContext?.clientState !== ClientState.Ready;
        i += 1
      )
        await act(async () => {
          await Promise.resolve();
        });
      expect(currentContext?.clientState).toBe(ClientState.Ready);
      await act(async () => {
        await currentContext!.storeSession({ sessionToken: "A" });
      });
      const oldHttp = currentContext!.httpClient!;
      expect(
        (await oldHttp.stampGetActivity({ activityId: "before" }))?.stamp
          .stampHeaderValue,
      ).toBe("A-key");

      await act(async () => {
        startTransition(() => {
          root.render(<Screen target="org-B" suspend />);
        });
        await Promise.resolve();
      });
      expect(bRenderCount).toBeGreaterThan(0);
      expect(currentContext?.httpClient).toBe(oldHttp);
      await expect(
        oldHttp.getActivity({ activityId: "after-abort" }),
      ).resolves.toBeDefined();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("fails closed on first mount with an unbound persisted session", async () => {
    mockStore.sessions.set(defaultSessionKey, session("A", "A-key"));
    mockStore.active = defaultSessionKey;
    mounted = await dom.mount({ ...config, organizationId: "org-B" });
    await ready("org-B");

    expect(mounted.context()?.session).toBeUndefined();
    await expect(mounted.context()!.fetchUser()).rejects.toBeDefined();
    await expect(
      mounted.context()!.httpClient!.stampGetActivity({ activityId: "test" }),
    ).rejects.toBeDefined();
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockStore.sessions.get(defaultSessionKey)?.token).toBe("A");
  });

  it("blocks B high-level and raw HTTP credentials from A's active session", async () => {
    mockStore.sessions.set(defaultSessionKey, session("A", "A-key"));
    mockStore.active = defaultSessionKey;
    mockStore.keys.add("A-key");
    mounted = await dom.mount(config);
    await ready("org-A");
    await mounted.rerender({ ...config, organizationId: "org-B" });
    await ready("org-B");

    await expect(mounted.context()!.fetchUser()).rejects.toBeDefined();
    expect(mockGetUser).not.toHaveBeenCalled();
    await expect(
      mounted.context()!.httpClient!.stampGetActivity({ activityId: "test" }),
    ).rejects.toBeDefined();
    await expect(
      mounted
        .context()!
        .createHttpClient()
        .stampGetActivity({ activityId: "test" }),
    ).rejects.toBeDefined();
    await expect(
      mounted.context()!.httpClient!.getActivity({ activityId: "test" }),
    ).rejects.toBeDefined();
    await expect(
      mounted.context()!.createHttpClient().getActivity({ activityId: "test" }),
    ).rejects.toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();

    await act(async () => {
      await mounted!.context()!.storeSession({ sessionToken: "B" });
    });
    const signed = await mounted
      .context()!
      .httpClient!.stampGetActivity({ activityId: "test" });
    expect(signed?.stamp.stampHeaderValue).toBe("B-key");
  });

  it("fails closed on A→B→A without trusted persisted target ownership", async () => {
    mockStore.sessions.set(defaultSessionKey, session("A", "A-key"));
    mockStore.active = defaultSessionKey;
    mounted = await dom.mount(config);
    await ready("org-A");
    await mounted.rerender({ ...config, organizationId: "org-B" });
    await ready("org-B");
    await mounted.rerender(config);
    await ready("org-A");
    expect(mounted.context()?.session).toBeUndefined();
    await expect(mounted.context()!.fetchUser()).rejects.toBeDefined();
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockStore.sessions.get(defaultSessionKey)?.token).toBe("A");
  });

  it("does not publish A's preexisting valid session as B's active session", async () => {
    mockStore.sessions.set(defaultSessionKey, session("A", "A-key"));
    mockStore.active = defaultSessionKey;
    mounted = await dom.mount(config);
    await ready("org-A");
    expect(mounted.context()?.session).toBeUndefined();

    await mounted.rerender({ ...config, organizationId: "org-B" });
    await ready("org-B");
    expect(mounted.context()?.session).toBeUndefined();
    await expect(mounted.context()!.getSession()).resolves.toBeUndefined();
    await expect(mounted.context()!.getAllSessions()).resolves.toBeUndefined();
    expect(mockStore.sessions.get(defaultSessionKey)?.token).toBe("A");
  });

  it("drains an A commit already inside storage before initializing B sessions", async () => {
    mounted = await dom.mount(config);
    await ready("org-A");
    const blockedStore = deferred<void>();
    const storeStarted = deferred<void>();
    const originalStore = mockStore.storeSession.bind(mockStore);
    mockStore.storeSession = async (token: string, key?: string) => {
      await originalStore(token, key);
      if (token === "A") {
        storeStarted.resolve();
        await blockedStore.promise;
      }
    };
    const oldLogin = mounted.context()!.loginWithOauth({
      oidcToken: "A-oidc",
      publicKey: "A-key",
    });
    void oldLogin.catch(() => undefined);
    mockOAuthLogin.resolve({ session: "A" });
    await storeStarted.promise;

    await mounted.rerender({ ...config, organizationId: "org-B" });
    for (let i = 0; i < 10; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    const sessionBeforeRelease = mounted.context()?.session;
    const stateBeforeRelease = mounted.context()?.clientState;

    await act(async () => {
      blockedStore.resolve();
      await oldLogin.catch(() => undefined);
    });
    await ready("org-B");
    expect(sessionBeforeRelease).toBeUndefined();
    expect(stateBeforeRelease).not.toBe(
      dom.loadPublicExports().ClientState.Ready,
    );
    expect(mounted.context()?.session).toBeUndefined();
    await expect(mounted.context()!.getSession()).resolves.toBeUndefined();
  });

  it("retires unpublished A init and keeps B unready until native retirement settles", async () => {
    mockAInitGate = deferred<void>();
    mockAInitEntered = deferred<void>();
    mockARetirementGate = deferred<void>();
    mockARetirementEntered = deferred<void>();
    mounted = await dom.mount(config);
    await mockAInitEntered.promise;
    expect(mockClients).toHaveLength(1);

    try {
      await mounted.rerender({ ...config, organizationId: "org-B" });
      for (let i = 0; i < 5; i += 1)
        await act(async () => {
          await Promise.resolve();
        });
      expect(mockClients).toHaveLength(1);
      expect(mounted.context()?.clientState).not.toBe(
        dom.loadPublicExports().ClientState.Ready,
      );

      mockAInitGate.resolve();
      await mockARetirementEntered.promise;
      for (let i = 0; i < 5; i += 1)
        await act(async () => {
          await Promise.resolve();
        });
      expect(mockClients).toHaveLength(1);
      expect(mounted.context()?.clientState).not.toBe(
        dom.loadPublicExports().ClientState.Ready,
      );

      mockARetirementGate.resolve();
      await (
        mockClients[0]! as (typeof mockClients)[number] & {
          awaitAuthRetirement: () => Promise<void>;
        }
      ).awaitAuthRetirement();
      await ready("org-B");
      expect(mockClients).toHaveLength(2);
    } finally {
      mockAInitGate.resolve();
      mockARetirementGate.resolve();
    }
  });

  it("retires A after init resolves while its client state publication is deferred", async () => {
    mockAInitGate = deferred<void>();
    mockAInitEntered = deferred<void>();
    mockARetirementGate = deferred<void>();
    mockARetirementEntered = deferred<void>();
    const reactRuntime = jest.requireActual<typeof import("react")>("react");
    const useState = reactRuntime.useState;
    const publicationDeferred = deferred<void>();
    let intercepted = false;
    jest.spyOn(reactRuntime, "useState").mockImplementation(((
      initialValue: unknown,
    ) => {
      const [value, setValue] = useState(initialValue);
      return [
        value,
        (next: unknown) => {
          if (
            !intercepted &&
            next !== null &&
            typeof next === "object" &&
            (next as any).config?.organizationId === "org-A" &&
            typeof (next as any).retireAuthWrites === "function"
          ) {
            intercepted = true;
            publicationDeferred.resolve();
            return;
          }
          setValue(next);
        },
      ];
    }) as typeof reactRuntime.useState);
    try {
      mounted = await dom.mount(config);
      await mockAInitEntered.promise;
      mockAInitGate.resolve();
      await publicationDeferred.promise;
      expect(intercepted).toBe(true);

      await mounted.rerender({ ...config, organizationId: "org-B" });
      expect(mockClients).toHaveLength(1);
      expect(mounted.context()?.clientState).not.toBe(
        dom.loadPublicExports().ClientState.Ready,
      );
      await mockARetirementEntered.promise;
      mockARetirementGate.resolve();
      await ready("org-B");
    } finally {
      mockAInitGate.resolve();
      mockARetirementGate.resolve();
    }
  });

  it("keeps B's in-flight owner when stale A finishes during A→B→A", async () => {
    mockAInitGate = deferred<void>();
    mockAInitEntered = deferred<void>();
    mockARetirementGate = deferred<void>();
    mockARetirementEntered = deferred<void>();
    mockBInitGate = deferred<void>();
    mockBInitEntered = deferred<void>();
    mockBRetirementGate = deferred<void>();
    mockBRetirementEntered = deferred<void>();
    mounted = await dom.mount(config);
    await mockAInitEntered.promise;

    try {
      await mounted.rerender({ ...config, organizationId: "org-B" });
      await mockARetirementEntered.promise;
      mockARetirementGate.resolve();
      await mockBInitEntered.promise;
      expect(mockClients).toHaveLength(2);

      mockAInitGate.resolve();
      for (let i = 0; i < 5; i += 1)
        await act(async () => {
          await Promise.resolve();
        });
      await mounted.rerender(config);
      await mockBRetirementEntered.promise;
      expect(mockClients).toHaveLength(2);

      mockBInitGate.resolve();
      for (let i = 0; i < 5; i += 1)
        await act(async () => {
          await Promise.resolve();
        });
      expect(mockClients).toHaveLength(2);
      mockBRetirementGate.resolve();
      await ready("org-A");
      expect(mockClients).toHaveLength(3);
    } finally {
      mockAInitGate.resolve();
      mockARetirementGate.resolve();
      mockBInitGate.resolve();
      mockBRetirementGate.resolve();
    }
  });

  it("exposes only B-bound session keys after B authenticates", async () => {
    mockStore.sessions.set(defaultSessionKey, session("A", "A-key"));
    mockStore.active = defaultSessionKey;
    mounted = await dom.mount(config);
    await ready("org-A");
    await mounted.rerender({ ...config, organizationId: "org-B" });
    await ready("org-B");

    await act(async () => {
      await mounted!.context()!.storeSession({
        sessionToken: "B",
        sessionKey: "B-session",
      });
    });
    expect(mounted.context()?.session?.token).toBe("B");
    expect(
      Object.keys((await mounted.context()!.getAllSessions()) ?? {}),
    ).toEqual(["B-session"]);
    await expect(
      mounted.context()!.getSession({ sessionKey: defaultSessionKey }),
    ).resolves.toBeUndefined();
    await expect(
      mounted.context()!.setActiveSession({ sessionKey: defaultSessionKey }),
    ).rejects.toBeDefined();
    await act(async () => {
      await mounted!.context()!.clearSession();
    });
    expect(mockStore.sessions.get(defaultSessionKey)?.token).toBe("A");
    expect(mockStore.sessions.has("B-session")).toBe(false);
    await act(async () => {
      await mounted!.context()!.storeSession({
        sessionToken: "B",
        sessionKey: "B-session",
      });
    });
    await act(async () => {
      await mounted!.context()!.clearAllSessions();
    });
    expect(mockStore.sessions.get(defaultSessionKey)?.token).toBe("A");
    expect(mockStore.sessions.has("B-session")).toBe(false);
  });

  it("keeps B default session when A OAuth login returns after the switch", async () => {
    mounted = await dom.mount(config);
    await ready("org-A");
    const oldLogin = mounted.context()!.loginWithOauth({
      oidcToken: "A-oidc",
      publicKey: "A-key",
    });
    void oldLogin.catch(() => undefined);

    await mounted.rerender({ ...config, organizationId: "org-B" });
    await ready("org-B");
    await act(async () => {
      await mounted!.context()!.storeSession({ sessionToken: "B" });
    });
    expect(mockStore.sessions.get(defaultSessionKey)?.token).toBe("B");
    await act(async () => {
      mockOAuthLogin.resolve({ session: "A" });
      await oldLogin.catch(() => undefined);
    });
    expect(mockStore.sessions.get(defaultSessionKey)?.token).toBe("B");
  });

  it("keeps B session and keypair when A invalid-session clear read returns late", async () => {
    mockStore.storeInvalidAOnInit = true;
    mockStore.pauseClearRead = true;
    mockStore.pauseReadAt = 3;
    mockStore.storeBOnInit = true;
    mounted = await dom.mount(config);
    for (let i = 0; i < 30 && !mockStore.clearReadStarted; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(mockStore.clearReadStarted).toBe(true);

    await mounted.rerender({ ...config, organizationId: "org-B" });
    await ready("org-B");
    expect(mockStore.sessions.get(defaultSessionKey)?.token).toBe("B");
    expect(mockStore.keys.has("B-key")).toBe(true);
    await act(async () => {
      mockStore.blockedClearRead.resolve();
      await Promise.resolve();
    });
    expect(mockStore.sessions.get(defaultSessionKey)?.token).toBe("B");
    expect(mockStore.keys.has("B-key")).toBe(true);
  });
});
