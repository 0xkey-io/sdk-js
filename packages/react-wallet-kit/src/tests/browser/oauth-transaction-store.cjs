"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const NODE_PATH =
  "/Users/torben/codes/0xkey-workspace/.work/oauth-turnkey-parity/npm-cache/_npx/f6c81a5e22bed22a/node_modules/node/bin/node";
const PLAYWRIGHT_ROOT =
  "/Users/torben/codes/0xkey-workspace/.work/iterations/0xkey-v2026.09.0/workspace/repos/web/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core";
const TYPESCRIPT_PATH =
  "/Users/torben/codes/0xkey-workspace/.work/oauth-turnkey-parity/sdk-js/node_modules/.pnpm/typescript@5.4.3/node_modules/typescript/lib/typescript.js";
const BROWSER_PATH =
  "/Users/torben/codes/0xkey-workspace/.work/oauth-turnkey-parity/browser-runtime-20260923/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const SOURCE_PATH = path.resolve(
  __dirname,
  "../../utils/oauth/transaction-store.ts",
);
const PINNED = new Map([
  [
    NODE_PATH,
    "53dc65febda99ecaafe692de5ec60efdc2f7bd4fb14d1ba8cd30dc2af103953f",
  ],
  [
    path.join(PLAYWRIGHT_ROOT, "package.json"),
    "759e376f995bf39edd4810d699b99469bab1d7428b6fbc78d41912f367df7ba9",
  ],
  [
    path.join(PLAYWRIGHT_ROOT, "browsers.json"),
    "ee39bc924bc3d1bd895626c2910f1292d109bbfeeb5abd113acb45e1951cc942",
  ],
  [
    path.join(PLAYWRIGHT_ROOT, "index.js"),
    "a58fb2cec4293e7dcf73c58a179898a4f3986666451a19da4e731fa3af63265b",
  ],
  [
    path.join(PLAYWRIGHT_ROOT, "lib/coreBundle.js"),
    "6be5c2ea035554e9b184b1dbc7aa5e7f1fb428dd1b5c202022858dcfae9bee27",
  ],
  [
    BROWSER_PATH,
    "11e393326c7d20a7c56641a7c65def33ea9c280da3b0b74cf8563b07989a0ee3",
  ],
  [
    TYPESCRIPT_PATH,
    "d11c5c5a6f68774af19d1fc9d2c9aa3bb179d0bb2a78458a1ccf16638614443e",
  ],
]);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseArguments() {
  const allowed = new Set(["--run-dir", "--mode"]);
  const result = {};
  for (const item of process.argv.slice(2)) {
    const separator = item.indexOf("=");
    assert.notEqual(separator, -1, "runner arguments use --name=value");
    const key = item.slice(0, separator);
    assert(allowed.has(key), `unexpected runner argument: ${key}`);
    assert.equal(result[key], undefined, `duplicate runner argument: ${key}`);
    result[key] = item.slice(separator + 1);
  }
  assert.ok(result["--run-dir"], "--run-dir is required");
  assert.ok(
    ["red", "green", "cleanup-fault"].includes(result["--mode"]),
    "--mode is red, green, or cleanup-fault",
  );
  return { runDir: result["--run-dir"], mode: result["--mode"] };
}

function assertOwnedRunDirectory(runDir) {
  const resolved = fs.realpathSync(runDir);
  assert.equal(resolved, runDir);
  assert.match(path.basename(runDir), /^oxkey-oauth-idb-[A-Za-z0-9]+$/);
  assert.equal(path.dirname(runDir), "/private/tmp");
  const stat = fs.lstatSync(runDir);
  assert.ok(stat.isDirectory());
  assert.ok(!stat.isSymbolicLink());
  assert.equal(stat.uid, process.getuid());
  assert.equal(stat.mode & 0o777, 0o700);
  for (const child of ["profile", "tmp", "evidence"]) {
    const childPath = path.join(runDir, child);
    const childStat = fs.lstatSync(childPath);
    assert.ok(childStat.isDirectory());
    assert.ok(!childStat.isSymbolicLink());
    assert.equal(childStat.uid, process.getuid());
    assert.equal(childStat.mode & 0o777, 0o700);
    assert.deepEqual(
      fs.readdirSync(childPath),
      [],
      `${child} must be fresh and empty`,
    );
  }
}

function writeExclusive(file, contents) {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function syncExistingFile(file) {
  const fd = fs.openSync(file, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function createRecorder(runDir, mode) {
  const runLabel = `${mode}-1`;
  const evidencePath = path.join(
    runDir,
    "evidence",
    `${runLabel}-observations.jsonl`,
  );
  const rawPath = path.join(runDir, "evidence", `${runLabel}-raw.log`);
  writeExclusive(evidencePath, "");
  writeExclusive(rawPath, "");
  const started = Date.now();
  const record = (value) => {
    const safe = {
      caseId: value.caseId,
      page: value.page ?? "runner",
      phase: value.phase,
      result: value.result,
      reason: value.reason ?? null,
      counts: value.counts ?? null,
      elapsedMs: Date.now() - started,
    };
    fs.appendFileSync(evidencePath, `${JSON.stringify(safe)}\n`, {
      mode: 0o600,
    });
    const line = `${safe.caseId}: ${safe.result}${safe.reason ? ` (${safe.reason})` : ""}`;
    fs.appendFileSync(rawPath, `${line}\n`, { mode: 0o600 });
    process.stdout.write(`${line}\n`);
  };
  return { evidencePath, rawPath, record, runLabel };
}

function verifyRuntimePins(record) {
  for (const [file, expected] of PINNED) {
    const stat = fs.lstatSync(file);
    assert.ok(stat.isFile(), `runtime pin is not a regular file: ${file}`);
    assert.ok(!stat.isSymbolicLink(), `runtime pin is a symlink: ${file}`);
    assert.equal(
      sha256(fs.readFileSync(file)),
      expected,
      `runtime pin mismatch: ${file}`,
    );
  }
  assert.ok(
    (fs.statSync(BROWSER_PATH).mode & 0o111) !== 0,
    "browser is not executable",
  );
  record({ caseId: "runtime-pins", phase: "prelaunch", result: "matched" });
}

function inventoryLoadedSupport(runDir, record) {
  const inventory = Object.keys(require.cache)
    .filter(
      (file) =>
        file.startsWith(PLAYWRIGHT_ROOT) ||
        file === TYPESCRIPT_PATH ||
        file.includes("/fsevents@"),
    )
    .sort()
    .map((file) => ({ file, sha256: sha256(fs.readFileSync(file)) }));
  assert.ok(
    inventory.some(
      (entry) => entry.file === path.join(PLAYWRIGHT_ROOT, "index.js"),
    ),
  );
  assert.ok(inventory.some((entry) => entry.file === TYPESCRIPT_PATH));
  writeExclusive(
    path.join(runDir, "evidence", "loaded-support.json"),
    `${JSON.stringify(inventory, null, 2)}\n`,
  );
  record({
    caseId: "support-closure",
    phase: "prelaunch",
    result: "inventoried",
    counts: { files: inventory.length },
  });
}

function compileCandidate(ts, runDir, record) {
  const source = fs.readFileSync(SOURCE_PATH, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      strict: true,
    },
    fileName: SOURCE_PATH,
    reportDiagnostics: true,
  });
  const diagnostics = output.diagnostics ?? [];
  assert.equal(
    diagnostics.length,
    0,
    "candidate transpilation diagnostics must be empty",
  );
  assert.doesNotMatch(
    output.outputText,
    /(?:^|\n)\s*import\s|\bimport\s*\(/,
    "candidate has a runtime import",
  );
  const hashes = {
    sourcePath: SOURCE_PATH,
    sourceSha256: sha256(source),
    servedSha256: sha256(output.outputText),
  };
  writeExclusive(
    path.join(runDir, "evidence", "candidate-hashes.json"),
    `${JSON.stringify(hashes, null, 2)}\n`,
  );
  record({ caseId: "candidate-bytes", phase: "prelaunch", result: "hashed" });
  return { source, served: output.outputText, hashes };
}

function startServer(servedModule, record) {
  const html =
    "<!doctype html><meta charset=utf-8><title>owned oauth idb fixture</title>";
  const server = http.createServer((request, response) => {
    const expectedHost = `127.0.0.1:${server.address().port}`;
    if (request.method !== "GET" || request.headers.host !== expectedHost) {
      response.writeHead(400, {
        "content-type": "text/plain",
        "cache-control": "no-store",
      });
      response.end("rejected");
      return;
    }
    const requestUrl = new URL(request.url, `http://${expectedHost}`);
    const headers = {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    };
    if (
      requestUrl.pathname === "/page.html" ||
      requestUrl.pathname === "/cleanup.html"
    ) {
      response.writeHead(200, {
        ...headers,
        "content-type": "text/html; charset=utf-8",
      });
      response.end(html);
      return;
    }
    if (requestUrl.pathname === "/transaction-store.js") {
      response.writeHead(200, {
        ...headers,
        "content-type": "text/javascript; charset=utf-8",
      });
      response.end(servedModule);
      return;
    }
    response.writeHead(404, { ...headers, "content-type": "text/plain" });
    response.end("not found");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.equal(typeof address, "object");
      const origin = `http://127.0.0.1:${address.port}`;
      record({ caseId: "owned-origin", phase: "listen", result: "ready" });
      resolve({ server, origin });
    });
  });
}

const binding = Object.freeze({
  organizationId: "org_fixture",
  configId: "config_fixture",
  apiBaseUrl: "https://api.fixture.test/",
  authProxyUrl: "https://auth.fixture.test/",
  provider: "x",
  clientId: "client_fixture",
  redirectUri: "https://app.fixture.test/callback?fixed=one&fixed=two",
  route: Object.freeze({
    origin: "https://app.fixture.test",
    pathname: "/callback",
    staticQuery: Object.freeze([
      Object.freeze(["fixed", "one"]),
      Object.freeze(["fixed", "two"]),
    ]),
  }),
  completion: Object.freeze({ kind: "synthetic", targetId: "target_fixture" }),
});

