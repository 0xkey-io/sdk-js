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
  const matching = requests.filter(
    (request) => new URL(request.url).pathname === path,
  );
  expect(matching).toHaveLength(1);
  for (const request of requests) {
    const requestUrl = new URL(request.url);
    const protectedRoute = requestUrl.pathname === path;
    expect(request.headers["X-Captcha-Token"]).toBe(
      protectedRoute ? token : undefined,
    );
    expect(requestUrl.search).toBe(
      protectedRoute ? "?captcha_config_id=config-1" : "",
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

test("passkey signup requests Captcha only after WebAuthn and submits its fresh token", async () => {
  const client = await ready();
  Object.assign(client, {
    apiKeyStamper: {
      createKeyPair: async () => "public-key",
      setTemporaryPublicKey: () => {},
      clearTemporaryPublicKey: () => {},
      deleteKeyPair: async () => {},
    },
  });
  let finishPasskey!: (value: any) => void;
  let passkeyStarted!: () => void;
  const started = new Promise<void>((resolve) => (passkeyStarted = resolve));
  client.createPasskey = async () => {
    passkeyStarted();
    return new Promise((resolve) => (finishPasskey = resolve));
  };
  Object.assign(client.httpClient, {
    stampLogin: async () => ({ session: "session" }),
  });
  const requests = capture({ "/v1/signup": { appProofs: [] } });
  let challengeCount = 0;
  const pending = client.signUpWithPasskey({}, async (submit) => {
    challengeCount += 1;
    return submit("fresh-after-passkey");
  });
  await started;
  expect(challengeCount).toBe(0);
  expect(requests).toHaveLength(0);
  finishPasskey({
    encodedChallenge: "challenge",
    attestation: { credentialId: "credential" },
  });
  await pending;
  expect(challengeCount).toBe(1);
  expectTokenOnlyOn(requests, "/v1/signup", "fresh-after-passkey");
});

test.each(["config mutation", "http client replacement"])(
  "signUpWithPasskey refuses a changed Captcha target after passkey creation: %s",
  async (change) => {
    const client = await ready();
    Object.assign(client, {
      apiKeyStamper: {
        createKeyPair: async () => "public-key",
        setTemporaryPublicKey: () => {},
        clearTemporaryPublicKey: () => {},
        deleteKeyPair: async () => {},
      },
    });
    let releaseCreation!: () => void;
    let creationStarted!: () => void;
    const paused = new Promise<void>((resolve) => {
      releaseCreation = resolve;
    });
    const started = new Promise<void>((resolve) => {
      creationStarted = resolve;
    });
    client.createPasskey = async () => {
      creationStarted();
      await paused;
      return {
        encodedChallenge: "challenge",
        attestation: { credentialId: "credential" } as any,
      };
    };
    const requests = capture({ "/v1/signup": { appProofs: [] } });
    const pending = client.signUpWithPasskey({ captchaToken: captcha });
    await started;
    if (change === "config mutation") {
      client.httpClient.config.authProxyConfigId = "config-2";
    } else {
      client.httpClient = client.createHttpClient({
        authProxyUrl: "https://other.example.test",
      });
    }
    releaseCreation();
    await expect(pending).rejects.toThrow();
    expect(requests).toHaveLength(0);
  },
);

test("passkey callback refuses Core organization switch during WebAuthn", async () => {
  const client = await ready();
  Object.assign(client, {
    apiKeyStamper: {
      createKeyPair: async () => "public-key",
      setTemporaryPublicKey: () => {},
      clearTemporaryPublicKey: () => {},
      deleteKeyPair: async () => {},
    },
  });
  let releaseCreation!: () => void;
  let creationStarted!: () => void;
  const paused = new Promise<void>((resolve) => (releaseCreation = resolve));
  const started = new Promise<void>((resolve) => (creationStarted = resolve));
  client.createPasskey = async () => {
    creationStarted();
    await paused;
    return {
      encodedChallenge: "challenge",
      attestation: { credentialId: "credential" } as any,
    };
  };
  const requests = capture({ "/v1/signup": { appProofs: [] } });
  let challenges = 0;
  const pending = client.signUpWithPasskey({}, async (submit) => {
    challenges += 1;
    return submit("never-sent");
  });
  await started;
  client.config.organizationId = "other-org";
  releaseCreation();
  await expect(pending).rejects.toThrow();
  expect(challenges).toBe(0);
  expect(requests).toHaveLength(0);
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

test("signUpWithOauth refuses a mismatched Core and HTTP Captcha config", async () => {
  const client = await ready();
  client.config.authProxyConfigId = "config-2";
  const requests = capture({ "/v1/signup": { appProofs: [] } });
  await expect(
    client.signUpWithOauth({
      oidcToken: "oidc",
      publicKey: "key",
      captchaToken: captcha,
    }),
  ).rejects.toThrow();
  expect(requests).toHaveLength(0);
});

test("signUpWithOauth does not log in through B after A signup completes", async () => {
  const client = await ready();
  let releaseSignup!: () => void;
  let signupStarted!: () => void;
  const paused = new Promise<void>((resolve) => {
    releaseSignup = resolve;
  });
  const started = new Promise<void>((resolve) => {
    signupStarted = resolve;
  });
  const requests: string[] = [];
  global.fetch = (async (url: RequestInfo | URL) => {
    const path = new URL(String(url)).pathname;
    requests.push(path);
    if (path !== "/v1/signup") throw new Error(`unexpected ${path}`);
    signupStarted();
    await paused;
    return { ok: true, json: async () => ({ appProofs: [] }) } as Response;
  }) as typeof fetch;
  const pending = client.signUpWithOauth({
    oidcToken: "oidc",
    publicKey: "key",
    captchaToken: captcha,
  });
  await started;
  client.httpClient = client.createHttpClient({
    authProxyUrl: "https://other.example.test",
  });
  releaseSignup();
  await expect(pending).rejects.toThrow();
  expect(requests).toEqual(["/v1/signup"]);
});

test.each([
  ["", AuthAction.SIGNUP],
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

test.each([
  ["", AuthAction.SIGNUP, 1],
  ["existing-org", AuthAction.LOGIN, 0],
] as Array<[string, AuthAction, number]>)(
  "completeOauth delayed challenge runs only after account lookup for %s",
  async (organizationId, action, expectedChallenges) => {
    const client = await ready();
    const requests = capture({
      "/v1/account": { organizationId },
      "/v1/signup": { appProofs: [] },
      "/v1/oauth_login": { session: "session" },
    });
    let challenges = 0;
    const result = await client.completeOauth(
      { oidcToken: "oidc", publicKey: "key" },
      async (submit) => {
        challenges += 1;
        expect(
          requests.map((request) => new URL(request.url).pathname),
        ).toEqual(["/v1/account"]);
        return submit("fresh-after-lookup");
      },
    );
    expect(result.action).toBe(action);
    expect(challenges).toBe(expectedChallenges);
    if (action === AuthAction.SIGNUP) {
      expectTokenOnlyOn(requests, "/v1/signup", "fresh-after-lookup");
    } else {
      expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
        "/v1/account",
        "/v1/oauth_login",
      ]);
      expect(
        requests.every((request) => !request.headers["X-Captcha-Token"]),
      ).toBe(true);
    }
  },
);

test.each(["", " "])(
  "completeOauth delayed challenge refuses empty token %s before signup",
  async (token) => {
    const client = await ready();
    const requests = capture({
      "/v1/account": { organizationId: "" },
      "/v1/signup": { appProofs: [] },
    });
    await expect(
      client.completeOauth(
        { oidcToken: "oidc", publicKey: "key" },
        async (submit) => submit(token),
      ),
    ).rejects.toThrow();
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/v1/account",
    ]);
  },
);

test("completeOauth trusted off wrapper submits signup without a token", async () => {
  const client = await ready();
  const requests = capture({
    "/v1/account": { organizationId: "" },
    "/v1/signup": { appProofs: [] },
    "/v1/oauth_login": { session: "session" },
  });
  const result = await client.completeOauth(
    { oidcToken: "oidc", publicKey: "key" },
    async (submit) => submit(undefined),
  );
  expect(result.action).toBe(AuthAction.SIGNUP);
  expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
    "/v1/account",
    "/v1/signup",
    "/v1/oauth_login",
  ]);
  expect(requests.every((request) => !request.headers["X-Captcha-Token"])).toBe(
    true,
  );
  expect(requests.every((request) => new URL(request.url).search === "")).toBe(
    true,
  );
});

