import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { createECDH, createPrivateKey, createSign, createVerify } from "crypto";
import { AuthAction, ZeroXKeyErrorCodes } from "@0xkey-io/sdk-types";
import type { CrossPlatformApiKeyStamper } from "../__stampers__/api/base";
import { OtpType, type StorageBase } from "../__types__";
import { createReadyClient } from "./test-support/ready-client";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  delete (globalThis as any).document;
  delete (globalThis as any).window;
});

const ecdh = createECDH("prime256v1");
ecdh.setPrivateKey(Buffer.alloc(32, 1));
const point = ecdh.getPublicKey(undefined, "uncompressed");
const privateKey = createPrivateKey({
  key: {
    kty: "EC",
    crv: "P-256",
    x: point.subarray(1, 33).toString("base64url"),
    y: point.subarray(33).toString("base64url"),
    d: Buffer.alloc(32, 1).toString("base64url"),
  },
  format: "jwk",
});
const publicKey = ecdh.getPublicKey("hex", "compressed");

const verificationToken = `header.${Buffer.from(
  JSON.stringify({
    id: "token-1",
    public_key: publicKey,
    contact: "person@example.test",
    verification_type: "OTP_TYPE_EMAIL",
    exp: 2_000_000_000,
  }),
).toString("base64url")}.signature`;

const STAMP_LOGIN = "https://api.example.test/public/v1/submit/stamp_login";
const OTP_LOGIN_V2 = "https://auth.example.test/v1/otp_login_v2";

type StampLoginReply = { status: number; body: string; json: boolean };

function plain(status: number, body = "rejected"): StampLoginReply {
  return { status, body, json: false };
}

function grpc(status: number, reason?: string): StampLoginReply {
  return {
    status,
    json: true,
    body: JSON.stringify({
      code: 16,
      message: "rejected",
      details: reason
        ? [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason,
              domain: "0xkey.io",
            },
          ]
        : [],
    }),
  };
}

async function setup(config: Record<string, unknown> = {}) {
  const stored: Array<{ token: string; key: string | undefined }> = [];
  const signer = {
    listKeyPairs: async () => [publicKey],
    createKeyPair: async () => publicKey,
    deleteKeyPair: async () => {},
    sign: async (payload: string, format: unknown, key?: string) => {
      if (key !== publicKey) throw new Error("missing local signing key");
      return createSign("SHA256")
        .update(payload)
        .sign({
          key: privateKey,
          dsaEncoding: format === "raw" ? "ieee-p1363" : "der",
        })
        .toString("hex");
    },
  } as unknown as CrossPlatformApiKeyStamper;
  const storage = {
    getActiveSession: async () => undefined,
    storeSession: async (sessionToken: string, key?: string) => {
      stored.push({ token: sessionToken, key });
    },
    listSessionKeys: async () => stored.map((item) => item.key ?? "default"),
    getSession: async () => ({ publicKey }),
  } as unknown as StorageBase;
  const client = await createReadyClient();
  Object.assign(client, {
    config: {
      apiBaseUrl: "https://api.example.test",
      authProxyUrl: "https://auth.example.test",
      authProxyConfigId: "config-1",
      organizationId: "parent-org",
      ...config,
    },
    apiKeyStamper: signer,
    storageManager: storage,
  });
  const httpClient = client.createHttpClient();
  httpClient.config.activityPoller = { intervalMs: 0, numRetries: 1 };
  Object.assign(client, { httpClient });
  return { client, stored };
}

function mockNetwork(stampLogin: StampLoginReply) {
  const requests: Array<{ url: string; body: any }> = [];
  global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    requests.push({ url: String(url), body });
    if (String(url) === STAMP_LOGIN) {
      return new Response(stampLogin.body, {
        status: stampLogin.status,
        headers: {
          "content-type": stampLogin.json ? "application/json" : "text/plain",
        },
      });
    }
    if (String(url) === OTP_LOGIN_V2) {
      return new Response(JSON.stringify({ session: "proxy-session" }), {
        status: 200,
      });
    }
    if (String(url) === "https://auth.example.test/v1/otp_verify_v2") {
      return new Response(JSON.stringify({ verificationToken }), {
        status: 200,
      });
    }
    if (String(url) === "https://auth.example.test/v1/account") {
      return new Response(JSON.stringify({ organizationId: "verified-org" }), {
        status: 200,
      });
    }
    throw new Error(`unexpected request ${String(url)}`);
  }) as typeof fetch;
  return requests;
}

describe("loginWithOtp falls back to otp_login_v2 when Attested StampLogin is unavailable", () => {
  test.each<[string, StampLoginReply]>([
    ["plain-text 401 from a gateway without Attested support", plain(401)],
    ["plain-text 503", plain(503)],
    ["JSON 503 without a reason", grpc(503)],
    ["ATTESTED_STAMP_NOT_ENABLED", grpc(503, "ATTESTED_STAMP_NOT_ENABLED")],
    ["plain-text 404", plain(404)],
    ["JSON 404", grpc(404)],
    ["plain-text 501", plain(501)],
  ])("%s", async (_name, reply) => {
    const { client, stored } = await setup();
    const requests = mockNetwork(reply);

    await expect(
      client.loginWithOtp({
        verificationToken,
        organizationId: "org-1",
        invalidateExisting: true,
        sessionKey: "named",
      }),
    ).resolves.toEqual({ sessionToken: "proxy-session" });

    expect(requests.map((r) => r.url)).toEqual([STAMP_LOGIN, OTP_LOGIN_V2]);
    const body = requests[1]!.body;
    expect(body).toMatchObject({
      verificationToken,
      publicKey,
      organizationId: "org-1",
      invalidateExisting: true,
    });
    const expectedMessage = JSON.stringify({
      login: { publicKey },
      tokenId: "token-1",
      type: "USAGE_TYPE_LOGIN",
    });
    expect(body.clientSignature).toMatchObject({
      publicKey,
      scheme: "CLIENT_SIGNATURE_SCHEME_API_P256",
      message: expectedMessage,
    });
    expect(
      createVerify("SHA256")
        .update(expectedMessage)
        .verify(
          { key: privateKey, dsaEncoding: "ieee-p1363" },
          Buffer.from(body.clientSignature.signature, "hex"),
        ),
    ).toBe(true);
    expect(stored).toEqual([{ token: "proxy-session", key: "named" }]);
  });
});

