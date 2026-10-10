// Manual RED integration gate. Requires installed Playwright and Chromium:
// C5_PLAYWRIGHT_ROOT=... C5_CHROME=... node packages/core/src/__tests__/browser/mixed-core-bound.red.cjs
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");

if (!process.env.C5_PLAYWRIGHT_ROOT || !process.env.C5_CHROME)
  throw new Error("Set C5_PLAYWRIGHT_ROOT and C5_CHROME for this browser RED");
const playwright = require(process.env.C5_PLAYWRIGHT_ROOT);
const esbuild = require(
  path.resolve(
    __dirname,
    "../../../../../node_modules/.pnpm/esbuild@0.18.20/node_modules/esbuild",
  ),
);
const root = path.resolve(__dirname, "../../../../..");
const targetA = {
  organizationId: "org-A",
  apiBaseUrl: "https://api.example.test",
  authProxyUrl: "https://auth.example.test",
};
const targetB = { ...targetA, organizationId: "org-B" };
const token = (publicKey, user) =>
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
  response.end("<!doctype html><title>Core mixed storage RED</title>");
});
const listen = () =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${server.address().port}/`),
    ),
  );
const close = () => new Promise((resolve) => server.close(resolve));

async function snapshot(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("ZeroXKeyBoundAuthV3", 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(
            ["BoundSessions", "KeyStore", "KeyOwners", "Meta"],
            "readonly",
          );
          const result = {};
          for (const name of [
            "BoundSessions",
            "KeyStore",
            "KeyOwners",
            "Meta",
          ]) {
            const keys = tx.objectStore(name).getAllKeys();
            const values = tx.objectStore(name).getAll();
            values.onsuccess = () => {
              result[name] = keys.result.map((key, index) => [
                key,
                name === "KeyStore"
                  ? Boolean(values.result[index])
                  : values.result[index],
              ]);
            };
          }
          tx.oncomplete = () => {
            db.close();
            resolve(result);
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
  );
}

async function run() {
  const built = await esbuild.build({
    entryPoints: [path.join(__dirname, "mixed-core-entry.ts")],
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
  });
  const origin = await listen();
  const browser = await playwright.chromium.launch({
    executablePath: process.env.C5_CHROME,
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext();
    const a = await context.newPage();
    const b = await context.newPage();
    await Promise.all([a.goto(origin), b.goto(origin)]);
    await Promise.all([
      a.addScriptTag({ content: built.outputFiles[0].text }),
      b.addScriptTag({ content: built.outputFiles[0].text }),
    ]);

    // Same target and exact CryptoKey: opt-in creates the owner reference, while
    // real Core later replaces and clears through the old single-store adapter.
    const publicKey = await a.evaluate(async (target) => {
      const pair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign", "verify"],
      );
      return new WebBoundCredentialStore().createPendingKey(
        pair,
        target,
        "owner-mixed",
        "claim-A",
        0,
        new AbortController().signal,
      );
    }, targetA);
    const first = token(publicKey, "first");
    const replacement = token(publicKey, "replacement");
    await a.evaluate(
      ({ target, jwt }) =>
        new WebBoundCredentialStore().claimSession(
          target,
          "@0xkey-io/session/v3",
          jwt,
          "claim-A",
          0,
          undefined,
          new AbortController().signal,
        ),
      { target: targetA, jwt: first },
    );
    await b.evaluate(async (config) => {
      globalThis.coreA = new ZeroXKeyClient(config);
      await coreA.init();
    }, targetA);
    await b.evaluate(
      (jwt) => coreA.storeSession({ sessionToken: jwt }),
      replacement,
    );
    const targetBToken = token(publicKey, "other-target");
    await a.evaluate(
      ({ target, publicKey }) =>
        new WebBoundCredentialStore().reservePendingClaim(
          publicKey,
          "owner-mixed",
          target,
          "claim-B",
          0,
          new AbortController().signal,
        ),
      { target: targetB, publicKey },
    );
    await a.evaluate(
      ({ target, jwt }) =>
        new WebBoundCredentialStore().claimSession(
          target,
          "other-session",
          jwt,
          "claim-B",
          0,
          undefined,
          new AbortController().signal,
        ),
      { target: targetB, jwt: targetBToken },
    );
    let state = await snapshot(a);
    const staleOwner = state.KeyOwners[0][1].references.some(
      (ref) => ref.token === first,
    );
    await b.evaluate(() => coreA.clearSession());
    state = await snapshot(a);
    const bRetainedAfterAClear = state.BoundSessions.some(
      ([, record]) =>
        record.target.organizationId === "org-B" &&
        record.sessions[0]?.token === targetBToken,
    );
    const orphanOwner = state.KeyOwners.some(([, owner]) =>
      owner.references.some(
        (ref) =>
          !state.BoundSessions.some(
            ([key, record]) =>
              key === ref.targetKey &&
              record.sessions.some(
                (session) =>
                  session.key === ref.sessionKey && session.token === ref.token,
              ),
          ),
      ),
    );

    // A tab initialized before clearAll can still write through Core after
    // the opt-in Meta epoch has advanced.
    await a.evaluate(async (config) => {
      globalThis.staleCore = new ZeroXKeyClient(config);
      await staleCore.init();
    }, targetA);
    const nextEpoch = await b.evaluate(() =>
      new WebBoundCredentialStore().clearAll(0, new AbortController().signal),
    );
    assert.equal(nextEpoch, 1);
    const lateToken = token("legacy-V2-public-key", "late");
    await a.evaluate(
      (jwt) => staleCore.storeSession({ sessionToken: jwt }),
      lateToken,
    );
    state = await snapshot(b);
    const recreatedAfterFence = state.BoundSessions.length === 1;

    // The opt-in primitive cannot claim a pre-index Core record or delete its
    // unknown legacy key material; it aborts and leaves that record intact.
    const oldClearRejected = await b.evaluate(
      async ({ target, jwt }) => {
        try {
          await new WebBoundCredentialStore().clearSession(
            target,
            "@0xkey-io/session/v3",
            jwt,
            1,
            new AbortController().signal,
          );
          return false;
        } catch {
          return true;
        }
      },
      { target: targetA, jwt: lateToken },
    );
    state = await snapshot(b);
    const ownerUnknownRetained =
      oldClearRejected &&
      state.BoundSessions[0][1].sessions[0].token === lateToken;

    // Cold Core restore sees that unowned record even though the owner store
    // and same-file private key are absent.
    const coldRestored = await b.evaluate(async (config) => {
      const cold = new ZeroXKeyClient(config);
      await cold.init();
      return Boolean(await cold.getSession());
    }, targetA);

    await b.evaluate(async (config) => {
      globalThis.coreB = new ZeroXKeyClient(config);
      await coreB.init();
      await coreB.storeSession({
        sessionToken:
          "header." +
          btoa(
            JSON.stringify({
              exp: 2000000000,
              public_key: "B-legacy-key",
              session_type: "SESSION_TYPE_READ_WRITE",
              user_id: "B-user",
              organization_id: "child-org",
            }),
          ) +
          ".signature",
      });
    }, targetB);
    await a.evaluate(() => staleCore.clearAllSessions());
    state = await snapshot(b);
    const otherTargetSurvivesClearAll = state.BoundSessions.some(
      ([, record]) => record.target.organizationId === "org-B",
    );

    const observed = {
      staleOwner,
      orphanOwner,
      bRetainedAfterAClear,
      recreatedAfterFence,
      ownerUnknownRetained,
      coldRestored,
      otherTargetSurvivesClearAll,
    };
    console.log(JSON.stringify(observed));
    assert.deepEqual(observed, {
      staleOwner: false,
      orphanOwner: false,
      bRetainedAfterAClear: true,
      recreatedAfterFence: false,
      ownerUnknownRetained: true,
      coldRestored: false,
      otherTargetSurvivesClearAll: false,
    });
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
