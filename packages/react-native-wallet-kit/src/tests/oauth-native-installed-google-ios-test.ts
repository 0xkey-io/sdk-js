import { describe, expect, it, jest } from "@jest/globals";
import {
  createGoogleIosInstalledAdapter,
  createGoogleIosInstalledOwner,
} from "../native/google-ios-installed";
import { createNativeOAuthLifecycleForTests } from "../utils/oauth-native-flow";
import {
  parseNativeRecord,
  type NativeBinding,
  type NativeSlotStorage,
} from "../utils/oauth-native-store";

let mockIsAvailable = async () => true;
let mockOpenAuth: (url: string, redirect: string) => Promise<unknown> = async (
  _url,
  redirect,
) => ({
  type: "success",
  url: `${redirect}?code=code-1&state=AQEBAQEBAQEBAQEBAQEBAQ`,
});

jest.mock("react-native-inappbrowser-reborn", () => ({
  InAppBrowser: {
    isAvailable: () => mockIsAvailable(),
    openAuth: (url: string, redirect: string) => mockOpenAuth(url, redirect),
  },
}));

const publicKey = `02${"12".repeat(32)}`;
const expectedNonce =
  "df483b5bef3df3c1032a4bead51e97ffaadabdb12960a3cc888388555b8b7ac9";
const binding: NativeBinding = {
  organizationId: "org-1",
  apiBaseUrl: "https://api.example/",
  authProxyUrl: "https://proxy.example/",
  authProxyConfigId: "config-1",
  provider: "google",
  platform: "ios",
  clientId: "ios-client.apps.googleusercontent.com",
  redirectUri: "com.googleusercontent.apps.example:/oauthredirect",
  completion: "internal",
  keyNamespace: "auth-v2",
};

function lifecycle() {
  let value: string | null = null;
  const storage: NativeSlotStorage = {
    read: async () => value,
    write: async (next) => {
      value = next;
    },
    remove: async () => {
      value = null;
    },
  };
  return {
    storage: () => value,
    instance: createNativeOAuthLifecycleForTests(
      {
        storage,
        now: () => 1_000,
        randomBytes: (length) => new Uint8Array(length).fill(3),
      },
      {},
    ),
  };
}

function ownerCallbacks() {
  const createKey = jest.fn(async () => publicKey);
  const discardKey = jest.fn(async (_key: string) => undefined);
  const complete = jest.fn(
    async (_input: { publicKey: string; oidcToken: string }) => undefined,
  );
  return { createKey, discardKey, complete };
}

