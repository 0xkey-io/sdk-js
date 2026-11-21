import { afterAll, beforeAll, expect, it, jest } from "@jest/globals";
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
let mockDashboardConfig: Record<string, unknown> = { enabledProviders: [] };
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
  default: { getApplicationName: () => "app", getBundleId: () => "app.id" },
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
    getAuthProxyConfig: async () => mockDashboardConfig,
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

beforeAll(() => {
  (globalThis as { RN$Bridgeless?: boolean }).RN$Bridgeless = true;
});
afterAll(() => {
  delete (globalThis as { RN$Bridgeless?: boolean }).RN$Bridgeless;
});

const UNSET = ["0", "-5", "abc", "", "NaN"];

// Mounts the Provider with a real Core client whose sign-in and refresh methods
// are replaced, then calls every entry point that applies a session length.
async function lengthsFor(options: {
  dashboard: string | undefined;
  local: string | undefined;
  caller?: string;
}) {
  mockDashboardConfig = {
    enabledProviders: [],
    ...(options.dashboard !== undefined && {
      sessionExpirationSeconds: options.dashboard,
    }),
  };
  const { ZeroXKeyProvider } =
    require("../providers/ZeroXKeyProvider") as typeof import("../providers/ZeroXKeyProvider");
  const harness = new ProviderHarness(
    ZeroXKeyProvider as (props: unknown) => unknown,
    {
      organizationId: "parent-org",
      apiBaseUrl: "https://api.example.test",
      authProxyUrl: "https://auth.example.test",
      authProxyConfigId: "config-1",
      autoRefreshManagedState: false,
      ...(options.local !== undefined && {
        auth: { sessionExpirationSeconds: options.local },
      }),
    } as ZeroXKeyProviderConfig,
  );
  try {
    await harness.settle();
    const client = mockRealClients.at(-1)!;
    const stubs = {
      loginWithPasskey: jest.fn(async (_params: unknown) => undefined),
      signUpWithPasskey: jest.fn(async (_params: unknown) => undefined),
      loginWithOtp: jest.fn(async (_params: unknown) => undefined),
      signUpWithOtp: jest.fn(async (_params: unknown) => undefined),
      completeOtp: jest.fn(async (_params: unknown) => undefined),
      refreshSession: jest.fn(async (_params: unknown) => undefined),
    };
    Object.assign(client, stubs, {
      getActiveSessionKey: async () => "session-key",
    });
    const call = {
      ...(options.caller !== undefined && {
        expirationSeconds: options.caller,
      }),
    };
    const context = harness.context as any;
    await context.loginWithPasskey(call);
    await context.signUpWithPasskey(call);
    await context.loginWithOtp({ verificationToken: "v", ...call });
    await context.signUpWithOtp({
      verificationToken: "v",
      contact: "a@example.test",
      otpType: "OTP_TYPE_EMAIL",
      ...call,
    });
    await context.completeOtp({
      otpId: "o",
      otpCode: "1",
      otpEncryptionTargetBundle: "b",
      contact: "a@example.test",
      otpType: "OTP_TYPE_EMAIL",
      ...call,
    });
    await context.refreshSession(call);
    return Object.values(stubs).map(
      (stub) => (stub.mock.calls[0]![0] as any).expirationSeconds,
    );
  } finally {
    harness.unmount();
  }
}

it.each(UNSET)(
  "local value %p is unset and the default of 900 applies",
  async (local) => {
    expect(await lengthsFor({ dashboard: undefined, local })).toEqual(
      Array(6).fill("900"),
    );
  },
);

it.each(UNSET)(
  "Dashboard value %p is unset and the local value applies",
  async (dashboard) => {
    expect(await lengthsFor({ dashboard, local: "3600" })).toEqual(
      Array(6).fill("3600"),
    );
  },
);

it.each(UNSET)(
  "Dashboard value %p with no local value falls back to 900",
  async (dashboard) => {
    expect(await lengthsFor({ dashboard, local: undefined })).toEqual(
      Array(6).fill("900"),
    );
  },
);

it("a valid Dashboard value beats the local value", async () => {
  expect(await lengthsFor({ dashboard: "7200", local: "3600" })).toEqual(
    Array(6).fill("7200"),
  );
});

it.each(UNSET)(
  "caller value %p is unset and the Dashboard value applies",
  async (caller) => {
    expect(
      await lengthsFor({ dashboard: "7200", local: "3600", caller }),
    ).toEqual(Array(6).fill("7200"));
  },
);

it("a valid caller value beats the Dashboard value", async () => {
  expect(
    await lengthsFor({ dashboard: "7200", local: "3600", caller: "60" }),
  ).toEqual(Array(6).fill("60"));
});