function inputFor(keyRef, suffix = "base") {
  return {
    expectedState: `opaque-state-${suffix}`,
    binding: structuredClone(binding),
    keyRef,
    verifier: `verifier-${suffix}`,
  };
}

async function initializeDatabase(page, databaseName) {
  await page.evaluate(async (name) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("transactions", { keyPath: "id" });
        db.createObjectStore("synthetic-keys");
      };
      request.onerror = () => reject(new Error("fixture-open-failed"));
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
  }, databaseName);
}

async function installRealm(page, origin, databaseName, label) {
  return page.evaluate(
    async ({ moduleUrl, databaseName: name, label: realmLabel }) => {
      const module = await import(moduleUrl);
      const harness = {
        module,
        databaseName: name,
        label: realmLabel,
        sentinel: crypto.randomUUID(),
        stores: new Map(),
        handles: new Map(),
        discardEvents: [],
        claimGates: new Map(),
        claimReady: new Set(),
      };
      const open = () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open(name, 1);
          request.onerror = () => reject(new Error("fixture-open-failed"));
          request.onsuccess = () => resolve(request.result);
        });
      harness.putKey = async (keyRef) => {
        const pair = await crypto.subtle.generateKey(
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign", "verify"],
        );
        const db = await open();
        await new Promise((resolve, reject) => {
          const tx = db.transaction("synthetic-keys", "readwrite");
          tx.objectStore("synthetic-keys").put(pair.privateKey, keyRef);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(new Error("fixture-key-write-failed"));
          tx.onabort = () => reject(new Error("fixture-key-write-aborted"));
        });
        db.close();
      };
      harness.hasKey = async (keyRef, sign = false) => {
        const db = await open();
        const key = await new Promise((resolve, reject) => {
          const tx = db.transaction("synthetic-keys", "readonly");
          const request = tx.objectStore("synthetic-keys").get(keyRef);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(new Error("fixture-key-read-failed"));
        });
        db.close();
        if (!key) return false;
        if (sign)
          await crypto.subtle.sign(
            { name: "ECDSA", hash: "SHA-256" },
            key,
            new Uint8Array([1, 2, 3]),
          );
        return true;
      };
      harness.readRecord = async (id) => {
        const db = await open();
        const value = await new Promise((resolve, reject) => {
          const tx = db.transaction("transactions", "readonly");
          const request = tx.objectStore("transactions").get(id);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () =>
            reject(new Error("fixture-record-read-failed"));
        });
        db.close();
        return value;
      };
      harness.writeRecord = async (record) => {
        const db = await open();
        await new Promise((resolve, reject) => {
          const tx = db.transaction("transactions", "readwrite");
          tx.objectStore("transactions").put(record);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(new Error("fixture-record-write-failed"));
          tx.onabort = () => reject(new Error("fixture-record-write-aborted"));
        });
        db.close();
      };
      harness.deleteRecord = async (id) => {
        const db = await open();
        await new Promise((resolve, reject) => {
          const tx = db.transaction("transactions", "readwrite");
          tx.objectStore("transactions").delete(id);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(new Error("fixture-record-delete-failed"));
        });
        db.close();
      };
      globalThis.__oauthIdbHarness = harness;
      return { sentinel: harness.sentinel, origin: location.origin };
    },
    {
      moduleUrl: `${origin}/transaction-store.js?realm=${encodeURIComponent(label)}`,
      databaseName,
      label,
    },
  );
}

async function makeStore(page, name, options = {}) {
  return page.evaluate(
    ({ name: storeName, options: settings }) => {
      const harness = globalThis.__oauthIdbHarness;
      const queue = (settings.randomHex ?? []).map((value) =>
        Uint8Array.from(
          value.match(/../g).map((part) => Number.parseInt(part, 16)),
        ),
      );
      const owner = {
        label: settings.ownerLabel ?? storeName,
        nowValue: settings.now ?? 1_700_000_000_000,
        failures: settings.cleanupFailures ?? 0,
        now() {
          if (settings.nowThrows) throw new Error("synthetic-clock-throw");
          return this.nowValue;
        },
        randomBytes() {
          if (settings.randomThrows) throw new Error("synthetic-random-throw");
          if (settings.randomLength !== undefined)
            return new Uint8Array(settings.randomLength);
          if (queue.length > 0) return queue.shift();
          return crypto.getRandomValues(new Uint8Array(16));
        },
        async discardFreshKey(keyRef) {
          harness.discardEvents.push({ owner: this.label, keyRef });
          if (this.failures > 0) {
            this.failures -= 1;
            throw new Error("synthetic-discard-failure");
          }
          const request = indexedDB.open(harness.databaseName, 1);
          const db = await new Promise((resolve, reject) => {
            request.onerror = () =>
              reject(new Error("fixture-discard-open-failed"));
            request.onsuccess = () => resolve(request.result);
          });
          await new Promise((resolve, reject) => {
            const tx = db.transaction("synthetic-keys", "readwrite");
            tx.objectStore("synthetic-keys").delete(keyRef);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(new Error("fixture-discard-failed"));
            tx.onabort = () => reject(new Error("fixture-discard-aborted"));
          });
          db.close();
        },
      };
      const store = harness.module.createOAuthTransactionStore({
        databaseName: harness.databaseName,
        now: owner.now.bind(owner),
        randomBytes: owner.randomBytes.bind(owner),
        discardFreshKey: owner.discardFreshKey.bind(owner),
      });
      harness.stores.set(storeName, { store, owner });
      return true;
    },
    { name, options },
  );
}

async function callCreate(page, storeName, input, handleName) {
  return page.evaluate(
    async ({ storeName: name, input: value, handleName: handle }) => {
      const harness = globalThis.__oauthIdbHarness;
      try {
        const created = await harness.stores.get(name).store.create(value);
        harness.handles.set(handle, created);
        return { ok: true, transactionId: created.transactionId };
      } catch (error) {
        return {
          ok: false,
          reason:
            error && typeof error.reason === "string"
              ? error.reason
              : "unbounded",
        };
      }
    },
    { storeName, input, handleName },
  );
}

async function callClaim(
  page,
  storeName,
  transactionId,
  returnedState,
  claimBinding = binding,
) {
  return page.evaluate(
    async ({
      storeName: name,
      transactionId: id,
      returnedState: state,
      binding: trustedBinding,
    }) => {
      const harness = globalThis.__oauthIdbHarness;
      try {
        const claimed = await harness.stores.get(name).store.claim({
          transactionId: id,
          returnedState: state,
          binding: trustedBinding,
        });
        return {
          ok: true,
          claimed,
          frozen:
            Object.isFrozen(claimed) &&
            Object.isFrozen(claimed.binding) &&
            Object.isFrozen(claimed.binding.route),
        };
      } catch (error) {
        return {
          ok: false,
          reason:
            error && typeof error.reason === "string"
              ? error.reason
              : "unbounded",
        };
      }
    },
    { storeName, transactionId, returnedState, binding: claimBinding },
  );
}

function redirectBinding() {
  const value = structuredClone(binding);
  value.completion = { kind: "redirect" };
  return value;
}

async function callProductionCreate(page, input) {
  return page.evaluate(async (value) => {
    const harness = globalThis.__oauthIdbHarness;
    const databaseName = harness.module.OAUTH_TRANSACTION_DATABASE_NAME;
    const reportedName =
      typeof databaseName === "string" ? databaseName : null;
    try {
      const store = harness.module.createOAuthTransactionStore({
        databaseName,
        now: () => 1_700_000_000_000,
        randomBytes: () => crypto.getRandomValues(new Uint8Array(16)),
        async discardFreshKey() {},
      });
      const created = await store.create(value);
      return {
        ok: true,
        transactionId: created.transactionId,
        databaseName: reportedName,
      };
    } catch (error) {
      return {
        ok: false,
        reason:
          error && typeof error.reason === "string" ? error.reason : "unbounded",
        databaseName: reportedName,
      };
    }
  }, input);
}

async function callProductionClaimReturned(page, returnedState) {
  return page.evaluate(
    async ({ returnedState: state, binding: trustedBinding }) => {
      const harness = globalThis.__oauthIdbHarness;
      try {
        const databaseName = harness.module.OAUTH_TRANSACTION_DATABASE_NAME;
        const store = harness.module.createOAuthTransactionStore({
          databaseName,
          now: () => 1_700_000_000_000,
          randomBytes: () => crypto.getRandomValues(new Uint8Array(16)),
          async discardFreshKey() {},
        });
        const claimed = await store.claimReturned({
          returnedState: state,
          binding: trustedBinding,
        });
        return {
          ok: true,
          claimed,
          frozen: Object.isFrozen(claimed) && Object.isFrozen(claimed.binding),
        };
      } catch (error) {
        return {
          ok: false,
          reason:
            error && typeof error.reason === "string"
              ? error.reason
              : "unbounded",
        };
      }
    },
    { returnedState, binding: redirectBinding() },
  );
}

async function callClaimReturned(page, storeName, returnedState) {
  return page.evaluate(
    async ({
      storeName: name,
      returnedState: state,
      binding: trustedBinding,
    }) => {
      const harness = globalThis.__oauthIdbHarness;
      try {
        const claimed = await harness.stores.get(name).store.claimReturned({
          returnedState: state,
          binding: trustedBinding,
        });
        return {
          ok: true,
          claimed,
          frozen:
            Object.isFrozen(claimed) &&
            Object.isFrozen(claimed.binding) &&
            Object.isFrozen(claimed.binding.route),
        };
      } catch (error) {
        return {
          ok: false,
          reason:
            error && typeof error.reason === "string"
              ? error.reason
              : "unbounded",
        };
      }
    },
    { storeName, returnedState, binding },
  );
}

