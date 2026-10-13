import type { ZeroXKeyCallbacks } from "@0xkey-io/react-native-wallet-kit";

/**
 * Minimal callbacks for visibility during development. Safe to keep: the
 * authentication identifier is an OIDC or verification token and session keys
 * are credentials, so neither is logged.
 */
export const ZEROXKEY_CALLBACKS: ZeroXKeyCallbacks = {
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
