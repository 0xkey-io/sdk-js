import { afterEach, describe, expect, test } from "@jest/globals";
import { ZeroXKeySDKClientBase } from "../__generated__/sdk-client-base";
import { getClientSignatureMessageForLogin } from "../utils";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

const client = () =>
  new ZeroXKeySDKClientBase({
    apiBaseUrl: "https://api.example.test",
    organizationId: "parent-org",
    authProxyUrl: "https://auth.example.test",
    authProxyConfigId: "config-1",
  });

describe("OTP V2 Auth Proxy contract", () => {
  test.each([
    [
      "proxyInitOtpV2",
      "/v1/otp_init_v2",
      { otpType: "OTP_TYPE_EMAIL", contact: "a@example.test" },
      { otpId: "otp-1", otpEncryptionTargetBundle: "bundle" },
    ],
    [
      "proxyVerifyOtpV2",
      "/v1/otp_verify_v2",
      { otpId: "otp-1", encryptedOtpBundle: "encrypted" },
      { verificationToken: "token" },
    ],
    [
      "proxyOtpLoginV2",
      "/v1/otp_login_v2",
      {
        verificationToken: "token",
        publicKey: "session-key",
        clientSignature: {
          message: "signed bytes",
          publicKey: "verification-key",
          scheme: "CLIENT_SIGNATURE_SCHEME_API_P256",
          signature: "signature",
        },
        invalidateExisting: true,
        organizationId: "org-1",
      },
      { session: "session-token" },
    ],
  ] as Array<
    [
      "proxyInitOtpV2" | "proxyVerifyOtpV2" | "proxyOtpLoginV2",
      string,
      any,
      any,
    ]
  >)("%s sends its V2 contract", async (method, path, body, result) => {
    let request: { url: string; init: RequestInit } | undefined;
    global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      request = { url: String(url), init: init! };
      return { ok: true, json: async () => result } as Response;
    }) as typeof fetch;

    const actual = await (client()[method] as (input: any) => Promise<unknown>)(
      body,
    );

    expect(actual).toEqual(result);
    expect(request?.url).toBe(`https://auth.example.test${path}`);
    expect(request?.init.method).toBe("POST");
    expect(request?.init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Auth-Proxy-Config-ID": "config-1",
    });
    expect(JSON.parse(String(request?.init.body))).toEqual(body);
  });

  test.each([
    [
      "proxyInitOtpV2",
      { otpType: "OTP_TYPE_EMAIL", contact: "a@example.test" },
    ],
    ["proxyVerifyOtpV2", { otpId: "otp-1", encryptedOtpBundle: "bad" }],
    [
      "proxyOtpLoginV2",
      {
        verificationToken: "token",
        publicKey: "session-key",
        clientSignature: {
          message: "signed bytes",
          publicKey: "verification-key",
          scheme: "CLIENT_SIGNATURE_SCHEME_API_P256",
          signature: "signature",
        },
      },
    ],
  ] as Array<["proxyInitOtpV2" | "proxyVerifyOtpV2" | "proxyOtpLoginV2", any]>)(
    "%s propagates rpcStatus errors",
    async (method, body) => {
      global.fetch = (async () =>
        ({
          ok: false,
          json: async () => ({
            code: 3,
            message: "invalid OTP request",
            details: [],
          }),
        }) as Response) as typeof fetch;
      await expect(
        (client()[method] as (input: any) => Promise<unknown>)(body),
      ).rejects.toThrow("ZeroXKey error 3: invalid OTP request");
    },
  );

  test("low-level signature message binds verification key A to session key B", () => {
    const verificationToken = `header.${Buffer.from(
      JSON.stringify({
        id: "token-1",
        public_key: "verification-key-A",
      }),
    ).toString("base64url")}.signature`;
    const signature = getClientSignatureMessageForLogin({
      verificationToken,
      sessionPublicKey: "session-key-B",
    });
    expect(signature.publicKey).toBe("verification-key-A");
    expect(signature.message).toBe(
      '{"login":{"publicKey":"session-key-B"},"tokenId":"token-1","type":"USAGE_TYPE_LOGIN"}',
    );
  });
});
