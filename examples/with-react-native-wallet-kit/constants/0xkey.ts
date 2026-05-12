import type {
  ZeroXKeyProviderConfig,
  ZeroXKeyCallbacks,
} from "@0xkey-io/react-native-wallet-kit";

const ORGANIZATION_ID = process.env.EXPO_PUBLIC_ZEROXKEY_ORGANIZATION_ID || "";
const API_BASE_URL = process.env.EXPO_PUBLIC_ZEROXKEY_API_BASE_URL || "";
const AUTH_PROXY_URL = process.env.EXPO_PUBLIC_ZEROXKEY_AUTH_PROXY_URL || "";
const AUTH_PROXY_CONFIG_ID =
  process.env.EXPO_PUBLIC_ZEROXKEY_AUTH_PROXY_CONFIG_ID;
const PASSKEY_RP_ID = process.env.EXPO_PUBLIC_ZEROXKEY_RPID || "";
const APP_SCHEME = process.env.EXPO_PUBLIC_APP_SCHEME || "";

export const ZEROXKEY_CONFIG: ZeroXKeyProviderConfig = {
  organizationId: ORGANIZATION_ID,
  apiBaseUrl: API_BASE_URL,
  ...(AUTH_PROXY_CONFIG_ID ? { authProxyConfigId: AUTH_PROXY_CONFIG_ID } : {}),
  passkeyConfig: {
    rpId: PASSKEY_RP_ID,
  },
  auth: {
    otp: {
      email: true,
      sms: false,
      // Optional proxy-controlled values if not using Auth Proxy
      // alphanumeric: true,
      // length: "6",
    },
    passkey: true,
    oauth: {
      appScheme: APP_SCHEME,
      google: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID
        ? { clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID }
        : false,
      apple: process.env.EXPO_PUBLIC_APPLE_CLIENT_ID
        ? { clientId: process.env.EXPO_PUBLIC_APPLE_CLIENT_ID }
        : false,
      facebook: process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_ID
        ? { clientId: process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_ID }
        : false,
      x: process.env.EXPO_PUBLIC_X_CLIENT_ID
        ? { clientId: process.env.EXPO_PUBLIC_X_CLIENT_ID }
        : false,
      discord: process.env.EXPO_PUBLIC_DISCORD_CLIENT_ID
        ? { clientId: process.env.EXPO_PUBLIC_DISCORD_CLIENT_ID }
        : false,
    },
    // Optional: override default session expiration
    // sessionExpirationSeconds: "86400",
    autoRefreshSession: true,
  },
};

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
