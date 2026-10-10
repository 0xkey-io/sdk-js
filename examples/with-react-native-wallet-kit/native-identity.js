const APPLE_TEAM_ID = /^[A-Z0-9]{10}$/;
const APP_ID = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const HOST_NAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*$/;

function read(env, name, pattern) {
  const raw = env[name] && env[name].trim();
  if (!raw) return undefined;
  if (!pattern.test(raw)) {
    throw new Error(`${name} has an invalid format`);
  }
  return raw;
}

/**
 * Applies the owner's signing identity and passkey domain to the Expo config.
 * The passkey associated domain always follows the RP ID used at runtime.
 */
function applyNativeIdentity(expoConfig, env) {
  const config = structuredClone(expoConfig);
  const rpId = read(env, "EXPO_PUBLIC_ZEROXKEY_RPID", HOST_NAME);
  const scheme = read(env, "EXPO_PUBLIC_APP_SCHEME", URL_SCHEME);
  const teamId = read(env, "ZEROXKEY_DEMO_APPLE_TEAM_ID", APPLE_TEAM_ID);
  const bundleId = read(env, "ZEROXKEY_DEMO_IOS_BUNDLE_ID", APP_ID);
  const androidPackage = read(env, "ZEROXKEY_DEMO_ANDROID_PACKAGE", APP_ID);

  config.ios = { ...config.ios };
  config.android = { ...config.android };
  if (scheme) config.scheme = scheme;
  if (rpId) config.ios.associatedDomains = [`webcredentials:${rpId}`];
  if (teamId) config.ios.appleTeamId = teamId;
  if (bundleId) config.ios.bundleIdentifier = bundleId;
  if (androidPackage) config.android.package = androidPackage;
  return config;
}

module.exports = { applyNativeIdentity };
