import type { ZeroXKeyCallbacks } from "@0xkey-io/react-native-wallet-kit";

export type OauthRedirect = Parameters<
  NonNullable<ZeroXKeyCallbacks["onOauthRedirect"]>
>[0];

type OauthCompletion = (redirect: OauthRedirect) => void;

let completion: OauthCompletion | undefined;
let undelivered: OauthRedirect | undefined;
let startedProvider: string | undefined;

/**
 * The app completes OAuth itself (components/auth/oauth-completion.tsx) so a
 * new account can be challenged before signup. A result that arrives before
 * that component mounts, as in a cold-start recovery, is held in memory only
 * until then.
 */
export function registerOauthCompletion(next: OauthCompletion): () => void {
  completion = next;
  const redirect = undelivered;
  undelivered = undefined;
  if (redirect) next(redirect);
  return () => {
    if (completion === next) completion = undefined;
  };
}

/** Records which provider button started the browser flow. */
export function setOauthProvider(provider: string | undefined): void {
  startedProvider = provider;
}

export function takeOauthProvider(): string | undefined {
  const provider = startedProvider;
  startedProvider = undefined;
  return provider;
}

/**
 * Minimal callbacks for visibility during development. Safe to keep: the
 * authentication identifier is an OIDC or verification token and session keys
 * are credentials, so neither is logged.
 */
export const ZEROXKEY_CALLBACKS: ZeroXKeyCallbacks = {
  onOauthRedirect: (redirect) => {
    if (completion) completion(redirect);
    else undelivered = redirect;
  },
  beforeSessionExpiry: () => {
    console.log("[ZeroXKey] Session nearing expiry");
  },
  onSessionExpired: () => {
    console.log("[ZeroXKey] Session expired");
  },
  onAuthenticationSuccess: ({ action, method }) => {
    console.log("[ZeroXKey] Auth success:", { action, method });
  },
  onError: (error) => {
    console.error("[ZeroXKey] Error:", error);
  },
};
