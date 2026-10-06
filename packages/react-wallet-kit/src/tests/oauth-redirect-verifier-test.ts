/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://app.example.test/"}
 */
import { describe, expect, it, jest } from "@jest/globals";
import { OAuthProviders } from "@0xkey-io/sdk-types";
import { completePKCEFlow } from "../utils/oauth/completion";

describe("redirect PKCE completion", () => {
  it("uses the claimed transaction verifier and leaves the shared slot untouched", async () => {
    localStorage.setItem("discord_verifier", "slot-verifier");
    const exchange = jest.fn(async () => "oidc-token");

    await completePKCEFlow({
      publicKey: "public-key",
      providerName: OAuthProviders.DISCORD,
      exchangeCodeForToken: exchange,
      completeOauth: jest.fn(async () => {
        throw new Error("default completion must not run");
      }),
      onOauthSuccess: jest.fn(),
      codeVerifier: "claimed-verifier",
    });

    expect(exchange).toHaveBeenCalledWith("claimed-verifier");
    expect(localStorage.getItem("discord_verifier")).toBe("slot-verifier");
  });
});
