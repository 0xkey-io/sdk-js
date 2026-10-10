import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { applyNativeIdentity } = require("../native-identity.js");
const appJson = require("../app.json");

const base = () => structuredClone(appJson.expo);

test("app.json does not ship another team's Apple identity", () => {
  assert.equal(appJson.expo.ios.appleTeamId, undefined);
  assert.equal(appJson.expo.ios.associatedDomains, undefined);
});

test("derives the passkey associated domain and scheme from the runtime env", () => {
  const config = applyNativeIdentity(base(), {
    EXPO_PUBLIC_ZEROXKEY_RPID: "passkey.staging.example",
    EXPO_PUBLIC_APP_SCHEME: "oxkeydemo",
  });
  assert.deepEqual(config.ios.associatedDomains, [
    "webcredentials:passkey.staging.example",
  ]);
  assert.equal(config.scheme, "oxkeydemo");
});

test("applies owner-provided bundle, package, and team identifiers", () => {
  const config = applyNativeIdentity(base(), {
    ZEROXKEY_DEMO_APPLE_TEAM_ID: "ABCDE12345",
    ZEROXKEY_DEMO_IOS_BUNDLE_ID: "com.example.oxkeydemo",
    ZEROXKEY_DEMO_ANDROID_PACKAGE: "com.example.oxkeydemo",
  });
  assert.equal(config.ios.appleTeamId, "ABCDE12345");
  assert.equal(config.ios.bundleIdentifier, "com.example.oxkeydemo");
  assert.equal(config.android.package, "com.example.oxkeydemo");
});

test("keeps app.json identifiers when no override is set", () => {
  const config = applyNativeIdentity(base(), {});
  assert.equal(config.ios.bundleIdentifier, appJson.expo.ios.bundleIdentifier);
  assert.equal(config.android.package, appJson.expo.android.package);
  assert.equal(config.ios.appleTeamId, undefined);
  assert.equal(config.ios.associatedDomains, undefined);
});

test("rejects malformed identifiers", () => {
  assert.throws(
    () => applyNativeIdentity(base(), { ZEROXKEY_DEMO_APPLE_TEAM_ID: "team" }),
    /ZEROXKEY_DEMO_APPLE_TEAM_ID/,
  );
  assert.throws(
    () =>
      applyNativeIdentity(base(), {
        ZEROXKEY_DEMO_ANDROID_PACKAGE: "com.example.demo-app",
      }),
    /ZEROXKEY_DEMO_ANDROID_PACKAGE/,
  );
  assert.throws(
    () =>
      applyNativeIdentity(base(), {
        EXPO_PUBLIC_ZEROXKEY_RPID: "https://passkey.staging.example",
      }),
    /EXPO_PUBLIC_ZEROXKEY_RPID/,
  );
});

test("does not mutate the input config", () => {
  const input = base();
  const before = structuredClone(input);
  applyNativeIdentity(input, {
    EXPO_PUBLIC_ZEROXKEY_RPID: "passkey.staging.example",
    ZEROXKEY_DEMO_APPLE_TEAM_ID: "ABCDE12345",
  });
  assert.deepEqual(input, before);
});
