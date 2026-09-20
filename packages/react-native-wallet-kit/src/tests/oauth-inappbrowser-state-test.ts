import { describe, expect, it } from "@jest/globals";
import { OAuthProviders } from "@0xkey-io/sdk-types";
import { buildOAuthState, parseInAppBrowserResult } from "../utils/oauth";

const providers = [
  OAuthProviders.GOOGLE,
  OAuthProviders.APPLE,
  OAuthProviders.FACEBOOK,
  OAuthProviders.X,
  OAuthProviders.DISCORD,
] as const;

function callbackUrl(
  provider: (typeof providers)[number],
  state: string,
  extras: Record<string, string> = {},
): string {
  const callback = new URL("myapp://oauth/callback");
  callback.searchParams.set(
    provider === OAuthProviders.GOOGLE || provider === OAuthProviders.APPLE
      ? "id_token"
      : "code",
    provider === OAuthProviders.GOOGLE || provider === OAuthProviders.APPLE
      ? "synthetic.id.token"
      : "synthetic-code",
  );
  callback.searchParams.set("state", state);
  for (const [key, value] of Object.entries(extras)) {
    callback.searchParams.set(key, value);
  }
  return callback.toString();
}

describe("InAppBrowser OAuth callback state enforcement", () => {
  it.each(providers)(
    "accepts the exact %s authorization state after one transport decode",
    (provider) => {
      const state = buildOAuthState({
        provider,
        flow: "redirect",
        publicKey: "pk+with%metacharacters",
        nonce: "nonce/安全?value",
        additionalState: {
          returnTarget: "https://example.com/a?x=1&y=two words#片段",
          label: "安全 🔐 + 100%",
        },
      });

      const parsed = parseInAppBrowserResult(
        callbackUrl(provider, state),
        state,
      );

      expect(parsed).toEqual({
        idToken:
          provider === OAuthProviders.GOOGLE ||
          provider === OAuthProviders.APPLE
            ? "synthetic.id.token"
            : null,
        authCode:
          provider === OAuthProviders.GOOGLE ||
          provider === OAuthProviders.APPLE
            ? null
            : "synthetic-code",
        sessionKey: undefined,
        provider,
        publicKey: "pk+with%metacharacters",
        nonce: "nonce/安全?value",
      });
    },
  );

  it.each([undefined, "", "different-state"])(
    "rejects missing, empty, or unequal returned state (%s)",
    (returnedState) => {
      const callback = new URL("myapp://oauth/callback");
      callback.searchParams.set("code", "do-not-exchange");
      if (returnedState !== undefined) {
        callback.searchParams.set("state", returnedState);
      }

      expect(() =>
        parseInAppBrowserResult(callback.toString(), "expected-state"),
      ).toThrow("Invalid OAuth callback state");
    },
  );

  it("rejects duplicate returned state", () => {
    expect(() =>
      parseInAppBrowserResult(
        "myapp://oauth/callback?code=do-not-exchange&state=expected-state&state=expected-state",
        "expected-state",
      ),
    ).toThrow("Invalid OAuth callback state");
  });

  it.each([
    ["provider", "apple"],
    ["publicKey", "attacker-key"],
    ["nonce", "attacker-nonce"],
    ["returnTarget", "https://attacker.example/return"],
  ])("rejects a %s mutation in returned state", (field, value) => {
    const expectedState = buildOAuthState({
      provider: OAuthProviders.GOOGLE,
      flow: "redirect",
      publicKey: "trusted-key",
      nonce: "trusted-nonce",
      additionalState: { returnTarget: "trusted-target" },
    });
    const mutated = new URLSearchParams(expectedState);
    mutated.set(field, value);

    expect(() =>
      parseInAppBrowserResult(
        callbackUrl(OAuthProviders.GOOGLE, mutated.toString()),
        expectedState,
      ),
    ).toThrow("Invalid OAuth callback state");
  });

  it("rejects malformed callback URLs", () => {
    expect(() =>
      parseInAppBrowserResult("not a callback URL", "expected-state"),
    ).toThrow("Invalid OAuth callback URL");
  });

  it("does not treat fragment state as query state", () => {
    expect(() =>
      parseInAppBrowserResult(
        "myapp://oauth/callback?code=do-not-exchange#state=expected-state",
        "expected-state",
      ),
    ).toThrow("Invalid OAuth callback state");
  });

  it("rejects an OAuth error even when code and state are also present without exposing response data", () => {
    const state = "provider=discord&flow=redirect&publicKey=sensitive-key";
    let thrown: unknown;
    try {
      parseInAppBrowserResult(
        callbackUrl(OAuthProviders.DISCORD, state, {
          error: "access_denied",
          error_description: "sensitive-provider-description",
          id_token: "sensitive-token",
        }),
        state,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("OAuth callback returned an error");
    expect((thrown as Error).message).not.toContain("sensitive-key");
    expect((thrown as Error).message).not.toContain("synthetic-code");
    expect((thrown as Error).message).not.toContain("sensitive-token");
    expect((thrown as Error).message).not.toContain("access_denied");
  });

  it("retains parsing compatibility when expected state is omitted", () => {
    expect(
      parseInAppBrowserResult("myapp://oauth/callback?id_token=legacy-token"),
    ).toEqual({
      idToken: "legacy-token",
      authCode: null,
      sessionKey: undefined,
      provider: null,
      publicKey: null,
      nonce: null,
    });
  });
});
