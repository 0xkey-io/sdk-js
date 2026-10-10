const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const {
  fixturePrivateKey,
  fixtureTrustProfile,
  signedToken,
  localSignerPinPlugin,
  localSignerAndProfilePlugin,
} = require("./session-jwt-test-signer.cjs");

if (!process.env.C5_PLAYWRIGHT_ROOT || !process.env.C5_CHROME)
  throw new Error("Set C5_PLAYWRIGHT_ROOT and C5_CHROME");
const playwright = require(process.env.C5_PLAYWRIGHT_ROOT);
const esbuild = require(
  path.resolve(
    __dirname,
    "../../../../../node_modules/.pnpm/esbuild@0.18.20/node_modules/esbuild",
  ),
);
const root = path.resolve(__dirname, "../../../../..");
const target = {
  organizationId: "org-opt-in",
  apiBaseUrl: "https://api.example.test",
  authProxyUrl: "https://auth.example.test",
  authProxyConfigId: "config-opt-in",
};
assert.deepEqual(target, fixtureTrustProfile.target);
const v3Claims = (nonce, overrides = {}) => ({
  session_version: 3,
  session_purpose: "bound-oauth-session-v3",
  parent_organization_id: fixtureTrustProfile.target.organizationId,
  auth_proxy_config_id: fixtureTrustProfile.target.authProxyConfigId,
  config_generation: fixtureTrustProfile.configGeneration,
  config_revision: fixtureTrustProfile.configRevision,
  config_digest: fixtureTrustProfile.configDigest,
  operation_nonce: nonce,
  deployment_audience: fixtureTrustProfile.deploymentAudience,
  organization_id: fixtureTrustProfile.childOrganizationId,
  iat: 1_900_000_000,
  jti: "local-fixture-jti",
  ...overrides,
});
const v3Token = (publicKey, nonce, overrides = {}, user = "oauth-user") =>
  signedToken(
    publicKey,
    user,
    2_000_000_000,
    fixturePrivateKey,
    v3Claims(nonce, overrides),
  );
const token = (publicKey, user = "oauth-user") =>
  `header.${Buffer.from(
    JSON.stringify({
      exp: 2_000_000_000,
      public_key: publicKey,
      session_type: "SESSION_TYPE_READ_WRITE",
      user_id: user,
      organization_id: "child-org",
    }),
  ).toString("base64url")}.signature`;
