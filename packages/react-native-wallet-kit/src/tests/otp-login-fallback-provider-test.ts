import { afterAll, beforeAll, expect, it, jest } from "@jest/globals";
import { createPublicKey, createVerify, ECDH } from "node:crypto";
import { dirname } from "node:path";
import type { ZeroXKeyClient } from "@0xkey-io/core";
import type { ClientContextType } from "../providers/Types";
import type { ZeroXKeyCallbacks, ZeroXKeyProviderConfig } from "../types/base";

type Effect = () => void | (() => void);

function sameDeps(a: readonly unknown[] | undefined, b: readonly unknown[]) {
  return (
    a?.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  );
}

// Renders ZeroXKeyProvider as a plain function with hook state kept here, the
// same way the OAuth wiring tests drive it without a native renderer.
class ProviderHarness {
  private state: Array<{ value: unknown }> = [];
  private refs: Array<{ current: unknown }> = [];
  private callbacks: Array<{ value: unknown; deps: readonly unknown[] }> = [];
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
    private readonly provider: (props: unknown) => unknown,
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
    const element = this.provider({
      config: this.config,
      callbacks: this.callbacksProp,
      children: null,
    }) as { props: { value: ClientContextType } };
    this.context = element.props.value;
    mockActiveHarness = undefined;
  }

  async settle(limit = 60) {
    for (let attempt = 0; attempt < limit; attempt += 1) {
      if (!this.context || this.dirty) this.render();
      for (const slot of this.effects) {
        if (!slot?.pending) continue;
        slot.cleanup?.();
        const effect = slot.pending;
        slot.pending = undefined;
        slot.cleanup = effect() ?? undefined;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!this.dirty && !this.effects.some((slot) => slot?.pending)) return;
    }
    throw new Error("Provider harness did not settle");
  }

  unmount() {
    this.mounted = false;
    for (const slot of this.effects) slot?.cleanup?.();
  }
}

let mockActiveHarness: ProviderHarness | undefined;
const mockRealClients: ZeroXKeyClient[] = [];
const mockKeychain = new Map<string, { username: string; password: string }>();
const mockAsyncStorage = new Map<string, string>();

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
    getInitialURL: async () => null,
    addEventListener: () => ({ remove: () => undefined }),
  },
}));
jest.mock("react-native-device-info", () => ({
  __esModule: true,
  default: {},
}));
jest.mock("react-native-inappbrowser-reborn", () => ({
  InAppBrowser: { isAvailable: async () => true, openAuth: jest.fn() },
}));
// In-memory Keychain: Core's real React Native stamper creates, lists and
// signs with this key store.
jest.mock(
  "react-native-keychain",
  () => ({
    getAllGenericPasswordServices: async () => [...mockKeychain.keys()],
    getGenericPassword: async ({ service }: { service: string }) =>
      mockKeychain.get(service) ?? false,
    setGenericPassword: async (
      username: string,
      password: string,
      { service }: { service: string },
    ) => {
      mockKeychain.set(service, { username, password });
      return { service };
    },
    resetGenericPassword: async ({ service }: { service: string }) =>
      mockKeychain.delete(service),
  }),
  { virtual: true },
);
// The Provider constructs a real Core client; only OTP verification is
// replaced below, so StampLogin, the fallback and storage all run for real.
jest.mock("@0xkey-io/core", () => {
  const actual =
    jest.requireActual<typeof import("@0xkey-io/core")>("@0xkey-io/core");
  return {
    ...actual,
    getAuthProxyConfig: async () => ({ enabledProviders: ["email"] }),
    ZeroXKeyClient: jest.fn((config: unknown) => {
      const client = new actual.ZeroXKeyClient(
        config as ConstructorParameters<typeof actual.ZeroXKeyClient>[0],
      );
      mockRealClients.push(client);
      return client;
    }),
  };
});

const asyncStorageMock = () => {
  const storage = {
    getItem: async (key: string) => mockAsyncStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockAsyncStorage.set(key, value);
    },
    removeItem: async (key: string) => {
      mockAsyncStorage.delete(key);
    },
  };
  return { __esModule: true, default: storage, ...storage };
};
jest.doMock("@react-native-async-storage/async-storage", asyncStorageMock);
// Core resolves its own copy of AsyncStorage (a different peer set). The
// Provider is required inside the test, after both mocks are registered.
jest.doMock(
  require.resolve("@react-native-async-storage/async-storage", {
    paths: [dirname(require.resolve("@0xkey-io/core"))],
  }),
  asyncStorageMock,
);

