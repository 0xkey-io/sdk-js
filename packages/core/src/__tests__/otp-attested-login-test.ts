import { afterEach, expect, test } from "@jest/globals";
import {
  createECDH,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
} from "crypto";
import { AttestedScheme, AttestedStamper } from "@0xkey-io/attested-stamper";
import { AuthAction } from "@0xkey-io/sdk-types";
import type { CrossPlatformApiKeyStamper } from "../__stampers__/api/base";
import { ZeroXKeyClient } from "../__clients__/core";
import {
  OtpType,
  type LoginWithOtpParams,
  type StorageBase,
} from "../__types__";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

const privateA = Buffer.alloc(32, 1);
const privateB = Buffer.alloc(32, 2);
function keyPair(privateKey: Buffer) {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(privateKey);
  const point = ecdh.getPublicKey(undefined, "uncompressed");
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33).toString("base64url"),
      d: privateKey.toString("base64url"),
    },
    format: "jwk",
  });
  return {
    publicKey: ecdh.getPublicKey("hex", "compressed"),
    privateKey: key,
    verifyingKey: createPublicKey(key),
  };
}
const pairA = keyPair(privateA);
const pairB = keyPair(privateB);
const publicA = pairA.publicKey;
const publicB = pairB.publicKey;

function token(publicKey: string, id = "token-1") {
  return `header.${Buffer.from(
    JSON.stringify({
      id,
      public_key: publicKey,
      contact: "person@example.test",
      verification_type: "VERIFICATION_TYPE_EMAIL",
      exp: 2_000_000_000,
    }),
  ).toString("base64url")}.signature`;
}

function response(session?: string, status = "ACTIVITY_STATUS_COMPLETED") {
  return {
    ok: true,
    json: async () => ({
      activity: {
        id: "activity-1",
        organizationId: "org-1",
        type: "ACTIVITY_TYPE_STAMP_LOGIN",
        status,
        ...(session && { result: { stampLoginResult: { session } } }),
      },
    }),
  } as Response;
}

function setup(
  keys: Record<string, ReturnType<typeof keyPair>> = { [publicA]: pairA },
) {
  const stored: Array<{ token: string; key: string | undefined }> = [];
  const deleted: string[] = [];
  const signer = {
    listKeyPairs: async () => Object.keys(keys),
    createKeyPair: async () => {
      throw new Error("must not create a key");
    },
    deleteKeyPair: async (publicKey: string) => {
      deleted.push(publicKey);
    },
    sign: async (payload: string, format: unknown, publicKey?: string) => {
      const secret = keys[publicKey ?? ""];
      if (!secret) throw new Error("missing local signing key");
      const signer = createSign("SHA256");
      signer.update(payload);
      return signer
        .sign({
          key: secret.privateKey,
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
    getSession: async () => ({ publicKey: publicA }),
  } as unknown as StorageBase;
  const originalStamper = new AttestedStamper(signer);
  originalStamper.configure({
    attestedIdentity: "existing-identity",
    publicKey: publicA,
    scheme: AttestedScheme.P256_OIDC,
  });
  const client = new ZeroXKeyClient(
    {
      apiBaseUrl: "https://api.example.test",
      authProxyUrl: "https://auth.example.test",
      authProxyConfigId: "config-1",
      organizationId: "parent-org",
    },
    signer,
    undefined,
    undefined,
    originalStamper,
  );
  Object.assign(client, { storageManager: storage });
  const httpClient = client.createHttpClient();
  httpClient.config.activityPoller = { intervalMs: 0, numRetries: 1 };
  Object.assign(client, { httpClient });
  return { client, stored, deleted, originalStamper, httpClient };
}

function assertAttestedRequest(
  url: RequestInfo | URL,
  init: RequestInit,
  expectedToken: string,
  expectedKey: string,
) {
  expect(String(url)).toBe(
    "https://api.example.test/public/v1/submit/stamp_login",
  );
  expect(init.method).toBe("POST");
  const headers = init.headers as Record<string, string>;
  expect(headers["X-Stamp-Attested"]).toBeTruthy();
  const stamp = JSON.parse(
    Buffer.from(headers["X-Stamp-Attested"]!, "base64url").toString(),
  );
  expect(stamp.publicKeyAttestation).toBe(expectedToken);
  expect(stamp.publicKey).toBe(expectedKey);
  expect(stamp.scheme).toBe("STAMP_ATTESTED_SCHEME_P256_VERIFICATION_TOKEN");
  const verifier = createVerify("SHA256");
  verifier.update(String(init.body));
  expect(
    verifier.verify(
      expectedKey === publicA ? pairA.verifyingKey : pairB.verifyingKey,
      Buffer.from(stamp.signature, "hex"),
    ),
  ).toBe(true);
}

test("loginWithOtp sends a real Attested stamp over the final StampLogin body and stores its Session", async () => {
  const { client, stored, deleted, originalStamper, httpClient } = setup();
  const verificationToken = token(publicA);
  global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    assertAttestedRequest(url, init!, verificationToken, publicA);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      type: "ACTIVITY_TYPE_STAMP_LOGIN",
      organizationId: "parent-org",
      parameters: { publicKey: publicA, expirationSeconds: "900" },
    });
    return response("session-1");
  }) as typeof fetch;

  expect(await client.loginWithOtp({ verificationToken })).toEqual({
    sessionToken: "session-1",
  });
  expect(stored).toEqual([{ token: "session-1", key: "@0xkey-io/session/v3" }]);
  expect(deleted).toEqual([]);
  expect(originalStamper.attestedIdentity).toBe("existing-identity");
  expect(client.httpClient).toBe(httpClient);
});