const server = http.createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end("<!doctype html><title>v3 OAuth opt-in</title>");
});
const listen = () =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${server.address().port}/`),
    ),
  );
const close = () => new Promise((resolve) => server.close(resolve));
const readPendingNonce = (page, publicKey) =>
  page.evaluate(
    (key) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("ZeroXKeyBoundAuthV3", 2);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("KeyOwners", "readonly");
          const owner = tx.objectStore("KeyOwners").get(key);
          tx.oncomplete = () => {
            db.close();
            resolve(owner.result?.pending[0]?.claimId);
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
    publicKey,
  );

async function run() {
  const buildOptions = {
    entryPoints: [path.join(__dirname, "web-bound-oauth-optin-entry.ts")],
    bundle: true,
    platform: "browser",
    format: "iife",
    tsconfig: path.join(root, "packages/core/tsconfig.json"),
    external: [
      "react-native",
      "react-native-keychain",
      "@react-native-async-storage/async-storage",
    ],
    write: false,
    logLevel: "error",
  };
  const built = await esbuild.build({
    ...buildOptions,
    plugins: [localSignerAndProfilePlugin()],
  });
  const noProfileBuilt = await esbuild.build({
    ...buildOptions,
    plugins: [localSignerPinPlugin()],
  });
  const origin = await listen();
  const browser = await playwright.chromium.launch({
    executablePath: process.env.C5_CHROME,
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext();
    const first = await context.newPage();
    const cold = await context.newPage();
    await Promise.all([first.goto(origin), cold.goto(origin)]);
    await Promise.all([
      first.addScriptTag({ content: built.outputFiles[0].text }),
      cold.addScriptTag({ content: built.outputFiles[0].text }),
    ]);
    const publicKey = await first.evaluate(async (config) => {
      globalThis.client = new ZeroXKeyClient(config);
      enableWebBoundOAuthExperiment(client);
      await client.init();
      return client.createApiKeyPair();
    }, target);
    const pendingNonce = await readPendingNonce(first, publicKey);
    assert.match(pendingNonce, /^[A-Za-z0-9_-]+$/);
    const browserChosenTarget = {
      ...target,
      organizationId: "browser-supplied-parent",
    };
    const untrusted = await context.newPage();
    await untrusted.goto(origin);
    await untrusted.addScriptTag({ content: built.outputFiles[0].text });
    const browserChosenKey = await untrusted.evaluate(async (config) => {
      globalThis.browserChosenClient = new ZeroXKeyClient(config);
      enableWebBoundOAuthExperiment(browserChosenClient);
      await browserChosenClient.init();
      return browserChosenClient.createApiKeyPair();
    }, browserChosenTarget);
    const browserChosenNonce = await readPendingNonce(
      untrusted,
      browserChosenKey,
    );
    const browserChosenToken = v3Token(browserChosenKey, browserChosenNonce, {
      parent_organization_id: browserChosenTarget.organizationId,
    });
    const browserTargetRejected = await untrusted.evaluate(async (session) => {
      try {
        await browserChosenClient.storeSession({ sessionToken: session });
        return false;
      } catch {
        return true;
      }
    }, browserChosenToken);
    assert.equal(
      browserTargetRejected,
      true,
      "browser-selected parent must not become the trusted target",
    );
    await untrusted.close();
    const validClaims = v3Claims(pendingNonce);
    const fieldMutations = {
      session_version: 2,
      session_purpose: "other-purpose",
      parent_organization_id: "other-parent",
      auth_proxy_config_id: "other-config",
      config_generation: Buffer.alloc(16, 0x33).toString("base64url"),
      config_revision: "8",
      config_digest: Buffer.alloc(32, 0x44).toString("base64url"),
      operation_nonce: Buffer.alloc(32, 0x55).toString("base64url"),
      deployment_audience: "other-audience",
      organization_id: "other-child",
      public_key: "04different-public-key",
    };
    const invalidV3Claims = Object.entries(fieldMutations).flatMap(
      ([field, wrong]) => {
        const missing = { ...validClaims };
        // undefined deliberately removes even base fields supplied by signedToken.
        missing[field] = undefined;
        return [
          [`wrong ${field}`, { ...validClaims, [field]: wrong }],
          [`missing ${field}`, missing],
        ];
      },
    );
    for (const [alias, wrong] of Object.entries({
      sessionVersion: 2,
      sessionPurpose: "other-purpose",
      parentOrganizationId: "other-parent",
      authProxyConfigId: "other-config",
      configGeneration: "other-generation",
      configRevision: "8",
      configDigest: "other-digest",
      operationNonce: "other-nonce",
      deploymentAudience: "other-audience",
      organizationId: "other-child",
      publicKey: "04different-public-key",
    })) {
      invalidV3Claims.push([
        `conflicting alias ${alias}`,
        { ...validClaims, [alias]: wrong },
      ]);
    }
    for (const [label, claims] of invalidV3Claims) {
      const invalid = signedToken(
        publicKey,
        "invalid-v3",
        2_000_000_000,
        fixturePrivateKey,
        claims,
      );
      const rejected = await first.evaluate(async (session) => {
        try {
          await client.storeSession({ sessionToken: session });
          return false;
        } catch {
          return true;
        }
      }, invalid);
      assert.equal(rejected, true, `first claim accepted ${label}`);
    }
    // Public Core.storeSession must not consume the first pending OAuth
    // claim. This synthetic same-K JWT has never come from Auth Proxy.
    const firstClaimForgery = token(publicKey, "forged-first-user");
    const firstClaim = await first.evaluate(async (session) => {
      let rejected = false;
      try {
        await client.storeSession({ sessionToken: session });
      } catch {
        rejected = true;
      }
      return {
        rejected,
        activeIsForged: (await client.getSession())?.token === session,
      };
    }, firstClaimForgery);
    const coldRestoresForged = await cold.evaluate(
      async ({ config, session }) =>
        (await new WebBoundCredentialStore().readVerifiedActive(config, 0, 0))
          ?.token === session,
      { config: target, session: firstClaimForgery },
    );
    assert.deepEqual(
      { ...firstClaim, coldRestoresForged },
      { rejected: true, activeIsForged: false, coldRestoresForged: false },
    );
    const wrongSigner = signedToken(
      publicKey,
      "wrong-signer",
      2_000_000_000,
      Uint8Array.from({ length: 32 }, () => 0x43),
      validClaims,
    );
    const wrongLocalKey = signedToken(
      "04different-public-key",
      "wrong-local-key",
      2_000_000_000,
      fixturePrivateKey,
      validClaims,
    );
    const zeroExpiry = signedToken(
      publicKey,
      "zero-expiry",
      0,
      fixturePrivateKey,
      validClaims,
    );
    const expired = signedToken(
      publicKey,
      "expired",
      1,
      fixturePrivateKey,
      validClaims,
    );
    const textExpiry = signedToken(
      publicKey,
      "text-expiry",
      "2000000000",
      fixturePrivateKey,
      validClaims,
    );
    const signed = v3Token(publicKey, pendingNonce, {}, "untampered");
    const [signedHeader, , signedSignature] = signed.split(".");
    const tampered = `${signedHeader}.${Buffer.from(
      JSON.stringify({
        exp: 2_000_000_000,
        public_key: publicKey,
        session_type: "SESSION_TYPE_READ_WRITE",
        user_id: "tampered",
        organization_id: "child-org",
        ...validClaims,
      }),
    ).toString("base64url")}.${signedSignature}`;
    const changedSignature = `${signedHeader}.${signed.split(".")[1]}.${signedSignature[0] === "A" ? "B" : "A"}${signedSignature.slice(1)}`;
    for (const invalid of [
      wrongSigner,
      wrongLocalKey,
      zeroExpiry,
      expired,
      textExpiry,
      tampered,
      changedSignature,
    ]) {
      const rejected = await first.evaluate(async (session) => {
        try {
          await client.storeSession({ sessionToken: session });
          return false;
        } catch {
          return true;
        }
      }, invalid);
      assert.equal(rejected, true);
    }
    if (process.env.C5_TARGET_CLAIM_RED === "1") {
      // A valid Signer signature with old claims cannot consume a pending
      // v3 operation. The positive fixture below is local only; it is not
      // evidence of a server issuer or online currentness.
      const unbound = signedToken(publicKey, "signed-but-target-unbound");
      const firstClaim = await first.evaluate(async (session) => {
        let rejected = false;
        try {
          await client.storeSession({ sessionToken: session });
        } catch {
          rejected = true;
        }
        return {
          rejected,
          activeIsUnbound: (await client.getSession())?.token === session,
        };
      }, unbound);
      const coldRestoresUnbound = await cold.evaluate(
        async ({ config, session }) =>
          (await new WebBoundCredentialStore().readVerifiedActive(config, 0, 0))
            ?.token === session,
        { config: target, session: unbound },
      );
      assert.deepEqual(
        { ...firstClaim, coldRestoresUnbound },
        {
          rejected: true,
          activeIsUnbound: false,
          coldRestoresUnbound: false,
        },
        "signed token without v3 target must be rejected without persisting",
      );
    }
    const mockedOAuthRejected = await first.evaluate(
      async ({ session, publicKey }) => {
        client.httpClient.proxyOAuthLogin = async () => ({ session });
        try {
          await client.loginWithOauth({
            oidcToken: "local-fixture",
            publicKey,
          });
          return false;
        } catch {
          return true;
        }
      },
      { session: firstClaimForgery, publicKey },
    );
    assert.equal(mockedOAuthRejected, true);
    const jwt = v3Token(publicKey, pendingNonce, {}, "???");
    assert.match(
      jwt.split(".")[1],
      /[-_]/,
      "fixture must exercise JWT base64url payload",
    );
    await first.evaluate(
      async ({ session, publicKey }) => {
        client.httpClient.proxyOAuthLogin = async () => ({ session });
        await client.loginWithOauth({
          oidcToken: "local-fixture",
          publicKey,
        });
      },
      { session: jwt, publicKey },
    );
    const claimed = await cold.evaluate(
      (publicKey) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("ZeroXKeyBoundAuthV3", 2);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(["KeyStore", "KeyOwners"], "readonly");
            const key = tx.objectStore("KeyStore").get(publicKey);
            const owner = tx.objectStore("KeyOwners").get(publicKey);
            tx.oncomplete = () => {
              db.close();
              resolve({
                privateKeyPresent: key.result instanceof CryptoKey,
                pending: owner.result?.pending.length,
                token: owner.result?.references[0]?.token,
              });
            };
            tx.onabort = () => reject(tx.error);
          };
        }),
      publicKey,
    );
    assert.deepEqual(claimed, {
      privateKeyPresent: true,
      pending: 0,
      token: jwt,
    });
    const evidence = await cold.evaluate(async (config) => {
      const verified = await new WebBoundCredentialStore().readVerifiedActive(
        config,
        0,
        0,
      );
      const client = new ZeroXKeyClient(config);
      enableWebBoundOAuthExperiment(client);
      await client.init();
      const restored = await client.getSession();
      const signed = await client.apiKeyStamper.stamp("cold-proof");
      return {
        verified,
        token: restored?.token,
        signed: Boolean(signed?.stampHeaderValue),
      };
    }, target);
    assert.equal(evidence.verified?.publicKey, publicKey);
    assert.equal(evidence.token, jwt);
    assert.equal(evidence.signed, true);
    const changeStoredToken = async (session) =>
      cold.evaluate(
        async ({ config, publicKey, session }) => {
          const key = `@0xkey-io/auth/v3/target/${JSON.stringify([
            config.organizationId,
            config.apiBaseUrl,
            config.authProxyUrl,
            config.authProxyConfigId,
          ])}`;
          await new Promise((resolve, reject) => {
            const open = indexedDB.open("ZeroXKeyBoundAuthV3", 2);
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction(
                ["BoundSessions", "KeyOwners"],
                "readwrite",
              );
              const sessions = tx.objectStore("BoundSessions");
              const owners = tx.objectStore("KeyOwners");
              const sessionRead = sessions.get(key);
              const ownerRead = owners.get(publicKey);
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onabort = () => reject(tx.error);
              ownerRead.onsuccess = () => {
                const owner = ownerRead.result;
                owner.references[0].token = session;
                owners.put(owner, publicKey);
              };
              sessionRead.onsuccess = () => {
                const record = sessionRead.result;
                record.sessions[0].token = session;
                sessions.put(record, key);
              };
            };
          });
        },
        { config: target, publicKey, session },
      );
    for (const [label, claims] of invalidV3Claims) {
      await changeStoredToken(
        signedToken(
          publicKey,
          "cold-v3",
          2_000_000_000,
          fixturePrivateKey,
          claims,
        ),
      );
      const restored = await cold.evaluate(async (config) => {
        try {
          return Boolean(
            await new WebBoundCredentialStore().readVerifiedActive(
              config,
              0,
              0,
            ),
          );
        } catch {
          return false;
        }
      }, target);
      assert.equal(restored, false, `cold recovery accepted ${label}`);
    }
    await changeStoredToken(jwt);
    const expiredColdRead = await cold.evaluate(async (config) => {
      const now = Date.now;
      Date.now = () => 2_000_000_000_001;
      try {
        const raw = await new WebBoundCredentialStore().readVerifiedActive(
          config,
          0,
          0,
        );
        const fresh = new ZeroXKeyClient(config);
        enableWebBoundOAuthExperiment(fresh);
        await fresh.init();
        return {
          raw: Boolean(raw),
          restored: Boolean(await fresh.getSession()),
        };
      } finally {
        Date.now = now;
      }
    }, target);
    assert.deepEqual(expiredColdRead, { raw: false, restored: false });

    // A public Core.storeSession caller has no proof that a replacement JWT
    // came from Auth Proxy. A cold opt-in Core must reject a forged token even
    // when its public key matches the existing, valid credential.
    const forged = token(publicKey, "forged-user");
    const injection = await cold.evaluate(
      async ({ config, publicKey, session }) => {
        const next = new ZeroXKeyClient(config);
        enableWebBoundOAuthExperiment(next);
        await next.init();
        let rejected = false;
        try {
          await next.storeSession({ sessionToken: session });
        } catch {
          rejected = true;
        }
        const open = indexedDB.open("ZeroXKeyBoundAuthV3", 2);
        const owner = await new Promise((resolve, reject) => {
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("KeyOwners", "readonly");
            const request = tx.objectStore("KeyOwners").get(publicKey);
            tx.oncomplete = () => {
              db.close();
              resolve(request.result);
            };
            tx.onabort = () => reject(tx.error);
          };
        });
        return {
          rejected,
          ownerTokens: owner?.references.map((ref) => ref.token),
          restoredToken: (await next.getSession())?.token,
        };
      },
      { config: target, publicKey, session: forged },
    );
    assert.deepEqual(injection, {
      rejected: true,
      ownerTokens: [jwt],
      restoredToken: jwt,
    });

    const immediateInitDriftRejected = await cold.evaluate(async (config) => {
      const drifting = new ZeroXKeyClient({ ...config });
      enableWebBoundOAuthExperiment(drifting);
      const init = drifting.init().then(
        () => false,
        () => true,
      );
      drifting.config.organizationId = "org-changed-before-init-await";
      return init;
    }, target);
    assert.equal(immediateInitDriftRejected, true);

    const initDriftRejected = await cold.evaluate(async (config) => {
      const original = WebBoundCredentialStore.prototype.readEpoch;
      let entered;
      let release;
      const started = new Promise((resolve) => (entered = resolve));
      const resumed = new Promise((resolve) => (release = resolve));
      WebBoundCredentialStore.prototype.readEpoch = async function () {
        entered();
        await resumed;
        return original.call(this);
      };
      try {
        const drifting = new ZeroXKeyClient({ ...config });
        enableWebBoundOAuthExperiment(drifting);
        const init = drifting.init().then(
          () => false,
          () => true,
        );
        await started;
        drifting.config.organizationId = "org-changed-during-init";
        release();
        return await init;
      } finally {
        WebBoundCredentialStore.prototype.readEpoch = original;
      }
    }, target);
    assert.equal(initDriftRejected, true);

    const heldAfterDrift = await cold.evaluate(async (config) => {
      const drifting = new ZeroXKeyClient({ ...config });
      enableWebBoundOAuthExperiment(drifting);
      await drifting.init();
      const heldStamper = drifting.apiKeyStamper;
      const heldHttp = drifting.httpClient;
      const originalFetch = globalThis.fetch;
      let fetches = 0;
      globalThis.fetch = async () => {
        fetches += 1;
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };
      try {
        drifting.config.organizationId = "org-changed-after-init";
        let stampRejected = false;
        let httpRejected = false;
        try {
          await heldStamper.stamp("held-stamper");
        } catch {
          stampRejected = true;
        }
        try {
          await heldHttp.authProxyRequest("/v1/account", {});
        } catch {
          httpRejected = true;
        }
        drifting.config.organizationId = config.organizationId;
        let restoredTargetStillRejected = false;
        try {
          await heldStamper.stamp("after-A-B-A");
        } catch {
          restoredTargetStillRejected = true;
        }
        return {
          stampRejected,
          httpRejected,
          restoredTargetStillRejected,
          fetches,
        };
      } finally {
        globalThis.fetch = originalFetch;
      }
    }, target);
    assert.deepEqual(heldAfterDrift, {
      stampRejected: true,
      httpRejected: true,
      restoredTargetStillRejected: true,
      fetches: 0,
    });

    const apiUrlDriftRejected = await cold.evaluate(async (config) => {
      const owner = new ZeroXKeyClient({ ...config });
      enableWebBoundOAuthExperiment(owner);
      await owner.init();
      owner.config.apiBaseUrl = "https://other-api.example.test";
      try {
        await owner.apiKeyStamper.stamp("api-url-drift");
        return false;
      } catch {
        return true;
      }
    }, target);
    assert.equal(apiUrlDriftRejected, true);

    const rawTargetDrift = await cold.evaluate(async (config) => {
      const owner = new ZeroXKeyClient({ ...config });
      enableWebBoundOAuthExperiment(owner);
      await owner.init();
      let overrideRejected = false;
      try {
        owner.createHttpClient({ organizationId: "org-other" });
      } catch {
        overrideRejected = true;
      }
      const heldHttp = owner.httpClient;
      const originalFetch = globalThis.fetch;
      let fetches = 0;
      globalThis.fetch = async () => {
        fetches += 1;
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };
      try {
        heldHttp.config.authProxyConfigId = "config-other";
        let stampRejected = false;
        let directStamperRejected = false;
        let httpRejected = false;
        try {
          await owner.apiKeyStamper.stamp("direct-stamper");
        } catch {
          directStamperRejected = true;
        }
        try {
          await heldHttp.config.apiKeyStamper.stamp("raw-stamper");
        } catch {
          stampRejected = true;
        }
        try {
          await heldHttp.authProxyRequest("/v1/account", {});
        } catch {
          httpRejected = true;
        }
        return {
          overrideRejected,
          stampRejected,
          directStamperRejected,
          httpRejected,
          fetches,
        };
      } finally {
        globalThis.fetch = originalFetch;
      }
    }, target);
    assert.deepEqual(rawTargetDrift, {
      overrideRejected: true,
      stampRejected: true,
      directStamperRejected: true,
      httpRejected: true,
      fetches: 0,
    });

    const inFlightSignRejected = await cold.evaluate(async (config) => {
      const signer = new ZeroXKeyClient({ ...config });
      enableWebBoundOAuthExperiment(signer);
      await signer.init();
      const subtle = crypto.subtle;
      const original = Object.getPrototypeOf(subtle).sign.bind(subtle);
      let entered;
      let release;
      const started = new Promise((resolve) => (entered = resolve));
      const resumed = new Promise((resolve) => (release = resolve));
      Object.defineProperty(subtle, "sign", {
        configurable: true,
        value: (...args) => {
          if (new TextDecoder().decode(args[2]) !== "inflight-target")
            return original(...args);
          entered();
          return resumed.then(() => original(...args));
        },
      });
      try {
        const signed = signer.apiKeyStamper.stamp("inflight-target").then(
          () => false,
          () => true,
        );
        await started;
        signer.config.authProxyUrl = "https://other.example.test";
        release();
        return await signed;
      } finally {
        delete subtle.sign;
      }
    }, target);
    assert.equal(inFlightSignRejected, true);
    assert.equal(
      await cold.evaluate(() =>
        new WebBoundCredentialStore().clearAll(0, new AbortController().signal),
      ),
      1,
    );
    const stale = await first.evaluate(async () => {
      const rejected = async (work) => {
        try {
          await work();
          return false;
        } catch {
          return true;
        }
      };
      return {
        stamp: await rejected(() => client.apiKeyStamper.stamp("after-clear")),
        create: await rejected(() => client.createApiKeyPair()),
      };
    });
    assert.deepEqual(stale, { stamp: true, create: true });

    // The unenabled built-in client still uses V2 key generation. A V2 key
    // and an unowned session must never become opt-in v3 cold credentials.
    const oldTarget = { ...target, organizationId: "org-default-v2" };
    const oldToken = await first.evaluate(async (config) => {
      const ordinary = new ZeroXKeyClient(config);
      await ordinary.init();
      const publicKey = await ordinary.createApiKeyPair();
      const session =
        "header." +
        btoa(
          JSON.stringify({
            exp: 2000000000,
            public_key: publicKey,
            session_type: "SESSION_TYPE_READ_WRITE",
            user_id: "old-user",
            organization_id: "child-org",
          }),
        ) +
        ".signature";
      await ordinary.storeSession({ sessionToken: session });
      return { publicKey, session };
    }, oldTarget);
    const oldCredential = await cold.evaluate(
      async ({ config, publicKey }) => {
        const open = indexedDB.open("ZeroXKeyAuthV2", 1);
        const keyPresent = await new Promise((resolve, reject) => {
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("KeyStore", "readonly");
            const key = tx.objectStore("KeyStore").get(publicKey);
            tx.oncomplete = () => {
              db.close();
              resolve(key.result instanceof CryptoKey);
            };
            tx.onabort = () => reject(tx.error);
          };
        });
        const opted = new ZeroXKeyClient(config);
        enableWebBoundOAuthExperiment(opted);
        await opted.init();
        return { keyPresent, restored: Boolean(await opted.getSession()) };
      },
      { config: oldTarget, publicKey: oldToken.publicKey },
    );
    assert.deepEqual(oldCredential, {
      keyPresent: true,
      restored: false,
    });
    const noProfileContext = await browser.newContext();
    const noProfilePage = await noProfileContext.newPage();
    await noProfilePage.goto(origin);
    await noProfilePage.addScriptTag({
      content: noProfileBuilt.outputFiles[0].text,
    });
    const noProfileKey = await noProfilePage.evaluate(async (config) => {
      globalThis.noProfileClient = new ZeroXKeyClient(config);
      enableWebBoundOAuthExperiment(noProfileClient);
      await noProfileClient.init();
      return noProfileClient.createApiKeyPair();
    }, target);
    const noProfileNonce = await readPendingNonce(noProfilePage, noProfileKey);
    const noProfileToken = v3Token(noProfileKey, noProfileNonce);
    const absentBuildProfile = await noProfilePage.evaluate(async (session) => {
      try {
        await noProfileClient.storeSession({ sessionToken: session });
        return false;
      } catch {
        return (await noProfileClient.getSession()) === undefined;
      }
    }, noProfileToken);
    assert.equal(
      absentBuildProfile,
      true,
      "browser target and valid local signature cannot replace the build profile",
    );
    await noProfileContext.close();
    console.log("v3 opt-in real Core OAuth claim/cold-sign: passed");
    await context.close();
  } finally {
    await browser.close();
    await close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