async function prepareBarrierClaim(
  page,
  storeName,
  transactionId,
  returnedState,
  gateName,
) {
  const outcome = page.evaluate(
    async ({
      storeName: name,
      transactionId: id,
      returnedState: state,
      gate,
      trustedBinding,
    }) => {
      const harness = globalThis.__oauthIdbHarness;
      const release = new Promise((resolve) => {
        harness.claimGates.set(gate, resolve);
      });
      harness.claimReady.add(gate);
      await release;
      try {
        const claimed = await harness.stores.get(name).store.claim({
          transactionId: id,
          returnedState: state,
          binding: trustedBinding,
        });
        return { ok: true, claimed, frozen: Object.isFrozen(claimed) };
      } catch (error) {
        return {
          ok: false,
          reason:
            error && typeof error.reason === "string"
              ? error.reason
              : "unbounded",
        };
      }
    },
    {
      storeName,
      transactionId,
      returnedState,
      gate: gateName,
      trustedBinding: binding,
    },
  );
  await page.waitForFunction(
    (gate) => globalThis.__oauthIdbHarness.claimReady.has(gate),
    gateName,
  );
  return {
    outcome,
    release: () =>
      page.evaluate((gate) => {
        const harness = globalThis.__oauthIdbHarness;
        const releaseGate = harness.claimGates.get(gate);
        if (typeof releaseGate !== "function")
          throw new Error("claim-barrier-missing");
        harness.claimGates.delete(gate);
        releaseGate();
      }, gateName),
  };
}

async function callCancel(page, handleName, cleanup = false) {
  return page.evaluate(
    async ({ handleName: name, cleanup: shouldCleanup }) => {
      const harness = globalThis.__oauthIdbHarness;
      try {
        const result = await harness.handles.get(name).cancel();
        if (shouldCleanup && result.kind === "cancelled")
          await result.cleanup();
        if (result.kind === "cancelled")
          harness.handles.set(`${name}:cleanup`, result.cleanup);
        return { ok: true, kind: result.kind };
      } catch (error) {
        return {
          ok: false,
          reason:
            error && typeof error.reason === "string"
              ? error.reason
              : "unbounded",
        };
      }
    },
    { handleName, cleanup },
  );
}

async function cleanupCall(page, handleName) {
  return page.evaluate(async (name) => {
    try {
      await globalThis.__oauthIdbHarness.handles.get(`${name}:cleanup`)();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason:
          error && typeof error.reason === "string"
            ? error.reason
            : "unbounded",
      };
    }
  }, handleName);
}

