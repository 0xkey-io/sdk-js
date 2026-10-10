const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const {
  signedToken,
  localSignerPinPlugin,
} = require("./session-jwt-test-signer.cjs");

const root = path.resolve(__dirname, "../../../../..");
const esbuild = require(
  process.env.C5_ESBUILD_ROOT ||
    path.join(root, "node_modules/.pnpm/esbuild@0.18.20/node_modules/esbuild"),
);
// This standalone local smoke intentionally does not add browser dependencies
// to the published SDK. Provide installed Playwright and Chrome paths at run time.
if (!process.env.C5_PLAYWRIGHT_ROOT || !process.env.C5_CHROME)
  throw new Error("Set C5_PLAYWRIGHT_ROOT and C5_CHROME for the browser smoke");
const playwright = require(process.env.C5_PLAYWRIGHT_ROOT);
const chrome = process.env.C5_CHROME;

const targetA = {
  organizationId: "org-A",
  apiBaseUrl: "https://api.example.test",
  authProxyUrl: "https://auth.example.test",
};
const targetB = { ...targetA, organizationId: "org-B" };
const targetLegacy = { ...targetA, organizationId: "org-legacy" };
const token = signedToken;

// This harness exercises IndexedDB ownership, retirement, and two-tab races
// using arbitrary historical targets/claim IDs. Keep its former signed-JWT
// check isolated from the real v3 admission gate, which is exercised by
// web-bound-oauth-optin.cjs with a fixed test trust profile.
const storageStructureJwtPlugin = {
  name: "storage-structure-signed-jwt-fixture",
  setup(build) {
    build.onLoad({ filter: /session-jwt-signature\.ts$/ }, () => ({
      contents: `
        import { verifySessionJwtSignature } from "@0xkey-io/crypto";
        import { parseSession } from "@utils";
        import { SESSION_JWT_SIGNING_KEY_HEX } from "./session-jwt-pin";
        export async function assertSignedBoundSessionJwt(token: string) {
          const parts = token.split(".");
          if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)))
            throw new Error("Invalid signed session JWT");
          const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
          if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) ||
              payload.exp <= Date.now() / 1000)
            throw new Error("Signed session JWT expired");
          if (!(await verifySessionJwtSignature(token, SESSION_JWT_SIGNING_KEY_HEX)))
            throw new Error("Session JWT signer is not trusted");
          return parseSession(token);
        }
      `,
      loader: "ts",
      resolveDir: path.join(root, "packages/core/src/__storage__/web"),
    }));
  },
};

