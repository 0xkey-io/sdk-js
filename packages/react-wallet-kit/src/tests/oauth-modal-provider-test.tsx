/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://app.example.test/"}
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { OAuthProviders, Session } from "@0xkey-io/sdk-types";
import { act, createElement, type ReactNode } from "react";
import type {
  StamperType,
  ZeroXKeyCallbacks,
  ZeroXKeyClient,
  ZeroXKeyProviderConfig,
} from "../index";
import { installOAuthPopups } from "./fixtures/oauth-popup";
import {
  installControlledResizeObserver,
  playerObservations,
  resetPlayerObservations,
  type ControlledResizeObserver,
} from "./fixtures/provider-modal-environment";
import {
  setupProviderDom,
  type MountedProvider,
} from "./fixtures/provider-dom";

jest.mock("@lottiefiles/react-lottie-player", () => {
  const fixture = jest.requireActual<
    typeof import("./fixtures/provider-modal-environment")
  >("./fixtures/provider-modal-environment");
  return { Player: fixture.InstrumentedPlayer };
});

type CoreClient = Pick<
  ZeroXKeyClient,
  | "init"
  | "getAllSessions"
  | "getActiveSessionKey"
  | "createApiKeyPair"
  | "completeOauth"
  | "getSession"
  | "addOauthProvider"
>;
type ProxyOauth = ZeroXKeyClient["httpClient"]["proxyOAuth2Authenticate"];
type ProxyOauthParams = Parameters<ProxyOauth>[0];
type CompleteOauthParams = Parameters<CoreClient["completeOauth"]>[0];
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

type ClientSpec = {
  publicKeys: string[];
  proxy?: (params: ProxyOauthParams) => ReturnType<ProxyOauth>;
  completeOauth?: (
    params: CompleteOauthParams,
  ) => ReturnType<CoreClient["completeOauth"]>;
  getSession?: (
    ...params: Parameters<CoreClient["getSession"]>
  ) => ReturnType<CoreClient["getSession"]>;
  addOauthProvider?: (
    params: AddOauthProviderParams,
  ) => ReturnType<CoreClient["addOauthProvider"]>;
};

let mockSpec: ClientSpec = { publicKeys: [] };
const mockConstructedConfigs: unknown[] = [];
const mockCreatedKeys: string[] = [];
const mockInit = jest.fn(async () => undefined);
const mockGetAllSessions = jest.fn(async () => ({}));
const mockGetActiveSessionKey = jest.fn(async () => undefined);
const mockCreateApiKeyPair = jest.fn(async () => {
  const publicKey = mockSpec.publicKeys.shift();
  if (!publicKey) throw new Error("No synthetic public key remains");
  mockCreatedKeys.push(publicKey);
  return publicKey;
});
const mockCompleteOauth = jest.fn(
  (params: CompleteOauthParams): ReturnType<CoreClient["completeOauth"]> => {
    if (!mockSpec.completeOauth) {
      throw new Error("Unexpected completeOauth call");
    }
    return mockSpec.completeOauth(params);
  },
);
const mockGetSession = jest.fn(
  (...params: Parameters<CoreClient["getSession"]>) => {
    if (!mockSpec.getSession) throw new Error("Unexpected getSession call");
    return mockSpec.getSession(...params);
  },
);
const mockAddOauthProvider = jest.fn((params: AddOauthProviderParams) => {
  if (!mockSpec.addOauthProvider) {
    throw new Error("Unexpected addOauthProvider call");
  }
  return mockSpec.addOauthProvider(params);
});
const mockProxyOauth = jest.fn((params: ProxyOauthParams) => {
  if (!mockSpec.proxy) throw new Error("Unexpected OAuth exchange call");
  return mockSpec.proxy(params);
});
const mockZeroXKeyClient = jest.fn((config: unknown) => {
  mockConstructedConfigs.push(config);
  return {
    init: mockInit,
    getAllSessions: mockGetAllSessions,
    getActiveSessionKey: mockGetActiveSessionKey,
    createApiKeyPair: mockCreateApiKeyPair,
    completeOauth: mockCompleteOauth,
    getSession: mockGetSession,
    addOauthProvider: mockAddOauthProvider,
    httpClient: { proxyOAuth2Authenticate: mockProxyOauth },
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

const redirectUri = "https://app.example.test/oauth/callback";
const animationUrl =
  "https://lottie.host/a7306a93-4125-48e1-b0e9-17904e5a774e/2aVGSPuWWf.json";
const frameSettlingMs = 50;
const closeSettlingMs = 500;
const successDurationMs = 2000;
const expectedHeadlessUiWarning = [
  "Headless UI has polyfilled `Element.prototype.getAnimations` for your tests.",
  "Please install a proper polyfill e.g. `jsdom-testing-mocks`, to silence these warnings.",
  "",
  "Example usage:",
  "```js",
  "import { mockAnimationsApi } from 'jsdom-testing-mocks'",
  "mockAnimationsApi()",
  "```",
].join("\n");

let originalGetAnimationsDescriptor: PropertyDescriptor | undefined;
let installedGetAnimationsDescriptor: PropertyDescriptor | undefined;
const modalWarningCounts: Array<{ caseName: string; count: number }> = [];

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

function resetCore(): void {
  mockSpec = { publicKeys: [] };
  mockConstructedConfigs.length = 0;
  mockCreatedKeys.length = 0;
  mockInit.mockClear();
  mockGetAllSessions.mockClear();
  mockGetActiveSessionKey.mockClear();
  mockCreateApiKeyPair.mockClear();
  mockCompleteOauth.mockClear();
  mockGetSession.mockClear();
  mockAddOauthProvider.mockClear();
  mockProxyOauth.mockClear();
  mockZeroXKeyClient.mockClear();
}

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

async function advanceBy(milliseconds: number): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(milliseconds);
    await Promise.resolve();
  });
  await flush(2);
}

