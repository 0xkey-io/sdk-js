const path = require("node:path");
const root = path.resolve(__dirname, "../../../../..");
const { p256 } = require(
  path.join(root, "packages/crypto/node_modules/@noble/curves/p256"),
);
const { sha256 } = require(
  path.join(root, "packages/crypto/node_modules/@noble/hashes/sha256"),
);

// Test signer material is confined to standalone browser harnesses.
const fixturePrivateKey = Uint8Array.from({ length: 32 }, () => 0x42);
const fixturePublicKey = Buffer.from(
  p256.getPublicKey(fixturePrivateKey, false),
).toString("hex");
const fixtureTrustProfile = Object.freeze({
  target: {
    organizationId: "org-opt-in",
    apiBaseUrl: "https://api.example.test",
    authProxyUrl: "https://auth.example.test",
    authProxyConfigId: "config-opt-in",
  },
  childOrganizationId: "child-org",
  configGeneration: Buffer.alloc(16, 0x11).toString("base64url"),
  configRevision: "7",
  configDigest: Buffer.alloc(32, 0x22).toString("base64url"),
  deploymentAudience: "staging-web-local-fixture",
});

function signedToken(
  publicKey,
  user = "oauth-user",
  exp = 2_000_000_000,
  signingKey = fixturePrivateKey,
  claims = {},
) {
  const header = Buffer.from(
    JSON.stringify({ alg: "ES256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      exp,
      public_key: publicKey,
      session_type: "SESSION_TYPE_READ_WRITE",
      user_id: user,
      organization_id: "child-org",
      ...claims,
    }),
  ).toString("base64url");
  const input = `${header}.${payload}`;
  const digest = sha256(sha256(Buffer.from(input)));
  const signature = Buffer.from(
    p256.sign(digest, signingKey).toCompactRawBytes(),
  ).toString("base64url");
  return `${input}.${signature}`;
}

function localSignerPinPlugin() {
  return {
    name: "local-signer-fixture-pin",
    setup(build) {
      build.onLoad({ filter: /session-jwt-pin\.ts$/ }, () => ({
        contents: `export const SESSION_JWT_SIGNING_KEY_HEX = ${JSON.stringify(fixturePublicKey)};`,
        loader: "ts",
      }));
    },
  };
}

function localSignerAndProfilePlugin() {
  return {
    name: "local-signer-and-v3-profile-fixture",
    setup(build) {
      localSignerPinPlugin().setup(build);
      build.onLoad({ filter: /session-jwt-trust-profile\.ts$/ }, () => ({
        contents: `export const WEB_BOUND_OAUTH_TRUST_PROFILE = ${JSON.stringify(fixtureTrustProfile)};`,
        loader: "ts",
      }));
    },
  };
}

module.exports = {
  fixturePrivateKey,
  fixtureTrustProfile,
  signedToken,
  localSignerPinPlugin,
  localSignerAndProfilePlugin,
};
