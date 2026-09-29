import { afterEach, expect, test } from "@jest/globals";
import { AuthAction } from "@0xkey-io/sdk-types";
import {
  OtpType,
  Chain,
  WalletInterfaceType,
  type WalletProvider,
} from "../__types__";
import { createReadyClient } from "./test-support/ready-client";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  delete (globalThis as any).document;
  delete (globalThis as any).window;
});

type Request = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};
const captcha = "opaque-captcha-token";

async function ready() {
  const client = await createReadyClient();
  (globalThis as any).window.location = { hostname: "wallet.example.test" };
  Object.assign(client, {
    config: {
      apiBaseUrl: "https://api.example.test",
      authProxyUrl: "https://auth.example.test",
      authProxyConfigId: "config-1",
      organizationId: "parent-org",
    },
  });
  client.httpClient = client.createHttpClient();
  client.storeSession = async () => {};
  return client;
}

function capture(answers: Record<string, object | object[]>) {
  const requests: Request[] = [];
  global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const value = answers[path];
    if (!value) throw new Error(`unexpected request ${path}`);
    const answer = Array.isArray(value) ? value.shift() : value;
    requests.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    return { ok: true, json: async () => answer } as Response;
  }) as typeof fetch;
  return requests;
}

function expectTokenOnlyOn(requests: Request[], path: string, token = captcha) {
  expect(requests.filter((request) => request.url.endsWith(path))).toHaveLength(
    1,
  );
  for (const request of requests) {
    expect(request.headers["X-Captcha-Token"]).toBe(
      request.url.endsWith(path) ? token : undefined,
    );
    expect(request.url).not.toContain(token);
    expect(JSON.stringify(request.body)).not.toContain(token);
  }
}

test("initOtp uses each supplied token for its own send or resend and never carries a failed token forward", async () => {
  const client = await ready();
  const requests = capture({
    "/v1/otp_init_v2": [
      { otpId: "otp-1", otpEncryptionTargetBundle: "bundle-1" },
      {},
      { otpId: "otp-3", otpEncryptionTargetBundle: "bundle-3" },
    ],
  });
  await client.initOtp({
    otpType: OtpType.Email,
    contact: "a@example.test",
    captchaToken: "first",
  });
  const failure = await client
    .initOtp({
      otpType: OtpType.Email,
      contact: "a@example.test",
      captchaToken: "failed-token",
    })
    .catch((error) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).not.toContain("failed-token");
  await client.initOtp({
    otpType: OtpType.Email,
    contact: "a@example.test",
    captchaToken: "fresh",
  });
  expect(requests.map((request) => request.headers["X-Captcha-Token"])).toEqual(
    ["first", "failed-token", "fresh"],
  );
  for (const request of requests) {
    expect(request.url).not.toContain("first");
    expect(JSON.stringify(request.body)).not.toMatch(
      /first|failed-token|fresh/,
    );
  }
});

test("signUpWithPasskey sends Captcha only on signup", async () => {
  const client = await ready();
  const keyStamper = {
    createKeyPair: async () => "public-key",
    setTemporaryPublicKey: () => {},
    clearTemporaryPublicKey: () => {},
    deleteKeyPair: async () => {},
  };
  Object.assign(client, { apiKeyStamper: keyStamper });
  client.createPasskey = async () => ({
    encodedChallenge: "challenge",
    attestation: { credentialId: "credential" } as any,
  });
  Object.assign(client.httpClient, {
    stampLogin: async () => ({ session: "session" }),
  });
  const requests = capture({ "/v1/signup": { appProofs: [] } });
  await client.signUpWithPasskey({ captchaToken: captcha });
  expectTokenOnlyOn(requests, "/v1/signup");
});

test("signUpWithOauth sends Captcha only on signup, never on OAuth login", async () => {
  const client = await ready();
  const requests = capture({
    "/v1/signup": { appProofs: [] },
    "/v1/oauth_login": { session: "session" },
  });
  await client.signUpWithOauth({
    oidcToken: "oidc",
    publicKey: "key",
    captchaToken: captcha,
  });
  expectTokenOnlyOn(requests, "/v1/signup");
});