async function advanceTo(startedAt: number, elapsed: number): Promise<void> {
  const remaining = elapsed - (Date.now() - startedAt);
  if (remaining < 0) {
    throw new Error(`The fake clock already passed ${elapsed}ms`);
  }
  await advanceBy(remaining);
  expect(Date.now() - startedAt).toBe(elapsed);
}

type ModalEnvironment = {
  dom: ReturnType<typeof setupProviderDom>;
  popups: ReturnType<typeof installOAuthPopups>;
  resize: ControlledResizeObserver;
  publicExports: typeof import("../index");
  closeProbe: ReactNode;
  mounts: MountedProvider[];
  timerBaseline: number;
};

function sameDescriptor(
  actual: PropertyDescriptor | undefined,
  expected: PropertyDescriptor | undefined,
): boolean {
  if (!actual || !expected) return actual === expected;
  return (
    actual.configurable === expected.configurable &&
    actual.enumerable === expected.enumerable &&
    actual.writable === expected.writable &&
    actual.value === expected.value &&
    actual.get === expected.get &&
    actual.set === expected.set
  );
}

function recordOrAssertHeadlessUiFallback(): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "getAnimations",
  );
  if (!descriptor || typeof descriptor.value !== "function") {
    throw new Error("Headless UI did not install its getAnimations fallback");
  }
  if (!installedGetAnimationsDescriptor) {
    installedGetAnimationsDescriptor = descriptor;
    return;
  }
  if (!sameDescriptor(descriptor, installedGetAnimationsDescriptor)) {
    throw new Error(
      "Headless UI getAnimations fallback identity changed across cases",
    );
  }
}

beforeAll(() => {
  modalWarningCounts.length = 0;
  originalGetAnimationsDescriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "getAnimations",
  );
  if (
    originalGetAnimationsDescriptor !== undefined ||
    typeof Element.prototype.getAnimations !== "undefined"
  ) {
    throw new Error(
      "Expected Element.prototype.getAnimations to be absent before SDK loading",
    );
  }
});

