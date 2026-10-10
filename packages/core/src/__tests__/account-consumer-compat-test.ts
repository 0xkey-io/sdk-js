import { afterEach, expect, jest, test } from "@jest/globals";
import { createECDH } from "crypto";
import {
  Chain,
  OtpType,
  WalletInterfaceType,
  type WalletProvider,
} from "../__types__";
import { createReadyClient } from "./test-support/ready-client";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  delete (globalThis as any).document;
  delete (globalThis as any).window;
});

type AccountAnswer = {
  status: number;
  body: unknown;
};

const accountError = (status: number): AccountAnswer => ({
  status,
  body: { code: status, message: "account lookup failed", details: null },
});

const otpKey = createECDH("prime256v1");
otpKey.setPrivateKey(Buffer.alloc(32, 1));
const otpPublicKey = otpKey.getPublicKey("hex", "compressed");
const targetKey = createECDH("prime256v1");
targetKey.setPrivateKey(Buffer.alloc(32, 3));
const otpEncryptionTargetBundle = JSON.stringify({
  data: Buffer.from(
    JSON.stringify({ targetPublic: targetKey.getPublicKey("hex") }),
  ).toString("hex"),
});
const verificationToken = `header.${Buffer.from(
  JSON.stringify({
    id: "otp-token-1",
    public_key: otpPublicKey,
    contact: "person@example.test",
    verification_type: OtpType.Email,
    exp: 2_000_000_000,
  }),
).toString("base64url")}.signature`;
const walletProvider = {
  interfaceType: WalletInterfaceType.Solana,
  chainInfo: { namespace: Chain.Solana },
} as WalletProvider;
type Flow = "oauth" | "otp" | "wallet";

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

function serveAccount(answer: AccountAnswer) {
  const paths: string[] = [];
  global.fetch = (async (url: RequestInfo | URL) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    if (path === "/v1/account") {
      return {
        ok: answer.status === 200,
        status: answer.status,
        statusText: "fixture",
        json: async () => answer.body,
      } as Response;
    }
    if (path === "/v1/otp_verify_v2") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ verificationToken }),
      } as Response;
    }
    if (path === "/v1/signup" || path === "/v1/signup_v2") {
      return {
        ok: false,
        status: 503,
        statusText: "fixture",
        json: async () => ({
          code: 14,
          message: "signup probe",
          details: null,
        }),
      } as Response;
    }
    throw new Error(`unexpected request ${path}`);
  }) as typeof fetch;
  return paths;
}

async function invoke(flow: Flow, client: Awaited<ReturnType<typeof ready>>) {
  if (flow === "oauth") {
    return client.completeOauth({ oidcToken: "oidc", publicKey: "key" });
  }
  if (flow === "otp") {
    Object.assign(client, {
      apiKeyStamper: {
        listKeyPairs: async () => [otpPublicKey],
        sign: async () => "11".repeat(64),
      },
    });
    return client.completeOtp({
      otpId: "otp-1",
      otpCode: "123456",
      otpEncryptionTargetBundle,
      contact: "person@example.test",
      otpType: OtpType.Email,
      publicKey: otpPublicKey,
    });
  }
  client.buildWalletLoginRequest = async () => ({
    signedRequest: {} as any,
    publicKey: "11".repeat(32),
  });
  return client.loginOrSignupWithWallet({ walletProvider });
}

const flows: Flow[] = ["oauth", "otp", "wallet"];
for (const flow of flows) {
  test.each([403, 409, 503])(
    `${flow} does not turn HTTP %s account failure into signup`,
    async (status) => {
      const client = await ready();
      const paths = serveAccount(accountError(status));
      await expect(invoke(flow, client)).rejects.toThrow();
      expect(paths).toEqual(
        flow === "otp" ? ["/v1/otp_verify_v2", "/v1/account"] : ["/v1/account"],
      );
    },
  );
}

const malformedAccounts: Array<[string, unknown]> = [
  ["missing", {}],
  ["null", { organizationId: null }],
  ["number", { organizationId: 0 }],
  ["whitespace", { organizationId: "   " }],
];
for (const flow of flows) {
  test.each(malformedAccounts)(
    `${flow} rejects 200 account body with %s organizationId before signup`,
    async (_name, body) => {
      const client = await ready();
      const paths = serveAccount({ status: 200, body });
      await expect(invoke(flow, client)).rejects.toThrow();
      expect(paths).toEqual(
        flow === "otp" ? ["/v1/otp_verify_v2", "/v1/account"] : ["/v1/account"],
      );
    },
  );
}

for (const flow of flows) {
  test(`${flow} permits only exact 200 empty organizationId to start signup`, async () => {
    const client = await ready();
    const paths = serveAccount({ status: 200, body: { organizationId: "" } });
    await expect(invoke(flow, client)).rejects.toThrow();
    expect(paths).toEqual(
      flow === "otp"
        ? ["/v1/otp_verify_v2", "/v1/account", "/v1/signup_v2"]
        : ["/v1/account", "/v1/signup"],
    );
  });
}