test.each([
  "config ID",
  "proxy URL",
  "HTTP client",
  "Core organization",
  "Core API URL",
  "HTTP organization",
  "HTTP API URL",
])(
  "completeOauth delayed challenge refuses changed %s before asking for token",
  async (change) => {
    const client = await ready();
    let releaseLookup!: () => void;
    let lookupStarted!: () => void;
    const paused = new Promise<void>((resolve) => (releaseLookup = resolve));
    const started = new Promise<void>((resolve) => (lookupStarted = resolve));
    const requests: string[] = [];
    global.fetch = (async (url: RequestInfo | URL) => {
      const path = new URL(String(url)).pathname;
      requests.push(path);
      if (path !== "/v1/account") throw new Error(`unexpected ${path}`);
      lookupStarted();
      await paused;
      return {
        ok: true,
        json: async () => ({ organizationId: "" }),
      } as Response;
    }) as typeof fetch;
    let challenges = 0;
    const pending = client.completeOauth(
      { oidcToken: "oidc", publicKey: "key" },
      async (submit) => {
        challenges += 1;
        return submit("never-sent");
      },
    );
    await started;
    if (change === "config ID") {
      client.httpClient.config.authProxyConfigId = "config-2";
    } else if (change === "proxy URL") {
      client.config.authProxyUrl = "https://other.example.test";
    } else if (change === "Core organization") {
      client.config.organizationId = "other-org";
    } else if (change === "Core API URL") {
      client.config.apiBaseUrl = "https://other-api.example.test";
    } else if (change === "HTTP organization") {
      client.httpClient.config.organizationId = "other-org";
    } else if (change === "HTTP API URL") {
      client.httpClient.config.apiBaseUrl = "https://other-api.example.test";
    } else {
      client.httpClient = client.createHttpClient({
        authProxyUrl: "https://other.example.test",
      });
    }
    releaseLookup();
    await expect(pending).rejects.toThrow();
    expect(challenges).toBe(0);
    expect(requests).toEqual(["/v1/account"]);
  },
);