test.each([
  [undefined, AuthAction.SIGNUP],
  ["existing-org", AuthAction.LOGIN],
] as Array<[string | undefined, AuthAction]>)(
  "completeOauth conditionally forwards Captcha for organization %s",
  async (organizationId, action) => {
    const client = await ready();
    const requests = capture({
      "/v1/account": { organizationId },
      "/v1/signup": { appProofs: [] },
      "/v1/oauth_login": { session: "session" },
    });
    const result = await client.completeOauth({
      oidcToken: "oidc",
      publicKey: "key",
      captchaToken: captcha,
    });
    expect(result.action).toBe(action);
    if (action === AuthAction.SIGNUP) expectTokenOnlyOn(requests, "/v1/signup");
    else {
      expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
        "/v1/account",
        "/v1/oauth_login",
      ]);
      expect(
        requests.every(
          (request) => request.headers["X-Captcha-Token"] === undefined,
        ),
      ).toBe(true);
    }
  },
);

const walletProvider = {
  interfaceType: WalletInterfaceType.Solana,
  chainInfo: { namespace: Chain.Solana },
} as WalletProvider;
function walletReady(client: Awaited<ReturnType<typeof ready>>) {
  client.buildWalletLoginRequest = async () => ({
    signedRequest: {} as any,
    publicKey: "11".repeat(32),
  });
  Object.assign(client.httpClient, {
    sendSignedRequest: async () => ({ session: "session" }),
  });
}

test("signUpWithWallet sends Captcha on its direct signup route", async () => {
  const client = await ready();
  walletReady(client);
  const requests = capture({ "/v1/signup": { appProofs: [] } });
  await client.signUpWithWallet({ walletProvider, captchaToken: captcha });
  expectTokenOnlyOn(requests, "/v1/signup");
});

test.each([
  [undefined, AuthAction.SIGNUP],
  ["existing-org", AuthAction.LOGIN],
] as Array<[string | undefined, AuthAction]>)(
  "loginOrSignupWithWallet conditionally forwards Captcha for organization %s",
  async (organizationId, action) => {
    const client = await ready();
    walletReady(client);
    const requests = capture({
      "/v1/account": { organizationId },
      "/v1/signup": { appProofs: [] },
    });
    const result = await client.loginOrSignupWithWallet({
      walletProvider,
      captchaToken: captcha,
    });
    expect(result.action).toBe(action);
    if (action === AuthAction.SIGNUP) expectTokenOnlyOn(requests, "/v1/signup");
    else {
      expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
        "/v1/account",
      ]);
      expect(requests[0]?.headers["X-Captcha-Token"]).toBeUndefined();
    }
  },
);

test.each([
  [undefined, AuthAction.SIGNUP],
  ["existing-org", AuthAction.LOGIN],
] as Array<[string | undefined, AuthAction]>)(
  "completeOtp conditionally forwards Captcha for organization %s",
  async (subOrganizationId, action) => {
    const client = await ready();
    client.verifyOtp = async () => ({
      subOrganizationId,
      verificationToken: "proof",
    });
    let signUpCaptcha: string | undefined;
    client.signUpWithOtp = async (params) => {
      signUpCaptcha = params.captchaToken;
      return { sessionToken: "session" };
    };
    client.loginWithOtp = async () => ({ sessionToken: "session" });
    const result = await client.completeOtp({
      otpId: "otp",
      otpCode: "123456",
      otpEncryptionTargetBundle: "bundle",
      contact: "a@example.test",
      otpType: OtpType.Email,
      publicKey: "key",
      captchaToken: captcha,
    });
    expect(result.action).toBe(action);
    expect(signUpCaptcha).toBe(
      action === AuthAction.SIGNUP ? captcha : undefined,
    );
  },
);