async function runMatrix(context, origin, databaseName, record) {
  const pageA = context.pages()[0] ?? (await context.newPage());
  let pageB = await context.newPage();
  await Promise.all([
    pageA.goto(`${origin}/page.html`),
    pageB.goto(`${origin}/page.html`),
  ]);
  await initializeDatabase(pageA, databaseName);
  const [realmA, realmB] = await Promise.all([
    installRealm(pageA, origin, databaseName, "A"),
    installRealm(pageB, origin, databaseName, "B"),
  ]);
  assert.equal(realmA.origin, origin);
  assert.equal(realmB.origin, origin);
  assert.notEqual(realmA.sentinel, realmB.sentinel);
  record({
    caseId: "independent-realms",
    page: "A+B",
    phase: "ready",
    result: "passed",
  });
  await Promise.all([makeStore(pageA, "A"), makeStore(pageB, "B")]);

  const productionInput = {
    expectedState: "opaque-state-production",
    binding: redirectBinding(),
    keyRef: "prod_key_a",
    verifier: "verifier-production",
  };
  const productionCreated = await callProductionCreate(pageA, productionInput);
  record({
    caseId: "production-database-redirect-claim",
    page: "A",
    phase: "observed",
    result: productionCreated.ok ? "created" : "rejected",
    reason: productionCreated.ok ? null : productionCreated.reason,
    counts: { databaseName: productionCreated.databaseName ?? null },
  });
  assert.equal(productionCreated.ok, true);
  const productionClaimed = await callProductionClaimReturned(
    pageB,
    productionInput.expectedState,
  );
  assert.equal(productionClaimed.ok, true);
  assert.equal(productionClaimed.claimed.verifier, productionInput.verifier);
  assert.equal(
    productionClaimed.claimed.transactionId,
    productionCreated.transactionId,
  );
  assert.equal(productionClaimed.claimed.binding.completion.kind, "redirect");
  assert.equal(productionClaimed.frozen, true);
  const productionRepeated = await callProductionClaimReturned(
    pageA,
    productionInput.expectedState,
  );
  assert.equal(productionRepeated.ok, false);
  assert.equal(productionRepeated.reason, "unavailable");
  record({
    caseId: "production-database-redirect-claim",
    page: "B",
    phase: "committed",
    result: "passed",
  });

  const coldA = inputFor("cold_key_a", "cold-a");
  const coldB = inputFor("cold_key_b", "cold-b");
  await pageA.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    coldA.keyRef,
  );
  await pageA.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    coldB.keyRef,
  );
  const createdColdA = await callCreate(pageA, "A", coldA, "cold-a");
  const createdColdB = await callCreate(pageA, "A", coldB, "cold-b");
  assert.equal(createdColdA.ok, true);
  assert.equal(createdColdB.ok, true);
  const recovered = await callClaimReturned(pageB, "B", coldA.expectedState);
  record({
    caseId: "cold-claim-by-returned-state",
    page: "B",
    phase: "observed",
    result: recovered.ok ? "claimed" : "rejected",
    reason: recovered.ok ? null : recovered.reason,
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.claimed.verifier, coldA.verifier);
  assert.equal(recovered.claimed.transactionId, createdColdA.transactionId);
  assert.equal(recovered.frozen, true);
  const repeated = await callClaimReturned(pageA, "A", coldA.expectedState);
  assert.equal(repeated.ok, false);
  assert.equal(repeated.reason, "unavailable");
  const other = await callClaimReturned(pageB, "B", coldB.expectedState);
  assert.equal(other.ok, true);
  assert.equal(other.claimed.verifier, coldB.verifier);
  assert.equal(other.claimed.transactionId, createdColdB.transactionId);
  record({
    caseId: "cold-claim-by-returned-state",
    page: "B",
    phase: "committed",
    result: "passed",
  });

  let raceExchanges = 0;
  const syntheticExchange = async (claimed) => {
    assert.equal(claimed.kind, "claimed");
    raceExchanges += 1;
  };
  const raceWinners = [];
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const keyRef = `race_key_${iteration}`;
    await pageA.evaluate(
      (key) => globalThis.__oauthIdbHarness.putKey(key),
      keyRef,
    );
    const input = inputFor(keyRef, `race-${iteration}`);
    const created = await callCreate(pageA, "A", input, `race-${iteration}`);
    assert.equal(created.ok, true);
    const visible = await pageB.evaluate(async (id) => {
      const record = await globalThis.__oauthIdbHarness.readRecord(id);
      return record
        ? {
            id: record.id,
            expectedState: record.expectedState,
            keyRef: record.keyRef,
            generation: record.generation,
          }
        : null;
    }, created.transactionId);
    assert.equal(visible.id, created.transactionId);
    assert.equal(visible.expectedState, input.expectedState);
    assert.equal(visible.keyRef, input.keyRef);
    assert.match(visible.generation, /^[0-9a-f]{32}$/);
    const participants =
      iteration % 2 === 0
        ? [
            { page: pageA, store: "A", label: "A" },
            { page: pageB, store: "B", label: "B" },
          ]
        : [
            { page: pageB, store: "B", label: "B" },
            { page: pageA, store: "A", label: "A" },
          ];
    const prepared = await Promise.all(
      participants.map((participant) =>
        prepareBarrierClaim(
          participant.page,
          participant.store,
          created.transactionId,
          input.expectedState,
          `race-${iteration}-${participant.label}`,
        ),
      ),
    );
    await Promise.all(prepared.map((claim) => claim.release()));
    const claims = await Promise.all(prepared.map((claim) => claim.outcome));
    assert.equal(claims.filter((value) => value.ok).length, 1);
    assert.equal(
      claims.filter((value) => !value.ok && value.reason === "unavailable")
        .length,
      1,
    );
    const winnerIndex = claims.findIndex((value) => value.ok);
    const winner = claims[winnerIndex];
    raceWinners.push(participants[winnerIndex].label);
    assert.equal(winner.frozen, true);
    await syntheticExchange(winner.claimed);
  }
  const [raceDiscardsA, raceDiscardsB] = await Promise.all([
    pageA.evaluate(() => globalThis.__oauthIdbHarness.discardEvents.length),
    pageB.evaluate(() => globalThis.__oauthIdbHarness.discardEvents.length),
  ]);
  assert.equal(raceExchanges, 6);
  assert.equal(raceDiscardsA, 0);
  assert.equal(raceDiscardsB, 0);
  record({
    caseId: "two-page-claim-race",
    page: "A+B",
    phase: "committed",
    result: "passed",
    counts: {
      iterations: 6,
      winners: 6,
      exchanges: raceExchanges,
      loserCleanupA: raceDiscardsA,
      loserCleanupB: raceDiscardsB,
      winnerA: raceWinners.filter((label) => label === "A").length,
      winnerB: raceWinners.filter((label) => label === "B").length,
      winnerSequence: raceWinners,
    },
  });

  const isolationA = inputFor("isolation_key_a", "isolation-a");
  const isolationB = inputFor("isolation_key_b", "isolation-b");
  await Promise.all([
    pageA.evaluate(
      (key) => globalThis.__oauthIdbHarness.putKey(key),
      isolationA.keyRef,
    ),
    pageA.evaluate(
      (key) => globalThis.__oauthIdbHarness.putKey(key),
      isolationB.keyRef,
    ),
    pageA.evaluate(
      (key) => globalThis.__oauthIdbHarness.putKey(key),
      "unrelated_sentinel",
    ),
  ]);
  const createdA = await callCreate(pageA, "A", isolationA, "isolation-a");
  const createdB = await callCreate(pageA, "A", isolationB, "isolation-b");
  const wrongState = await callClaim(
    pageB,
    "B",
    createdA.transactionId,
    "wrong-state",
  );
  assert.deepEqual(wrongState, { ok: false, reason: "state-mismatch" });
  const wrongBinding = structuredClone(binding);
  wrongBinding.provider = "discord";
  const mismatch = await callClaim(
    pageB,
    "B",
    createdA.transactionId,
    isolationA.expectedState,
    wrongBinding,
  );
  assert.deepEqual(mismatch, { ok: false, reason: "binding-mismatch" });
  const unknown = await callClaim(
    pageB,
    "B",
    "f".repeat(32),
    isolationA.expectedState,
  );
  assert.deepEqual(unknown, { ok: false, reason: "unavailable" });
  assert.equal(
    (
      await callClaim(
        pageB,
        "B",
        createdA.transactionId,
        isolationA.expectedState,
      )
    ).ok,
    true,
  );
  assert.equal(
    Boolean(
      await pageB.evaluate(
        (id) => globalThis.__oauthIdbHarness.readRecord(id),
        createdB.transactionId,
      ),
    ),
    true,
  );
  assert.equal(
    await pageB.evaluate(() =>
      globalThis.__oauthIdbHarness.hasKey("unrelated_sentinel", true),
    ),
    true,
  );
  record({
    caseId: "isolation",
    page: "A+B",
    phase: "observed",
    result: "passed",
    counts: { secretDeliveriesOnMismatch: 0, exchangesOnMismatch: 0 },
  });

  const invalidInputs = [
    {},
    { ...inputFor("bad_key", "missing"), verifier: undefined },
    { ...inputFor("bad_key", "extra"), extra: true },
    { ...inputFor("bad key", "label") },
    {
      ...inputFor("bad_key", "provider"),
      binding: { ...structuredClone(binding), provider: "google" },
    },
    {
      ...inputFor("bad_key", "query"),
      binding: {
        ...structuredClone(binding),
        route: {
          ...structuredClone(binding.route),
          staticQuery: [
            ["fixed", "two"],
            ["fixed", "one"],
          ],
        },
      },
    },
    { ...inputFor("bad_key", "scalar"), expectedState: 4 },
    { ...inputFor("bad_key", "object"), binding: [] },
    {
      ...inputFor("bad_key", "array"),
      binding: {
        ...structuredClone(binding),
        route: { ...structuredClone(binding.route), staticQuery: {} },
      },
    },
    {
      ...inputFor("bad_key", "duplicate"),
      binding: {
        ...structuredClone(binding),
        route: {
          ...structuredClone(binding.route),
          staticQuery: [["fixed", "one"]],
        },
      },
    },
    {
      ...inputFor("bad_key", "forbidden"),
      binding: {
        ...structuredClone(binding),
        redirectUri: "https://app.fixture.test/callback?state=x",
        route: {
          origin: "https://app.fixture.test",
          pathname: "/callback",
          staticQuery: [["state", "x"]],
        },
      },
    },
    {
      ...inputFor("bad_key", "uri"),
      binding: {
        ...structuredClone(binding),
        apiBaseUrl: "https://api.fixture.test:443/",
      },
    },
  ];
  for (const [index, invalid] of invalidInputs.entries()) {
    const outcome = await callCreate(pageA, "A", invalid, `invalid-${index}`);
    assert.deepEqual(outcome, { ok: false, reason: "invalid-input" });
  }
  const descriptorInput = inputFor("descriptor_key", "descriptor");
  await pageA.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    descriptorInput.keyRef,
  );
  const descriptorCreated = await callCreate(
    pageA,
    "A",
    descriptorInput,
    "descriptor-valid",
  );
  assert.equal(descriptorCreated.ok, true);
  const descriptorOutcomes = await pageA.evaluate(
    async ({ validInput, transactionId }) => {
      const harness = globalThis.__oauthIdbHarness;
      const store = harness.stores.get("A").store;
      const cases = [
        "outer-accessor",
        "pair-accessor",
        "outer-hidden-extra",
        "pair-hidden-extra",
        "outer-sparse",
        "pair-sparse",
        "outer-accessor-throws",
        "pair-accessor-throws",
      ];
      const makeQuery = (kind) => {
        const first = ["fixed", "one"];
        const second = ["fixed", "two"];
        if (kind === "pair-accessor") {
          Object.defineProperty(first, "0", {
            enumerable: true,
            configurable: true,
            get: () => "fixed",
          });
        } else if (kind === "pair-accessor-throws") {
          Object.defineProperty(first, "0", {
            enumerable: true,
            configurable: true,
            get: () => {
              throw new Error("forbidden-pair-getter");
            },
          });
        } else if (kind === "pair-hidden-extra") {
          Object.defineProperty(first, "hidden", { value: true });
        } else if (kind === "pair-sparse") {
          delete first[1];
        }
        if (kind === "outer-accessor") {
          const query = [];
          Object.defineProperty(query, "0", {
            enumerable: true,
            configurable: true,
            get: () => first,
          });
          query[1] = second;
          return query;
        }
        if (kind === "outer-accessor-throws") {
          const query = [];
          Object.defineProperty(query, "0", {
            enumerable: true,
            configurable: true,
            get: () => {
              throw new Error("forbidden-outer-getter");
            },
          });
          query[1] = second;
          return query;
        }
        const query = [first, second];
        if (kind === "outer-hidden-extra")
          Object.defineProperty(query, "hidden", { value: true });
        if (kind === "outer-sparse") delete query[1];
        return query;
      };
      const invoke = async (kind, operation) => {
        const value = structuredClone(validInput);
        value.binding.route.staticQuery = makeQuery(kind);
        try {
          if (operation === "create") await store.create(value);
          else
            await store.claim({
              transactionId,
              returnedState: validInput.expectedState,
              binding: value.binding,
            });
          return { kind, ok: true };
        } catch (error) {
          return {
            kind,
            ok: false,
            reason:
              error && typeof error.reason === "string"
                ? error.reason
                : "unbounded",
          };
        }
      };
      return {
        create: await Promise.all(cases.map((kind) => invoke(kind, "create"))),
        claim: await Promise.all(cases.map((kind) => invoke(kind, "claim"))),
      };
    },
    {
      validInput: descriptorInput,
      transactionId: descriptorCreated.transactionId,
    },
  );
  for (const operation of ["create", "claim"])
    for (const outcome of descriptorOutcomes[operation])
      assert.deepEqual(outcome, {
        kind: outcome.kind,
        ok: false,
        reason: "invalid-input",
      });
  assert.ok(
    await pageB.evaluate(
      (id) => globalThis.__oauthIdbHarness.readRecord(id),
      descriptorCreated.transactionId,
    ),
  );
  const bindingVariants = [
    { organizationId: "other_org" },
    { configId: "other_config" },
    { clientId: "other_client" },
    { apiBaseUrl: "https://other-api.fixture.test/" },
    { authProxyUrl: "https://other-auth.fixture.test/" },
    {
      redirectUri: "https://app.fixture.test/other?fixed=one&fixed=two",
      route: { ...structuredClone(binding.route), pathname: "/other" },
    },
    {
      redirectUri: "https://app.fixture.test/callback?fixed=one&fixed=three",
      route: {
        ...structuredClone(binding.route),
        staticQuery: [
          ["fixed", "one"],
          ["fixed", "three"],
        ],
      },
    },
    { completion: { kind: "synthetic", targetId: "other_target" } },
  ];
  for (const variant of bindingVariants) {
    assert.deepEqual(
      await callClaim(
        pageB,
        "B",
        descriptorCreated.transactionId,
        descriptorInput.expectedState,
        { ...structuredClone(binding), ...variant },
      ),
      { ok: false, reason: "binding-mismatch" },
    );
    assert.ok(
      await pageB.evaluate(
        (id) => globalThis.__oauthIdbHarness.readRecord(id),
        descriptorCreated.transactionId,
      ),
    );
  }
  assert.deepEqual(
    await callClaim(
      pageB,
      "B",
      descriptorCreated.transactionId,
      descriptorInput.expectedState,
      {
        ...structuredClone(binding),
        redirectUri: "https://app.fixture.test/other?fixed=one&fixed=two",
      },
    ),
    { ok: false, reason: "invalid-input" },
  );
  assert.ok(
    await pageB.evaluate(
      (id) => globalThis.__oauthIdbHarness.readRecord(id),
      descriptorCreated.transactionId,
    ),
  );
  const claimMutation = await pageB.evaluate(
    async ({ id, state, trustedBinding }) => {
      const entry = globalThis.__oauthIdbHarness.stores.get("B");
      const input = {
        transactionId: id,
        returnedState: state,
        binding: trustedBinding,
      };
      const pending = entry.store.claim(input);
      input.returnedState = "changed";
      input.binding.clientId = "changed";
      const claimed = await pending;
      return { keyRef: claimed.keyRef, clientId: claimed.binding.clientId };
    },
    {
      id: descriptorCreated.transactionId,
      state: descriptorInput.expectedState,
      trustedBinding: structuredClone(binding),
    },
  );
  assert.deepEqual(claimMutation, {
    keyRef: descriptorInput.keyRef,
    clientId: binding.clientId,
  });
  const clockClaimInput = inputFor("clock_claim_key", "clock-claim");
  await pageA.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    clockClaimInput.keyRef,
  );
  const clockClaimCreated = await callCreate(
    pageA,
    "A",
    clockClaimInput,
    "clock-claim",
  );
  assert.equal(clockClaimCreated.ok, true);
  for (const [name, options] of [
    ["claim-clock-throw", { nowThrows: true }],
    ["claim-clock-fraction", { now: 1.5 }],
  ]) {
    await makeStore(pageB, name, options);
    assert.deepEqual(
      await callClaim(
        pageB,
        name,
        clockClaimCreated.transactionId,
        clockClaimInput.expectedState,
      ),
      { ok: false, reason: "clock-invalid" },
    );
    assert.ok(
      await pageA.evaluate(
        (id) => globalThis.__oauthIdbHarness.readRecord(id),
        clockClaimCreated.transactionId,
      ),
    );
    assert.equal(
      await pageA.evaluate(
        (key) => globalThis.__oauthIdbHarness.hasKey(key, true),
        clockClaimInput.keyRef,
      ),
      true,
    );
  }
  assert.equal(
    (
      await callClaim(
        pageB,
        "B",
        clockClaimCreated.transactionId,
        clockClaimInput.expectedState,
      )
    ).ok,
    true,
  );
  await makeStore(pageA, "boundary-accept", { now: 1_700_000_299_999 });
  await makeStore(pageB, "boundary-reject", { now: 1_700_000_300_000 });
  const boundaryOne = inputFor("boundary_key_one", "boundary-one");
  const boundaryTwo = inputFor("boundary_key_two", "boundary-two");
  await Promise.all([
    pageA.evaluate(
      (key) => globalThis.__oauthIdbHarness.putKey(key),
      boundaryOne.keyRef,
    ),
    pageA.evaluate(
      (key) => globalThis.__oauthIdbHarness.putKey(key),
      boundaryTwo.keyRef,
    ),
  ]);
  const boundaryCreatedOne = await callCreate(
    pageA,
    "A",
    boundaryOne,
    "boundary-one",
  );
  const boundaryCreatedTwo = await callCreate(
    pageA,
    "A",
    boundaryTwo,
    "boundary-two",
  );
  const recordOne = await pageA.evaluate(
    (id) => globalThis.__oauthIdbHarness.readRecord(id),
    boundaryCreatedOne.transactionId,
  );
  const recordTwo = await pageA.evaluate(
    (id) => globalThis.__oauthIdbHarness.readRecord(id),
    boundaryCreatedTwo.transactionId,
  );
  await pageA.evaluate(
    ({ one, two }) =>
      Promise.all([
        globalThis.__oauthIdbHarness.writeRecord(one),
        globalThis.__oauthIdbHarness.writeRecord(two),
      ]),
    {
      one: {
        ...recordOne,
        createdAtMs: 1_700_000_000_000,
        expiresAtMs: 1_700_000_300_000,
      },
      two: {
        ...recordTwo,
        createdAtMs: 1_700_000_000_000,
        expiresAtMs: 1_700_000_300_000,
      },
    },
  );
  assert.equal(
    (
      await callClaim(
        pageA,
        "boundary-accept",
        boundaryCreatedOne.transactionId,
        boundaryOne.expectedState,
      )
    ).ok,
    true,
  );
  assert.deepEqual(
    await callClaim(
      pageB,
      "boundary-reject",
      boundaryCreatedTwo.transactionId,
      boundaryTwo.expectedState,
    ),
    { ok: false, reason: "expired" },
  );
  const malformedInput = inputFor("malformed_key", "malformed");
  await pageA.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    malformedInput.keyRef,
  );
  const malformedCreated = await callCreate(
    pageA,
    "A",
    malformedInput,
    "malformed",
  );
  const malformedRecord = await pageA.evaluate(
    (id) => globalThis.__oauthIdbHarness.readRecord(id),
    malformedCreated.transactionId,
  );
  await pageA.evaluate(
    (value) =>
      globalThis.__oauthIdbHarness.writeRecord({ ...value, version: 2 }),
    malformedRecord,
  );
  assert.deepEqual(
    await callClaim(
      pageB,
      "B",
      malformedCreated.transactionId,
      malformedInput.expectedState,
    ),
    { ok: false, reason: "invalid-record" },
  );
  assert.equal(
    Boolean(
      await pageB.evaluate(
        (id) => globalThis.__oauthIdbHarness.readRecord(id),
        malformedCreated.transactionId,
      ),
    ),
    true,
  );
  assert.deepEqual(await callCancel(pageA, "malformed", false), {
    ok: false,
    reason: "invalid-record",
  });
  const invalidTimestamps = [
    { createdAtMs: 1_700_000_000 },
    { expiresAtMs: 1_700_000_000_000 },
    { createdAtMs: 1_700_000_300_001, expiresAtMs: 1_700_000_300_000 },
  ];
  for (const change of invalidTimestamps) {
    await pageA.evaluate(
      (record) => globalThis.__oauthIdbHarness.writeRecord(record),
      { ...malformedRecord, ...change },
    );
    assert.deepEqual(
      await callClaim(
        pageB,
        "B",
        malformedCreated.transactionId,
        malformedInput.expectedState,
      ),
      { ok: false, reason: "invalid-record" },
    );
  }
  await pageA.evaluate(
    (record) => globalThis.__oauthIdbHarness.writeRecord(record),
    { ...malformedRecord, version: 2 },
  );
  for (const [name, options, reason] of [
    ["clock-throw", { nowThrows: true }, "clock-invalid"],
    ["clock-fraction", { now: 1.5 }, "clock-invalid"],
    ["random-throw", { randomThrows: true }, "random-invalid"],
    ["random-short", { randomLength: 15 }, "random-invalid"],
    [
      "random-equal",
      { randomHex: ["a".repeat(32), "a".repeat(32)] },
      "random-invalid",
    ],
  ]) {
    await makeStore(pageA, name, options);
    assert.deepEqual(
      await callCreate(pageA, name, inputFor(`bad_${name}`, name), name),
      { ok: false, reason },
    );
  }
  const mutationInput = inputFor("mutation_key", "mutation");
  await pageA.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    mutationInput.keyRef,
  );
  const mutationResult = await pageA.evaluate(async (value) => {
    const harness = globalThis.__oauthIdbHarness;
    const entry = harness.stores.get("A");
    const createdPromise = entry.store.create(value);
    value.expectedState = "mutated-state";
    value.binding.clientId = "mutated_client";
    entry.owner.discardFreshKey = async (keyRef) => {
      harness.discardEvents.push({ owner: "replacement-owner", keyRef });
    };
    const created = await createdPromise;
    harness.handles.set("mutation", created);
    const record = await harness.readRecord(created.transactionId);
    return {
      transactionId: created.transactionId,
      expectedState: record.expectedState,
      clientId: record.binding.clientId,
    };
  }, mutationInput);
  assert.equal(mutationResult.expectedState, "opaque-state-mutation");
  assert.equal(mutationResult.clientId, "client_fixture");
  assert.deepEqual(await callCancel(pageA, "mutation", true), {
    ok: true,
    kind: "cancelled",
  });
  const mutationDiscard = await pageA.evaluate(() =>
    globalThis.__oauthIdbHarness.discardEvents.at(-1),
  );
  assert.equal(mutationDiscard.owner, "A");

  await makeStore(pageB, "rollback", { now: 1_699_999_999_999 });
  const rollbackInput = inputFor("rollback_key", "rollback");
  await pageA.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    rollbackInput.keyRef,
  );
  const rollbackCreated = await callCreate(
    pageA,
    "A",
    rollbackInput,
    "rollback",
  );
  assert.deepEqual(
    await callClaim(
      pageB,
      "rollback",
      rollbackCreated.transactionId,
      rollbackInput.expectedState,
    ),
    { ok: false, reason: "clock-invalid" },
  );
  record({
    caseId: "synthetic-contract-boundaries",
    page: "A+B",
    phase: "validated",
    result: "passed",
  });

  const abortInput = inputFor("abort_key", "abort");
  await pageA.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    abortInput.keyRef,
  );
  const abortCreated = await callCreate(pageA, "A", abortInput, "abort");
  await pageA.evaluate(() => {
    const original = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (...args) {
      const request = original.apply(this, args);
      const tx = this.transaction;
      request.addEventListener("success", () => tx.abort(), { once: true });
      IDBObjectStore.prototype.delete = original;
      return request;
    };
  });
  assert.deepEqual(
    await callClaim(
      pageA,
      "A",
      abortCreated.transactionId,
      abortInput.expectedState,
    ),
    { ok: false, reason: "transaction-aborted" },
  );
  assert.equal(
    Boolean(
      await pageB.evaluate(
        (id) => globalThis.__oauthIdbHarness.readRecord(id),
        abortCreated.transactionId,
      ),
    ),
    true,
  );
  record({
    caseId: "real-abort-after-delete-request",
    page: "A",
    phase: "aborted",
    result: "passed",
    counts: { exchanges: 0 },
  });

  const raceCancelInput = inputFor("cancel_race_key", "cancel-race");
  await pageA.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    raceCancelInput.keyRef,
  );
  const raceCancelCreated = await callCreate(
    pageA,
    "A",
    raceCancelInput,
    "cancel-race",
  );
  const [cancelOutcome, claimOutcome] = await Promise.all([
    callCancel(pageA, "cancel-race", false),
    callClaim(
      pageB,
      "B",
      raceCancelCreated.transactionId,
      raceCancelInput.expectedState,
    ),
  ]);
  assert.equal(
    Number(cancelOutcome.ok && cancelOutcome.kind === "cancelled") +
      Number(claimOutcome.ok),
    1,
  );
  if (cancelOutcome.kind === "cancelled") {
    assert.deepEqual(await cleanupCall(pageA, "cancel-race"), { ok: true });
    assert.equal(
      await pageB.evaluate(
        (key) => globalThis.__oauthIdbHarness.hasKey(key),
        raceCancelInput.keyRef,
      ),
      false,
    );
  } else {
    assert.equal(
      await pageB.evaluate(
        (key) => globalThis.__oauthIdbHarness.hasKey(key, true),
        raceCancelInput.keyRef,
      ),
      true,
    );
  }
  record({
    caseId: "cancel-claim-race",
    page: "A+B",
    phase: "committed",
    result: "passed",
  });

  const tamperInput = inputFor("tamper_key", "tamper");
  await pageA.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    tamperInput.keyRef,
  );
  const tamperCreated = await callCreate(pageA, "A", tamperInput, "tamper");
  const originalTamperRecord = await pageA.evaluate(
    (id) => globalThis.__oauthIdbHarness.readRecord(id),
    tamperCreated.transactionId,
  );
  await pageA.evaluate(
    (value) =>
      globalThis.__oauthIdbHarness.writeRecord({
        ...value,
        keyRef: "unrelated_sentinel",
      }),
    originalTamperRecord,
  );
  assert.deepEqual(await callCancel(pageA, "tamper", false), {
    ok: false,
    reason: "binding-mismatch",
  });
  assert.equal(
    await pageB.evaluate(
      (key) => globalThis.__oauthIdbHarness.hasKey(key, true),
      tamperInput.keyRef,
    ),
    true,
  );
  assert.equal(
    await pageB.evaluate(() =>
      globalThis.__oauthIdbHarness.hasKey("unrelated_sentinel", true),
    ),
    true,
  );
  await pageA.evaluate(
    (value) => globalThis.__oauthIdbHarness.writeRecord(value),
    originalTamperRecord,
  );
  const cancelResult = await callCancel(pageA, "tamper", false);
  assert.deepEqual(cancelResult, { ok: true, kind: "cancelled" });
  assert.deepEqual(await cleanupCall(pageA, "tamper"), { ok: true });
  assert.deepEqual(await cleanupCall(pageA, "tamper"), { ok: true });
  assert.deepEqual(await callCancel(pageA, "tamper", false), {
    ok: true,
    kind: "inactive",
  });
  record({
    caseId: "cancel-capability-integrity",
    page: "A+B",
    phase: "cleaned",
    result: "passed",
  });

  await makeStore(pageA, "cleanup-retry", {
    cleanupFailures: 1,
    ownerLabel: "original-owner",
  });
  const retryInput = inputFor("retry_key", "retry");
  await pageA.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    retryInput.keyRef,
  );
  const retryCreated = await callCreate(
    pageA,
    "cleanup-retry",
    retryInput,
    "cleanup-retry",
  );
  assert.equal(retryCreated.ok, true);
  assert.deepEqual(await callCancel(pageA, "cleanup-retry", false), {
    ok: true,
    kind: "cancelled",
  });
  const retryBefore = await pageA.evaluate(
    () => globalThis.__oauthIdbHarness.discardEvents.length,
  );
  await pageA.evaluate(() => {
    globalThis.__oauthIdbHarness.stores.get(
      "cleanup-retry",
    ).owner.discardFreshKey = async () => {
      throw new Error("replacement-called");
    };
  });
  assert.deepEqual(
    await pageA.evaluate(async () => {
      const cleanup = globalThis.__oauthIdbHarness.handles.get(
        "cleanup-retry:cleanup",
      );
      const capture = (promise) =>
        promise.then(
          () => ({ ok: true }),
          (error) => ({ ok: false, reason: error.reason ?? "unbounded" }),
        );
      return Promise.all([capture(cleanup()), capture(cleanup())]);
    }),
    [
      { ok: false, reason: "cleanup-failed" },
      { ok: false, reason: "cleanup-failed" },
    ],
  );
  assert.equal(
    await pageA.evaluate(
      () => globalThis.__oauthIdbHarness.discardEvents.length,
    ),
    retryBefore + 1,
  );
  assert.equal(
    await pageB.evaluate(
      (key) => globalThis.__oauthIdbHarness.hasKey(key),
      retryInput.keyRef,
    ),
    true,
  );
  assert.deepEqual(await cleanupCall(pageA, "cleanup-retry"), { ok: true });
  assert.equal(
    await pageA.evaluate(
      () => globalThis.__oauthIdbHarness.discardEvents.at(-1).owner,
    ),
    "original-owner",
  );
  assert.equal(
    await pageB.evaluate(
      (key) => globalThis.__oauthIdbHarness.hasKey(key),
      retryInput.keyRef,
    ),
    false,
  );
  record({
    caseId: "cleanup-retry-exact-capability",
    page: "A",
    phase: "retried",
    result: "passed",
  });

  const collisionId = "1".repeat(32);
  const generationOne = "2".repeat(32);
  const generationTwo = "3".repeat(32);
  const finalId = "4".repeat(32);
  await makeStore(pageA, "collision-one", {
    randomHex: [generationOne, collisionId],
  });
  const collisionOld = inputFor("collision_old_key", "collision-old");
  await pageA.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    collisionOld.keyRef,
  );
  const collisionOldCreated = await callCreate(
    pageA,
    "collision-one",
    collisionOld,
    "collision-old",
  );
  assert.equal(collisionOldCreated.transactionId, collisionId);
  assert.equal(
    (
      await callClaim(
        pageB,
        "B",
        collisionOldCreated.transactionId,
        collisionOld.expectedState,
      )
    ).ok,
    true,
  );
  await makeStore(pageA, "collision-two", {
    randomHex: [generationTwo, collisionId],
  });
  const collisionNew = inputFor("collision_new_key", "collision-new");
  await pageA.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    collisionNew.keyRef,
  );
  const collisionNewCreated = await callCreate(
    pageA,
    "collision-two",
    collisionNew,
    "collision-new",
  );
  assert.equal(collisionNewCreated.transactionId, collisionId);
  assert.deepEqual(await callCancel(pageA, "collision-old", false), {
    ok: true,
    kind: "inactive",
  });
  assert.equal(
    Boolean(
      await pageB.evaluate(
        (id) => globalThis.__oauthIdbHarness.readRecord(id),
        collisionId,
      ),
    ),
    true,
  );
  assert.equal(
    await pageB.evaluate(
      (key) => globalThis.__oauthIdbHarness.hasKey(key, true),
      collisionNew.keyRef,
    ),
    true,
  );
  assert.equal(
    await pageB.evaluate(
      (key) => globalThis.__oauthIdbHarness.hasKey(key, true),
      collisionOld.keyRef,
    ),
    true,
  );
  await makeStore(pageA, "collision-retry", {
    randomHex: ["5".repeat(32), collisionId, finalId],
  });
  const collisionRetry = inputFor("collision_retry_key", "collision-retry");
  await pageA.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    collisionRetry.keyRef,
  );
  const collisionRetryCreated = await callCreate(
    pageA,
    "collision-retry",
    collisionRetry,
    "collision-retry",
  );
  assert.equal(collisionRetryCreated.transactionId, finalId);
  assert.equal(
    (
      await pageB.evaluate(
        (id) => globalThis.__oauthIdbHarness.readRecord(id),
        collisionId,
      )
    ).keyRef,
    collisionNew.keyRef,
  );
  await makeStore(pageA, "collision-exhaust", {
    randomHex: [
      "6".repeat(32),
      collisionId,
      collisionId,
      collisionId,
      collisionId,
    ],
  });
  const exhausted = await callCreate(
    pageA,
    "collision-exhaust",
    inputFor("collision_exhaust_key", "collision-exhaust"),
    "collision-exhaust",
  );
  assert.deepEqual(exhausted, { ok: false, reason: "collision-exhausted" });
  record({
    caseId: "collision-and-stale-capability",
    page: "A",
    phase: "validated",
    result: "passed",
    counts: { attemptsAtExhaustion: 4 },
  });

  const reconstructionInput = inputFor("reconstruction_key", "reconstruction");
  await pageA.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    reconstructionInput.keyRef,
  );
  const reconstructionCreated = await callCreate(
    pageA,
    "A",
    reconstructionInput,
    "reconstruction",
  );
  await pageA.close();
  const pageA2 = await context.newPage();
  await pageA2.goto(`${origin}/page.html`);
  await installRealm(pageA2, origin, databaseName, "A-reconstructed");
  await makeStore(pageA2, "A2");
  assert.equal(
    (
      await callClaim(
        pageA2,
        "A2",
        reconstructionCreated.transactionId,
        reconstructionInput.expectedState,
      )
    ).ok,
    true,
  );
  assert.deepEqual(
    await callClaim(
      pageA2,
      "A2",
      reconstructionCreated.transactionId,
      reconstructionInput.expectedState,
    ),
    { ok: false, reason: "unavailable" },
  );
  record({
    caseId: "reconstruction-before-claim",
    page: "A-reconstructed",
    phase: "committed",
    result: "passed",
  });

  const lossInput = inputFor("post_claim_key", "post-claim");
  await pageA2.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    lossInput.keyRef,
  );
  const lossCreated = await callCreate(pageA2, "A2", lossInput, "post-claim");
  assert.equal(
    (
      await callClaim(
        pageA2,
        "A2",
        lossCreated.transactionId,
        lossInput.expectedState,
      )
    ).ok,
    true,
  );
  const cdp = await context.newCDPSession(pageA2);
  const crashEvent = new Promise((resolve) =>
    pageA2.once("crash", () => resolve("page-crash-event")),
  );
  void cdp.send("Page.crash").catch(() => undefined);
  const crashSignal = await Promise.race([
    crashEvent,
    new Promise((resolve) => setTimeout(() => resolve("indeterminate"), 2_000)),
  ]);
  assert.equal(
    crashSignal,
    "page-crash-event",
    "post-claim renderer loss requires Playwright's page crash event",
  );
  assert.deepEqual(
    await callClaim(
      pageB,
      "B",
      lossCreated.transactionId,
      lossInput.expectedState,
    ),
    { ok: false, reason: "unavailable" },
  );
  assert.equal(
    await pageB.evaluate(
      (key) => globalThis.__oauthIdbHarness.hasKey(key, true),
      lossInput.keyRef,
    ),
    true,
  );
  record({
    caseId: "loss-after-claim-completion",
    page: "A-reconstructed",
    phase: "renderer-loss-observed",
    result: "passed",
    counts: { exchanges: 0, crashSignal },
  });

  const outcomes = [
    "known-rejection",
    "context-mismatch",
    "ambiguous-transport",
    "unknown-pending",
    "handoff-throw",
    "handoff-pending",
  ];
  let unknownFixture;
  const policyObservations = [];
  for (const outcome of outcomes) {
    const fixtureInput = inputFor(
      `policy_${outcome.replaceAll("-", "_")}`,
      outcome,
    );
    await pageB.evaluate(
      (key) => globalThis.__oauthIdbHarness.putKey(key),
      fixtureInput.keyRef,
    );
    await pageB.evaluate(
      ({ name, keyRef }) => {
        const harness = globalThis.__oauthIdbHarness;
        harness.policyOwners ??= new Map();
        const owner = {
          identity: name,
          calls: [],
          async cleanup(exactKey) {
            this.calls.push({
              kind: "cleanup",
              receiver: this.identity,
              exactKey,
            });
            const request = indexedDB.open(harness.databaseName, 1);
            const db = await new Promise((resolve, reject) => {
              request.onsuccess = () => resolve(request.result);
              request.onerror = reject;
            });
            await new Promise((resolve, reject) => {
              const tx = db.transaction("synthetic-keys", "readwrite");
              tx.objectStore("synthetic-keys").delete(exactKey);
              tx.oncomplete = resolve;
              tx.onerror = reject;
            });
            db.close();
          },
          complete(exactKey) {
            this.calls.push({
              kind: "complete",
              receiver: this.identity,
              exactKey,
            });
            if (this.identity === "handoff-pending")
              return new Promise(() => {});
            throw new Error("synthetic-completion-throw");
          },
        };
        const captured = {
          keyRef,
          cleanup: owner.cleanup.bind(owner),
          complete: owner.complete.bind(owner),
          owner,
          exchangeCalls: 0,
          handedOff: false,
        };
        owner.cleanup = async () => {
          owner.calls.push({ kind: "replacement-cleanup" });
        };
        owner.complete = () => {
          owner.calls.push({ kind: "replacement-complete" });
        };
        harness.policyOwners.set(name, captured);
      },
      { name: outcome, keyRef: fixtureInput.keyRef },
    );
    const fixtureCreated = await callCreate(
      pageB,
      "B",
      fixtureInput,
      `policy-${outcome}`,
    );
    const claimed = await callClaim(
      pageB,
      "B",
      fixtureCreated.transactionId,
      fixtureInput.expectedState,
    );
    assert.equal(claimed.ok, true);
    if (outcome === "unknown-pending") {
      unknownFixture = {
        transactionId: fixtureCreated.transactionId,
        expectedState: fixtureInput.expectedState,
        keyRef: fixtureInput.keyRef,
      };
    }
    const policyObservation = await pageB.evaluate(async (name) => {
      const captured = globalThis.__oauthIdbHarness.policyOwners.get(name);
      const exchange = async () => {
        captured.exchangeCalls += 1;
        if (name === "unknown-pending") return new Promise(() => {});
        return {
          kind:
            name === "known-rejection"
              ? "known-rejection"
              : name === "ambiguous-transport"
                ? "ambiguous-transport"
                : "accepted",
        };
      };
      const workflow = async () => {
        const outcome = await exchange();
        const contextCurrent = name !== "context-mismatch";
        if (outcome.kind === "known-rejection" || !contextCurrent)
          await captured.cleanup(captured.keyRef);
        else if (outcome.kind === "accepted" && !captured.handedOff) {
          captured.handedOff = true;
          if (name === "handoff-pending") {
            captured.pendingCallback = captured.complete(captured.keyRef);
          } else {
            try {
              captured.complete(captured.keyRef);
            } catch {
              /* synthetic callback failure */
            }
          }
        }
      };
      if (name === "unknown-pending") {
        captured.pending = workflow();
        await Promise.resolve();
      } else await workflow();
      return {
        calls: captured.owner.calls,
        exchangeCalls: captured.exchangeCalls,
        handedOff: captured.handedOff,
        pending: Boolean(captured.pending),
      };
    }, outcome);
    assert.equal(policyObservation.exchangeCalls, 1);
    assert.equal(
      policyObservation.calls.some((call) =>
        call.kind.startsWith("replacement"),
      ),
      false,
    );
    const dispose =
      outcome === "known-rejection" || outcome === "context-mismatch";
    if (dispose) {
      assert.deepEqual(policyObservation.calls, [
        { kind: "cleanup", receiver: outcome, exactKey: fixtureInput.keyRef },
      ]);
    }
    if (outcome === "handoff-throw" || outcome === "handoff-pending") {
      assert.equal(policyObservation.handedOff, true);
      assert.deepEqual(policyObservation.calls, [
        { kind: "complete", receiver: outcome, exactKey: fixtureInput.keyRef },
      ]);
      await pageB.evaluate(() => {
        globalThis.__oauthIdbHarness.stores.get("B").owner.nowValue += 300_001;
      });
      assert.deepEqual(await callCancel(pageB, `policy-${outcome}`, false), {
        ok: true,
        kind: "inactive",
      });
      await pageB.evaluate(() => {
        globalThis.__oauthIdbHarness.stores.get("B").owner.nowValue -= 300_001;
      });
    }
    if (outcome === "unknown-pending")
      assert.equal(policyObservation.pending, true);
    if (outcome === "ambiguous-transport" || outcome === "unknown-pending") {
      assert.deepEqual(policyObservation.calls, []);
      assert.equal(policyObservation.handedOff, false);
    }
    policyObservations.push({ name: outcome, ...policyObservation });
    assert.equal(
      await pageB.evaluate(
        ({ key, shouldSign }) =>
          globalThis.__oauthIdbHarness.hasKey(key, shouldSign),
        { key: fixtureInput.keyRef, shouldSign: !dispose },
      ),
      !dispose,
    );
    assert.deepEqual(
      await callClaim(
        pageB,
        "B",
        fixtureCreated.transactionId,
        fixtureInput.expectedState,
      ),
      { ok: false, reason: "unavailable" },
    );
  }
  assert.equal(
    await pageB.evaluate(() =>
      globalThis.__oauthIdbHarness.hasKey("unrelated_sentinel", true),
    ),
    true,
  );
  assert.ok(unknownFixture);
  const pendingCdp = await context.newCDPSession(pageB);
  const pendingCrashEvent = new Promise((resolve) =>
    pageB.once("crash", () => resolve("page-crash-event")),
  );
  void pendingCdp.send("Page.crash").catch(() => undefined);
  assert.equal(
    await Promise.race([
      pendingCrashEvent,
      new Promise((resolve) =>
        setTimeout(() => resolve("indeterminate"), 2_000),
      ),
    ]),
    "page-crash-event",
  );
  pageB = await context.newPage();
  await pageB.goto(`${origin}/page.html`);
  await installRealm(pageB, origin, databaseName, "B-after-unknown-exchange");
  await makeStore(pageB, "B");
  assert.deepEqual(
    await callClaim(
      pageB,
      "B",
      unknownFixture.transactionId,
      unknownFixture.expectedState,
    ),
    { ok: false, reason: "unavailable" },
  );
  assert.equal(
    await pageB.evaluate(
      (key) => globalThis.__oauthIdbHarness.hasKey(key, true),
      unknownFixture.keyRef,
    ),
    true,
  );
  record({
    caseId: "synthetic-outcome-policy",
    page: "B+B-after-unknown-exchange",
    phase: "settled",
    result: "passed",
    counts: {
      knownCleanup: policyObservations.filter((entry) =>
        entry.calls.some((call) => call.kind === "cleanup"),
      ).length,
      retained: policyObservations.filter(
        (entry) => !entry.calls.some((call) => call.kind === "cleanup"),
      ).length,
      handoffs: policyObservations.filter((entry) => entry.handedOff).length,
      exchangeAttempts: policyObservations.reduce(
        (sum, entry) => sum + entry.exchangeCalls,
        0,
      ),
      pendingExchangeCrash: "page-crash-event",
    },
  });

  const restartPending = inputFor("restart_pending_key", "restart-pending");
  await pageB.evaluate(
    (key) => globalThis.__oauthIdbHarness.putKey(key),
    restartPending.keyRef,
  );
  const restartPendingCreated = await callCreate(
    pageB,
    "B",
    restartPending,
    "restart-pending",
  );
  assert.equal(restartPendingCreated.ok, true);

  await pageB.evaluate(() => {
    const original = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => {
      throw new Error("synthetic-unavailable");
    };
    globalThis.__oauthIdbHarness.restoreOpen = () => {
      indexedDB.open = original;
    };
  });
  const unavailableInput = inputFor(
    "storage_unavailable_key",
    "storage-unavailable",
  );
  assert.deepEqual(
    await callCreate(pageB, "B", unavailableInput, "storage-unavailable"),
    { ok: false, reason: "open-failed" },
  );
  await pageB.evaluate(() => globalThis.__oauthIdbHarness.restoreOpen());
  record({
    caseId: "storage-unavailable",
    page: "B",
    phase: "rejected",
    result: "passed",
  });

  return {
    pendingId: restartPendingCreated.transactionId,
    pendingState: restartPending.expectedState,
    pendingKeyRef: restartPending.keyRef,
    consumedId: lossCreated.transactionId,
    consumedState: lossInput.expectedState,
  };
}