afterAll(() => {
  if (installedGetAnimationsDescriptor) {
    const current = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "getAnimations",
    );
    if (!sameDescriptor(current, installedGetAnimationsDescriptor)) {
      throw new Error(
        "Headless UI getAnimations fallback changed before terminal restoration",
      );
    }
    if (originalGetAnimationsDescriptor) {
      Object.defineProperty(
        Element.prototype,
        "getAnimations",
        originalGetAnimationsDescriptor,
      );
    } else {
      Reflect.deleteProperty(Element.prototype, "getAnimations");
    }
    const restored = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "getAnimations",
    );
    if (
      !sameDescriptor(restored, originalGetAnimationsDescriptor) ||
      (originalGetAnimationsDescriptor === undefined &&
        typeof Element.prototype.getAnimations !== "undefined")
    ) {
      throw new Error(
        "Element.prototype.getAnimations was not restored after the modal suite",
      );
    }
  }
  process.stdout.write(
    `[react-oauth-modal warning-counts] ${JSON.stringify(modalWarningCounts)}\n`,
  );
});

async function withModalEnvironment(
  caseName: string,
  run: (environment: ModalEnvironment) => Promise<void>,
): Promise<void> {
  resetCore();
  resetPlayerObservations();
  const originalBodyOverflow = document.body.style.overflow;
  const resize = installControlledResizeObserver();
  let dom: ReturnType<typeof setupProviderDom> | undefined;
  let popups: ReturnType<typeof installOAuthPopups> | undefined;
  const mounts: MountedProvider[] = [];
  let failure: unknown;

  try {
    const unexpectedFetch = async (input: RequestInfo | URL) => {
      throw new Error(`Unexpected fetch: ${String(input)}`);
    };
    dom = setupProviderDom({ fetchImpl: unexpectedFetch as typeof fetch });
    popups = installOAuthPopups();
    const publicExports = dom.loadPublicExports();
    recordOrAssertHeadlessUiFallback();
    const useModal = publicExports.useModal;

    function CloseProbe(): ReactNode {
      const { closeModal, isMobile, modalStack } = useModal();
      return (
        <div>
          <button type="button" onClick={closeModal}>
            Close modal from public hook
          </button>
          <output data-testid="modal-state">
            {modalStack.length}|{String(isMobile)}
          </output>
        </div>
      );
    }

    const timerBaseline = jest.getTimerCount();
    expect(timerBaseline).toBe(0);
    await run({
      dom,
      popups,
      resize,
      publicExports,
      closeProbe: createElement(CloseProbe),
      mounts,
      timerBaseline,
    });
  } catch (error) {
    failure = error;
  } finally {
    const retain = (error: unknown) => {
      failure ??= error;
    };

    try {
      for (const popup of popups?.handles ?? []) popup.close();
      if (dom) {
        for (const mounted of [...mounts]) await dom.unmount(mounted);
      }
    } catch (error) {
      retain(error);
    }

    try {
      if (dom) {
        await advanceBy(closeSettlingMs);
        const observedTargets = [
          ...new Set(resize.records.flatMap((record) => record.observed)),
        ];
        expect(resize.liveTargets()).toHaveLength(0);
        expect(resize.records.length).toBeGreaterThan(0);
        expect(resize.records.every((record) => record.disconnects > 0)).toBe(
          true,
        );
        for (const target of observedTargets) {
          await expect(
            resize.deliver(target, { width: 1, height: 1 }),
          ).rejects.toThrow("Expected one live ResizeObserver");
        }
        expect(playerObservations.mounts).toBe(playerObservations.unmounts);
        expect(document.body.style.overflow).toBe(originalBodyOverflow);
        expect(
          document.querySelector('[data-testid="test-animation-renderer"]'),
        ).toBeNull();
        expect(
          document.querySelectorAll("[data-headlessui-portal]"),
        ).toHaveLength(0);
        expect(jest.getTimerCount()).toBe(0);
        expect(dom.observations.consoleError).not.toHaveBeenCalled();
        const warningCalls = dom.observations.consoleWarn.mock.calls;
        expect(warningCalls.length).toBeGreaterThan(0);
        for (const call of warningCalls) {
          expect(call).toEqual([expectedHeadlessUiWarning]);
        }
        modalWarningCounts.push({ caseName, count: warningCalls.length });
        expect(dom.observations.getAuthProxyConfig).not.toHaveBeenCalled();
        expect(dom.observations.xhrSend).not.toHaveBeenCalled();
        expect(dom.observations.fetch).not.toHaveBeenCalled();
      }
    } catch (error) {
      retain(error);
    }

    try {
      resize.restore();
    } catch (error) {
      retain(error);
    }

    try {
      if (dom) await dom.restore();
      if (installedGetAnimationsDescriptor) {
        recordOrAssertHeadlessUiFallback();
      }
    } catch (error) {
      retain(error);
    }
  }

  if (failure) throw failure;
}

