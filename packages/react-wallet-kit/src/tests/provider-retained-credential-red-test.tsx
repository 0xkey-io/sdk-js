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
import { act, useLayoutEffect } from "react";
import type { ZeroXKeySDKClientConfig } from "@0xkey-io/core";
import type { ZeroXKeyProviderConfig } from "../index";
import {
  setupProviderDom,
  type MountedProvider,
} from "./fixtures/provider-dom";

let mockRaw: Map<string, string>;
let mockStorageIdentity: object;
const mockFetch = jest.fn(async () => ({
  ok: true,
  json: async () => ({ activity: { status: "ACTIVITY_STATUS_COMPLETED" } }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

jest.mock("@0xkey-io/core", () => {
  const actual =
    jest.requireActual<typeof import("@0xkey-io/core")>("@0xkey-io/core");
  const source = jest.requireActual<typeof import("@0xkey-io/core")>(
    "../../../core/src/__clients__/core",
  );
  const { AuthStorageManager } = jest.requireActual<any>(
    "../../../core/src/__storage__/auth-storage",
  );
  const { CrossPlatformApiKeyStamper } = jest.requireActual<any>(
    "../../../core/src/__stampers__/api/base",
  );
  return {
    ...actual,
    ZeroXKeyClient: jest.fn((config: ZeroXKeySDKClientConfig) => {
      const client = new source.ZeroXKeyClient(config);
      const storage = new AuthStorageManager({
        identity: mockStorageIdentity,
        get: async (key: string) => mockRaw.get(key) ?? null,
        set: async (key: string, value: string) => {
          mockRaw.set(key, value);
        },
        remove: async (key: string) => {
          mockRaw.delete(key);
        },
        cleanup: async () => undefined,
      });
      const stamper = new CrossPlatformApiKeyStamper(storage);
      (stamper as any).stamper = {
        stamp: async (_payload: string, publicKey: string) => ({
          stampHeaderName: "X-Test-Stamp",
          stampHeaderValue: publicKey,
        }),
        deleteKeyPair: async () => undefined,
      };
      const dependencies = {
        storageManager: storage,
        apiKeyStamper: stamper,
      };
      const httpClient = (client as any).buildHttpClient(dependencies);
      (client as any).init = async () => {
        (client as any).authDependencies = {
          ...dependencies,
          httpClient,
        };
        (client as any).authReady = true;
      };
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

const token = `header.${Buffer.from(
  JSON.stringify({
    exp: 2_000_000_000,
    public_key: "A-key",
    session_type: "SESSION_TYPE_READ_WRITE",
    user_id: "A-user",
    organization_id: "org-A",
  }),
).toString("base64")}.signature`;

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
  mockRaw = new Map();
  mockStorageIdentity = {};
  mockFetch.mockClear();
  dom = setupProviderDom({ fetchImpl: mockFetch as unknown as typeof fetch });
  mounted = undefined;
});

afterEach(async () => {
  if (mounted) await dom.unmount(mounted);
  await dom.restore();
});

describe("retained A credential handles after Provider A→B", () => {
  it("revokes A before B first-commit child layout can finish a raw stamp", async () => {
    mounted = await dom.mount(config);
    await ready("org-A");
    await act(async () => {
      await mounted!.context()!.storeSession({ sessionToken: token });
    });
    const oldHttp = mounted.context()!.httpClient!;
    const outcome = deferred<"signed" | "blocked">();
    function BChildLayout() {
      useLayoutEffect(() => {
        void oldHttp.stampGetActivity({ activityId: "B-first-commit" }).then(
          () => outcome.resolve("signed"),
          () => outcome.resolve("blocked"),
        );
      }, []);
      return null;
    }

    await mounted.rerender(
      { ...config, organizationId: "org-B" },
      undefined,
      <BChildLayout />,
    );
    expect(await outcome.promise).toBe("blocked");
    await ready("org-B");
  });

  it("revokes an old generated HTTP client from stamping A after B is ready", async () => {
    mounted = await dom.mount(config);
    await ready("org-A");
    await act(async () => {
      await mounted!.context()!.storeSession({ sessionToken: token });
    });
    const oldHttp = mounted.context()!.httpClient!;
    expect(
      (await oldHttp.stampGetActivity({ activityId: "pre-switch" }))?.stamp
        .stampHeaderValue,
    ).toBe("A-key");

    await mounted.rerender({ ...config, organizationId: "org-B" });
    await ready("org-B");
    await expect(
      oldHttp.stampGetActivity({ activityId: "post-switch" }),
    ).rejects.toBeDefined();
  });

  it("revokes a retained createHttpClient callback before it can send A credentials", async () => {
    mounted = await dom.mount(config);
    await ready("org-A");
    await act(async () => {
      await mounted!.context()!.storeSession({ sessionToken: token });
    });
    const oldCreateHttpClient = mounted.context()!.createHttpClient;

    await mounted.rerender({ ...config, organizationId: "org-B" });
    await ready("org-B");
    await expect(
      oldCreateHttpClient().getActivity({ activityId: "post-switch" }),
    ).rejects.toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocks a retained unauthenticated Auth Proxy transport after the switch", async () => {
    const proxyConfig = { ...config, authProxyConfigId: "A-config" };
    mounted = await dom.mount(proxyConfig);
    await ready("org-A");
    const oldHttp = mounted.context()!.httpClient!;

    await mounted.rerender({
      ...proxyConfig,
      organizationId: "org-B",
      authProxyConfigId: "B-config",
    });
    await ready("org-B");
    await expect(
      oldHttp.authProxyRequest("/v1/account", {}),
    ).rejects.toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocks a retained transport from submitting a previously signed A request", async () => {
    mounted = await dom.mount(config);
    await ready("org-A");
    await act(async () => {
      await mounted!.context()!.storeSession({ sessionToken: token });
    });
    const oldHttp = mounted.context()!.httpClient!;
    const signed = (await oldHttp.stampGetActivity({
      activityId: "pre-switch",
    }))!;

    await mounted.rerender({ ...config, organizationId: "org-B" });
    await ready("org-B");
    await expect(oldHttp.sendSignedRequest(signed)).rejects.toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not reauthorize the first A HTTP handle after A→B→A", async () => {
    mounted = await dom.mount(config);
    await ready("org-A");
    await act(async () => {
      await mounted!.context()!.storeSession({ sessionToken: token });
    });
    const firstAHttp = mounted.context()!.httpClient!;

    await mounted.rerender({ ...config, organizationId: "org-B" });
    await ready("org-B");
    await mounted.rerender(config);
    await ready("org-A");

    await expect(
      firstAHttp.stampGetActivity({ activityId: "old-A-after-return" }),
    ).rejects.toBeDefined();
    await expect(
      mounted.context()!.httpClient!.stampGetActivity({ activityId: "new-A" }),
    ).rejects.toBeDefined();
  });
});
