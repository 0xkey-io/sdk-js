import { nativeOAuthError } from "../utils/oauth-native-store";
import { checkedState, checkedToken } from "./contract";

type FormPost = Readonly<{ method: string; url: string; body: string }>;

/**
 * Boundary for a host-owned WebView that exposes real navigation and form POST
 * events. Invertase v2.5.1 does not expose the exact callback URL to JS and
 * its Android interceptor uses substring matching, so it cannot back this gate.
 */
export function createAppleAndroidCallbackGate(input: {
  returnUrl: string;
  expectedState: string;
  allowedOrigins: readonly string[];
}): Readonly<{
  navigation(url: string): "allow" | "block";
  capturePost(post: FormPost): void;
  result(): { oidcToken: string };
}> {
  let target: URL;
  try {
    target = new URL(input.returnUrl);
  } catch {
    throw nativeOAuthError("config-invalid");
  }
  if (
    target.protocol !== "https:" ||
    !target.hostname ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.href !== input.returnUrl ||
    typeof input.expectedState !== "string" ||
    !input.expectedState ||
    !Array.isArray(input.allowedOrigins) ||
    !input.allowedOrigins.length
  ) {
    throw nativeOAuthError("config-invalid");
  }
  const origins = new Set<string>();
  for (const origin of input.allowedOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw nativeOAuthError("config-invalid");
    }
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/" ||
      parsed.origin !== origin ||
      origin === target.origin
    ) {
      throw nativeOAuthError("config-invalid");
    }
    origins.add(origin);
  }
  const returnUrl = input.returnUrl;
  const expectedState = input.expectedState;
  let terminal = false;
  let token: { oidcToken: string } | null = null;
  return Object.freeze({
    navigation(value: string) {
      if (terminal) return "block";
      try {
        const url = new URL(value);
        return url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          origins.has(url.origin)
          ? "allow"
          : "block";
      } catch {
        return "block";
      }
    },
    capturePost(post: FormPost) {
      if (terminal) throw nativeOAuthError("result-invalid");
      terminal = true;
      if (
        !post ||
        post.method !== "POST" ||
        post.url !== returnUrl ||
        typeof post.body !== "string" ||
        post.body.length > 65_536 ||
        /%(?![0-9a-fA-F]{2})/.test(post.body)
      ) {
        throw nativeOAuthError("result-invalid");
      }
      const form = new URLSearchParams(post.body);
      const states = form.getAll("state");
      const tokens = form.getAll("id_token");
      if (states.length !== 1 || tokens.length !== 1 || form.has("error"))
        throw nativeOAuthError("result-invalid");
      checkedState(states[0], expectedState);
      token = checkedToken(tokens[0]);
    },
    result() {
      if (!token) throw nativeOAuthError("result-invalid");
      const claimed = token;
      token = null;
      return claimed;
    },
  });
}
