import { describe, expect, it } from "@jest/globals";
import { OAuthProviders } from "@0xkey-io/sdk-types";
import {
  buildOAuthState,
  buildOAuthUrl,
  extractOAuthTransactionCallback,
  parseStateParam,
} from "../utils/oauth";
import {
  createOAuthTransactionStore,
  type OAuthTransactionSecureStorage,
} from "../utils/oauth-transaction";

const transactionId = "0123456789abcdef0123456789abcdef";
const stateParams = {
  provider: OAuthProviders.GOOGLE,
  flow: "redirect" as const,
  publicKey: "trusted-public-key",
};
const urlParams = {
  ...stateParams,
  clientId: "test-client",
  redirectUri: "testapp://callback",
  nonce: "test-nonce",
};

function callback(state: string): string {
  return `testapp://callback?code=test-code&state=${encodeURIComponent(state)}`;
}

describe("OAuth state contract", () => {
  it.each([
    ["provider", "google"],
    ["flow", "redirect"],
    ["publicKey", "trusted-public-key"],
    ["nonce", "trusted-nonce"],
    ["transactionId", transactionId],
  ])(
    "rejects additionalState collision with reserved key %s without exposing its value",
    (reservedKey, suppliedValue) => {
      let thrown: unknown;
      try {
        buildOAuthState({
          provider: OAuthProviders.GOOGLE,
          flow: "redirect",
          publicKey: "trusted-public-key",
          nonce: "trusted-nonce",
          additionalState: { [reservedKey]: suppliedValue },
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).not.toContain(suppliedValue);
    },
  );

  it("carries the dedicated ID through direct and proxy authorization state", () => {
    const expected =
      "provider=google&flow=redirect&publicKey=trusted-public-key&transactionId=0123456789abcdef0123456789abcdef";
    expect(buildOAuthState({ ...stateParams, transactionId })).toBe(expected);
    for (const useOauthProxyOrigin of [false, true]) {
      const url = buildOAuthUrl({
        ...urlParams,
        transactionId,
        useOauthProxyOrigin,
      });
      expect(new URL(url).searchParams.get("state")).toBe(expected);
    }
  });

  it.each([
    "",
    "short",
    "0123456789ABCDEF0123456789ABCDEF",
    "0123456789abcdef0123456789abcdef0",
    "../0123456789abcdef0123456789abc",
    "0123456789abcdef0123456789abcdef\n",
  ])("rejects malformed dedicated IDs in both builders (%s)", (id) => {
    expect(() =>
      buildOAuthState({ ...stateParams, transactionId: id }),
    ).toThrow();
    expect(() => buildOAuthUrl({ ...urlParams, transactionId: id })).toThrow();
  });

  it("rejects additionalState ID overrides even when equal to the dedicated ID", () => {
    const additionalState = { transactionId };
    expect(() =>
      buildOAuthState({ ...stateParams, transactionId, additionalState }),
    ).toThrow();
    expect(() =>
      buildOAuthUrl({ ...urlParams, transactionId, additionalState }),
    ).toThrow();
  });

  it("extracts one exact transport-decoded state without recursive decoding or reserialization", () => {
    const returnedState =
      "provider=google&flow=redirect&publicKey=key%2526&transactionId=0123456789abcdef0123456789abcdef&label=%E5%AE%89%E5%85%A8+%F0%9F%94%90&literal=%2526%253D&percent=%25&equals=a=b=c";
    expect(
      extractOAuthTransactionCallback(
        callback(returnedState) + "&id_token=test-token#screen",
      ),
    ).toEqual({ transactionId, returnedState });
    const plusEncoded = `testapp://callback?state=${encodeURIComponent(returnedState + "&note=two words").replace("%20", "+")}`;
    expect(extractOAuthTransactionCallback(plusEncoded).returnedState).toBe(
      returnedState + "&note=two words",
    );
  });

  it.each(["transactionId", "provider", "flow", "publicKey", "nonce"])(
    "rejects repeated inner security field %s including encoded aliases",
    (field) => {
      const value = field === "transactionId" ? transactionId : "test-value";
      const first =
        field === "transactionId" ? "" : `transactionId=${transactionId}&`;
      for (const duplicate of [
        field,
        `%${field.charCodeAt(0).toString(16)}${field.slice(1)}`,
      ]) {
        expect(() =>
          extractOAuthTransactionCallback(
            callback(`${first}${field}=${value}&${duplicate}=${value}`),
          ),
        ).toThrow("Invalid OAuth transaction callback");
      }
    },
  );

  it.each(["state", "code", "id_token", "error"])(
    "rejects repeated outer security field %s including encoded aliases",
    (field) => {
      const state = encodeURIComponent(`transactionId=${transactionId}`);
      const value = field === "state" ? state : "test-value";
      const first = field === "state" ? "" : `state=${state}&`;
      for (const duplicate of [
        field,
        `%${field.charCodeAt(0).toString(16)}${field.slice(1)}`,
      ]) {
        expect(() =>
          extractOAuthTransactionCallback(
            `testapp://callback?${first}${field}=${value}&${duplicate}=${value}`,
          ),
        ).toThrow("Invalid OAuth transaction callback");
      }
    },
  );

  it.each(["%", "%2", "%GG", "%C0%AF", "%ED%A0%80", "%E5%AE"])(
    "rejects malformed percent/UTF-8 at either form layer (%s)",
    (malformed) => {
      for (const raw of [
        `testapp://callback?state=${malformed}`,
        `${callback(`transactionId=${transactionId}`)}&${malformed}=metadata`,
        `${callback(`transactionId=${transactionId}`)}&metadata=${malformed}`,
        callback(`transactionId=${transactionId}&metadata=${malformed}`),
        callback(`transactionId=${transactionId}&${malformed}=metadata`),
      ])
        expect(() => extractOAuthTransactionCallback(raw)).toThrow(
          "Invalid OAuth transaction callback",
        );
    },
  );

  it.each([
    "not-a-url",
    "testapp://callback?code=test-code",
    "testapp://callback?state=",
    callback("provider=google"),
    callback("transactionId="),
    callback("transactionId=0123456789ABCDEF0123456789ABCDEF"),
    callback(`transactionId=${transactionId}\n`),
    callback(`transactionId=${transactionId}`) + "&error=secret-error",
    `testapp://callback?state=${encodeURIComponent(`transactionId=${transactionId}`)}&error=secret-error`,
    `testapp://callback#state=${encodeURIComponent(`transactionId=${transactionId}`)}`,
    callback(`transactionId=${transactionId}`) + "#state=other",
    callback(`transactionId=${transactionId}`) + "#code=other",
    callback(`transactionId=${transactionId}`) + "#id_token=other",
    callback(`transactionId=${transactionId}`) + "#%65rror=other",
  ])(
    "rejects unavailable or ambiguous callback envelopes without echoing input (%s)",
    (url) => {
      expect(() => extractOAuthTransactionCallback(url)).toThrow(
        new Error("Invalid OAuth transaction callback"),
      );
    },
  );

  it("reconstructs pending bytes, rejects extraction failures without mutation, and redeems the correlated verifier once", async () => {
    const persisted = new Map<string, string>();
    const adapter = (
      values: Map<string, string>,
    ): OAuthTransactionSecureStorage => ({
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        values.set(key, value);
      },
      remove: async (key) => {
        values.delete(key);
      },
    });
    const keys = new Set(["trusted-public-key"]);
    const dependencies = {
      randomBytes: () => new Uint8Array(16).fill(7),
      now: () => 1_000,
      cleanupTemporaryKey: async (key: string) => {
        keys.delete(key);
      },
    };
    let authorizationUrl = "";
    await createOAuthTransactionStore({
      ...dependencies,
      secureStorage: adapter(persisted),
    }).beginOAuthTransaction({
      configId: "test-config",
      provider: OAuthProviders.GOOGLE,
      publicKey: "trusted-public-key",
      codeVerifier: "test-verifier",
      createExpectedState: (id) => {
        authorizationUrl = buildOAuthUrl({
          ...urlParams,
          transactionId: id,
          additionalState: { label: "安全 🔐 %2526 %253D" },
        });
        return new URL(authorizationUrl).searchParams.get("state")!;
      },
    });
    // Only persisted bytes and the returned URL survive; the adapter is a different object.
    const resumedBytes = new Map(persisted);
    const resumed = createOAuthTransactionStore({
      ...dependencies,
      secureStorage: adapter(resumedBytes),
    });
    const returnedState = new URL(authorizationUrl).searchParams.get("state")!;
    const deepLink = callback(returnedState);
    expect(() =>
      extractOAuthTransactionCallback(deepLink + "&error=secret-error"),
    ).toThrow("Invalid OAuth transaction callback");
    expect([...resumedBytes]).toEqual([...persisted]);
    const envelope = extractOAuthTransactionCallback(deepLink);
    expect(envelope.transactionId).toBe("07070707070707070707070707070707");
    const context = {
      configId: "test-config",
      provider: OAuthProviders.GOOGLE,
    };
    await expect(
      resumed.consumeOAuthTransaction(
        envelope.transactionId,
        envelope.returnedState,
        context,
      ),
    ).resolves.toMatchObject({
      codeVerifier: "test-verifier",
      publicKey: "trusted-public-key",
    });
    await expect(
      resumed.consumeOAuthTransaction(
        envelope.transactionId,
        envelope.returnedState,
        context,
      ),
    ).rejects.toThrow("OAuth transaction unavailable");
    expect(resumedBytes.size).toBe(0);
    expect([...keys]).toEqual(["trusted-public-key"]);
  });

  it("round-trips safe metadata with URL metacharacters and Unicode without changing the security tuple", () => {
    const state = buildOAuthState({
      provider: OAuthProviders.GOOGLE,
      flow: "redirect",
      publicKey: "trusted-public-key",
      nonce: "trusted-nonce",
      additionalState: {
        returnTarget: "https://example.com/callback?a=1&b=two words#片段",
        label: "安全 🔐 + 100%",
      },
    });

    expect(parseStateParam(state)).toEqual({
      provider: "google",
      flow: "redirect",
      publicKey: "trusted-public-key",
      nonce: "trusted-nonce",
      returnTarget: "https://example.com/callback?a=1&b=two words#片段",
      label: "安全 🔐 + 100%",
    });
  });
});
