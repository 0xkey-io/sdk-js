import { describe, expect, it } from "@jest/globals";
import { OAuthProviders } from "@0xkey-io/sdk-types";
import { buildOAuthState, parseStateParam } from "../utils/oauth";

describe("OAuth state contract", () => {
  it.each([
    ["provider", "google"],
    ["flow", "redirect"],
    ["publicKey", "trusted-public-key"],
    ["nonce", "trusted-nonce"],
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