// Passkeys are not on the OTP path; the native module cannot load in Node.
jest.doMock(
  require.resolve("@0xkey-io/react-native-passkey-stamper", {
    paths: [dirname(require.resolve("@0xkey-io/core"))],
  }),
  () => ({
    PasskeyStamper: class {
      async stamp(): Promise<never> {
        throw new Error("passkeys are not used in this test");
      }
    },
  }),
);

const STAMP_LOGIN = "https://api.example.test/public/v1/submit/stamp_login";
const OTP_LOGIN_V2 = "https://auth.example.test/v1/otp_login_v2";

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function verifyingKey(compressedHex: string) {
  const point = Buffer.from(
    ECDH.convertKey(
      compressedHex,
      "prime256v1",
      "hex",
      "hex",
      "uncompressed",
    ) as string,
    "hex",
  );
  return createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33).toString("base64url"),
    },
    format: "jwk",
  });
}

function reply(status: number, statusText: string, body: string): Response {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: () => null },
    json: async () => JSON.parse(body),
    text: async () => body,
    clone: () => response,
  };
  return response as unknown as Response;
}

const originalFetch = globalThis.fetch;
beforeAll(() => {
  (globalThis as { RN$Bridgeless?: boolean }).RN$Bridgeless = true;
});
afterAll(() => {
  delete (globalThis as { RN$Bridgeless?: boolean }).RN$Bridgeless;
  globalThis.fetch = originalFetch;
});

it("completeOtp signs an existing user in through otp_login_v2 when the gateway rejects Attested StampLogin", async () => {
  const requests: Array<{ url: string; body: any }> = [];
  let session = "";
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    if (String(url) === STAMP_LOGIN) {
      return reply(401, "Unauthorized", "missing authentication stamp");
    }
    if (String(url) === OTP_LOGIN_V2) {
      return reply(200, "OK", JSON.stringify({ session }));
    }
    throw new Error(`unexpected request ${String(url)}`);
  }) as typeof fetch;

  const { ZeroXKeyProvider } =
    require("../providers/ZeroXKeyProvider") as typeof import("../providers/ZeroXKeyProvider");
  const onAuthenticationSuccess = jest.fn();
  const onError = jest.fn();
  const harness = new ProviderHarness(
    ZeroXKeyProvider as (props: unknown) => unknown,
    {
      organizationId: "parent-org",
      apiBaseUrl: "https://api.example.test",
      authProxyUrl: "https://auth.example.test",
      authProxyConfigId: "config-1",
      autoRefreshManagedState: false,
    } as ZeroXKeyProviderConfig,
    { onAuthenticationSuccess, onError },
  );
  try {
    await harness.settle();
    const client = mockRealClients.at(-1)!;
    const publicKey = await client.createApiKeyPair();
    const verificationToken = `header.${base64url({
      id: "token-1",
      public_key: publicKey,
      contact: "person@example.test",
      verification_type: "OTP_TYPE_EMAIL",
      exp: 2_000_000_000,
    })}.signature`;
    session = `header.${base64url({
      exp: 2_000_000_000,
      public_key: publicKey,
      session_type: "SESSION_TYPE_READ_WRITE",
      user_id: "user-1",
      organization_id: "verified-org",
    })}.signature`;
    client.verifyOtp = async () => ({
      verificationToken,
      subOrganizationId: "verified-org",
    });

    const result = await harness.context.completeOtp({
      otpId: "otp-1",
      otpCode: "123456",
      otpEncryptionTargetBundle: "bundle",
      contact: "person@example.test",
      otpType: "OTP_TYPE_EMAIL" as never,
      publicKey,
    });
    await harness.settle();

    expect(result).toMatchObject({ sessionToken: session, action: "LOGIN" });
    expect(requests.map((request) => request.url)).toEqual([
      STAMP_LOGIN,
      OTP_LOGIN_V2,
    ]);
    const { clientSignature, organizationId } = requests[1]!.body;
    expect(organizationId).toBe("verified-org");
    expect(
      createVerify("SHA256")
        .update(clientSignature.message)
        .verify(
          { key: verifyingKey(publicKey), dsaEncoding: "ieee-p1363" },
          Buffer.from(clientSignature.signature, "hex"),
        ),
    ).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(onAuthenticationSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LOGIN",
        session: expect.objectContaining({ token: session }),
      }),
    );
  } finally {
    harness.unmount();
  }
});
