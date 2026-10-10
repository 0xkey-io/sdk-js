import assert from "node:assert/strict";
import { test } from "node:test";

import { buildZeroXKeyConfig } from "../constants/config.ts";

const staging = {
  organizationId: "org-placeholder",
  apiBaseUrl: "https://api.staging.0xkey.io",
  authProxyUrl: "https://authproxy.staging.0xkey.io",
  authProxyConfigId: "config-placeholder",
  passkeyRpId: "passkey.staging.example",
  appScheme: "withreactnativewalletkit",
};

test("forwards the Auth Proxy URL so a staging config ID never reaches the default proxy", () => {
  const config = buildZeroXKeyConfig(staging);
  assert.equal(config.authProxyUrl, "https://authproxy.staging.0xkey.io");
  assert.equal(config.authProxyConfigId, "config-placeholder");
  assert.equal(config.apiBaseUrl, "https://api.staging.0xkey.io");
  assert.equal(config.organizationId, "org-placeholder");
  assert.equal(config.passkeyConfig?.rpId, "passkey.staging.example");
  assert.equal(config.auth?.oauth?.appScheme, "withreactnativewalletkit");
});

test("rejects a config ID without an explicit Auth Proxy URL", () => {
  const { authProxyUrl: _omitted, ...withoutUrl } = staging;
  assert.throws(
    () => buildZeroXKeyConfig(withoutUrl),
    /EXPO_PUBLIC_ZEROXKEY_AUTH_PROXY_URL/,
  );
});

test("rejects an Auth Proxy URL without a config ID", () => {
  const { authProxyConfigId: _omitted, ...withoutId } = staging;
  assert.throws(
    () => buildZeroXKeyConfig(withoutId),
    /EXPO_PUBLIC_ZEROXKEY_AUTH_PROXY_CONFIG_ID/,
  );
});

test("names every missing required variable without echoing configured values", () => {
  assert.throws(
    () =>
      buildZeroXKeyConfig({
        apiBaseUrl: "  ",
        authProxyUrl: staging.authProxyUrl,
        authProxyConfigId: staging.authProxyConfigId,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      for (const name of [
        "EXPO_PUBLIC_ZEROXKEY_ORGANIZATION_ID",
        "EXPO_PUBLIC_ZEROXKEY_API_BASE_URL",
        "EXPO_PUBLIC_ZEROXKEY_RPID",
        "EXPO_PUBLIC_APP_SCHEME",
      ]) {
        assert.match(error.message, new RegExp(name));
      }
      assert.doesNotMatch(
        error.message,
        /authproxy\.staging|config-placeholder/,
      );
      return true;
    },
  );
});

test("requires HTTPS service URLs", () => {
  assert.throws(
    () => buildZeroXKeyConfig({ ...staging, apiBaseUrl: "http://api.example" }),
    /EXPO_PUBLIC_ZEROXKEY_API_BASE_URL must be an https:\/\/ URL/,
  );
  assert.throws(
    () =>
      buildZeroXKeyConfig({ ...staging, oauthRedirectUri: "myapp://callback" }),
    /EXPO_PUBLIC_OAUTH_REDIRECT_URI must be an https:\/\/ URL/,
  );
});

test("requires the RP ID to be a bare host name", () => {
  for (const passkeyRpId of [
    "https://passkey.staging.example",
    "passkey.staging.example/path",
    "passkey.staging.example:443",
  ]) {
    assert.throws(
      () => buildZeroXKeyConfig({ ...staging, passkeyRpId }),
      /EXPO_PUBLIC_ZEROXKEY_RPID must be a host name/,
    );
  }
});

test("requires a valid deep link scheme", () => {
  assert.throws(
    () => buildZeroXKeyConfig({ ...staging, appScheme: "my_app://" }),
    /EXPO_PUBLIC_APP_SCHEME/,
  );
});

test("disables OAuth providers that have no client ID", () => {
  const oauth = buildZeroXKeyConfig(staging).auth?.oauth;
  assert.equal(oauth?.google, false);
  assert.equal(oauth?.apple, false);
  assert.equal(oauth?.facebook, false);
  assert.equal(oauth?.x, false);
  assert.equal(oauth?.discord, false);
  assert.equal(oauth?.redirectUri, undefined);
});

test("uses provider-specific primary client IDs instead of the deprecated clientId", () => {
  const oauth = buildZeroXKeyConfig({
    ...staging,
    googleWebClientId: "google-web",
    appleServiceId: "apple-service",
    appleBundleId: "apple-bundle",
    facebookClientId: "facebook",
    xClientId: "x",
    discordClientId: "discord",
    oauthRedirectUri: "https://oauth-redirect.staging.example/",
  }).auth?.oauth;
  assert.deepEqual(oauth?.google, {
    primaryClientId: { webClientId: "google-web" },
  });
  assert.deepEqual(oauth?.apple, {
    primaryClientId: {
      serviceId: "apple-service",
      iosBundleId: "apple-bundle",
    },
  });
  assert.deepEqual(oauth?.facebook, { primaryClientId: "facebook" });
  assert.deepEqual(oauth?.x, { primaryClientId: "x" });
  assert.deepEqual(oauth?.discord, { primaryClientId: "discord" });
  assert.equal(oauth?.redirectUri, "https://oauth-redirect.staging.example/");
});

test("enables email OTP and passkeys for the device test", () => {
  const auth = buildZeroXKeyConfig(staging).auth;
  assert.equal(auth?.otp?.email, true);
  assert.equal(auth?.otp?.sms, false);
  assert.equal(auth?.passkey, true);
});