async function deleteOwnedDatabase(cleanupPage, databaseName) {
  return cleanupPage.evaluate(
    (name) =>
      new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve("unknown");
          }
        }, 3_000);
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve("success");
          }
        };
        request.onerror = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve("error");
          }
        };
        request.onblocked = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve("blocked");
          }
        };
      }),
    databaseName,
  );
}

async function closeServer(server) {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function launchOptions(runDir) {
  return {
    executablePath: BROWSER_PATH,
    headless: true,
    serviceWorkers: "block",
    acceptDownloads: false,
    env: {
      PATH: "/usr/bin:/bin",
      LC_ALL: "C",
      LANG: "C",
      TMPDIR: path.join(runDir, "tmp"),
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    },
    args: [
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-domain-reliability",
      "--disable-extensions",
      "--disable-features=AutofillServerCommunication,OptimizationHints,MediaRouter",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--safebrowsing-disable-auto-update",
    ],
  };
}

async function installRequestRoute(context, origin) {
  const allowedPaths = new Set([
    "/page.html",
    "/cleanup.html",
    "/transaction-store.js",
  ]);
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === origin && allowedPaths.has(requestUrl.pathname))
      await route.continue();
    else await route.abort("blockedbyclient");
  });
}

async function main() {
  const { runDir, mode } = parseArguments();
  assertOwnedRunDirectory(runDir);
  const { record, evidencePath, rawPath, runLabel } = createRecorder(
    runDir,
    mode,
  );
  verifyRuntimePins(record);
  assert.equal(
    process.execPath,
    NODE_PATH,
    "runner must use the accepted Node binary",
  );
  const playwright = require(PLAYWRIGHT_ROOT);
  const ts = require(TYPESCRIPT_PATH);
  inventoryLoadedSupport(runDir, record);
  const { served, hashes } = compileCandidate(ts, runDir, record);
  const runToken = crypto.randomBytes(16).toString("hex");
  const databaseName = `oxkey-oauth-idb-test-${runToken}`;
  const { server, origin } = await startServer(served, record);
  try {
    writeExclusive(
      path.join(runDir, "evidence", "ownership.json"),
      `${JSON.stringify({ runDir, profilePath: path.join(runDir, "profile"), databaseName, origin, runLabel }, null, 2)}\n`,
    );
  } catch (error) {
    await closeServer(server);
    throw error;
  }
  let context;
  let cleanupStatus = "not-attempted";
  let profileCleanupStatus = "not-attempted";
  let shutdownStatus = "not-attempted";
  let listenerStatus = "not-attempted";
  let primaryError;
  try {
    context = await playwright.chromium.launchPersistentContext(
      path.join(runDir, "profile"),
      launchOptions(runDir),
    );
    record({
      caseId: "browser-launch",
      phase: "launched",
      result: "passed",
      counts: { version: context.browser()?.version() ?? "persistent-context" },
    });
    await installRequestRoute(context, origin);
    if (mode === "cleanup-fault") {
      const fixturePage = context.pages()[0] ?? (await context.newPage());
      await fixturePage.goto(`${origin}/page.html`);
      await initializeDatabase(fixturePage, databaseName);
      record({
        caseId: "cleanup-fault-fixture",
        phase: "committed",
        result: "passed",
      });
    } else {
      const restartFixture = await runMatrix(
        context,
        origin,
        databaseName,
        record,
      );
      await context.close();
      context = await playwright.chromium.launchPersistentContext(
        path.join(runDir, "profile"),
        launchOptions(runDir),
      );
      await installRequestRoute(context, origin);
      const restartedPage = context.pages()[0] ?? (await context.newPage());
      await restartedPage.goto(`${origin}/page.html`);
      await installRealm(restartedPage, origin, databaseName, "restart");
      await makeStore(restartedPage, "restart");
      assert.equal(
        (
          await callClaim(
            restartedPage,
            "restart",
            restartFixture.pendingId,
            restartFixture.pendingState,
          )
        ).ok,
        true,
      );
      assert.deepEqual(
        await callClaim(
          restartedPage,
          "restart",
          restartFixture.consumedId,
          restartFixture.consumedState,
        ),
        { ok: false, reason: "unavailable" },
      );
      assert.equal(
        await restartedPage.evaluate(
          (key) => globalThis.__oauthIdbHarness.hasKey(key, true),
          restartFixture.pendingKeyRef,
        ),
        true,
      );
      record({
        caseId: "graceful-browser-restart",
        page: "restart",
        phase: "reopened",
        result: "passed",
        counts: { pendingClaims: 1, consumedReplays: 0 },
      });
      await restartedPage.evaluate(async () => {
        const harness = globalThis.__oauthIdbHarness;
        const nativeOpen = indexedDB.open.bind(indexedDB);
        const request = nativeOpen(harness.databaseName, 1);
        harness.blocker = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(new Error("blocker-open-failed"));
        });
        harness.nativeOpen = nativeOpen;
        indexedDB.open = (name) => nativeOpen(name, 2);
      });
      const blockedResult = await callCreate(
        restartedPage,
        "restart",
        inputFor("blocked_key", "blocked"),
        "blocked",
      );
      assert.deepEqual(blockedResult, { ok: false, reason: "blocked" });
      await restartedPage.evaluate(async () => {
        const harness = globalThis.__oauthIdbHarness;
        indexedDB.open = harness.nativeOpen;
        harness.blocker.close();
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      record({
        caseId: "open-blocked",
        page: "restart",
        phase: "rejected",
        result: "passed",
      });
    }
  } catch (error) {
    primaryError = error;
    record({
      caseId: "matrix",
      phase: "assertion",
      result: "failed",
      reason:
        error && error.code === "ERR_ASSERTION"
          ? "assertion-failed"
          : "runner-failed",
    });
  } finally {
    if (context) {
      let cleanupPage;
      try {
        if (mode === "cleanup-fault")
          throw new Error("synthetic-cleanup-realm-failure");
        cleanupPage = await context.newPage();
        await cleanupPage.goto(`${origin}/cleanup.html`);
        assert.equal(await cleanupPage.evaluate(() => location.origin), origin);
        for (const page of context.pages()) {
          if (page !== cleanupPage) await page.close();
        }
        record({
          caseId: "pre-cleanup",
          phase: "checkpoint",
          result: "flushed",
        });
        syncExistingFile(evidencePath);
        syncExistingFile(rawPath);
        writeExclusive(
          path.join(runDir, "evidence", `${runLabel}-pre-cleanup.json`),
          `${JSON.stringify(
            {
              runDir,
              profilePath: path.join(runDir, "profile"),
              databaseName,
              origin,
              evidence: [evidencePath, rawPath].map((file) => ({
                file,
                sha256: sha256(fs.readFileSync(file)),
              })),
            },
            null,
            2,
          )}\n`,
        );
        cleanupStatus = await deleteOwnedDatabase(cleanupPage, databaseName);
      } catch {
        cleanupStatus = "error";
      }
      record({
        caseId: "database-cleanup",
        page: "cleanup",
        phase: "delete-exact-name",
        result: cleanupStatus,
      });
      let cleanupPageClosed = !cleanupPage;
      try {
        if (cleanupPage) await cleanupPage.close();
        cleanupPageClosed = true;
      } catch {
        /* Retain profile on uncertain shutdown. */
      }
      let contextClosed = false;
      try {
        await context.close();
        contextClosed = true;
      } catch {
        /* Retain profile on uncertain shutdown. */
      }
      shutdownStatus =
        cleanupPageClosed && contextClosed ? "success" : "failed";
    }
    try {
      await closeServer(server);
      listenerStatus = !server.listening ? "success" : "failed";
    } catch {
      listenerStatus = "failed";
    }
    if (
      cleanupStatus === "success" &&
      shutdownStatus === "success" &&
      listenerStatus === "success"
    ) {
      const profilePath = path.join(runDir, "profile");
      try {
        const profileStat = fs.lstatSync(profilePath);
        assert.ok(profileStat.isDirectory() && !profileStat.isSymbolicLink());
        assert.equal(profileStat.uid, process.getuid());
        assert.equal(profileStat.mode & 0o777, 0o700);
        assert.equal(path.dirname(profilePath), runDir);
        fs.rmSync(profilePath, { recursive: true, force: false });
        profileCleanupStatus = "success";
      } catch {
        profileCleanupStatus = "failed";
      }
    }
    if (
      (cleanupStatus !== "success" ||
        shutdownStatus !== "success" ||
        listenerStatus !== "success" ||
        profileCleanupStatus !== "success") &&
      !primaryError
    )
      primaryError = new Error("owned resource cleanup did not succeed");
    record({
      caseId: "owned-resource-cleanup",
      phase: "closed",
      result:
        cleanupStatus === "success" &&
        shutdownStatus === "success" &&
        listenerStatus === "success" &&
        profileCleanupStatus === "success" &&
        !server.listening
          ? "passed"
          : "failed",
      reason:
        cleanupStatus !== "success"
          ? "database-cleanup-incomplete"
          : shutdownStatus !== "success"
            ? "browser-shutdown-incomplete"
            : listenerStatus !== "success"
              ? "listener-shutdown-incomplete"
              : profileCleanupStatus !== "success"
                ? "profile-cleanup-incomplete"
                : undefined,
      counts: {
        database: cleanupStatus,
        shutdown: shutdownStatus,
        listener: listenerStatus,
        profile: profileCleanupStatus,
        listenerClosed: !server.listening,
      },
    });
    const manifest = {
      mode,
      databaseNameSha256: sha256(databaseName),
      origin,
      sourceSha256: hashes.sourceSha256,
      servedSha256: hashes.servedSha256,
      browserPathSha256: PINNED.get(BROWSER_PATH),
      evidence: [evidencePath, rawPath].map((file) => ({
        file,
        sha256: sha256(fs.readFileSync(file)),
      })),
      cleanupStatus,
      shutdownStatus,
      listenerStatus,
      profileCleanupStatus,
      exitStatus: primaryError ? 1 : 0,
    };
    writeExclusive(
      path.join(runDir, "evidence", `${runLabel}-manifest.json`),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }
  if (primaryError) throw primaryError;
}

main().catch((error) => {
  const reason =
    error && error.code === "ERR_ASSERTION"
      ? "assertion-failed"
      : "runner-failed";
  process.stderr.write(`oauth-transaction-store runner failed (${reason})\n`);
  process.exitCode = 1;
});
