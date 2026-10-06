"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const NODE_PATH =
  "/Users/torben/codes/0xkey-workspace/.work/oauth-turnkey-parity/npm-cache/_npx/f6c81a5e22bed22a/node_modules/node/bin/node";
const PLAYWRIGHT_ROOT =
  "/Users/torben/codes/0xkey-workspace/.work/iterations/0xkey-v2026.09.0/workspace/repos/web/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core";
const ESBUILD_BIN =
  "/Users/torben/codes/0xkey-workspace/.work/iterations/0xkey-v2026.09.0/workspace/repos/web/node_modules/@esbuild/darwin-arm64/bin/esbuild";
const ESBUILD_PACKAGE =
  "/Users/torben/codes/0xkey-workspace/.work/iterations/0xkey-v2026.09.0/workspace/repos/web/node_modules/esbuild/package.json";
const BROWSER_PATH =
  "/Users/torben/codes/0xkey-workspace/.work/oauth-turnkey-parity/browser-runtime-20260923/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const PACKAGE_ROOT = path.resolve(__dirname, "../../..");
const FIXTURE_PATH = path.join(__dirname, "provider-redirect-fixture.tsx");
const SHIM_PATH = path.join(__dirname, "provider-redirect-process-shim.js");
const DATABASE_NAME = "0xkey-oauth-transaction-v1";
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
  [ESBUILD_BIN, "3e030ee2aa86ad3c33e5e95ae0e53bb03de40e0da35c9b1180a67de4a497cae5"],
  [
    ESBUILD_PACKAGE,
    "cb7d5b1fe478f8cbaae566a86031b6fdf5f7d444354f35d1cb3cba9adf6d2935",
  ],
]);
const PROVIDERS = [
  { id: "discord", pkce: true, host: "discord.com", idToken: "synthetic-oidc-token" },
  { id: "x", pkce: true, host: "x.com", idToken: "synthetic-oidc-token" },
  {
    id: "facebook",
    pkce: true,
    host: "www.facebook.com",
    idToken: "synthetic-facebook-token",
  },
  {
    id: "google",
    pkce: false,
    host: "accounts.google.com",
    idToken: "synthetic-google-token",
  },
  {
    id: "apple",
    pkce: false,
    host: "account.apple.com",
    idToken: "synthetic-apple-token",
  },
];
const AUTH_HOSTS = new Set(PROVIDERS.map((provider) => provider.host));

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function scrub(value) {
  return String(value)
    .replace(/[0-9a-f]{32,}/gi, "[hex]")
    .replace(/verifier=[^&\s]+/gi, "verifier=[redacted]")
    .slice(0, 280);
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
  assert.equal(result["--mode"], "green", "--mode must be green");
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
    assert.deepEqual(fs.readdirSync(childPath), [], `${child} must be fresh and empty`);
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

function createRecorder(runDir) {
  const evidencePath = path.join(runDir, "evidence", "green-1-observations.jsonl");
  const rawPath = path.join(runDir, "evidence", "green-1-raw.log");
  writeExclusive(evidencePath, "");
  writeExclusive(rawPath, "");
  const started = Date.now();
  const record = (value) => {
    const safe = {
      caseId: value.caseId,
      phase: value.phase,
      result: value.result,
      reason: value.reason ? scrub(value.reason) : null,
      counts: value.counts ?? null,
      elapsedMs: Date.now() - started,
    };
    fs.appendFileSync(evidencePath, `${JSON.stringify(safe)}\n`, { mode: 0o600 });
    const line = `${safe.caseId}: ${safe.result}${safe.reason ? ` (${safe.reason})` : ""}`;
    fs.appendFileSync(rawPath, `${line}\n`, { mode: 0o600 });
    process.stdout.write(`${line}\n`);
  };
  return { evidencePath, rawPath, record };
}

function verifyRuntimePins(record) {
  for (const [file, expected] of PINNED) {
    const stat = fs.lstatSync(file);
    assert.ok(stat.isFile(), `runtime pin is not a regular file: ${file}`);
    assert.ok(!stat.isSymbolicLink(), `runtime pin is a symlink: ${file}`);
    assert.equal(sha256(fs.readFileSync(file)), expected, `runtime pin mismatch: ${file}`);
  }
  assert.ok((fs.statSync(BROWSER_PATH).mode & 0o111) !== 0, "browser is not executable");
  assert.ok((fs.statSync(ESBUILD_BIN).mode & 0o111) !== 0, "esbuild is not executable");
  record({ caseId: "runtime-pins", phase: "prelaunch", result: "matched" });
}

function bundleFixture(runDir, record) {
  const bundleDir = path.join(runDir, "tmp", "bundle");
  fs.mkdirSync(bundleDir, 0o700);
  const sourcePaths = [
    FIXTURE_PATH,
    SHIM_PATH,
    path.join(PACKAGE_ROOT, "src/providers/client/Provider.tsx"),
    path.join(PACKAGE_ROOT, "src/utils/oauth/redirect-transaction.ts"),
    path.join(PACKAGE_ROOT, "src/utils/oauth/transaction-store.ts"),
  ];
  const built = spawnSync(
    ESBUILD_BIN,
    [
      FIXTURE_PATH,
      "--bundle",
      "--splitting",
      "--format=esm",
      "--platform=browser",
      "--target=es2022",
      "--jsx=automatic",
      `--outdir=${bundleDir}`,
      "--entry-names=[name]",
      "--chunk-names=chunk-[hash]",
      "--legal-comments=none",
      "--log-level=warning",
      `--inject:${SHIM_PATH}`,
      `--alias:react-native=${path.join(__dirname, "provider-redirect-native-stub.js")}`,
      `--alias:react-native-keychain=${path.join(__dirname, "provider-redirect-native-stub.js")}`,
      `--alias:@react-native-async-storage/async-storage=${path.join(__dirname, "provider-redirect-native-stub.js")}`,
      `--alias:@0xkey-io/react-native-passkey-stamper=${path.join(__dirname, "provider-redirect-native-stub.js")}`,
      "--define:process.env.NODE_ENV=\"production\"",
      "--define:global=globalThis",
      "--loader:.css=empty",
      "--loader:.svg=dataurl",
      "--loader:.png=dataurl",
      "--loader:.jpg=dataurl",
      "--loader:.gif=dataurl",
      "--loader:.woff=dataurl",
      "--loader:.woff2=dataurl",
      "--loader:.ttf=dataurl",
      "--loader:.eot=dataurl",
      "--conditions=browser,import,default",
    ],
    { cwd: PACKAGE_ROOT, encoding: "utf8" },
  );
  if (built.status !== 0) {
    throw new Error(
      `provider bundle failed (${built.status}): ${scrub(built.stderr || built.stdout)}`,
    );
  }
  const files = fs.readdirSync(bundleDir).sort();
  assert.ok(files.includes("provider-redirect-fixture.js"), "bundle entry missing");
  const hashes = {
    sources: sourcePaths.map((file) => ({
      file,
      sha256: sha256(fs.readFileSync(file)),
    })),
    bundle: files.map((file) => ({
      file,
      sha256: sha256(fs.readFileSync(path.join(bundleDir, file))),
      bytes: fs.statSync(path.join(bundleDir, file)).size,
    })),
    warnings: scrub(built.stderr || ""),
  };
  writeExclusive(
    path.join(runDir, "evidence", "candidate-hashes.json"),
    `${JSON.stringify(hashes, null, 2)}\n`,
  );
  record({
    caseId: "provider-bundle",
    phase: "prelaunch",
    result: "bundled",
    counts: {
      files: files.length,
      bytes: hashes.bundle.reduce((sum, entry) => sum + entry.bytes, 0),
    },
  });
  return bundleDir;
}

function startServer(bundleDir, record) {
  const page =
    "<!doctype html><html><head><meta charset=utf-8><meta name=referrer content=no-referrer>" +
    "<title>oauth provider redirect</title></head><body><div id=root></div>" +
    '<script type=module src="/bundle/provider-redirect-fixture.js"></script></body></html>';
  const inspect = "<!doctype html><meta charset=utf-8><title>inspect</title>";
  const server = http.createServer((request, response) => {
    const expectedHost = `127.0.0.1:${server.address().port}`;
    if (request.method !== "GET" || request.headers.host !== expectedHost) {
      response.writeHead(400, { "content-type": "text/plain", "cache-control": "no-store" });
      response.end("rejected");
      return;
    }
    const requestUrl = new URL(request.url, `http://${expectedHost}`);
    const headers = {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; script-src 'self'; connect-src 'self' https://auth.example.test https://api.example.test https://graph.facebook.com; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    };
    if (requestUrl.pathname === "/start" || requestUrl.pathname === "/return") {
      response.writeHead(200, { ...headers, "content-type": "text/html; charset=utf-8" });
      response.end(page);
      return;
    }
    if (requestUrl.pathname === "/inspect.html") {
      response.writeHead(200, { ...headers, "content-type": "text/html; charset=utf-8" });
      response.end(inspect);
      return;
    }
    if (requestUrl.pathname.startsWith("/bundle/")) {
      const name = requestUrl.pathname.slice("/bundle/".length);
      if (!/^[A-Za-z0-9._-]+$/.test(name)) {
        response.writeHead(404, { ...headers, "content-type": "text/plain" });
        response.end("not found");
        return;
      }
      const file = path.join(bundleDir, name);
      const relative = path.relative(bundleDir, file);
      if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(file)) {
        response.writeHead(404, { ...headers, "content-type": "text/plain" });
        response.end("not found");
        return;
      }
      response.writeHead(200, { ...headers, "content-type": "text/javascript; charset=utf-8" });
      response.end(fs.readFileSync(file));
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
      record({ caseId: "owned-origin", phase: "listen", result: "ready" });
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
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

function safeLabel(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "unparsed";
  }
}

function verifierFromBody(body) {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    return typeof parsed.codeVerifier === "string" ? parsed.codeVerifier : null;
  } catch {
    const params = new URLSearchParams(body);
    return params.get("code_verifier");
  }
}

function corsHeaders(request) {
  return {
    "access-control-allow-origin": request.headers().origin ?? "null",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type,x-auth-proxy-config-id,x-captcha-token",
    "access-control-max-age": "0",
    vary: "Origin",
  };
}

function isExchange(url) {
  return (
    (url.hostname === "auth.example.test" &&
      url.pathname === "/v1/oauth2_authenticate") ||
    (url.hostname === "graph.facebook.com" &&
      url.pathname === "/v11.0/oauth/access_token")
  );
}

function installRoutes(context, origin, network) {
  return context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
      await route.continue();
      return;
    }
    const allowed =
      requestUrl.origin === origin &&
      (requestUrl.pathname === "/start" ||
        requestUrl.pathname === "/return" ||
        requestUrl.pathname === "/inspect.html" ||
        requestUrl.pathname.startsWith("/bundle/"));
    if (allowed) {
      await route.continue();
      return;
    }
    if (AUTH_HOSTS.has(requestUrl.hostname)) {
      network.authUrls.push(route.request().url());
      if (network.resolveAuth) network.resolveAuth(route.request().url());
      await route.abort("blockedbyclient");
      return;
    }
    if (isExchange(requestUrl)) {
      const request = route.request();
      if (request.method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: corsHeaders(request) });
        return;
      }
      const verifier = verifierFromBody(request.postData() ?? "");
      network.exchanges.push({
        host: requestUrl.host,
        verifier,
        decoy: verifier === "decoy-verifier",
      });
      const facebook = requestUrl.hostname === "graph.facebook.com";
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders(request), "content-type": "application/json" },
        body: JSON.stringify(
          facebook
            ? { id_token: "synthetic-facebook-token" }
            : { oidcToken: "synthetic-oidc-token" },
        ),
      });
      return;
    }
    network.unexpected.push(safeLabel(route.request().url()));
    await route.abort("blockedbyclient");
  });
}