test("loginWithOtp maps explicit Session options without changing its storage key", async () => {
  const { client, stored } = setup();
  const params: LoginWithOtpParams = {
    verificationToken: token(publicA),
    publicKey: publicA,
    expirationSeconds: "3600",
    sessionProfileId: "profile-1",
    organizationId: "org-1",
    invalidateExisting: true,
    sessionKey: "my-session",
  };
  global.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body))).toMatchObject({
      organizationId: "org-1",
      parameters: {
        publicKey: publicA,
        expirationSeconds: "3600",
        sessionProfileId: "profile-1",
        invalidateExisting: true,
      },
    });
    expect(String(init?.body)).not.toContain("my-session");
    return response("session-2");
  }) as typeof fetch;

  expect(await client.loginWithOtp(params)).toEqual({
    sessionToken: "session-2",
  });
  expect(stored).toEqual([{ token: "session-2", key: "my-session" }]);
});

test("missing local Token key and incompatible legacy publicKey fail before network", async () => {
  const { client, stored, deleted } = setup({});
  let requests = 0;
  global.fetch = (async () => {
    requests++;
    return response("unexpected");
  }) as typeof fetch;
  await expect(
    client.loginWithOtp({ verificationToken: token(publicA) }),
  ).rejects.toThrow();
  await expect(
    client.loginWithOtp({
      verificationToken: token(publicA),
      publicKey: publicB,
    }),
  ).rejects.toThrow(/proxyOtpLoginV2/);
  expect(requests).toBe(0);
  expect(stored).toEqual([]);
  expect(deleted).toEqual([]);
});

test("failure and MFA pause do not store Session or delete the Token key", async () => {
  const { client, stored, deleted, originalStamper } = setup();
  global.fetch = (async () => {
    throw new Error("transport failed");
  }) as typeof fetch;
  await expect(
    client.loginWithOtp({ verificationToken: token(publicA) }),
  ).rejects.toThrow();
  global.fetch = (async () =>
    response(
      undefined,
      "ACTIVITY_STATUS_AUTHENTICATORS_NEEDED",
    )) as typeof fetch;
  await expect(
    client.loginWithOtp({ verificationToken: token(publicA) }),
  ).rejects.toThrow(/session/i);
  expect(stored).toEqual([]);
  expect(deleted).toEqual([]);
  expect(originalStamper.attestedIdentity).toBe("existing-identity");
});

test("concurrent Token logins keep separate signing identities", async () => {
  const { client, stored } = setup({ [publicA]: pairA, [publicB]: pairB });
  const tokens = new Map([
    [publicA, token(publicA, "token-A")],
    [publicB, token(publicB, "token-B")],
  ]);
  const seen = new Set<string>();
  global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const stamp = JSON.parse(
      Buffer.from(
        (init?.headers as Record<string, string>)["X-Stamp-Attested"]!,
        "base64url",
      ).toString(),
    );
    assertAttestedRequest(
      url,
      init!,
      tokens.get(stamp.publicKey)!,
      stamp.publicKey,
    );
    seen.add(stamp.publicKey);
    return response(`session-${stamp.publicKey.slice(0, 4)}`);
  }) as typeof fetch;
  await Promise.all([
    client.loginWithOtp({
      verificationToken: tokens.get(publicA)!,
      sessionKey: "A",
    }),
    client.loginWithOtp({
      verificationToken: tokens.get(publicB)!,
      sessionKey: "B",
    }),
  ]);
  expect(seen).toEqual(new Set([publicA, publicB]));
  expect(stored).toHaveLength(2);
});

