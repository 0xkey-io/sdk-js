import { nativeOAuthError } from "../utils/oauth-native-store";
import { checkedToken } from "./contract";
import type { GoogleIosNativeBridge } from "./google-ios";

type SystemBrowser = Pick<
  typeof import("react-native-inappbrowser-reborn").InAppBrowser,
  "isAvailable" | "openAuth"
>;

type TokenFetcher = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Installed-app Google Code+PKCE protocol over the pinned InAppBrowser API.
 * The caller supplies the actual system browser and fetch. The parent adapter
 * checks callback URI/state and the server must verify the returned ID token.
 */
export function createGoogleIosSystemBridge(input: {
  browser: SystemBrowser;
  fetcher: TokenFetcher;
}): GoogleIosNativeBridge {
  if (
    !input?.browser ||
    typeof input.browser.isAvailable !== "function" ||
    typeof input.browser.openAuth !== "function" ||
    typeof input.fetcher !== "function"
  ) {
    throw nativeOAuthError("config-invalid");
  }
  const { browser, fetcher } = input;
  return Object.freeze({
    async openAuthorization(request) {
      const url = new URL(AUTHORIZATION_URL);
      url.searchParams.set("client_id", request.clientId);
      url.searchParams.set("redirect_uri", request.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", request.state);
      url.searchParams.set("code_challenge", request.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("nonce", request.nonce);
      let available: boolean;
      try {
        available = await browser.isAvailable();
      } catch {
        throw nativeOAuthError("adapter-failed");
      }
      if (!available) throw nativeOAuthError("adapter-failed");
      let response: Awaited<ReturnType<SystemBrowser["openAuth"]>>;
      try {
        response = await browser.openAuth(url.href, request.redirectUri, {
          dismissButtonStyle: "cancel",
          ephemeralWebSession: false,
        });
      } catch {
        throw nativeOAuthError("adapter-failed");
      }
      if (response.type === "cancel" || response.type === "dismiss")
        return { type: "cancel" as const };
      if (response.type !== "success" || typeof response.url !== "string")
        throw nativeOAuthError("result-invalid");
      return { type: "callback" as const, url: response.url };
    },
    async exchangeCode(request) {
      const body = new URLSearchParams({
        client_id: request.clientId,
        redirect_uri: request.redirectUri,
        code: request.code,
        code_verifier: request.verifier,
        grant_type: "authorization_code",
      });
      let response: Awaited<ReturnType<TokenFetcher>>;
      try {
        response = await fetcher(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          redirect: "error",
        });
      } catch {
        throw nativeOAuthError("adapter-failed");
      }
      if (!response?.ok) throw nativeOAuthError("adapter-failed");
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw nativeOAuthError("result-invalid");
      }
      const token =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as { id_token?: unknown }).id_token
          : undefined;
      return checkedToken(token);
    },
  });
}