const server = http.createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end("<!doctype html><title>Bound credential transaction</title>");
});
const listen = () =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${server.address().port}/`),
    ),
  );
const close = () => new Promise((resolve) => server.close(resolve));

async function create(page, target, ownerId, claimId, epoch) {
  return page.evaluate(
    async ({ target, ownerId, claimId, epoch }) => {
      const pair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign", "verify"],
      );
      return new WebBoundCredentialStore().createPendingKey(
        pair,
        target,
        ownerId,
        claimId,
        epoch,
        new AbortController().signal,
      );
    },
    { target, ownerId, claimId, epoch },
  );
}

async function reserve(page, publicKey, ownerId, target, claimId, epoch) {
  return page.evaluate(
    ({ publicKey, ownerId, target, claimId, epoch }) =>
      new WebBoundCredentialStore().reservePendingClaim(
        publicKey,
        ownerId,
        target,
        claimId,
        epoch,
        new AbortController().signal,
      ),
    { publicKey, ownerId, target, claimId, epoch },
  );
}

async function claim(page, target, key, jwt, claimId, epoch, prior) {
  return page.evaluate(
    ({ target, key, jwt, claimId, epoch, prior }) =>
      new WebBoundCredentialStore().claimSession(
        target,
        key,
        jwt,
        claimId,
        epoch,
        prior,
        new AbortController().signal,
      ),
    { target, key, jwt, claimId, epoch, prior },
  );
}

async function clearSession(page, target, key, jwt, epoch) {
  return page.evaluate(
    ({ target, key, jwt, epoch }) =>
      new WebBoundCredentialStore().clearSession(
        target,
        key,
        jwt,
        epoch,
        new AbortController().signal,
      ),
    { target, key, jwt, epoch },
  );
}

async function snapshot(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("ZeroXKeyBoundAuthV3", 2);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
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
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
}

async function rejects(page, operation, args) {
  return page.evaluate(
    async ({ operation, args }) => {
      try {
        await new WebBoundCredentialStore()[operation](
          ...args,
          new AbortController().signal,
        );
        return false;
      } catch {
        return true;
      }
    },
    { operation, args },
  );
}

async function verified(page, target, epoch, targetGeneration = 0) {
  return page.evaluate(
    async ({ target, epoch, targetGeneration }) => {
      try {
        return (
          (await new WebBoundCredentialStore().readVerifiedActive(
            target,
            epoch,
            targetGeneration,
          )) ?? null
        );
      } catch {
        return null;
      }
    },
    { target, epoch, targetGeneration },
  );
}

async function pauseVerifiedProof(page, target, epoch, targetGeneration = 0) {
  await page.evaluate(
    ({ target, epoch, targetGeneration }) => {
      const subtle = crypto.subtle;
      Object.defineProperty(subtle, "sign", {
        configurable: true,
        value: (...args) => {
          globalThis.proofSignEntered = true;
          return new Promise((resolve) => {
            globalThis.releaseProofSign = resolve;
          }).then(() => globalThis.originalProofSign(...args));
        },
      });
      globalThis.originalProofSign =
        Object.getPrototypeOf(subtle).sign.bind(subtle);
      globalThis.pendingVerifiedProof = new WebBoundCredentialStore()
        .readVerifiedActive(target, epoch, targetGeneration)
        .then(
          (value) => value ?? null,
          () => null,
        );
    },
    { target, epoch, targetGeneration },
  );
  await page.waitForFunction(() => globalThis.proofSignEntered === true);
}

async function releaseVerifiedProof(page) {
  return page.evaluate(async () => {
    globalThis.releaseProofSign();
    try {
      return await globalThis.pendingVerifiedProof;
    } finally {
      delete crypto.subtle.sign;
      delete globalThis.originalProofSign;
      delete globalThis.releaseProofSign;
      delete globalThis.pendingVerifiedProof;
      delete globalThis.proofSignEntered;
    }
  });
}

async function run() {
  const built = await esbuild.build({
    entryPoints: [path.join(__dirname, "bound-credential-entry.ts")],
    bundle: true,
    platform: "browser",
    format: "iife",
    tsconfig: path.join(root, "packages/core/tsconfig.json"),
    write: false,
    logLevel: "silent",
    plugins: [localSignerPinPlugin(), storageStructureJwtPlugin],
  });
  const source = built.outputFiles[0].text;
  const origin = await listen();
  const browser = await playwright.chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext();
    const a = await context.newPage();
    const b = await context.newPage();
    await Promise.all([a.goto(origin), b.goto(origin)]);
    await Promise.all([
      a.addScriptTag({ content: source }),
      b.addScriptTag({ content: source }),
    ]);

    // An old tab that refuses versionchange must block v1 -> v2, not trigger fallback.
    await a.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("ZeroXKeyBoundAuthV3", 1);
          open.onupgradeneeded = () =>
            open.result.createObjectStore("BoundSessions");
          open.onsuccess = () => {
            globalThis.oldConnection = open.result;
            oldConnection.onversionchange = () => undefined;
            resolve();
          };
          open.onerror = () => reject(open.error);
        }),
    );
    assert.equal(
      await b.evaluate(() =>
        new WebBoundCredentialStore().readEpoch().then(
          () => false,
          () => true,
        ),
      ),
      true,
    );
    await a.evaluate(() => oldConnection.close());

    // A preexisting V2 database is not read, claimed, or cleared by this API.
    await a.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("ZeroXKeyAuthV2", 1);
          open.onupgradeneeded = () =>
            open.result.createObjectStore("KeyStore");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("KeyStore", "readwrite");
            tx.objectStore("KeyStore").put("legacy-key", "legacy-public-key");
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onabort = () => reject(tx.error);
          };
        }),
    );

    const shared = await create(a, targetA, "owner-shared", "claim-A", 0);
    const aToken = token(shared, "user-A");
    const bToken = token(shared, "user-B");
    // A direct call to this internal primitive must not spend a pending
    // owner claim on a token that the Signer never issued.
    const forged = `${aToken.split(".").slice(0, 2).join(".")}.signature`;
    await assert.rejects(claim(a, targetA, "session-A", forged, "claim-A", 0));
    assert.equal((await snapshot(a)).BoundSessions.length, 0);
    await claim(a, targetA, "session-A", aToken, "claim-A", 0);
    await reserve(b, shared, "owner-shared", targetB, "claim-B", 0);
    await claim(b, targetB, "session-B", bToken, "claim-B", 0);
    assert.equal(await clearSession(a, targetA, "session-A", aToken, 0), true);
    let state = await snapshot(b);
    assert.equal(state.KeyStore.length, 1);
    assert.equal(state.BoundSessions[0][1].sessions[0].token, bToken);
    assert.equal(await clearSession(b, targetB, "session-B", bToken, 0), true);
    state = await snapshot(a);
    assert.equal(state.KeyStore.length, 0);
    assert.equal(state.KeyOwners.length, 0);

    const replaceKey = await create(
      a,
      targetA,
      "owner-replace",
      "claim-old",
      0,
    );
    const oldToken = token(replaceKey, "user-old");
    const newToken = token(replaceKey, "user-new");
    await claim(a, targetA, "replace", oldToken, "claim-old", 0);
    await reserve(b, replaceKey, "owner-replace", targetA, "claim-new", 0);
    await claim(b, targetA, "replace", newToken, "claim-new", 0, oldToken);
    assert.equal(await clearSession(a, targetA, "replace", oldToken, 0), false);
    state = await snapshot(b);
    assert.equal(state.BoundSessions[0][1].sessions[0].token, newToken);
    assert.equal(state.KeyStore.length, 1);
    assert.equal(await clearSession(b, targetA, "replace", newToken, 0), true);

    // A retired generation must not clear a later generation's session even
    // when the session key and token bytes are unchanged. This runs before
    // malformed-record fixtures so a failed clear cannot be masked by the
    // conservative full-store inventory check.
    const retiredTarget = { ...targetA, organizationId: "org-retired-clear" };
    const retiredKey = await a.evaluate(async (target) => {
      globalThis.retiredPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign", "verify"],
      );
      return new WebBoundCredentialStore().createPendingKey(
        retiredPair,
        target,
        "owner-retired-clear",
        "retired-claim-0",
        0,
        new AbortController().signal,
      );
    }, retiredTarget);
    const retiredToken = token(retiredKey, "same-user");
    await claim(
      a,
      retiredTarget,
      "retired-session",
      retiredToken,
      "retired-claim-0",
      0,
    );
    assert.equal(
      await clearSession(b, retiredTarget, "retired-session", retiredToken, 0),
      true,
    );
    await b.evaluate(
      (target) =>
        new WebAtomicBoundSessionStore().withCredentialTransaction(
          ({ meta }) => {
            meta.put(
              1,
              `@0xkey-io/auth/v3/target-generation/${JSON.stringify([
                target.organizationId,
                target.apiBaseUrl,
                target.authProxyUrl,
                null,
              ])}`,
            );
          },
          new AbortController().signal,
        ),
      retiredTarget,
    );
    assert.equal(
      await a.evaluate(
        (target) =>
          new WebBoundCredentialStore().createPendingKey(
            retiredPair,
            target,
            "owner-retired-clear",
            "retired-claim-1",
            0,
            new AbortController().signal,
            1,
          ),
        retiredTarget,
      ),
      retiredKey,
    );
    await a.evaluate(
      ({ target, jwt }) =>
        new WebBoundCredentialStore().claimSession(
          target,
          "retired-session",
          jwt,
          "retired-claim-1",
          0,
          undefined,
          new AbortController().signal,
          1,
        ),
      { target: retiredTarget, jwt: retiredToken },
    );
    const beforeRetiredClear = await snapshot(b);
    const retiredClearError = await b.evaluate(
      async ({ target, jwt }) => {
        try {
          await new WebBoundCredentialStore().clearSession(
            target,
            "retired-session",
            jwt,
            0,
            new AbortController().signal,
          );
          return null;
        } catch (error) {
          return error.message;
        }
      },
      { target: retiredTarget, jwt: retiredToken },
    );
    assert.notEqual(retiredClearError, null);
    assert.deepEqual(await snapshot(b), beforeRetiredClear);
    assert.equal(
      await a.evaluate(
        ({ target, jwt }) =>
          new WebBoundCredentialStore().clearSession(
            target,
            "retired-session",
            jwt,
            0,
            new AbortController().signal,
            1,
          ),
        { target: retiredTarget, jwt: retiredToken },
      ),
      true,
    );
    await a.evaluate(() => delete globalThis.retiredPair);
    await b.evaluate(
      (target) =>
        new WebAtomicBoundSessionStore().withCredentialTransaction(
          ({ meta }) => {
            meta.delete(
              `@0xkey-io/auth/v3/target-generation/${JSON.stringify([
                target.organizationId,
                target.apiBaseUrl,
                target.authProxyUrl,
                null,
              ])}`,
            );
          },
          new AbortController().signal,
        ),
      retiredTarget,
    );

    const pendingKey = await create(
      a,
      targetA,
      "owner-pending",
      "pending-A",
      0,
    );
    const pendingAToken = token(pendingKey, "user-pending-A");
    const pendingBToken = token(pendingKey, "user-pending-B");
    await claim(a, targetA, "pending-A", pendingAToken, "pending-A", 0);
    await reserve(b, pendingKey, "owner-pending", targetB, "pending-B", 0);
    assert.equal(
      await clearSession(a, targetA, "pending-A", pendingAToken, 0),
      true,
    );
    state = await snapshot(b);
    assert.equal(state.KeyStore.length, 1);
    assert.equal(state.KeyOwners[0][1].pending.length, 1);
    await claim(b, targetB, "pending-B", pendingBToken, "pending-B", 0);
    assert.equal(
      await clearSession(b, targetB, "pending-B", pendingBToken, 0),
      true,
    );

    // Two independent connections race a last-reference clear with a new
    // pending claim. Either transaction order is valid, but key and claim must
    // agree after both complete.
    const raceKey = await create(a, targetA, "owner-race", "race-A", 0);
    const raceToken = token(raceKey, "user-race");
    await claim(a, targetA, "race-A", raceToken, "race-A", 0);
    const [clearing, reserving] = await Promise.allSettled([
      clearSession(a, targetA, "race-A", raceToken, 0),
      reserve(b, raceKey, "owner-race", targetB, "race-B", 0),
    ]);
    assert.equal(clearing.status, "fulfilled");
    assert.equal(clearing.value, true);
    state = await snapshot(b);
    assert.equal(
      state.KeyStore.length,
      reserving.status === "fulfilled" ? 1 : 0,
    );
    assert.equal(
      state.KeyOwners.length,
      reserving.status === "fulfilled" ? 1 : 0,
    );
    if (reserving.status === "fulfilled") {
      assert.equal(state.KeyOwners[0][1].pending[0].claimId, "race-B");
      const raceBToken = token(raceKey, "user-race-B");
      await claim(b, targetB, "race-B", raceBToken, "race-B", 0);
      await clearSession(b, targetB, "race-B", raceBToken, 0);
    }

    // An unowned older v3 session must prevent last-reference key deletion.
    const legacyKey = await create(a, targetA, "owner-legacy", "legacy-A", 0);
    const legacyAToken = token(legacyKey, "user-legacy-A");
    const legacyOtherToken = token(legacyKey, "user-legacy-B");
    await claim(a, targetA, "legacy-A", legacyAToken, "legacy-A", 0);
    await b.evaluate(
      ({ target, key, jwt }) =>
        new WebAtomicBoundSessionStore().withCredentialTransaction(
          ({ sessions }) => {
            sessions.put(
              {
                version: 3,
                target,
                sessions: [{ key, token: jwt }],
                activeSessionKey: key,
              },
              `@0xkey-io/auth/v3/target/${JSON.stringify([
                target.organizationId,
                target.apiBaseUrl,
                target.authProxyUrl,
                null,
              ])}`,
            );
          },
          new AbortController().signal,
        ),
      { target: targetLegacy, key: "legacy-other", jwt: legacyOtherToken },
    );
    assert.equal(
      await clearSession(a, targetA, "legacy-A", legacyAToken, 0),
      true,
    );
    state = await snapshot(b);
    assert.equal(state.KeyStore.length, 1, "unowned v3 reference retains key");

    // Abort after requests are queued must roll back all four stores.
    assert.equal(
      await a.evaluate(async () => {
        try {
          await new WebAtomicBoundSessionStore().withCredentialTransaction(
            ({ sessions, keys, owners, meta }) => {
              sessions.put({ bogus: true }, "aborted-session");
              keys.put("bogus", "aborted-key");
              owners.put({ bogus: true }, "aborted-owner");
              meta.put(999, "epoch");
              meta.transaction.abort();
            },
            new AbortController().signal,
          );
          return false;
        } catch {
          return true;
        }
      }),
      true,
    );
    state = await snapshot(b);
    assert.equal(state.Meta.length, 0);
    assert.equal(state.KeyStore.length, 1);
    assert.equal(state.BoundSessions.length, 1);

    // A failed request also aborts preceding queued writes in the same txn.
    assert.equal(
      await b.evaluate(async (publicKey) => {
        try {
          await new WebAtomicBoundSessionStore().withCredentialTransaction(
            ({ sessions, keys, owners }) => {
              sessions.put({ bogus: true }, "failed-session");
              keys.add("duplicate", publicKey);
              owners.put({ bogus: true }, "failed-owner");
            },
            new AbortController().signal,
          );
          return false;
        } catch {
          return true;
        }
      }, legacyKey),
      true,
    );
    state = await snapshot(a);
    assert.equal(state.BoundSessions.length, 1);
    assert.equal(state.KeyOwners.length, 1);
    assert.equal(state.KeyStore.length, 1);

    const fenceKey = await create(a, targetA, "owner-fence", "fence-claim", 0);
    const fenceToken = token(fenceKey, "user-fence");
    assert.equal(
      await b.evaluate(() =>
        new WebBoundCredentialStore().clearAll(0, new AbortController().signal),
      ),
      1,
    );
    assert.equal(
      await rejects(a, "claimSession", [
        targetA,
        "fence",
        fenceToken,
        "fence-claim",
        0,
        undefined,
      ]),
      true,
    );
    assert.equal(
      await rejects(a, "clearSession", [targetA, "fence", fenceToken, 0]),
      true,
    );
    assert.equal(
      await a.evaluate(async (target) => {
        const pair = await crypto.subtle.generateKey(
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign", "verify"],
        );
        try {
          await new WebBoundCredentialStore().createPendingKey(
            pair,
            target,
            "late-owner",
            "late-claim",
            0,
            new AbortController().signal,
          );
          return false;
        } catch {
          return true;
        }
      }, targetA),
      true,
    );
    state = await snapshot(b);
    assert.deepEqual(state.Meta, [["epoch", 1]]);
    assert.equal(state.KeyStore.length, 0);
    assert.equal(state.KeyOwners.length, 0);
    assert.equal(state.BoundSessions.length, 0);
    assert.equal(
      await b.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open("ZeroXKeyAuthV2", 1);
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction("KeyStore", "readonly");
              const get = tx.objectStore("KeyStore").get("legacy-public-key");
              get.onsuccess = () => resolve(get.result);
              tx.oncomplete = () => db.close();
              tx.onabort = () => reject(tx.error);
            };
          }),
      ),
      "legacy-key",
    );

    // One cross-store snapshot must validate the complete active token, owner
    // reference, target generation and a real private CryptoKey.
    const verifiedKey = await create(
      a,
      targetA,
      "owner-verified",
      "verified",
      1,
    );
    const verifiedToken = token(verifiedKey, "verified-user");
    await claim(a, targetA, "verified-session", verifiedToken, "verified", 1);
    assert.deepEqual(await verified(b, targetA, 1), {
      sessionKey: "verified-session",
      token: verifiedToken,
      publicKey: verifiedKey,
      targetGeneration: 0,
    });

    const crossTarget = { ...targetA, organizationId: "org-cross" };
    await a.evaluate(
      ({ source, other }) =>
        new WebAtomicBoundSessionStore().withCredentialTransaction(
          ({ sessions }) => {
            const sourceKey = `@0xkey-io/auth/v3/target/${JSON.stringify([
              source.organizationId,
              source.apiBaseUrl,
              source.authProxyUrl,
              null,
            ])}`;
            const otherKey = `@0xkey-io/auth/v3/target/${JSON.stringify([
              other.organizationId,
              other.apiBaseUrl,
              other.authProxyUrl,
              null,
            ])}`;
            const get = sessions.get(sourceKey);
            get.onsuccess = () => sessions.put(get.result, otherKey);
          },
          new AbortController().signal,
        ),
      { source: targetA, other: crossTarget },
    );
    assert.equal(await verified(b, crossTarget, 1), null);

    const pendingTarget = { ...targetA, organizationId: "org-pending-only" };
    await create(a, pendingTarget, "owner-pending-only", "unclaimed", 1);
    assert.equal(await verified(b, pendingTarget, 1), null);

    await a.evaluate(
      (publicKey) =>
        new WebAtomicBoundSessionStore().withCredentialTransaction(
          ({ keys }) => {
            keys.delete(publicKey);
          },
          new AbortController().signal,
        ),
      verifiedKey,
    );
    assert.equal(await verified(b, targetA, 1), null);
    state = await snapshot(b);
    assert.equal(
      state.BoundSessions.length > 0,
      true,
      "failed read preserves session",
    );

    const staleTarget = { ...targetA, organizationId: "org-stale-token" };
    const staleKey = await create(a, staleTarget, "owner-stale", "stale", 1);
    const staleToken = token(staleKey, "original");
    await claim(a, staleTarget, "stale-session", staleToken, "stale", 1);
    await a.evaluate(
      ({ target, jwt }) =>
        new WebAtomicBoundSessionStore().withCredentialTransaction(
          ({ sessions }) => {
            const key = `@0xkey-io/auth/v3/target/${JSON.stringify([
              target.organizationId,
              target.apiBaseUrl,
              target.authProxyUrl,
              null,
            ])}`;
            const get = sessions.get(key);
            get.onsuccess = () =>
              sessions.put(
                {
                  ...get.result,
                  sessions: [{ key: "stale-session", token: jwt }],
                },
                key,
              );
          },
          new AbortController().signal,
        ),
      { target: staleTarget, jwt: token(staleKey, "replacement") },
    );
    const staleRefState = await snapshot(b);
    assert.equal(await verified(b, staleTarget, 1), null);
    assert.deepEqual(await snapshot(b), staleRefState);

    const missingOwnerTarget = { ...targetA, organizationId: "org-no-owner" };
    const missingOwnerKey = await create(
      a,
      missingOwnerTarget,
      "owner-no-owner",
      "no-owner",
      1,
    );
    await claim(
      a,
      missingOwnerTarget,
      "no-owner",
      token(missingOwnerKey, "owner"),
      "no-owner",
      1,
    );
    await a.evaluate(
      (publicKey) =>
        new WebAtomicBoundSessionStore().withCredentialTransaction(
          ({ owners }) => {
            owners.delete(publicKey);
          },
          new AbortController().signal,
        ),
      missingOwnerKey,
    );
    const unknownOwnerState = await snapshot(b);
    assert.equal(await verified(b, missingOwnerTarget, 1), null);
    assert.deepEqual(await snapshot(b), unknownOwnerState);

    const malformedTarget = { ...targetA, organizationId: "org-not-cryptokey" };
    const malformedKey = await create(
      a,
      malformedTarget,
      "owner-malformed",
      "malformed",
      1,
    );
    await claim(
      a,
      malformedTarget,
      "malformed",
      token(malformedKey, "owner"),
      "malformed",
      1,
    );
    await a.evaluate(
      (publicKey) =>
        new WebAtomicBoundSessionStore().withCredentialTransaction(
          ({ keys }) => {
            keys.put("not-a-private-key", publicKey);
          },
          new AbortController().signal,
        ),
      malformedKey,
    );
    assert.equal(await verified(b, malformedTarget, 1), null);

    const mismatchedTarget = {
      ...targetA,
      organizationId: "org-wrong-cryptokey",
    };
    const mismatchedKey = await create(
      a,
      mismatchedTarget,
      "owner-wrong-key",
      "wrong-key",
      1,
    );
    await claim(
      a,
      mismatchedTarget,
      "wrong-key",
      token(mismatchedKey, "owner"),
      "wrong-key",
      1,
    );
    await a.evaluate(async (publicKey) => {
      const unrelated = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign", "verify"],
      );
      await new WebAtomicBoundSessionStore().withCredentialTransaction(
        ({ keys }) => {
          keys.put(unrelated.privateKey, publicKey);
        },
        new AbortController().signal,
      );
    }, mismatchedKey);
    assert.equal(await verified(b, mismatchedTarget, 1), null);

    const inFlightGenerationTarget = {
      ...targetA,
      organizationId: "org-inflight-generation",
    };
    const inFlightGenerationKey = await create(
      a,
      inFlightGenerationTarget,
      "owner-inflight",
      "inflight",
      1,
    );
    await claim(
      a,
      inFlightGenerationTarget,
      "inflight",
      token(inFlightGenerationKey, "owner"),
      "inflight",
      1,
    );
    await pauseVerifiedProof(b, inFlightGenerationTarget, 1);
    await a.evaluate(
      (target) =>
        new WebAtomicBoundSessionStore().withCredentialTransaction(
          ({ meta }) => {
            const key = `@0xkey-io/auth/v3/target-generation/${JSON.stringify([
              target.organizationId,
              target.apiBaseUrl,
              target.authProxyUrl,
              null,
            ])}`;
            meta.put(1, key);
          },
          new AbortController().signal,
        ),
      inFlightGenerationTarget,
    );
    assert.equal(await releaseVerifiedProof(b), null);

    const generationTarget = { ...targetA, organizationId: "org-generation" };
    const generationKey = await create(
      a,
      generationTarget,
      "owner-generation",
      "generation",
      1,
    );
    await claim(
      a,
      generationTarget,
      "generation",
      token(generationKey, "owner"),
      "generation",
      1,
    );
    await a.evaluate(
      (target) =>
        new WebAtomicBoundSessionStore().withCredentialTransaction(
          ({ meta }) => {
            const key = `@0xkey-io/auth/v3/target-generation/${JSON.stringify([
              target.organizationId,
              target.apiBaseUrl,
              target.authProxyUrl,
              null,
            ])}`;
            meta.put(1, key);
          },
          new AbortController().signal,
        ),
      generationTarget,
    );
    assert.equal(await verified(b, generationTarget, 1, 0), null);
    assert.equal(await verified(b, generationTarget, 1, 1), null);

    const inFlightEpochTarget = {
      ...targetA,
      organizationId: "org-inflight-epoch",
    };
    const inFlightEpochKey = await create(
      a,
      inFlightEpochTarget,
      "owner-epoch",
      "epoch",
      1,
    );
    await claim(
      a,
      inFlightEpochTarget,
      "epoch",
      token(inFlightEpochKey, "owner"),
      "epoch",
      1,
    );
    const beforeStaleEpoch = await snapshot(b);
    await pauseVerifiedProof(b, inFlightEpochTarget, 1);
    await a.evaluate(() =>
      new WebAtomicBoundSessionStore().withCredentialTransaction(({ meta }) => {
        meta.put(2, "epoch");
      }, new AbortController().signal),
    );
    assert.equal(await releaseVerifiedProof(b), null);
    assert.equal(await verified(b, generationTarget, 1), null);
    state = await snapshot(b);
    assert.equal(
      state.BoundSessions.length,
      beforeStaleEpoch.BoundSessions.length,
    );

    console.log("bound credential Chrome 2-tab scenarios: 22 passed");
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