test.each(["organization", "API URL"])(
  "completeOauth delayed challenge rejects initial Core/HTTP %s mismatch",
  async (field) => {
    const client = await ready();
    if (field === "organization") client.config.organizationId = "other-org";
    else client.config.apiBaseUrl = "https://other-api.example.test";
    const requests = capture({ "/v1/account": { organizationId: "" } });
    let challenges = 0;
    await expect(
      client.completeOauth(
        { oidcToken: "oidc", publicKey: "key" },
        async (submit) => {
          challenges += 1;
          return submit("never-sent");
        },
      ),
    ).rejects.toThrow();
    expect(challenges).toBe(0);
    expect(requests).toHaveLength(0);
  },
);

test("completeOauth delayed challenge failure does not submit signup", async () => {
  const client = await ready();
  const requests = capture({ "/v1/account": { organizationId: "" } });
  await expect(
    client.completeOauth({ oidcToken: "oidc", publicKey: "key" }, async () => {
      throw new Error("challenge failed");
    }),
  ).rejects.toThrow();
  expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
    "/v1/account",
  ]);
});

test.each(["proxy URL", "Core organization"])(
  "completeOauth delayed challenge rejects %s switch while waiting for token",
  async (change) => {
    const client = await ready();
    const requests = capture({
      "/v1/account": { organizationId: "" },
      "/v1/signup": { appProofs: [] },
      "/v1/oauth_login": { session: "session" },
    });
    let releaseToken!: () => void;
    let challengeStarted!: () => void;
    const paused = new Promise<void>((resolve) => (releaseToken = resolve));
    const started = new Promise<void>(
      (resolve) => (challengeStarted = resolve),
    );
    const pending = client.completeOauth(
      { oidcToken: "oidc", publicKey: "key" },
      async (submit) => {
        challengeStarted();
        await paused;
        return submit("fresh-but-stale-target");
      },
    );
    await started;
    if (change === "proxy URL")
      client.httpClient.config.authProxyUrl = "https://other.example.test";
    else client.config.organizationId = "other-org";
    releaseToken();
    await expect(pending).rejects.toThrow();
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/v1/account",
    ]);
  },
);