function providerById(id) {
  const provider = PROVIDERS.find((item) => item.id === id);
  assert.ok(provider, `unknown provider ${id}`);
  return provider;
}

function forgedState(provider, pkce) {
  const base = `provider=${provider}&flow=redirect&publicKey=${"02"}${"ab".repeat(32)}`;
  return pkce ? `${base}&nonce=${"aa".repeat(16)}` : base;
}

function returnUrl(origin, provider, state, options = {}) {
  if (provider.pkce) {
    const params = new URLSearchParams();
    params.set("code", "synthetic-code");
    params.set("state", options.forge ? forgedState(provider.id, true) : state);
    if (options.plantDecoy) params.set("plantDecoy", "1");
    if (options.org) params.set("org", options.org);
    return `${origin}/return?${params.toString()}`;
  }
  const usedState = options.forge ? forgedState(provider.id, false) : state;
  const hash =
    provider.id === "apple"
      ? `state=${usedState}&code=synthetic-apple-code&id_token=${provider.idToken}`
      : new URLSearchParams({
          state: usedState,
          id_token: provider.idToken,
        }).toString();
  const search = new URLSearchParams();
  if (options.plantDecoy) search.set("plantDecoy", "1");
  if (options.org) search.set("org", options.org);
  const query = search.toString();
  return `${origin}/return${query ? `?${query}` : ""}#${hash}`;
}