test("successful Token login keeps other existing local keys available", async () => {
  const { client, deleted } = setup({ [publicA]: pairA, [publicB]: pairB });
  global.fetch = (async () => response("session-A")) as typeof fetch;
  await client.loginWithOtp({ verificationToken: token(publicA) });
  expect(deleted).toEqual([]);
});

test("signUpWithOtp uses Token key A for signup then StampLogin in the created organization", async () => {
  const { client, stored, deleted } = setup();
  const verificationToken = token(publicA);
  const urls: string[] = [];
  global.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(url));
    if (String(url).endsWith("/v1/signup_v2")) {
      const body = JSON.parse(String(init?.body));
      expect(body.verificationToken).toBe(verificationToken);
      expect(body.clientSignature.publicKey).toBe(publicA);
      const verifier = createVerify("SHA256");
      verifier.update(body.clientSignature.message);
      expect(
        verifier.verify(
          { key: pairA.verifyingKey, dsaEncoding: "ieee-p1363" },
          Buffer.from(body.clientSignature.signature, "hex"),
        ),
      ).toBe(true);
      return {
        ok: true,
        json: async () => ({
          organizationId: "new-org",
          userId: "user-1",
          appProofs: [],
        }),
      } as Response;
    }
    assertAttestedRequest(url, init!, verificationToken, publicA);
    expect(JSON.parse(String(init?.body)).organizationId).toBe("new-org");
    return response("signup-session");
  }) as typeof fetch;
  const result = await client.signUpWithOtp({
    verificationToken,
    contact: "person@example.test",
    otpType: OtpType.Email,
  });
  expect(result.sessionToken).toBe("signup-session");
  expect(urls).toEqual([
    "https://auth.example.test/v1/signup_v2",
    "https://api.example.test/public/v1/submit/stamp_login",
  ]);
  expect(stored).toHaveLength(1);
  expect(deleted).toEqual([]);
});

test("signUpWithOtp rejects a different publicKey before any network request", async () => {
  const { client, deleted } = setup({ [publicA]: pairA, [publicB]: pairB });
  let requests = 0;
  global.fetch = (async () => {
    requests++;
    return response("unexpected");
  }) as typeof fetch;
  await expect(
    client.signUpWithOtp({
      verificationToken: token(publicA),
      contact: "person@example.test",
      otpType: OtpType.Email,
      publicKey: publicB,
    }),
  ).rejects.toThrow(/proxyOtpLoginV2/);
  expect(requests).toBe(0);
  expect(deleted).toEqual([]);
});

test("signUpWithOtp rejects a missing created organization without deleting Token key", async () => {
  const { client, stored, deleted } = setup();
  let requests = 0;
  global.fetch = (async () => {
    requests++;
    return { ok: true, json: async () => ({ userId: "user-1" }) } as Response;
  }) as typeof fetch;
  await expect(
    client.signUpWithOtp({
      verificationToken: token(publicA),
      contact: "person@example.test",
      otpType: OtpType.Email,
    }),
  ).rejects.toThrow(/organization ID/);
  expect(requests).toBe(1);
  expect(stored).toEqual([]);
  expect(deleted).toEqual([]);
});

test("completeOtp passes the verified existing organization into Attested login", async () => {
  const { client } = setup();
  client.verifyOtp = async () => ({
    verificationToken: token(publicA),
    subOrganizationId: "verified-org",
  });
  let loginParams: LoginWithOtpParams | undefined;
  client.loginWithOtp = async (params) => {
    loginParams = params;
    return { sessionToken: "session-1" };
  };
  const result = await client.completeOtp({
    otpId: "otp-1",
    otpCode: "123456",
    otpEncryptionTargetBundle: "bundle",
    contact: "person@example.test",
    otpType: OtpType.Email,
    publicKey: publicA,
  });
  expect(loginParams).toMatchObject({
    organizationId: "verified-org",
    publicKey: publicA,
  });
  expect(result.action).toBe(AuthAction.LOGIN);
});