describe("loginWithOtp does not fall back on an MFA refusal or a real failure", () => {
  test.each<[string, StampLoginReply]>([
    ["plain-text 403", plain(403)],
    ["JSON 403", grpc(403)],
    [
      "JSON 403 even with ATTESTED_STAMP_NOT_ENABLED",
      grpc(403, "ATTESTED_STAMP_NOT_ENABLED"),
    ],
    [
      "ATTESTED_LOGIN_MFA_UNSUPPORTED",
      grpc(403, "ATTESTED_LOGIN_MFA_UNSUPPORTED"),
    ],
    ["ATTESTED_LOGIN_* on 503", grpc(503, "ATTESTED_LOGIN_UNAVAILABLE")],
    ["ATTESTED_STAMP_* on 401", grpc(401, "ATTESTED_STAMP_SIGNATURE_INVALID")],
    ["ATTESTED_STAMP_* on 503", grpc(503, "ATTESTED_STAMP_MALFORMED")],
    ["JSON 401 without a reason", grpc(401)],
    ["plain-text 500", plain(500)],
    ["plain-text 429", plain(429)],
  ])("%s", async (_name, reply) => {
    const { client, stored } = await setup();
    const requests = mockNetwork(reply);

    await expect(
      client.loginWithOtp({ verificationToken, organizationId: "org-1" }),
    ).rejects.toMatchObject({
      code: ZeroXKeyErrorCodes.OTP_LOGIN_ERROR,
      cause: expect.objectContaining({ status: reply.status }),
    });
    expect(requests.map((r) => r.url)).toEqual([STAMP_LOGIN]);
    expect(stored).toEqual([]);
  });

  test("transport failure", async () => {
    const { client, stored } = await setup();
    const urls: string[] = [];
    global.fetch = (async (url: RequestInfo | URL) => {
      urls.push(String(url));
      throw new TypeError("network down");
    }) as typeof fetch;
    await expect(
      client.loginWithOtp({ verificationToken, organizationId: "org-1" }),
    ).rejects.toMatchObject({ code: ZeroXKeyErrorCodes.OTP_LOGIN_ERROR });
    expect(urls).toEqual([STAMP_LOGIN]);
    expect(stored).toEqual([]);
  });

  test("a Session Profile request, which otp_login_v2 cannot honour", async () => {
    const { client, stored } = await setup();
    const requests = mockNetwork(plain(401));
    await expect(
      client.loginWithOtp({
        verificationToken,
        organizationId: "org-1",
        sessionProfileId: "profile-1",
      }),
    ).rejects.toMatchObject({ code: ZeroXKeyErrorCodes.OTP_LOGIN_ERROR });
    expect(requests.map((r) => r.url)).toEqual([STAMP_LOGIN]);
    expect(stored).toEqual([]);
  });

  test("a client without an Auth Proxy config", async () => {
    const { client, stored } = await setup({ authProxyConfigId: undefined });
    const requests = mockNetwork(plain(401));
    await expect(
      client.loginWithOtp({ verificationToken, organizationId: "org-1" }),
    ).rejects.toMatchObject({ code: ZeroXKeyErrorCodes.OTP_LOGIN_ERROR });
    expect(requests.map((r) => r.url)).toEqual([STAMP_LOGIN]);
    expect(stored).toEqual([]);
  });
});

test("a failed fallback surfaces its own error and stores no Session", async () => {
  const { client, stored } = await setup();
  global.fetch = (async (url: RequestInfo | URL) =>
    String(url) === STAMP_LOGIN
      ? new Response("missing authentication stamp", { status: 401 })
      : new Response("bad gateway", { status: 502 })) as typeof fetch;
  await expect(
    client.loginWithOtp({ verificationToken, organizationId: "org-1" }),
  ).rejects.toMatchObject({
    code: ZeroXKeyErrorCodes.OTP_LOGIN_ERROR,
    cause: expect.objectContaining({ status: 502 }),
  });
  expect(stored).toEqual([]);
});

test("completeOtp logs an existing user in through the fallback", async () => {
  const { client, stored } = await setup();
  jest.spyOn(client, "verifyOtp").mockResolvedValue({
    verificationToken,
    subOrganizationId: "verified-org",
  });
  const requests = mockNetwork(plain(401));
  await expect(
    client.completeOtp({
      otpId: "otp-1",
      otpCode: "123456",
      otpEncryptionTargetBundle: "bundle",
      contact: "person@example.test",
      otpType: OtpType.Email,
      publicKey,
    }),
  ).resolves.toEqual({
    sessionToken: "proxy-session",
    verificationToken,
    action: AuthAction.LOGIN,
  });
  expect(requests.map((r) => r.url)).toEqual([STAMP_LOGIN, OTP_LOGIN_V2]);
  expect(requests[1]!.body.organizationId).toBe("verified-org");
  expect(stored).toHaveLength(1);
});