async function closePages(context) {
  for (const page of context.pages()) {
    await page.close().catch(() => undefined);
  }
}

async function resetOrigin(context, origin) {
  await closePages(context);
  const page = await context.newPage();
  await page.goto(`${origin}/inspect.html`, { waitUntil: "domcontentloaded" });
  const deleted = await page.evaluate(
    (name) =>
      new Promise((resolve) => {
        window.localStorage.clear();
        const request = indexedDB.deleteDatabase(name);
        const timer = setTimeout(() => resolve("timeout"), 3000);
        request.onsuccess = () => {
          clearTimeout(timer);
          resolve("success");
        };
        request.onerror = () => {
          clearTimeout(timer);
          resolve("error");
        };
        request.onblocked = () => {
          clearTimeout(timer);
          resolve("blocked");
        };
      }),
    DATABASE_NAME,
  );
  await page.close();
  assert.equal(deleted, "success", `reset ${deleted}`);
}

function watchPage(page, logs) {
  page.on("console", (message) => {
    logs.push(scrub(`${message.type()}: ${message.text()}`));
  });
  page.on("pageerror", (error) => {
    logs.push(scrub(`pageerror: ${error.message}`));
  });
}

async function readSnapshot(page) {
  return page.evaluate(async (name) => {
    const names = (await indexedDB.databases()).map((database) => database.name ?? "");
    const open = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => {
        try {
          request.transaction?.abort();
        } catch {
          /* keep the rejected open below */
        }
      };
      request.onerror = () => reject(new Error("snapshot-open-failed"));
      request.onsuccess = () => resolve(request.result);
    });
    const rows = await new Promise((resolve, reject) => {
      const transaction = open.transaction("transactions", "readonly");
      const request = transaction.objectStore("transactions").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("snapshot-read-failed"));
    });
    open.close();
    return {
      names,
      slot: {
        discord: window.localStorage.getItem("discord_verifier"),
        x: window.localStorage.getItem("x_verifier"),
        facebook: window.localStorage.getItem("facebook_verifier"),
      },
      rows: rows.map((row) => ({
        provider: row?.binding?.provider ?? null,
        organizationId: row?.binding?.organizationId ?? null,
        configId: row?.binding?.configId ?? null,
        completionKind: row?.binding?.completion?.kind ?? null,
        redirectUri: row?.binding?.redirectUri ?? null,
        verifier: row?.verifier ?? null,
        expectedState: row?.expectedState ?? null,
        keyRef: row?.keyRef ?? null,
      })),
    };
  }, DATABASE_NAME);
}

