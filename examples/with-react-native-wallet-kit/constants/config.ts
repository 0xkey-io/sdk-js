import type { ZeroXKeyProviderConfig } from "@0xkey-io/react-native-wallet-kit";

export type DemoEnv = {
  organizationId?: string | undefined;
  apiBaseUrl?: string | undefined;
  authProxyUrl?: string | undefined;
  authProxyConfigId?: string | undefined;
  passkeyRpId?: string | undefined;
  appScheme?: string | undefined;
  oauthRedirectUri?: string | undefined;
  googleWebClientId?: string | undefined;
  appleServiceId?: string | undefined;
  appleBundleId?: string | undefined;
  facebookClientId?: string | undefined;
  xClientId?: string | undefined;
  discordClientId?: string | undefined;
};

const ENV_NAMES: Record<keyof DemoEnv, string> = {
  organizationId: "EXPO_PUBLIC_ZEROXKEY_ORGANIZATION_ID",
  apiBaseUrl: "EXPO_PUBLIC_ZEROXKEY_API_BASE_URL",
  authProxyUrl: "EXPO_PUBLIC_ZEROXKEY_AUTH_PROXY_URL",
  authProxyConfigId: "EXPO_PUBLIC_ZEROXKEY_AUTH_PROXY_CONFIG_ID",
  passkeyRpId: "EXPO_PUBLIC_ZEROXKEY_RPID",
  appScheme: "EXPO_PUBLIC_APP_SCHEME",
  oauthRedirectUri: "EXPO_PUBLIC_OAUTH_REDIRECT_URI",
  googleWebClientId: "EXPO_PUBLIC_GOOGLE_CLIENT_ID",
  appleServiceId: "EXPO_PUBLIC_APPLE_SERVICE_ID",
  appleBundleId: "EXPO_PUBLIC_APPLE_BUNDLE_ID",
  facebookClientId: "EXPO_PUBLIC_FACEBOOK_CLIENT_ID",
  xClientId: "EXPO_PUBLIC_X_CLIENT_ID",
  discordClientId: "EXPO_PUBLIC_DISCORD_CLIENT_ID",
};

const HOST_NAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*$/;

/**
 * Builds the provider config from `EXPO_PUBLIC_*` values. Errors name the
 * offending variables but never include their values.
 */
export function buildZeroXKeyConfig(env: DemoEnv): ZeroXKeyProviderConfig {
  const value = (key: keyof DemoEnv) => {
    const raw = env[key]?.trim();
    return raw ? raw : undefined;
  };

  const organizationId = value("organizationId");
  const apiBaseUrl = value("apiBaseUrl");
  const authProxyUrl = value("authProxyUrl");
  const authProxyConfigId = value("authProxyConfigId");
  const passkeyRpId = value("passkeyRpId");
  const appScheme = value("appScheme");
  const oauthRedirectUri = value("oauthRedirectUri");

  const missing: (keyof DemoEnv)[] = [];
  if (!organizationId) missing.push("organizationId");
  if (!apiBaseUrl) missing.push("apiBaseUrl");
  if (!passkeyRpId) missing.push("passkeyRpId");
  if (!appScheme) missing.push("appScheme");
  // Without an explicit URL the SDK falls back to the production Auth Proxy.
  if (authProxyConfigId && !authProxyUrl) missing.push("authProxyUrl");
  if (authProxyUrl && !authProxyConfigId) missing.push("authProxyConfigId");
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing
        .map((key) => ENV_NAMES[key])
        .join(", ")}`,
    );
  }

  for (const key of [
    "apiBaseUrl",
    "authProxyUrl",
    "oauthRedirectUri",
  ] as const) {
    const url = value(key);
    if (url !== undefined && !isHttpsUrl(url)) {
      throw new Error(`${ENV_NAMES[key]} must be an https:// URL`);
    }
  }
  if (!HOST_NAME.test(passkeyRpId!)) {
    throw new Error(
      `${ENV_NAMES.passkeyRpId} must be a host name without scheme, port, or path`,
    );
  }
  if (!URL_SCHEME.test(appScheme!)) {
    throw new Error(
      `${ENV_NAMES.appScheme} must be a lowercase URL scheme without "://"`,
    );
  }

  const googleWebClientId = value("googleWebClientId");
  const appleServiceId = value("appleServiceId");
  const appleBundleId = value("appleBundleId");
  const facebookClientId = value("facebookClientId");
  const xClientId = value("xClientId");
  const discordClientId = value("discordClientId");

  return {
    organizationId: organizationId!,
    apiBaseUrl: apiBaseUrl!,
    ...(authProxyUrl ? { authProxyUrl, authProxyConfigId } : {}),
    passkeyConfig: { rpId: passkeyRpId! },
    auth: {
      otp: { email: true, sms: false },
      passkey: true,
      oauth: {
        appScheme: appScheme!,
        ...(oauthRedirectUri ? { redirectUri: oauthRedirectUri } : {}),
        google: googleWebClientId
          ? { primaryClientId: { webClientId: googleWebClientId } }
          : false,
        apple:
          appleServiceId || appleBundleId
            ? {
                primaryClientId: {
                  ...(appleServiceId ? { serviceId: appleServiceId } : {}),
                  ...(appleBundleId ? { iosBundleId: appleBundleId } : {}),
                },
              }
            : false,
        facebook: facebookClientId
          ? { primaryClientId: facebookClientId }
          : false,
        x: xClientId ? { primaryClientId: xClientId } : false,
        discord: discordClientId ? { primaryClientId: discordClientId } : false,
      },
      autoRefreshSession: true,
    },
  };
}

function isHttpsUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}