async function mountReady(
  environment: ModalEnvironment,
  callbacks: ZeroXKeyCallbacks,
): Promise<MountedProvider> {
  const mounted = await environment.dom.mount(
    baseConfig,
    callbacks,
    environment.closeProbe,
  );
  environment.mounts.push(mounted);
  await waitFor(
    () =>
      mounted.context()?.clientState ===
      environment.publicExports.ClientState.Ready,
    "Provider Ready",
  );
  expect(mounted.context()?.clientState).toBe(
    environment.publicExports.ClientState.Ready,
  );
  return mounted;
}

async function startGooglePopup(
  environment: ModalEnvironment,
  mounted: MountedProvider,
  params: {
    organizationId?: string;
    userId?: string;
    stampWith: StamperType;
  },
) {
  const previousCount = environment.popups.handles.length;
  const observed = observe(
    mounted.context()!.handleAddOauthProvider({
      providerName: "google" as OAuthProviders,
      stampWith: params.stampWith,
      successPageDuration: successDurationMs,
      openInPage: false,
      ...(params.organizationId && { organizationId: params.organizationId }),
      ...(params.userId && { userId: params.userId }),
    }),
  );
  await waitFor(
    () =>
      environment.popups.handles.length === previousCount + 1 &&
      environment.popups.handles[previousCount]!.assignedUrls.length === 1,
    "Google add-provider popup URL",
  );
  const popup = environment.popups.handles[previousCount]!;
  return {
    observed,
    popup,
    authorizationUrl: new URL(popup.assignedUrls[0]!),
  };
}

async function deliverGooglePopup(
  popup: ReturnType<typeof installOAuthPopups>["handles"][number],
  authorizationUrl: URL,
  token: string,
): Promise<void> {
  popup.deliver(
    `${redirectUri}#${new URLSearchParams({
      id_token: token,
      state: authorizationUrl.searchParams.get("state")!,
    }).toString()}`,
  );
  await advanceBy(500);
}

function successPage(text: string): HTMLElement | null {
  const paragraph = Array.from(document.querySelectorAll("p")).find(
    (candidate) => candidate.textContent === text,
  );
  return paragraph?.parentElement ?? null;
}

function modalStackLength(mounted: MountedProvider): number {
  const text = mounted.container.querySelector(
    '[data-testid="modal-state"]',
  )?.textContent;
  if (!text) throw new Error("The modal state Probe is unavailable");
  return Number(text.split("|")[0]);
}

function expectDesktop(mounted: MountedProvider): void {
  expect(
    mounted.container.querySelector('[data-testid="modal-state"]')?.textContent,
  ).toMatch(/\|false$/);
}

async function findObservedTarget(
  resize: ControlledResizeObserver,
  text: string,
): Promise<HTMLElement> {
  let target: HTMLElement | undefined;
  await waitFor(() => {
    target = resize
      .liveTargets()
      .find((candidate) => candidate.textContent?.includes(text)) as
      | HTMLElement
      | undefined;
    return target !== undefined;
  }, `ResizeObserver target containing ${text}`);
  return target!;
}

async function measurePage(
  environment: ModalEnvironment,
  mounted: MountedProvider,
  text: string,
): Promise<HTMLElement> {
  expectDesktop(mounted);
  await advanceBy(frameSettlingMs);
  const target = await findObservedTarget(environment.resize, text);
  await environment.resize.deliver(target, { width: 320, height: 240 });
  const panel = target.parentElement;
  expect(panel?.style.width).toBe("320px");
  expect(panel?.style.height).toBe("240px");
  expect(target.style.filter).toBe("blur(10px)");
  await advanceBy(100);
  expect(target.style.filter).toBe("blur(0px)");
  return target;
}

