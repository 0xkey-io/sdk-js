/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://app.example.test/"}
 */
import "fake-indexeddb/auto";
import { expect, it, jest } from "@jest/globals";
import {
  createECDH,
  createPrivateKey,
  createSign,
  createVerify,
} from "node:crypto";
import { act } from "react";
import type { ZeroXKeyClient, ZeroXKeyProviderConfig } from "../index";
import { setupProviderDom } from "./fixtures/provider-dom";

const mockRealClients: ZeroXKeyClient[] = [];

// The Provider constructs a real Core client; only its OTP verification step
// and its local signing key are replaced below, so StampLogin, the fallback,
// Session storage and the Provider post-auth path all run for real.
jest.mock("@0xkey-io/core", () => {
  const actual =
    jest.requireActual<typeof import("@0xkey-io/core")>("@0xkey-io/core");
  return {
    ...actual,
    ZeroXKeyClient: jest.fn((config: unknown) => {
      const client = new actual.ZeroXKeyClient(
        config as ConstructorParameters<typeof actual.ZeroXKeyClient>[0],
      );
      mockRealClients.push(client);
      return client;
    }),
  };
});

const STAMP_LOGIN = "https://api.example.test/public/v1/submit/stamp_login";
const OTP_LOGIN_V2 = "https://auth.example.test/v1/otp_login_v2";

const config: ZeroXKeyProviderConfig = {
  organizationId: "parent-org",
  apiBaseUrl: "https://api.example.test",
  authProxyUrl: "https://auth.example.test",
  authProxyConfigId: "config-1",
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

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

const ecdh = createECDH("prime256v1");
ecdh.setPrivateKey(Buffer.alloc(32, 7));
const point = ecdh.getPublicKey(undefined, "uncompressed");
const privateKey = createPrivateKey({
  key: {
    kty: "EC",
    crv: "P-256",
    x: point.subarray(1, 33).toString("base64url"),
    y: point.subarray(33).toString("base64url"),
    d: Buffer.alloc(32, 7).toString("base64url"),
  },
  format: "jwk",
});
const publicKey = ecdh.getPublicKey("hex", "compressed");

async function sign(payload: string, format: unknown, key?: string) {
  if (key !== publicKey) throw new Error("missing local signing key");
  return createSign("SHA256")
    .update(payload)
    .sign({
      key: privateKey,
      dsaEncoding: format === "raw" ? "ieee-p1363" : "der",
    })
    .toString("hex");
}

if (typeof globalThis.structuredClone !== "function") {
  globalThis.structuredClone = <T,>(value: T): T =>
    JSON.parse(JSON.stringify(value)) as T;
}

// jsdom has no fetch Response class.
function reply(status: number, statusText: string, body: string): Response {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: () => null },
    json: async () => JSON.parse(body),
    text: async () => body,
    clone: () => response,
  };
  return response as unknown as Response;
}

async function flush(times = 20) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
  }
}

it("completeOtp signs an existing user in through otp_login_v2 when the gateway rejects Attested StampLogin", async () => {
  const requests: Array<{ url: string; body: any }> = [];
  let session = "";
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    if (String(url) === STAMP_LOGIN) {
      return reply(401, "Unauthorized", "missing authentication stamp");
    }
    if (String(url) === OTP_LOGIN_V2) {
      return reply(200, "OK", JSON.stringify({ session }));
    }
    throw new Error(`unexpected request ${String(url)}`);
  }) as typeof fetch;

  const dom = setupProviderDom({ fetchImpl });
  const onAuthenticationSuccess = jest.fn();
  const onError = jest.fn();
  try {
    const { ClientState, AuthState } = dom.loadPublicExports();
    const mounted = await dom.mount(config, {
      onAuthenticationSuccess,
      onError,
    });
    for (let index = 0; index < 80; index += 1) {
      if (mounted.context()?.clientState === ClientState.Ready) break;
      await flush(1);
    }
    expect(mounted.context()?.clientState).toBe(ClientState.Ready);

    const client = mockRealClients.at(-1)!;
    // The IndexedDB key store needs a structuredClone that can copy
    // CryptoKey objects, which jsdom lacks; sign with a Node key instead.
    const stamper = (client as unknown as { apiKeyStamper: any }).apiKeyStamper;
    jest.spyOn(stamper, "listKeyPairs").mockResolvedValue([publicKey] as never);
    jest.spyOn(stamper, "sign").mockImplementation(sign as never);
    const verificationToken = `header.${base64url({
      id: "token-1",
      public_key: publicKey,
      contact: "person@example.test",
      verification_type: "OTP_TYPE_EMAIL",
      exp: 2_000_000_000,
    })}.signature`;
    session = `header.${base64url({
      exp: 2_000_000_000,
      public_key: publicKey,
      session_type: "SESSION_TYPE_READ_WRITE",
      user_id: "user-1",
      organization_id: "verified-org",
    })}.signature`;
    client.verifyOtp = async () => ({
      verificationToken,
      subOrganizationId: "verified-org",
    });

    let result: Awaited<
      ReturnType<NonNullable<ReturnType<typeof mounted.context>>["completeOtp"]>
    >;
    await act(async () => {
      result = await mounted.context()!.completeOtp({
        otpId: "otp-1",
        otpCode: "123456",
        otpEncryptionTargetBundle: "bundle",
        contact: "person@example.test",
        otpType: "OTP_TYPE_EMAIL" as never,
        publicKey,
      });
    });
    await flush();

    expect(result!).toMatchObject({ sessionToken: session, action: "LOGIN" });
    expect(requests.map((request) => request.url)).toEqual([
      STAMP_LOGIN,
      OTP_LOGIN_V2,
    ]);
    const { clientSignature, organizationId } = requests[1]!.body;
    expect(organizationId).toBe("verified-org");
    expect(
      createVerify("SHA256")
        .update(clientSignature.message)
        .verify(
          { key: privateKey, dsaEncoding: "ieee-p1363" },
          Buffer.from(clientSignature.signature, "hex"),
        ),
    ).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(onAuthenticationSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LOGIN",
        session: expect.objectContaining({ token: session }),
      }),
    );
    expect(mounted.context()?.authState).toBe(AuthState.Authenticated);
  } finally {
    await dom.restore();
  }
});
