/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://app.example.test/"}
 */
import { describe, expect, it, jest } from "@jest/globals";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TextDecoder, TextEncoder } from "node:util";
import type {
  ClientContextType,
  ZeroXKeyClient,
  ZeroXKeyProviderConfig,
} from "../index";

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

let mockInitDeferred: Deferred<void>;
let mockActiveSessionDeferred: Deferred<string | undefined>;
const mockConstructedConfigs: unknown[] = [];
const mockInit = jest.fn(() => mockInitDeferred.promise);
const mockGetAllSessions = jest.fn(async () => ({}));
const mockGetActiveSessionKey = jest.fn(
  () => mockActiveSessionDeferred.promise,
);
const mockZeroXKeyClient = jest.fn((config: unknown) => {
  mockConstructedConfigs.push(config);
  return {
    init: mockInit,
    getAllSessions: mockGetAllSessions,
    getActiveSessionKey: mockGetActiveSessionKey,
  } satisfies Pick<
    ZeroXKeyClient,
    "init" | "getAllSessions" | "getActiveSessionKey"
  >;
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
  organizationId: "org-harness",
  apiBaseUrl: "https://api.example.test",
  authProxyUrl: "https://auth.example.test",
  autoFetchWalletKitConfig: false,
  autoRefreshManagedState: false,
  auth: {
    methods: { walletAuthEnabled: false },
    autoRefreshSession: false,
  },
  walletConfig: {
    features: { auth: false, connecting: false },
    chains: {
      ethereum: { native: false },
      solana: { native: false },
    },
  },
};

let latestContext: ClientContextType | undefined;
let AuthState: (typeof import("../index"))["AuthState"];
let ClientState: (typeof import("../index"))["ClientState"];
let ZeroXKeyProvider: (typeof import("../index"))["ZeroXKeyProvider"];
let useZeroXKey: (typeof import("../index"))["useZeroXKey"];

function Probe(): ReactNode {
  const context = useZeroXKey();
  latestContext = context;
  return (
    <output data-testid="provider-state">
      {context.clientState ?? "unset"}|{context.authState}
    </output>
  );
}

describe("ZeroXKeyProvider harness", () => {
  it("initializes through Loading and unmounts after becoming Ready", async () => {
    const textEncoderDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "TextEncoder",
    );
    const textDecoderDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "TextDecoder",
    );
    Object.defineProperty(globalThis, "TextEncoder", {
      configurable: true,
      writable: true,
      value: TextEncoder,
    });
    Object.defineProperty(globalThis, "TextDecoder", {
      configurable: true,
      writable: true,
      value: TextDecoder,
    });

    jest.useFakeTimers();
    localStorage.clear();
    mockInitDeferred = deferred<void>();
    mockActiveSessionDeferred = deferred<string | undefined>();
    mockConstructedConfigs.length = 0;
    mockInit.mockClear();
    mockGetAllSessions.mockClear();
    mockGetActiveSessionKey.mockClear();
    mockZeroXKeyClient.mockClear();
    latestContext = undefined;

    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const actEnvironmentDescriptor = Object.getOwnPropertyDescriptor(
      actEnvironment,
      "IS_REACT_ACT_ENVIRONMENT",
    );
    Object.defineProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      writable: true,
      value: true,
    });

    let container: HTMLDivElement | undefined;
    let root: Root | undefined;
    let unmounted = false;

    try {
      const originalConsoleError = console.error;
      const originalConsoleWarn = console.warn;
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation((...args: Parameters<typeof console.error>) =>
          originalConsoleError(...args),
        );
      const consoleWarn = jest
        .spyOn(console, "warn")
        .mockImplementation((...args: Parameters<typeof console.warn>) =>
          originalConsoleWarn(...args),
        );
      const addEventListener = jest.spyOn(window, "addEventListener");
      const removeEventListener = jest.spyOn(window, "removeEventListener");
      const xhrSend = jest.spyOn(window.XMLHttpRequest.prototype, "send");
      const fetchSpy =
        typeof globalThis.fetch === "function"
          ? jest.spyOn(globalThis, "fetch")
          : undefined;
      const core =
        jest.requireMock<typeof import("@0xkey-io/core")>("@0xkey-io/core");
      const getAuthProxyConfig = jest.spyOn(core, "getAuthProxyConfig");
      const actualIndex =
        jest.requireActual<typeof import("../index")>("../index");
      ({ AuthState, ClientState, ZeroXKeyProvider, useZeroXKey } = actualIndex);

      const callbacks = {
        onError: jest.fn(),
        onOauthRedirect: jest.fn(),
        onAuthenticationSuccess: jest.fn(),
      };
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      expect(window.location.search).toBe("");
      expect(window.location.hash).toBe("");

      await act(async () => {
        root!.render(
          <ZeroXKeyProvider config={config} callbacks={callbacks}>
            <Probe />
          </ZeroXKeyProvider>,
        );
      });

      expect(mockZeroXKeyClient).toHaveBeenCalledTimes(1);
      expect(mockConstructedConfigs).toEqual([
        expect.objectContaining({
          organizationId: "org-harness",
          walletConfig: expect.objectContaining({
            features: expect.objectContaining({
              auth: false,
              connecting: false,
            }),
            chains: {
              ethereum: { native: false },
              solana: { native: false },
            },
          }),
        }),
      ]);
      expect(mockInit).toHaveBeenCalledTimes(1);
      expect(
        container.querySelector('[data-testid="provider-state"]')?.textContent,
      ).toBe(`${ClientState.Loading}|${AuthState.Unauthenticated}`);
      expect(mockGetAllSessions).not.toHaveBeenCalled();
      expect(mockGetActiveSessionKey).not.toHaveBeenCalled();

      await act(async () => {
        mockInitDeferred.resolve();
        await Promise.resolve();
      });

      expect(mockGetAllSessions).toHaveBeenCalledTimes(1);
      expect(mockGetActiveSessionKey).toHaveBeenCalledTimes(1);
      expect(
        container.querySelector('[data-testid="provider-state"]')?.textContent,
      ).toBe(`${ClientState.Loading}|${AuthState.Unauthenticated}`);

      await act(async () => {
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });

      expect(
        container.querySelector('[data-testid="provider-state"]')?.textContent,
      ).toBe(`${ClientState.Ready}|${AuthState.Unauthenticated}`);
      const readyContext = latestContext as ClientContextType | undefined;
      expect(readyContext?.session).toBeUndefined();
      expect(readyContext?.allSessions).toEqual({});
      expect(callbacks.onError).not.toHaveBeenCalled();
      expect(callbacks.onOauthRedirect).not.toHaveBeenCalled();
      expect(callbacks.onAuthenticationSuccess).not.toHaveBeenCalled();
      expect(getAuthProxyConfig).not.toHaveBeenCalled();
      expect(fetchSpy?.mock.calls ?? []).toHaveLength(0);
      expect(xhrSend).not.toHaveBeenCalled();

      const resizeHandlers = addEventListener.mock.calls
        .filter(([type]) => type === "resize")
        .map(([, handler]) => handler);
      expect(resizeHandlers).toHaveLength(1);

      await act(async () => {
        root!.unmount();
        await Promise.resolve();
      });
      unmounted = true;

      expect(container.firstChild).toBeNull();
      expect(removeEventListener).toHaveBeenCalledWith(
        "resize",
        resizeHandlers[0],
      );
      expect(jest.getTimerCount()).toBe(0);
      expect(consoleError).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
    } finally {
      if (root && !unmounted) {
        const mountedRoot = root;
        await act(async () => {
          mountedRoot.unmount();
          await Promise.resolve();
        });
      }
      container?.remove();
      if (actEnvironmentDescriptor) {
        Object.defineProperty(
          actEnvironment,
          "IS_REACT_ACT_ENVIRONMENT",
          actEnvironmentDescriptor,
        );
      } else {
        Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
      }
      jest.useRealTimers();
      jest.restoreAllMocks();
      localStorage.clear();
      if (textEncoderDescriptor) {
        Object.defineProperty(globalThis, "TextEncoder", textEncoderDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "TextEncoder");
      }
      if (textDecoderDescriptor) {
        Object.defineProperty(globalThis, "TextDecoder", textDecoderDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "TextDecoder");
      }
    }
  });
});