describe("installed Google iOS bridge composition", () => {
  it("rejects unavailable native auth and invalid binding before key allocation", async () => {
    const callbacks = ownerCallbacks();
    mockIsAvailable = async () => false;
    const state = lifecycle();
    const owner = createGoogleIosInstalledOwner({
      binding,
      randomBytes: (length) => new Uint8Array(length).fill(1),
      ready: Promise.resolve(),
      isCurrent: () => true,
      ...callbacks,
    });
    await expect(state.instance.start(owner).result).rejects.toMatchObject({
      code: "not-ready",
    });
    expect(callbacks.createKey).not.toHaveBeenCalled();
    expect(callbacks.complete).not.toHaveBeenCalled();
    for (const invalidBinding of [
      { ...binding, provider: "apple" as const },
      { ...binding, clientId: "" },
      { ...binding, redirectUri: "https://example.com/callback" },
    ]) {
      expect(() =>
        createGoogleIosInstalledOwner({
          binding: invalidBinding,
          randomBytes: (length) => new Uint8Array(length).fill(1),
          ready: Promise.resolve(),
          isCurrent: () => true,
          ...callbacks,
        }),
      ).toThrow();
    }
    expect(callbacks.createKey).not.toHaveBeenCalled();
  });

  it("rejects a mismatched lifecycle nonce before opening native UI", async () => {
    let opens = 0;
    mockIsAvailable = async () => true;
    mockOpenAuth = async () => {
      opens++;
      return { type: "cancel" };
    };
    const owner = createGoogleIosInstalledOwner({
      binding,
      randomBytes: (length) => new Uint8Array(length).fill(1),
      ready: Promise.resolve(),
      isCurrent: () => true,
      ...ownerCallbacks(),
    });
    await owner.ready;
    await expect(
      owner.authenticate({ publicKey, expectedNonce: "00" }),
    ).rejects.toMatchObject({ code: "config-invalid" });
    expect(opens).toBe(0);
  });

  it("hands the installed-session token to NativeOwner only after durable handoff", async () => {
    const previousFetch = globalThis.fetch;
    const state = lifecycle();
    const callbacks = ownerCallbacks();
    mockIsAvailable = async () => true;
    mockOpenAuth = async (url, redirect) => ({
      type: "success",
      url: `${redirect}?code=code-1&state=${new URL(url).searchParams.get("state")}`,
    });
    globalThis.fetch = jest.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ id_token: "signed-token" }),
        }) as Response,
    ) as typeof fetch;
    callbacks.complete.mockImplementation(async (input) => {
      expect(parseNativeRecord(state.storage()!).phase).toBe("handoff_started");
      expect(input).toEqual({ publicKey, oidcToken: "signed-token" });
    });
    try {
      const owner = createGoogleIosInstalledOwner({
        binding,
        randomBytes: (length) =>
          new Uint8Array(length).fill(length === 16 ? 1 : 2),
        ready: Promise.resolve(),
        isCurrent: () => true,
        ...callbacks,
      });
      await expect(state.instance.start(owner).result).resolves.toBeUndefined();
      expect(callbacks.createKey).toHaveBeenCalledTimes(1);
      expect(callbacks.complete).toHaveBeenCalledTimes(1);
      expect(callbacks.discardKey).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("cleans only its pre-handoff key on native cancellation", async () => {
    const previousFetch = globalThis.fetch;
    const state = lifecycle();
    const callbacks = ownerCallbacks();
    mockIsAvailable = async () => true;
    mockOpenAuth = async () => ({ type: "cancel" });
    const fetcher = jest.fn(async () => {
      throw new Error("exchange after cancel");
    });
    globalThis.fetch = fetcher as typeof fetch;
    try {
      const owner = createGoogleIosInstalledOwner({
        binding,
        randomBytes: (length) => new Uint8Array(length).fill(1),
        ready: Promise.resolve(),
        isCurrent: () => true,
        ...callbacks,
      });
      await expect(state.instance.start(owner).result).rejects.toMatchObject({
        code: "cancelled",
      });
      expect(callbacks.discardKey).toHaveBeenCalledWith(publicKey);
      expect(callbacks.complete).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("uses the installed system browser and global fetch through the adapter", async () => {
    const previousFetch = globalThis.fetch;
    let opened: { url: string; redirect: string } | undefined;
    let posted: { url: string; init: RequestInit } | undefined;
    mockIsAvailable = async () => true;
    mockOpenAuth = async (url, redirect) => {
      opened = { url, redirect };
      const state = new URL(url).searchParams.get("state");
      return { type: "success", url: `${redirect}?code=code-1&state=${state}` };
    };
    globalThis.fetch = jest.fn(async (url, init) => {
      posted = { url: String(url), init: init as RequestInit };
      return {
        ok: true,
        json: async () => ({ id_token: "signed-token" }),
      } as Response;
    }) as typeof fetch;
    try {
      const adapter = createGoogleIosInstalledAdapter({
        binding,
        randomBytes: (length) =>
          new Uint8Array(length).fill(length === 16 ? 1 : 2),
      });
      await expect(
        adapter.authenticate({ publicKey, expectedNonce }),
      ).resolves.toEqual({ oidcToken: "signed-token" });
      expect(opened?.redirect).toBe(binding.redirectUri);
      expect(new URL(opened!.url).searchParams.get("nonce")).toBe(
        expectedNonce,
      );
      expect(posted?.url).toBe("https://oauth2.googleapis.com/token");
      expect(posted!.init.body as string).toContain("code_verifier=");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("does not exchange a cancelled system session", async () => {
    const previousFetch = globalThis.fetch;
    const fetcher = jest.fn(async () => {
      throw new Error("exchange after cancel");
    });
    globalThis.fetch = fetcher as typeof fetch;
    mockIsAvailable = async () => true;
    mockOpenAuth = async () => ({ type: "cancel" });
    try {
      const adapter = createGoogleIosInstalledAdapter({
        binding,
        randomBytes: (length) => new Uint8Array(length).fill(1),
      });
      await expect(
        adapter.authenticate({ publicKey, expectedNonce }),
      ).rejects.toBeDefined();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