test("completeOauth delayed challenge refuses caller token plus callback", async () => {
  const client = await ready();
  const requests = capture({ "/v1/account": { organizationId: "" } });
  await expect(
    client.completeOauth(
      { oidcToken: "oidc", publicKey: "key", captchaToken: "caller" },
      async (submit) => submit("fresh"),
    ),
  ).rejects.toThrow();
  expect(requests).toHaveLength(0);
});

test("completeOauth callback rejects a second submit without a second signup", async () => {
  const client = await ready();
  const requests = capture({
    "/v1/account": { organizationId: "" },
    "/v1/signup": [{ appProofs: [] }, { appProofs: [] }],
    "/v1/oauth_login": { session: "session" },
  });
  await expect(
    client.completeOauth(
      { oidcToken: "oidc", publicKey: "key" },
      async (submit) => {
        await submit("first");
        return submit("second");
      },
    ),
  ).rejects.toThrow();
  expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
    "/v1/account",
    "/v1/signup",
    "/v1/oauth_login",
  ]);
  expect(
    requests.filter((request) => request.headers["X-Captcha-Token"]),
  ).toHaveLength(1);
  expect(requests[1]?.headers["X-Captcha-Token"]).toBe("first");
});

test.each(["config mutation", "http client replacement"])(
  "completeOtp refuses a changed Captcha target after verification: %s",
  async (change) => {
    const client = await ready();
    let releaseVerification!: () => void;
    let verificationStarted!: () => void;
    const paused = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    const started = new Promise<void>((resolve) => {
      verificationStarted = resolve;
    });
    client.verifyOtp = async () => {
      verificationStarted();
      await paused;
      return { subOrganizationId: undefined, verificationToken: "proof" };
    };
    let signupCalled = false;
    client.signUpWithOtp = async () => {
      signupCalled = true;
      return { sessionToken: "session" };
    };

    const pending = client.completeOtp({
      otpId: "otp",
      otpCode: "123456",
      otpEncryptionTargetBundle: "bundle",
      contact: "a@example.test",
      otpType: OtpType.Email,
      publicKey: "key",
      captchaToken: captcha,
    });
    await started;
    if (change === "config mutation") {
      client.httpClient.config.authProxyConfigId = "config-2";
    } else {
      client.httpClient = client.createHttpClient({
        authProxyUrl: "https://other.example.test",
      });
    }
    releaseVerification();
    await expect(pending).rejects.toThrow();
    expect(signupCalled).toBe(false);
  },
);