async function waitForPlayer(): Promise<HTMLElement> {
  await waitFor(
    () =>
      document.querySelector('[data-testid="test-animation-renderer"]') !==
      null,
    "instrumented Player mount through Wrapper and Dynamic",
  );
  const player = document.querySelector(
    '[data-testid="test-animation-renderer"]',
  ) as HTMLElement;
  expect(player.textContent).toBe("test animation renderer");
  expect(player.getAttribute("aria-label")).toBe("test animation renderer");
  expect(player.style.height).toBe("300px");
  expect(player.style.width).toBe("300px");
  expect(playerObservations.renders).toEqual([
    {
      src: animationUrl,
      autoplay: true,
      loop: false,
      style: { height: "300px", width: "300px" },
    },
  ]);
  expect(playerObservations.mounts).toBe(1);
  expect(playerObservations.unmounts).toBe(0);
  return player;
}

async function closeFromPublicHook(mounted: MountedProvider): Promise<void> {
  const button = Array.from(mounted.container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Close modal from public hook",
  );
  if (!button) throw new Error("The public-hook close button is unavailable");
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  expect(modalStackLength(mounted)).toBe(0);
}

function session(
  organizationId: string,
  userId: string,
  token: string,
): Session {
  return {
    sessionType: "SESSION_TYPE_READ_WRITE" as Session["sessionType"],
    organizationId,
    userId,
    expiry: 4_102_444_800,
    token,
    publicKey: `public-${token}`,
  };
}

function callbacks() {
  return {
    onOauthRedirect: jest.fn(),
    onAuthenticationSuccess: jest.fn(),
    onError: jest.fn(),
  };
}

function expectNoLoginCompletion(
  configuredCallbacks: ReturnType<typeof callbacks>,
): void {
  expect(configuredCallbacks.onOauthRedirect).not.toHaveBeenCalled();
  expect(configuredCallbacks.onAuthenticationSuccess).not.toHaveBeenCalled();
  expect(configuredCallbacks.onError).not.toHaveBeenCalled();
  expect(mockCompleteOauth).not.toHaveBeenCalled();
}

