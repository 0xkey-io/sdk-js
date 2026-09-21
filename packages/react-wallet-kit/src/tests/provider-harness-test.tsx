/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://app.example.test/"}
 */
import { describe, expect, it, jest } from "@jest/globals";
import { act } from "react";
import type {
  ClientContextType,
  ZeroXKeyClient,
  ZeroXKeyProviderConfig,
} from "../index";
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

describe("ZeroXKeyProvider harness", () => {
  it("initializes through Loading and unmounts after becoming Ready", async () => {
    mockInitDeferred = deferred<void>();
    mockActiveSessionDeferred = deferred<string | undefined>();
    mockConstructedConfigs.length = 0;
    mockInit.mockClear();
    mockGetAllSessions.mockClear();
    mockGetActiveSessionKey.mockClear();
    mockZeroXKeyClient.mockClear();

    const dom = setupProviderDom();
    let mounted: MountedProvider | undefined;
    try {
      const { AuthState, ClientState } = dom.loadPublicExports();
      const callbacks = {
        onError: jest.fn(),
        onOauthRedirect: jest.fn(),
        onAuthenticationSuccess: jest.fn(),
      };

      expect(window.location.search).toBe("");
      expect(window.location.hash).toBe("");
      mounted = await dom.mount(config, callbacks);

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
        mounted.container.querySelector('[data-testid="provider-state"]')
          ?.textContent,
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
        mounted.container.querySelector('[data-testid="provider-state"]')
          ?.textContent,
      ).toBe(`${ClientState.Loading}|${AuthState.Unauthenticated}`);

      await act(async () => {
        mockActiveSessionDeferred.resolve(undefined);
        await Promise.resolve();
      });

      expect(
        mounted.container.querySelector('[data-testid="provider-state"]')
          ?.textContent,
      ).toBe(`${ClientState.Ready}|${AuthState.Unauthenticated}`);
      const readyContext = mounted.context() as ClientContextType | undefined;
      expect(readyContext?.session).toBeUndefined();
      expect(readyContext?.allSessions).toEqual({});
      expect(callbacks.onError).not.toHaveBeenCalled();
      expect(callbacks.onOauthRedirect).not.toHaveBeenCalled();
      expect(callbacks.onAuthenticationSuccess).not.toHaveBeenCalled();
      expect(dom.observations.getAuthProxyConfig).not.toHaveBeenCalled();
      expect(dom.observations.fetch?.mock.calls ?? []).toHaveLength(0);
      expect(dom.observations.xhrSend).not.toHaveBeenCalled();

      const resizeHandlers = dom.observations.addEventListener.mock.calls
        .filter(([type]) => type === "resize")
        .map(([, handler]) => handler);
      expect(resizeHandlers).toHaveLength(1);

      await dom.unmount(mounted);
      expect(mounted.container.firstChild).toBeNull();
      expect(dom.observations.removeEventListener).toHaveBeenCalledWith(
        "resize",
        resizeHandlers[0],
      );
      expect(jest.getTimerCount()).toBe(0);
      expect(dom.observations.consoleError).not.toHaveBeenCalled();
      expect(dom.observations.consoleWarn).not.toHaveBeenCalled();
    } finally {
      if (mounted) await dom.unmount(mounted);
      await dom.restore();
    }
  });
});
