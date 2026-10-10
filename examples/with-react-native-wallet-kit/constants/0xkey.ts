import type {
  ZeroXKeyProviderConfig,
  ZeroXKeyCallbacks,
} from "@0xkey-io/react-native-wallet-kit";

import { buildZeroXKeyConfig } from "./config";

// Expo only inlines `process.env.EXPO_PUBLIC_*` when each one is read directly.
export const ZEROXKEY_CONFIG: ZeroXKeyProviderConfig = buildZeroXKeyConfig({
  organizationId: process.env.EXPO_PUBLIC_ZEROXKEY_ORGANIZATION_ID,
  apiBaseUrl: process.env.EXPO_PUBLIC_ZEROXKEY_API_BASE_URL,
  authProxyUrl: process.env.EXPO_PUBLIC_ZEROXKEY_AUTH_PROXY_URL,
  authProxyConfigId: process.env.EXPO_PUBLIC_ZEROXKEY_AUTH_PROXY_CONFIG_ID,
  passkeyRpId: process.env.EXPO_PUBLIC_ZEROXKEY_RPID,
  appScheme: process.env.EXPO_PUBLIC_APP_SCHEME,
  oauthRedirectUri: process.env.EXPO_PUBLIC_OAUTH_REDIRECT_URI,
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
  appleServiceId: process.env.EXPO_PUBLIC_APPLE_SERVICE_ID,
  appleBundleId: process.env.EXPO_PUBLIC_APPLE_BUNDLE_ID,
  facebookClientId: process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_ID,
  xClientId: process.env.EXPO_PUBLIC_X_CLIENT_ID,
  discordClientId: process.env.EXPO_PUBLIC_DISCORD_CLIENT_ID,
});

/**
 * Minimal callbacks for visibility during development. Safe to keep.
 */
export const ZEROXKEY_CALLBACKS: ZeroXKeyCallbacks = {
  beforeSessionExpiry: ({ sessionKey }) => {
    console.log("[ZeroXKey] Session nearing expiry:", sessionKey);
  },
  onSessionExpired: ({ sessionKey }) => {
    console.log("[ZeroXKey] Session expired:", sessionKey);
  },
  onAuthenticationSuccess: ({ action, method, identifier }) => {
    console.log("[ZeroXKey] Auth success:", { action, method, identifier });
  },
  onError: (error) => {
    console.error("[ZeroXKey] Error:", error);
  },
};
