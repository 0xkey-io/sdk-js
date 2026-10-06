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
import { AuthAction } from "@0xkey-io/sdk-types";
import type { ZeroXKeyClient, ZeroXKeyProviderConfig } from "../index";
import {
  setupProviderDom,
  type MountedProvider,
} from "./fixtures/provider-dom";

type ClientParams = { turnstileSiteKey?: string };
type Challenge = { token: string; reset(): void };
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

const mockGetClientParams = jest.fn(
  async (_configId: string, _url?: string): Promise<ClientParams> => ({}),
);
const mockInitOtp = jest.fn(async (_params: unknown) => ({
  otpId: "otp-1",
  otpEncryptionTargetBundle: "bundle-1",
}));
const mockSignUpWithWallet = jest.fn(
  async (_params: unknown, _gate?: unknown): Promise<unknown> => undefined,
);
const mockSignUpWithPasskey = jest.fn(
  async (_params: unknown, _gate?: unknown): Promise<unknown> => undefined,
);
const mockLoginOrSignupWithWallet = jest.fn(
  async (_params: unknown, _gate?: unknown): Promise<unknown> => undefined,
);
const mockSignUpWithOtp = jest.fn(async (_params: unknown) => undefined);
const mockLoginWithOtp = jest.fn(async (_params: unknown) => undefined);
const mockSignUpWithOauth = jest.fn(async (_params: unknown) => ({
  sessionToken: "oauth-session",
}));
const mockLoginWithOauth = jest.fn(async (_params: unknown) => undefined);
const mockCompleteOauth = jest.fn(async (_params: unknown) => undefined);
const mockChallengeCalls: Array<{
  siteKey: string;
  signal: AbortSignal;
  result: Deferred<Challenge>;
}> = [];
const mockDispose = jest.fn();
const createMockChallengeRenderer = (_container: HTMLElement) => ({
  challenge(siteKey: string, signal: AbortSignal): Promise<Challenge> {
    const result = deferred<Challenge>();
    mockChallengeCalls.push({ siteKey, signal, result });
    return result.promise;
  },
  dispose: mockDispose,
});
const mockCreateTurnstileChallengeRenderer = jest.fn(
  createMockChallengeRenderer,
);

const mockZeroXKeyClient = jest.fn((config: ZeroXKeyProviderConfig) => {
  const httpClient = {
    config: {
      authProxyUrl: config.authProxyUrl,
      authProxyConfigId: config.authProxyConfigId,
      organizationId: config.organizationId,
      apiBaseUrl: config.apiBaseUrl,
    },
  };
  return {
    config,
    init: async () => undefined,
    restrictPersistedCredentialsToNewSessions: () => undefined,
    setAuthContextGuard: () => undefined,
    getAllSessions: async () => ({}),
    getActiveSessionKey: async () => undefined,
    getSession: async () => undefined,
    get httpClient() {
      return httpClient;
    },
    initOtp: mockInitOtp,
    signUpWithWallet: mockSignUpWithWallet,
    signUpWithPasskey: mockSignUpWithPasskey,
    loginOrSignupWithWallet: mockLoginOrSignupWithWallet,
    signUpWithOtp: mockSignUpWithOtp,
    loginWithOtp: mockLoginWithOtp,
    signUpWithOauth: mockSignUpWithOauth,
    loginWithOauth: mockLoginWithOauth,
    completeOauth: mockCompleteOauth,
  } as unknown as ZeroXKeyClient;
});

jest.mock("@0xkey-io/core", () => {
  const actual =
    jest.requireActual<typeof import("@0xkey-io/core")>("@0xkey-io/core");
  return {
    ...actual,
    ZeroXKeyClient: mockZeroXKeyClient,
    getClientParams: mockGetClientParams,
  };
});

jest.mock("../utils/captcha-turnstile-renderer", () => ({
  createTurnstileChallengeRenderer: mockCreateTurnstileChallengeRenderer,
}));