test.each(["config mutation", "http client replacement"])(
  "completeOauth refuses a changed Captcha target after account lookup: %s",
  async (change) => {
    const client = await ready();
    let releaseLookup!: () => void;
    let lookupStarted!: () => void;
    const lookupPaused = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    const started = new Promise<void>((resolve) => {
      lookupStarted = resolve;
    });
    const requests: string[] = [];
    global.fetch = (async (url: RequestInfo | URL) => {
      const path = new URL(String(url)).pathname;
      requests.push(path);
      if (path !== "/v1/account") throw new Error(`unexpected ${path}`);
      lookupStarted();
      await lookupPaused;
      return {
        ok: true,
        json: async () => ({ organizationId: "" }),
      } as Response;
    }) as typeof fetch;

    const pending = client.completeOauth({
      oidcToken: "oidc",
      publicKey: "key",
      captchaToken: captcha,
    });
    await started;
    if (change === "config mutation") {
      client.httpClient.config.authProxyConfigId = "config-2";
    } else {
      client.httpClient = client.createHttpClient({
        authProxyUrl: "https://other.example.test",
      });
    }
    releaseLookup();
    await expect(pending).rejects.toThrow();
    expect(requests).toEqual(["/v1/account"]);
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

test("direct wallet signup waits for signing before obtaining its single-use Captcha", async () => {
  const client = await ready();
  walletReady(client);
  let releaseSigning!: () => void;
  let signingStarted!: () => void;
  const signing = new Promise<void>((resolve) => (releaseSigning = resolve));
  const started = new Promise<void>((resolve) => (signingStarted = resolve));
  client.buildWalletLoginRequest = async () => {
    signingStarted();
    await signing;
    return { signedRequest: {} as any, publicKey: "11".repeat(32) };
  };
  const requests = capture({ "/v1/signup": { appProofs: [] } });
  let challenges = 0;
  const pending = client.signUpWithWallet(
    { walletProvider },
    async (submit) => {
      challenges += 1;
      return submit("fresh-after-signing");
    },
  );
  await started;
  expect(challenges).toBe(0);
  expect(requests).toHaveLength(0);
  releaseSigning();
  await pending;
  expect(challenges).toBe(1);
  expectTokenOnlyOn(requests, "/v1/signup", "fresh-after-signing");
});

test.each(["config ID", "Core API URL"])(
  "direct wallet signup refuses changed %s during signing before challenge",
  async (change) => {
    const client = await ready();
    walletReady(client);
    let releaseSigning!: () => void;
    let signingStarted!: () => void;
    const signing = new Promise<void>((resolve) => (releaseSigning = resolve));
    const started = new Promise<void>((resolve) => (signingStarted = resolve));
    client.buildWalletLoginRequest = async () => {
      signingStarted();
      await signing;
      return { signedRequest: {} as any, publicKey: "11".repeat(32) };
    };
    const requests = capture({ "/v1/signup": { appProofs: [] } });
    let challenges = 0;
    const pending = client.signUpWithWallet(
      { walletProvider },
      async (submit) => {
        challenges += 1;
        return submit("never-sent");
      },
    );
    await started;
    if (change === "config ID")
      client.httpClient.config.authProxyConfigId = "config-2";
    else client.config.apiBaseUrl = "https://other-api.example.test";
    releaseSigning();
    await expect(pending).rejects.toThrow();
    expect(challenges).toBe(0);
    expect(requests).toHaveLength(0);
  },
);

test("direct wallet signup rejects a repeated protected submit", async () => {
  const client = await ready();
  walletReady(client);
  const requests = capture({ "/v1/signup": { appProofs: [] } });
  await expect(
    client.signUpWithWallet({ walletProvider }, async (submit) => {
      await submit("first");
      return submit("second");
    }),
  ).rejects.toThrow();
  expect(requests).toHaveLength(1);
});

test.each([
  ["", AuthAction.SIGNUP, 1],
  ["existing-org", AuthAction.LOGIN, 0],
] as Array<[string, AuthAction, number]>)(
  "wallet mixed flow challenges only after account lookup for %s",
  async (organizationId, action, expectedChallenges) => {
    const client = await ready();
    walletReady(client);
    const requests = capture({
      "/v1/account": { organizationId },
      "/v1/signup": { appProofs: [] },
    });
    let challengeCount = 0;
    const result = await client.loginOrSignupWithWallet(
      { walletProvider },
      async (submit) => {
        challengeCount += 1;
        expect(
          requests.map((request) => new URL(request.url).pathname),
        ).toEqual(["/v1/account"]);
        return submit("fresh-after-lookup");
      },
    );
    expect(result.action).toBe(action);
    expect(challengeCount).toBe(expectedChallenges);
    if (action === AuthAction.SIGNUP)
      expectTokenOnlyOn(requests, "/v1/signup", "fresh-after-lookup");
    else expect(requests).toHaveLength(1);
  },
);

test("wallet mixed callback refuses HTTP organization switch after account lookup", async () => {
  const client = await ready();
  walletReady(client);
  let releaseLookup!: () => void;
  let lookupStarted!: () => void;
  const paused = new Promise<void>((resolve) => (releaseLookup = resolve));
  const started = new Promise<void>((resolve) => (lookupStarted = resolve));
  const requests: string[] = [];
  global.fetch = (async (url: RequestInfo | URL) => {
    const path = new URL(String(url)).pathname;
    requests.push(path);
    if (path !== "/v1/account") throw new Error(`unexpected ${path}`);
    lookupStarted();
    await paused;
    return { ok: true, json: async () => ({ organizationId: "" }) } as Response;
  }) as typeof fetch;
  let challenges = 0;
  const pending = client.loginOrSignupWithWallet(
    { walletProvider },
    async (submit) => {
      challenges += 1;
      return submit("never-sent");
    },
  );
  await started;
  client.httpClient.config.organizationId = "other-org";
  releaseLookup();
  await expect(pending).rejects.toThrow();
  expect(challenges).toBe(0);
  expect(requests).toEqual(["/v1/account"]);
});

test.each(["config mutation", "http client replacement"])(
  "signUpWithWallet refuses a changed Captcha target after async signing: %s",
  async (change) => {
    const client = await ready();
    walletReady(client);
    let resumeSigning!: () => void;
    let signingStarted!: () => void;
    const signingPaused = new Promise<void>((resolve) => {
      resumeSigning = resolve;
    });
    const started = new Promise<void>((resolve) => {
      signingStarted = resolve;
    });
    client.buildWalletLoginRequest = async () => {
      signingStarted();
      await signingPaused;
      return { signedRequest: {} as any, publicKey: "11".repeat(32) };
    };
    const requests = capture({ "/v1/signup": { appProofs: [] } });
    const pending = client.signUpWithWallet({
      walletProvider,
      captchaToken: captcha,
    });
    await started;
    if (change === "config mutation") {
      client.httpClient.config.authProxyConfigId = "config-2";
    } else {
      client.httpClient = client.createHttpClient({
        authProxyUrl: "https://other.example.test",
      });
    }
    resumeSigning();
    await expect(pending).rejects.toThrow();
    expect(requests).toHaveLength(0);
  },
);

test.each([
  ["", AuthAction.SIGNUP],
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

test.each(["config mutation", "http client replacement"])(
  "loginOrSignupWithWallet refuses a changed Captcha target after account lookup: %s",
  async (change) => {
    const client = await ready();
    walletReady(client);
    let releaseLookup!: () => void;
    let lookupStarted!: () => void;
    const lookupPaused = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    const started = new Promise<void>((resolve) => {
      lookupStarted = resolve;
    });
    const requests: string[] = [];
    global.fetch = (async (url: RequestInfo | URL) => {
      const path = new URL(String(url)).pathname;
      requests.push(path);
      if (path !== "/v1/account") throw new Error(`unexpected ${path}`);
      lookupStarted();
      await lookupPaused;
      return {
        ok: true,
        json: async () => ({ organizationId: "" }),
      } as Response;
    }) as typeof fetch;

    const pending = client.loginOrSignupWithWallet({
      walletProvider,
      captchaToken: captcha,
    });
    await started;
    if (change === "config mutation") {
      client.httpClient.config.authProxyConfigId = "config-2";
    } else {
      client.httpClient = client.createHttpClient({
        authProxyUrl: "https://other.example.test",
      });
    }
    releaseLookup();
    await expect(pending).rejects.toThrow();
    expect(requests).toEqual(["/v1/account"]);
  },
);

test.each([
  ["", AuthAction.SIGNUP],
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