describe("mounted OAuth add-provider modal behavior", () => {
  it("[P4 modal] times Google popup success from the real SuccessPage mount", async () => {
    await withModalEnvironment("popup-explicit-timed", async (environment) => {
      const addition = deferred<string[]>();
      const configuredCallbacks = callbacks();
      mockSpec.publicKeys = ["popup-explicit-public-key"];
      mockSpec.getSession = async () =>
        session("session-org-loses", "session-user-loses", "explicit-session");
      mockSpec.addOauthProvider = () => addition.promise;

      const mounted = await mountReady(environment, configuredCallbacks);
      const { observed, popup, authorizationUrl } = await startGooglePopup(
        environment,
        mounted,
        {
          organizationId: "explicit-org",
          userId: "explicit-user",
          stampWith: "api-key" as StamperType,
        },
      );

      expect(mockGetSession).toHaveBeenCalledTimes(1);
      expect(mockGetSession).toHaveBeenCalledWith(undefined);
      expect(mockCreatedKeys).toEqual(["popup-explicit-public-key"]);
      expect(
        Object.fromEntries(
          new URLSearchParams(authorizationUrl.searchParams.get("state")!),
        ),
      ).toEqual({
        provider: "google",
        flow: "popup",
        publicKey: "popup-explicit-public-key",
        transactionId: expect.stringMatching(/^[0-9a-f]{32}$/),
      });

      await deliverGooglePopup(
        popup,
        authorizationUrl,
        "popup-explicit-oidc-token",
      );
      expect(mockAddOauthProvider).toHaveBeenCalledTimes(1);
      expect(mockAddOauthProvider).toHaveBeenCalledWith({
        providerName: "google",
        oidcToken: "popup-explicit-oidc-token",
        organizationId: "explicit-org",
        userId: "explicit-user",
        stampWith: "api-key" as StamperType,
      });
      expect(observed.outcome()).toEqual({ status: "pending" });
      expect(
        successPage("Successfully added google OAuth provider!"),
      ).toBeNull();
      expectNoLoginCompletion(configuredCallbacks);

      await act(async () => {
        addition.resolve(["provider-added"]);
        await Promise.resolve();
      });
      await observed.settled;
      expect(observed.outcome()).toEqual({
        status: "fulfilled",
        value: undefined,
      });
      expect(popup.close).toHaveBeenCalledTimes(1);
      await waitFor(
        () => successPage("Successfully added google OAuth provider!") !== null,
        "real Google SuccessPage",
      );
      const successMountedAt = Date.now();
      const player = await waitForPlayer();
      await measurePage(
        environment,
        mounted,
        "Successfully added google OAuth provider!",
      );

      const page = successPage("Successfully added google OAuth provider!")!;
      await advanceTo(successMountedAt, 299);
      expect(page.querySelector(".animate-ping")).toBeNull();
      await advanceTo(successMountedAt, 300);
      expect(page.querySelector(".animate-ping")).not.toBeNull();
      await advanceTo(successMountedAt, 1999);
      expect(
        successPage("Successfully added google OAuth provider!"),
      ).not.toBeNull();
      expect(document.body.contains(player)).toBe(true);
      expect(modalStackLength(mounted)).toBeGreaterThan(0);
      await advanceTo(successMountedAt, 2000);
      expect(modalStackLength(mounted)).toBe(0);
      await advanceBy(closeSettlingMs);
      expect(
        successPage("Successfully added google OAuth provider!"),
      ).toBeNull();
      expect(document.body.contains(player)).toBe(false);
      expect(playerObservations.unmounts).toBe(1);
      expect(mockAddOauthProvider).toHaveBeenCalledTimes(1);
      expectNoLoginCompletion(configuredCallbacks);
    });
  });

  it("[P4 modal] uses the session subject and cancels success timers on public-hook close", async () => {
    await withModalEnvironment("popup-session-close", async (environment) => {
      const addition = deferred<string[]>();
      const configuredCallbacks = callbacks();
      mockSpec.publicKeys = ["popup-fallback-public-key"];
      mockSpec.getSession = async () =>
        session("fallback-org", "fallback-user", "fallback-session");
      mockSpec.addOauthProvider = () => addition.promise;

      const mounted = await mountReady(environment, configuredCallbacks);
      const { observed, popup, authorizationUrl } = await startGooglePopup(
        environment,
        mounted,
        { stampWith: "passkey" as StamperType },
      );
      await deliverGooglePopup(
        popup,
        authorizationUrl,
        "popup-fallback-oidc-token",
      );
      expect(mockGetSession).toHaveBeenCalledTimes(1);
      expect(mockAddOauthProvider).toHaveBeenCalledWith({
        providerName: "google",
        oidcToken: "popup-fallback-oidc-token",
        organizationId: "fallback-org",
        userId: "fallback-user",
        stampWith: "passkey" as StamperType,
      });
      expect(observed.outcome()).toEqual({ status: "pending" });
      expectNoLoginCompletion(configuredCallbacks);

      await act(async () => {
        addition.resolve(["provider-added"]);
        await Promise.resolve();
      });
      await observed.settled;
      expect(observed.outcome()).toEqual({
        status: "fulfilled",
        value: undefined,
      });
      expect(popup.close).toHaveBeenCalledTimes(1);
      await waitFor(
        () => successPage("Successfully added google OAuth provider!") !== null,
        "fallback-subject SuccessPage",
      );
      const successMountedAt = Date.now();
      const player = await waitForPlayer();
      await measurePage(
        environment,
        mounted,
        "Successfully added google OAuth provider!",
      );

      await closeFromPublicHook(mounted);
      await advanceBy(closeSettlingMs);
      await advanceBy(frameSettlingMs);
      expect(
        successPage("Successfully added google OAuth provider!"),
      ).toBeNull();
      expect(document.body.contains(player)).toBe(false);
      expect(playerObservations.unmounts).toBe(1);
      expect(Date.now()).toBeLessThan(successMountedAt + successDurationMs);
      expect(jest.getTimerCount()).toBe(environment.timerBaseline);
      await advanceTo(successMountedAt, successDurationMs + 1);
      expect(modalStackLength(mounted)).toBe(0);
      expect(mockAddOauthProvider).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(environment.timerBaseline);
      expectNoLoginCompletion(configuredCallbacks);
    });
  });

  it("[P4 modal] runs seeded Discord redirect through ActionPage and closes through the public hook", async () => {
    await withModalEnvironment("redirect-action-close", async (environment) => {
      const addition = deferred<string[]>();
      const configuredCallbacks = callbacks();
      mockSpec.proxy = async () => ({ oidcToken: "redirect-discord-token" });
      mockSpec.addOauthProvider = () => addition.promise;

      localStorage.setItem("discord_verifier", "seeded-discord-verifier");
      localStorage.setItem(
        "oauth_add_provider_metadata",
        JSON.stringify({
          organizationId: "redirect-org",
          userId: "redirect-user",
          stampWith: "api-key",
          successPageDuration: successDurationMs,
        }),
      );
      const state = new URLSearchParams({
        provider: "discord",
        flow: "redirect",
        publicKey: "redirect-public-key",
        nonce: "redirect-nonce",
        oauthIntent: "addProvider",
        openModal: "true",
      }).toString();
      window.history.replaceState(
        null,
        document.title,
        `/oauth/callback?${new URLSearchParams({
          code: "redirect-discord-code",
          state,
        }).toString()}`,
      );

      const mounted = await environment.dom.mount(
        baseConfig,
        configuredCallbacks,
        environment.closeProbe,
      );
      environment.mounts.push(mounted);
      await waitFor(
        () =>
          document.body.textContent?.includes("Adding Discord provider...") ===
          true,
        "real Discord ActionPage",
      );
      await waitFor(
        () => mockAddOauthProvider.mock.calls.length === 1,
        "ActionPage-driven addOauthProvider call",
      );
      expect(mounted.context()?.clientState).toBe(
        environment.publicExports.ClientState.Loading,
      );
      expect(mockProxyOauth).toHaveBeenCalledTimes(1);
      expect(mockProxyOauth).toHaveBeenCalledWith({
        provider: "OAUTH2_PROVIDER_DISCORD",
        authCode: "redirect-discord-code",
        redirectUri,
        codeVerifier: "seeded-discord-verifier",
        clientId: "discord-A",
        nonce: "redirect-nonce",
      });
      expect(mockAddOauthProvider).toHaveBeenCalledWith({
        providerName: "discord",
        oidcToken: "redirect-discord-token",
        organizationId: "redirect-org",
        userId: "redirect-user",
        stampWith: "api-key" as StamperType,
      });
      expectNoLoginCompletion(configuredCallbacks);

      await measurePage(environment, mounted, "Adding Discord provider...");
      expect(mockAddOauthProvider).toHaveBeenCalledTimes(1);

      await act(async () => {
        addition.resolve(["provider-added"]);
        await Promise.resolve();
      });
      await waitFor(
        () =>
          successPage("Successfully added Discord OAuth provider!") !== null,
        "real Discord SuccessPage",
      );
      const successMountedAt = Date.now();
      const player = await waitForPlayer();
      await waitFor(
        () =>
          mounted.context()?.clientState ===
          environment.publicExports.ClientState.Ready,
        "Provider Ready after redirect add",
      );
      expect(localStorage.getItem("oauth_add_provider_metadata")).toBeNull();
      expect(localStorage.getItem("discord_verifier")).toBeNull();
      expect(window.location.pathname).toBe("/oauth/callback");
      expect(window.location.search).toBe("");
      expect(window.location.hash).toBe("");
      await measurePage(
        environment,
        mounted,
        "Successfully added Discord OAuth provider!",
      );

      await closeFromPublicHook(mounted);
      await advanceBy(closeSettlingMs);
      await advanceBy(frameSettlingMs);
      expect(
        successPage("Successfully added Discord OAuth provider!"),
      ).toBeNull();
      expect(document.body.contains(player)).toBe(false);
      expect(playerObservations.unmounts).toBe(1);
      expect(Date.now()).toBeLessThan(successMountedAt + successDurationMs);
      expect(jest.getTimerCount()).toBe(environment.timerBaseline);
      await advanceTo(successMountedAt, successDurationMs + 1);
      expect(modalStackLength(mounted)).toBe(0);
      expect(mockProxyOauth).toHaveBeenCalledTimes(1);
      expect(mockAddOauthProvider).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(environment.timerBaseline);
      expectNoLoginCompletion(configuredCallbacks);
    });
  });
});