const baseConfig: ZeroXKeyProviderConfig = {
  organizationId: "org-captcha",
  apiBaseUrl: "https://api.example.test",
  authProxyUrl: "https://auth.example.test",
  authProxyConfigId: "config-A",
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

let dom: ReturnType<typeof setupProviderDom>;
let mounted: MountedProvider;
let publicExports: typeof import("../index");

async function flush(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  });
}

function start<T>(invoke: () => Promise<T>): Promise<T> {
  let pending!: Promise<T>;
  act(() => {
    pending = invoke();
    void pending.catch(() => undefined);
  });
  return pending;
}

async function mountReady(config = baseConfig): Promise<MountedProvider> {
  const errors: unknown[] = [];
  const handle = await dom.mount(config, {
    onError: (error) => errors.push(error),
  });
  for (let index = 0; index < 40; index += 1) {
    await flush();
    if (handle.context()?.clientState === publicExports.ClientState.Ready) {
      return handle;
    }
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
  }
  throw new Error(
    `Provider did not become ready: ${String(handle.context()?.clientState)} / ${String(errors[0])} / ${String((errors[0] as { cause?: unknown })?.cause)}`,
  );
}

beforeEach(() => {
  mockGetClientParams.mockReset();
  mockInitOtp.mockClear();
  mockSignUpWithWallet.mockClear();
  mockSignUpWithPasskey.mockReset();
  mockLoginOrSignupWithWallet.mockReset();
  mockSignUpWithOtp.mockClear();
  mockLoginWithOtp.mockClear();
  mockSignUpWithOauth.mockClear();
  mockLoginWithOauth.mockClear();
  mockCompleteOauth.mockClear();
  mockChallengeCalls.length = 0;
  mockDispose.mockClear();
  mockCreateTurnstileChallengeRenderer.mockReset();
  mockCreateTurnstileChallengeRenderer.mockImplementation(
    createMockChallengeRenderer,
  );
  mockZeroXKeyClient.mockClear();
  dom = setupProviderDom();
  publicExports = dom.loadPublicExports();
});

afterEach(async () => {
  await dom.restore();
});