async function readOnce(context, origin) {
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/inspect.html`, { waitUntil: "domcontentloaded" });
    return await readSnapshot(page);
  } finally {
    await page.close();
  }
}

async function snapshotAfterStart(context, origin) {
  let latest = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      latest = await readOnce(context, origin);
    } catch (error) {
      latest = { error: scrub(error.message), names: [], rows: [], slot: {} };
    }
    if (latest.rows && latest.rows.length > 0) return latest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return latest;
}

function expectAuth(network) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      network.resolveAuth = null;
      reject(new Error("auth-navigation-timeout"));
    }, 30_000);
    network.resolveAuth = (url) => {
      clearTimeout(timer);
      network.resolveAuth = null;
      resolve(url);
    };
  });
}

async function outcomeOf(page) {
  await page.waitForFunction(
    () => {
      const data = document.documentElement.dataset;
      return Boolean(
        data.oauthResult || data.windowError || data.unhandled || data.clientState === "error",
      );
    },
    { timeout: 30_000 },
  );
  return page.evaluate(() => ({
    clientState: document.documentElement.dataset.clientState ?? null,
    oauthResult: document.documentElement.dataset.oauthResult ?? null,
    oauthIdToken: document.documentElement.dataset.oauthIdToken ?? null,
    oauthPublicKey: document.documentElement.dataset.oauthPublicKey ?? null,
    oauthError: document.documentElement.dataset.oauthError ?? null,
    startError: document.documentElement.dataset.startError ?? null,
    windowError: document.documentElement.dataset.windowError ?? null,
    unhandled: document.documentElement.dataset.unhandled ?? null,
  }));
}

function publicOutcome(outcome) {
  if (!outcome) return null;
  return {
    clientState: outcome.clientState,
    oauthResult: outcome.oauthResult,
    oauthIdToken: outcome.oauthIdToken,
    oauthError: scrub(outcome.oauthError),
    startError: scrub(outcome.startError),
    windowError: scrub(outcome.windowError),
    unhandled: scrub(outcome.unhandled),
    hasPublicKey: typeof outcome.oauthPublicKey === "string" && outcome.oauthPublicKey.length > 0,
  };
}

function assertStartShape(provider, origin, authUrl, snapshot) {
  const url = new URL(authUrl);
  assert.equal(url.host, provider.host, `${provider.id} authorization host`);
  assert.equal(url.hash, "", `${provider.id} authorization hash`);
  for (const key of ["transactionId", "code_verifier", "captcha", "captcha_token", "code"]) {
    assert.equal(url.searchParams.has(key), false, `${provider.id} authorization has ${key}`);
  }
  const state = url.searchParams.get("state");
  assert.equal(typeof state, "string", `${provider.id} authorization state`);
  assert.equal(state.includes("flow=redirect"), true, `${provider.id} full-page flow`);
  assert.equal(state.includes(`provider=${provider.id}`), true, `${provider.id} provider state`);
  assert.equal(snapshot.names.includes(DATABASE_NAME), true, "production database missing");
  assert.equal(snapshot.rows.length, 1, `${provider.id} stored transaction count`);
  const row = snapshot.rows[0];
  assert.equal(row.provider, provider.id);
  assert.equal(row.organizationId, "org-oauth");
  assert.equal(row.configId, "configA");
  assert.equal(row.completionKind, "redirect");
  assert.equal(row.redirectUri, `${origin}/return`);
  assert.equal(row.expectedState === state, true, `${provider.id} stored state`);
  assert.match(row.keyRef, /^[0-9a-f]{66}$/, `${provider.id} stored key`);
  assert.equal(state.includes(row.keyRef), true, `${provider.id} public key missing from state`);
  if (provider.pkce) {
    assert.equal(typeof row.verifier, "string", `${provider.id} verifier`);
    assert.equal(row.verifier.length >= 20, true, `${provider.id} verifier length`);
    assert.notEqual(row.verifier, "decoy-verifier");
    assert.equal(authUrl.includes(row.verifier), false, `${provider.id} verifier in URL`);
    assert.equal(snapshot.slot[provider.id], null, `${provider.id} shared verifier slot`);
  } else {
    assert.equal(row.verifier, null, `${provider.id} verifier`);
  }
  return row;
}

async function startProvider(context, origin, network, provider) {
  network.authUrls = [];
  network.exchanges = [];
  network.unexpected = [];
  const logs = [];
  const pending = expectAuth(network);
  const page = await context.newPage();
  watchPage(page, logs);
  await page.goto(`${origin}/start?provider=${provider.id}`, {
    waitUntil: "domcontentloaded",
  });
  let authUrl;
  try {
    authUrl = await pending;
  } catch (error) {
    const outcome = await page.evaluate(() => ({
      clientState: document.documentElement.dataset.clientState ?? null,
      startError: document.documentElement.dataset.startError ?? null,
      windowError: document.documentElement.dataset.windowError ?? null,
      unhandled: document.documentElement.dataset.unhandled ?? null,
      oauthError: document.documentElement.dataset.oauthError ?? null,
    })).catch(() => null);
    throw new Error(
      `${provider.id} start failed: ${scrub(error.message)} outcome=${JSON.stringify(publicOutcome(outcome))} unexpected=${network.unexpected.slice(0, 8).join(",")} logs=${logs.slice(-6).join(" | ")}`,
    );
  }
  const snapshot = await snapshotAfterStart(context, origin);
  if (!snapshot || snapshot.error || !snapshot.rows) {
    throw new Error(
      `${provider.id} snapshot failed: ${snapshot?.error ?? "empty"} unexpected=${network.unexpected.slice(0, 8).join(",")}`,
    );
  }
  const row = assertStartShape(provider, origin, authUrl, snapshot);
  assert.equal(network.exchanges.length, 0, `${provider.id} exchanged during start`);
  await page.close().catch(() => undefined);
  return { authUrl, row, state: new URL(authUrl).searchParams.get("state") };
}

async function openReturn(context, url, logs) {
  const page = await context.newPage();
  watchPage(page, logs);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  try {
    const outcome = await outcomeOf(page);
    return { page, outcome };
  } catch (error) {
    const partial = await page.evaluate(() => ({
      clientState: document.documentElement.dataset.clientState ?? null,
      oauthResult: document.documentElement.dataset.oauthResult ?? null,
      oauthError: document.documentElement.dataset.oauthError ?? null,
      windowError: document.documentElement.dataset.windowError ?? null,
      unhandled: document.documentElement.dataset.unhandled ?? null,
    })).catch(() => null);
    throw new Error(
      `return timed out: ${scrub(error.message)} outcome=${JSON.stringify(publicOutcome(partial))} logs=${logs.slice(-6).join(" | ")}`,
    );
  }
}

function assertExchanged(provider, row, outcome, exchange) {
  assert.equal(outcome.oauthResult, "redirect", `${provider.id} redirect result`);
  assert.equal(outcome.oauthIdToken, provider.idToken, `${provider.id} id token`);
  assert.equal(outcome.oauthPublicKey, row.keyRef, `${provider.id} returned public key`);
  assert.equal(outcome.windowError ?? null, null, `${provider.id} window error`);
  if (!provider.pkce) return;
  assert.ok(exchange, `${provider.id} exchange missing`);
  assert.notEqual(exchange.verifier, "decoy-verifier", `${provider.id} exchanged the decoy`);
  assert.equal(
    exchange.verifier === row.verifier,
    true,
    `${provider.id} exchanged verifier`,
  );
}

async function runRoundTrip(context, origin, network, provider, record) {
  await resetOrigin(context, origin);
  const started = await startProvider(context, origin, network, provider);
  const logs = [];
  const returned = await openReturn(
    context,
    returnUrl(origin, provider, started.state, { plantDecoy: true }),
    logs,
  );
  const exchange = network.exchanges.at(-1) ?? null;
  assertExchanged(provider, started.row, returned.outcome, exchange);
  assert.equal(network.exchanges.length, provider.pkce ? 1 : 0, `${provider.id} exchange count`);
  await returned.page.close();
  const secondLogs = [];
  const second = await openReturn(
    context,
    returnUrl(origin, provider, started.state, { plantDecoy: true }),
    secondLogs,
  );
  assert.equal(second.outcome.oauthResult, "error", `${provider.id} second claim`);
  assert.equal(network.exchanges.length, provider.pkce ? 1 : 0, `${provider.id} second exchange`);
  await second.page.close();
  const after = await readOnce(context, origin);
  assert.equal(after.rows.length, 0, `${provider.id} transaction removed`);
  record({
    caseId: `${provider.id}-start-return`,
    phase: "claimed",
    result: "passed",
    counts: {
      exchanges: network.exchanges.length,
      unexpected: network.unexpected.length,
    },
  });
}

async function runMismatch(context, origin, network, provider, kind, record) {
  await resetOrigin(context, origin);
  const started = await startProvider(context, origin, network, provider);
  const logs = [];
  const returned = await openReturn(
    context,
    returnUrl(origin, provider, started.state, {
      plantDecoy: true,
      forge: kind === "state",
      org: kind === "organization" ? "org-other" : undefined,
    }),
    logs,
  );
  assert.equal(returned.outcome.oauthResult, "error", `${provider.id} ${kind}`);
  assert.equal(network.exchanges.length, 0, `${provider.id} ${kind} exchange`);
  await returned.page.close();
  const after = await snapshotAfterStart(context, origin);
  assert.equal(after.rows.length, 1, `${provider.id} ${kind} retained transaction`);
  assert.equal(after.rows[0].expectedState, started.state, `${provider.id} ${kind} state`);
  if (provider.pkce) {
    assert.equal(
      after.rows[0].verifier === started.row.verifier,
      true,
      `${provider.id} ${kind} verifier`,
    );
  }
  record({
    caseId: `${provider.id}-${kind === "state" ? "wrong-state" : "organization-change"}`,
    phase: "retained",
    result: "passed",
    counts: { exchanges: 0, unexpected: network.unexpected.length },
  });
}

async function runTwoPages(context, origin, network, provider, record) {
  await resetOrigin(context, origin);
  const started = await startProvider(context, origin, network, provider);
  const logs = [];
  const url = returnUrl(origin, provider, started.state, { plantDecoy: true });
  const first = await context.newPage();
  const second = await context.newPage();
  watchPage(first, logs);
  watchPage(second, logs);
  await Promise.all([
    first.goto(url, { waitUntil: "domcontentloaded" }),
    second.goto(url, { waitUntil: "domcontentloaded" }),
  ]);
  const outcomes = await Promise.all([outcomeOf(first), outcomeOf(second)]);
  const redirects = outcomes.filter((outcome) => outcome.oauthResult === "redirect");
  const errors = outcomes.filter((outcome) => outcome.oauthResult === "error");
  assert.equal(redirects.length, 1, `${provider.id} two-page redirects`);
  assert.equal(errors.length, 1, `${provider.id} two-page errors`);
  assertExchanged(provider, started.row, redirects[0], network.exchanges[0] ?? null);
  assert.equal(network.exchanges.length, provider.pkce ? 1 : 0, `${provider.id} two-page exchanges`);
  await first.close();
  await second.close();
  const after = await readOnce(context, origin);
  assert.equal(after.rows.length, 0, `${provider.id} two-page transaction removed`);
  record({
    caseId: `${provider.id}-two-pages`,
    phase: "exclusive",
    result: "passed",
    counts: { exchanges: network.exchanges.length },
  });
}

async function main() {
  const { runDir } = parseArguments();
  assertOwnedRunDirectory(runDir);
  const { record } = createRecorder(runDir);
  assert.equal(process.execPath, NODE_PATH, "runner must use the accepted Node binary");
  verifyRuntimePins(record);
  const playwright = require(PLAYWRIGHT_ROOT);
  const bundleDir = bundleFixture(runDir, record);
  const { server, origin } = await startServer(bundleDir, record);
  const network = { authUrls: [], exchanges: [], unexpected: [], resolveAuth: null };
  let context;
  try {
    context = await playwright.chromium.launchPersistentContext(
      path.join(runDir, "profile"),
      launchOptions(runDir),
    );
    record({ caseId: "browser-launch", phase: "launched", result: "passed" });
    await installRoutes(context, origin, network);
    for (const provider of PROVIDERS) {
      await runRoundTrip(context, origin, network, provider, record);
    }
    await runMismatch(context, origin, network, providerById("discord"), "state", record);
    await runMismatch(
      context,
      origin,
      network,
      providerById("discord"),
      "organization",
      record,
    );
    await runMismatch(context, origin, network, providerById("google"), "state", record);
    await runTwoPages(context, origin, network, providerById("discord"), record);
    await runTwoPages(context, origin, network, providerById("google"), record);
    await resetOrigin(context, origin);
    record({ caseId: "provider-redirect", phase: "finished", result: "passed" });
  } finally {
    if (context) await context.close().catch(() => undefined);
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

main().catch((error) => {
  process.stderr.write(`${scrub(error && error.stack ? error.stack : error)}\n`);
  process.exit(1);
});