describe("mounted Provider Captcha gate", () => {
  it("waits for passkey creation before challenging and ignores the caller token", async () => {
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    const passkeyCreated = deferred<void>();
    const signupSubmitted = jest.fn(async (_token?: string) => undefined);
    mockSignUpWithPasskey.mockImplementationOnce(async (_params, gate) => {
      await passkeyCreated.promise;
      return (gate as (submit: typeof signupSubmitted) => Promise<unknown>)(
        signupSubmitted,
      );
    });
    mounted = await mountReady();
    const signup = start(() =>
      mounted.context()!.signUpWithPasskey({ captchaToken: "caller-token" }),
    );
    await flush();
    expect(mockGetClientParams).not.toHaveBeenCalled();
    expect(mockChallengeCalls).toHaveLength(0);
    expect(mockSignUpWithPasskey.mock.calls[0]![0]).not.toHaveProperty(
      "captchaToken",
    );
    await act(async () => passkeyCreated.resolve());
    await flush();
    expect(mockChallengeCalls).toHaveLength(1);
    await act(async () => {
      mockChallengeCalls[0]!.result.resolve({
        token: "fresh-passkey",
        reset: jest.fn(),
      });
      await signup;
    });
    expect(signupSubmitted).toHaveBeenCalledWith("fresh-passkey");
  });

  it.each([false, true])(
    "wallet mixed flow only challenges after lookup when signup=%s",
    async (signupBranch) => {
      mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
      const lookupDone = deferred<void>();
      const signupSubmitted = jest.fn(async (_token?: string) => undefined);
      mockLoginOrSignupWithWallet.mockImplementationOnce(
        async (_params, gate) => {
          await lookupDone.promise;
          if (signupBranch)
            return (
              gate as (submit: typeof signupSubmitted) => Promise<unknown>
            )(signupSubmitted);
          return undefined;
        },
      );
      mounted = await mountReady();
      const attempt = start(() =>
        mounted.context()!.loginOrSignupWithWallet({
          walletProvider: {} as any,
          captchaToken: "caller-token",
        }),
      );
      await flush();
      expect(mockGetClientParams).not.toHaveBeenCalled();
      expect(mockLoginOrSignupWithWallet.mock.calls[0]![0]).not.toHaveProperty(
        "captchaToken",
      );
      await act(async () => lookupDone.resolve());
      await flush();
      expect(mockChallengeCalls).toHaveLength(signupBranch ? 1 : 0);
      if (signupBranch) {
        await act(async () => {
          mockChallengeCalls[0]!.result.resolve({
            token: "fresh-wallet",
            reset: jest.fn(),
          });
          await attempt;
        });
        expect(signupSubmitted).toHaveBeenCalledWith("fresh-wallet");
      } else {
        await attempt;
        expect(signupSubmitted).not.toHaveBeenCalled();
      }
    },
  );

  it("direct wallet signup waits for signing before challenging", async () => {
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    const signed = deferred<void>();
    const signupSubmitted = jest.fn(async (_token?: string) => undefined);
    mockSignUpWithWallet.mockImplementationOnce(async (_params, gate) => {
      await signed.promise;
      return (gate as (submit: typeof signupSubmitted) => Promise<unknown>)(
        signupSubmitted,
      );
    });
    mounted = await mountReady();
    const signup = start(() =>
      mounted.context()!.signUpWithWallet({
        walletProvider: {} as any,
        captchaToken: "caller-token",
      }),
    );
    await flush();
    expect(mockSignUpWithWallet).toHaveBeenCalledTimes(1);
    expect(mockSignUpWithWallet.mock.calls[0]![0]).not.toHaveProperty(
      "captchaToken",
    );
    expect(mockGetClientParams).not.toHaveBeenCalled();
    expect(mockChallengeCalls).toHaveLength(0);
    await act(async () => signed.resolve());
    await flush();
    expect(mockChallengeCalls).toHaveLength(1);
    await act(async () => {
      mockChallengeCalls[0]!.result.resolve({
        token: "fresh-after-signing",
        reset: jest.fn(),
      });
      await signup;
    });
    expect(signupSubmitted).toHaveBeenCalledWith("fresh-after-signing");
  });
  const oauthSignup = () => ({
    oidcToken: "oidc-for-this-attempt",
    publicKey: "oauth-public-key",
    captchaToken: "caller-token",
  });

  it("challenges a direct OAuth signup once and reports the signup action", async () => {
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    const onAuthenticationSuccess = jest.fn();
    const onError = jest.fn();
    mounted = await mountReady();
    await mounted.rerender(baseConfig, { onAuthenticationSuccess, onError });
    const signup = start(() =>
      mounted.context()!.signUpWithOauth(oauthSignup()),
    );
    await flush();
    expect(mockSignUpWithOauth).not.toHaveBeenCalled();
    expect(mockChallengeCalls).toHaveLength(1);
    const reset = jest.fn();
    await act(async () => {
      mockChallengeCalls[0]!.result.resolve({
        token: "fresh-oauth-token",
        reset,
      });
      await signup;
    });
    expect(mockSignUpWithOauth).toHaveBeenCalledTimes(1);
    expect(mockSignUpWithOauth).toHaveBeenCalledWith({
      oidcToken: "oidc-for-this-attempt",
      publicKey: "oauth-public-key",
      captchaToken: "fresh-oauth-token",
    });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onAuthenticationSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuthAction.SIGNUP }),
    );
  });

  it("uses a fresh challenge token for each completed direct OAuth signup", async () => {
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    mounted = await mountReady();
    for (const [index, token] of ["oauth-token-1", "oauth-token-2"].entries()) {
      const signup = start(() =>
        mounted.context()!.signUpWithOauth({
          ...oauthSignup(),
          oidcToken: `oidc-attempt-${index + 1}`,
        }),
      );
      await flush();
      expect(mockChallengeCalls).toHaveLength(index + 1);
      expect(mockSignUpWithOauth).toHaveBeenCalledTimes(index);
      await act(async () => {
        mockChallengeCalls[index]!.result.resolve({ token, reset: jest.fn() });
        await signup;
      });
    }
    expect(mockGetClientParams).toHaveBeenCalledTimes(2);
    expect(mockSignUpWithOauth).toHaveBeenNthCalledWith(1, {
      oidcToken: "oidc-attempt-1",
      publicKey: "oauth-public-key",
      captchaToken: "oauth-token-1",
    });
    expect(mockSignUpWithOauth).toHaveBeenNthCalledWith(2, {
      oidcToken: "oidc-attempt-2",
      publicKey: "oauth-public-key",
      captchaToken: "oauth-token-2",
    });
  });

  it("rejects a repeated OAuth challenge token before a second Core signup", async () => {
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    mounted = await mountReady();
    const first = start(() =>
      mounted.context()!.signUpWithOauth(oauthSignup()),
    );
    await flush();
    await act(async () => {
      mockChallengeCalls[0]!.result.resolve({
        token: "replayed-oauth-token",
        reset: jest.fn(),
      });
      await first;
    });
    const second = start(() =>
      mounted.context()!.signUpWithOauth({
        ...oauthSignup(),
        oidcToken: "another-oidc-token",
      }),
    );
    await flush();
    expect(mockChallengeCalls).toHaveLength(2);
    await act(async () => {
      mockChallengeCalls[1]!.result.resolve({
        token: "replayed-oauth-token",
        reset: jest.fn(),
      });
      await expect(second).rejects.toThrow();
    });
    expect(mockSignUpWithOauth).toHaveBeenCalledTimes(1);
  });

  it("leaves OAuth login and completion unchallenged when Captcha is enabled", async () => {
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    mounted = await mountReady();
    const login = start(() =>
      mounted.context()!.loginWithOauth({
        oidcToken: "existing-oidc",
        publicKey: "oauth-public-key",
      }),
    );
    const completion = start(() =>
      mounted.context()!.completeOauth({
        oidcToken: "return-oidc",
        publicKey: "oauth-public-key",
      }),
    );
    await flush();
    expect(mockGetClientParams).not.toHaveBeenCalled();
    expect(mockChallengeCalls).toHaveLength(0);
    expect(mockLoginWithOauth).toHaveBeenCalledTimes(1);
    expect(mockCompleteOauth).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.all([login, completion]);
    });
  });

  it("omits a caller token when OAuth signup capability is off and does not challenge OAuth login or completion", async () => {
    mockGetClientParams.mockResolvedValue({});
    mounted = await mountReady();
    await act(async () => {
      await mounted.context()!.signUpWithOauth(oauthSignup());
      await mounted.context()!.loginWithOauth({
        oidcToken: "existing-oidc",
        publicKey: "oauth-public-key",
      });
      await mounted.context()!.completeOauth({
        oidcToken: "return-oidc",
        publicKey: "oauth-public-key",
      });
    });
    expect(mockGetClientParams).toHaveBeenCalledTimes(1);
    expect(mockChallengeCalls).toHaveLength(0);
    expect(mockSignUpWithOauth).toHaveBeenCalledWith({
      oidcToken: "oidc-for-this-attempt",
      publicKey: "oauth-public-key",
    });
    expect(mockLoginWithOauth).toHaveBeenCalledTimes(1);
    expect(mockCompleteOauth).toHaveBeenCalledTimes(1);
  });

  it.each(["C3", "widget"])(
    "does not submit direct OAuth signup when %s fails",
    async (failure) => {
      if (failure === "C3") {
        mockGetClientParams.mockRejectedValue(new Error("unavailable"));
      } else {
        mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
        mockCreateTurnstileChallengeRenderer.mockImplementationOnce(() => ({
          challenge: async () => {
            throw new Error("script unavailable");
          },
          dispose: mockDispose,
        }));
      }
      mounted = await mountReady();
      const signup = start(() =>
        mounted.context()!.signUpWithOauth(oauthSignup()),
      );
      await act(async () => {
        await expect(signup).rejects.toThrow();
      });
      expect(mockSignUpWithOauth).not.toHaveBeenCalled();
    },
  );

  it("cancels a direct OAuth signup on config switch and rejects a repeated pending attempt", async () => {
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    mounted = await mountReady();
    const signup = start(() =>
      mounted.context()!.signUpWithOauth(oauthSignup()),
    );
    await flush();
    expect(mockChallengeCalls).toHaveLength(1);
    const repeated = start(() =>
      mounted.context()!.signUpWithOauth(oauthSignup()),
    );
    await expect(repeated).rejects.toThrow();
    await mounted.rerender({ ...baseConfig, authProxyConfigId: "config-B" });
    await expect(signup).rejects.toThrow();
    await act(async () => {
      mockChallengeCalls[0]!.result.resolve({
        token: "late-oauth-token",
        reset: jest.fn(),
      });
    });
    expect(mockSignUpWithOauth).not.toHaveBeenCalled();
  });

  const otpSignup = () => ({
    otpType: publicExports.OtpType.Email,
    contact: "signup@example.test",
    verificationToken: "verified-otp",
    captchaToken: "caller-token",
  });

  it("waits for a fresh challenge before explicit OTP signup and refuses a repeated token", async () => {
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    mounted = await mountReady();
    const signup = start(() => mounted.context()!.signUpWithOtp(otpSignup()));
    await flush();
    expect(mockSignUpWithOtp).not.toHaveBeenCalled();
    expect(mockChallengeCalls).toHaveLength(1);
    const reset = jest.fn();
    await act(async () => {
      mockChallengeCalls[0]!.result.resolve({ token: "widget-token", reset });
      await signup;
    });
    expect(mockSignUpWithOtp).toHaveBeenCalledWith({
      otpType: "OTP_TYPE_EMAIL",
      contact: "signup@example.test",
      verificationToken: "verified-otp",
      captchaToken: "widget-token",
    });
    expect(reset).toHaveBeenCalledTimes(1);

    const repeat = start(() => mounted.context()!.signUpWithOtp(otpSignup()));
    await flush();
    expect(mockChallengeCalls).toHaveLength(2);
    await act(async () => {
      mockChallengeCalls[1]!.result.resolve({ token: "widget-token", reset });
      await expect(repeat).rejects.toThrow();
    });
    expect(mockSignUpWithOtp).toHaveBeenCalledTimes(1);
  });

  it("omits caller token when C3 says off and never challenges OTP login", async () => {
    mockGetClientParams.mockResolvedValue({});
    mounted = await mountReady();
    await act(async () => {
      await mounted.context()!.signUpWithOtp(otpSignup());
      await mounted.context()!.loginWithOtp({
        verificationToken: "verified-otp",
      });
    });
    expect(mockGetClientParams).toHaveBeenCalledTimes(1);
    expect(mockChallengeCalls).toHaveLength(0);
    expect(mockSignUpWithOtp).toHaveBeenCalledWith({
      otpType: "OTP_TYPE_EMAIL",
      contact: "signup@example.test",
      verificationToken: "verified-otp",
    });
    expect(mockLoginWithOtp).toHaveBeenCalledWith({
      verificationToken: "verified-otp",
    });
  });

  it.each(["C3", "widget"])(
    "does not submit OTP signup when %s fails",
    async (failure) => {
      if (failure === "C3") {
        mockGetClientParams.mockRejectedValue(new Error("unavailable"));
      } else {
        mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
        mockCreateTurnstileChallengeRenderer.mockImplementationOnce(() => ({
          challenge: async () => {
            throw new Error("script unavailable");
          },
          dispose: mockDispose,
        }));
      }
      mounted = await mountReady();
      const signup = start(() => mounted.context()!.signUpWithOtp(otpSignup()));
      await act(async () => {
        await expect(signup).rejects.toThrow();
      });
      expect(mockSignUpWithOtp).not.toHaveBeenCalled();
    },
  );

  it("rejects a late OTP signup challenge after config switch", async () => {
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    mounted = await mountReady();
    const signup = start(() => mounted.context()!.signUpWithOtp(otpSignup()));
    await flush();
    expect(mockChallengeCalls).toHaveLength(1);
    await mounted.rerender({ ...baseConfig, authProxyConfigId: "config-B" });
    await expect(signup).rejects.toThrow();
    await act(async () => {
      mockChallengeCalls[0]!.result.resolve({
        token: "late-token",
        reset: jest.fn(),
      });
    });
    expect(mockSignUpWithOtp).not.toHaveBeenCalled();
  });

  it("reads C3 and challenges each OTP attempt before sending only that token", async () => {
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    mounted = await mountReady();
    const first = start(() =>
      mounted.context()!.initOtp({
        otpType: publicExports.OtpType.Email,
        contact: "a@example.test",
        captchaToken: "caller-token",
      }),
    );
    await flush();
    expect(mockGetClientParams).toHaveBeenCalledWith(
      "config-A",
      "https://auth.example.test",
    );
    expect(mockChallengeCalls).toHaveLength(1);
    expect(mockChallengeCalls[0]!.siteKey).toBe("site-A");
    expect(mockInitOtp).not.toHaveBeenCalled();
    expect(
      mounted.container.querySelector("[data-captcha-challenge-host]"),
    ).not.toBeNull();
    expect(
      mounted.container.querySelector('[role="status"]')?.textContent,
    ).toContain("security check");
    const reset = jest.fn();
    await act(async () => {
      mockChallengeCalls[0]!.result.resolve({ token: "opaque-otp-1", reset });
      await first;
    });
    await expect(first).resolves.toMatchObject({ otpId: "otp-1" });
    expect(mockInitOtp).toHaveBeenCalledWith(
      expect.objectContaining({ captchaToken: "opaque-otp-1" }),
    );
    expect(mounted.container.textContent).not.toContain("opaque-otp-1");
    expect(reset).toHaveBeenCalledTimes(1);

    const second = start(() =>
      mounted.context()!.initOtp({
        otpType: publicExports.OtpType.Email,
        contact: "a@example.test",
      }),
    );
    await flush();
    expect(mockGetClientParams).toHaveBeenCalledTimes(2);
    expect(mockChallengeCalls).toHaveLength(2);
    await act(async () => {
      mockChallengeCalls[1]!.result.resolve({
        token: "opaque-otp-2",
        reset: jest.fn(),
      });
      await second;
    });
    await expect(second).resolves.toMatchObject({ otpId: "otp-1" });
    expect(mockInitOtp).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ captchaToken: "opaque-otp-2" }),
    );
  });

  it("uses fresh C3 for direct wallet signup and skips the widget for disabled capability", async () => {
    mockGetClientParams
      .mockResolvedValueOnce({ turnstileSiteKey: "site-A" })
      .mockResolvedValueOnce({});
    const submitted = jest.fn(async (_token?: string) => undefined);
    mockSignUpWithWallet.mockImplementationOnce(async (_params, gate) =>
      (
        gate as (
          submit: (token?: string) => Promise<unknown>,
        ) => Promise<unknown>
      )(submitted),
    );
    mounted = await mountReady();
    const signup = start(() =>
      mounted
        .context()!
        .signUpWithWallet({ captchaToken: "caller-token" } as Parameters<
          ZeroXKeyClient["signUpWithWallet"]
        >[0]),
    );
    await flush();
    expect(submitted).not.toHaveBeenCalled();
    await act(async () => {
      mockChallengeCalls[0]!.result.resolve({
        token: "opaque-wallet",
        reset: jest.fn(),
      });
      await signup;
    });
    await expect(signup).resolves.toBeUndefined();
    expect(mockSignUpWithWallet).toHaveBeenCalledWith(
      expect.not.objectContaining({ captchaToken: "caller-token" }),
      expect.any(Function),
    );
    expect(submitted).toHaveBeenCalledWith("opaque-wallet");

    await act(async () => {
      await mounted.context()!.initOtp({
        otpType: publicExports.OtpType.Email,
        contact: "a@example.test",
        captchaToken: "caller-token",
      });
    });
    expect(mockGetClientParams).toHaveBeenCalledTimes(2);
    expect(mockChallengeCalls).toHaveLength(1);
    expect(mockInitOtp.mock.calls[0]![0]).not.toHaveProperty("captchaToken");
  });

  it("does not call Core when C3 fails", async () => {
    mockGetClientParams.mockRejectedValue(new Error("unavailable"));
    mounted = await mountReady();
    const attempt = start(() =>
      mounted.context()!.initOtp({
        otpType: publicExports.OtpType.Email,
        contact: "a@example.test",
      }),
    );
    await act(async () => {
      await expect(attempt).rejects.toThrow();
    });
    expect(mockInitOtp).not.toHaveBeenCalled();
    expect(mockChallengeCalls).toHaveLength(0);
  });

  it("rejects a runtime HTTP target mismatch before reading C3", async () => {
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    mounted = await mountReady();
    mounted.context()!.httpClient!.config.authProxyConfigId = "config-B";

    const attempt = start(() =>
      mounted.context()!.initOtp({
        otpType: publicExports.OtpType.Email,
        contact: "a@example.test",
      }),
    );
    await flush();
    expect(mockGetClientParams).not.toHaveBeenCalled();
    await expect(attempt).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: "Captcha client selection changed",
      }),
    });
    expect(mockChallengeCalls).toHaveLength(0);
    expect(mockInitOtp).not.toHaveBeenCalled();
  });

  it("rejects a runtime HTTP target changed during challenge before Core submission", async () => {
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    mounted = await mountReady();
    const attempt = start(() =>
      mounted.context()!.initOtp({
        otpType: publicExports.OtpType.Email,
        contact: "a@example.test",
      }),
    );
    await flush();
    expect(mockChallengeCalls).toHaveLength(1);

    mounted.context()!.httpClient!.config.authProxyUrl =
      "https://other-auth.example.test";
    const reset = jest.fn();
    await act(async () => {
      mockChallengeCalls[0]!.result.resolve({ token: "opaque-token", reset });
      await expect(attempt).rejects.toMatchObject({
        cause: expect.objectContaining({
          message: "Captcha client selection changed",
        }),
      });
    });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(mockInitOtp).not.toHaveBeenCalled();
  });

  it("cancels a pending challenge on config switch and refuses the old client", async () => {
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    mounted = await mountReady();
    const oldInitOtp = mounted.context()!.initOtp;
    const pending = start(() =>
      oldInitOtp({
        otpType: publicExports.OtpType.Email,
        contact: "a@example.test",
      }),
    );
    await flush();
    await mounted.rerender({ ...baseConfig, authProxyConfigId: "config-B" });
    await expect(pending).rejects.toThrow();
    expect(mockChallengeCalls[0]!.signal.aborted).toBe(true);
    expect(mockInitOtp).not.toHaveBeenCalled();
    await expect(
      start(() =>
        oldInitOtp({
          otpType: publicExports.OtpType.Email,
          contact: "a@example.test",
        }),
      ),
    ).rejects.toThrow();
    expect(mockGetClientParams).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the mounted client for B after canceling A and submits with B", async () => {
    mockGetClientParams.mockImplementation(async (configId) =>
      configId === "config-A" ? { turnstileSiteKey: "site-A" } : {},
    );
    mounted = await mountReady();
    const oldInitOtp = mounted.context()!.initOtp;
    const pending = start(() =>
      oldInitOtp({
        otpType: publicExports.OtpType.Email,
        contact: "a@example.test",
      }),
    );
    await flush();
    expect(mockChallengeCalls).toHaveLength(1);

    await mounted.rerender({ ...baseConfig, authProxyConfigId: "config-B" });
    await expect(pending).rejects.toThrow();
    expect(mockChallengeCalls[0]!.signal.aborted).toBe(true);
    expect(mockInitOtp).not.toHaveBeenCalled();

    for (let index = 0; index < 20; index += 1) await flush();
    expect(mounted.context()?.clientState).toBe(
      publicExports.ClientState.Ready,
    );
    expect(mounted.context()?.httpClient?.config.authProxyConfigId).toBe(
      "config-B",
    );
    expect(mockZeroXKeyClient).toHaveBeenCalledTimes(2);
    await act(async () => {
      await mounted.context()!.initOtp({
        otpType: publicExports.OtpType.Email,
        contact: "b@example.test",
      });
    });
    expect(mockGetClientParams).toHaveBeenLastCalledWith(
      "config-B",
      "https://auth.example.test",
    );
    expect(mockInitOtp).toHaveBeenCalledTimes(1);
    expect(mockInitOtp.mock.calls[0]![0]).not.toHaveProperty("captchaToken");
  });

  it("cancels an A challenge when only the constructor organization changes", async () => {
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    mounted = await mountReady();
    const pending = start(() =>
      mounted.context()!.initOtp({
        otpType: publicExports.OtpType.Email,
        contact: "a@example.test",
      }),
    );
    await flush();
    await mounted.rerender({ ...baseConfig, organizationId: "org-B" });
    await expect(pending).rejects.toThrow();
    expect(mockChallengeCalls[0]!.signal.aborted).toBe(true);
    expect(mockInitOtp).not.toHaveBeenCalled();
    for (let index = 0; index < 20; index += 1) await flush();
    expect(mounted.context()?.httpClient?.config.organizationId).toBe("org-B");
  });

  it.each([{ authProxyConfigId: "config-B" }, { organizationId: "org-B" }])(
    "rejects a retained A OTP handler in the B layout-before-passive window: %p",
    async (change) => {
      mounted = await mountReady();
      const oldInitOtp = mounted.context()!.initOtp;
      let attempt: Promise<unknown> | undefined;
      function LayoutAttempt() {
        useLayoutEffect(() => {
          attempt = oldInitOtp({
            otpType: publicExports.OtpType.Email,
            contact: "layout@example.test",
          });
          void attempt.catch(() => undefined);
        }, []);
        return null;
      }
      await mounted.rerender(
        { ...baseConfig, ...change },
        undefined,
        <LayoutAttempt />,
      );
      await expect(attempt).rejects.toThrow();
      expect(mockGetClientParams).not.toHaveBeenCalled();
      expect(mockInitOtp).not.toHaveBeenCalled();
    },
  );

  it("cancels a challenge and disposes its widget owner on unmount", async () => {
    mockGetClientParams.mockResolvedValue({ turnstileSiteKey: "site-A" });
    mounted = await mountReady();
    const pending = start(() =>
      mounted.context()!.initOtp({
        otpType: publicExports.OtpType.Email,
        contact: "a@example.test",
      }),
    );
    await flush();
    await dom.unmount(mounted);
    await expect(pending).rejects.toThrow();
    expect(mockChallengeCalls[0]!.signal.aborted).toBe(true);
    expect(mockDispose).toHaveBeenCalledTimes(1);
    expect(mockInitOtp).not.toHaveBeenCalled();
  });
});
