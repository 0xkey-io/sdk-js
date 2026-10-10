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
const FIXTURE_PATH = path.join(__dirname, "provider-popup-fixture.tsx");
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
  { id: "discord", pkce: true, host: "discord.com" },
  { id: "x", pkce: true, host: "x.com" },
  { id: "facebook", pkce: true, host: "www.facebook.com" },
  { id: "google", pkce: false, host: "accounts.google.com" },
  { id: "apple", pkce: false, host: "account.apple.com" },
];
const AUTH_HOSTS = new Set(PROVIDERS.map((provider) => provider.host));
const FORBIDDEN_AUTH_KEYS = [
  "transactionId",
  "code_verifier",
  "captcha",
  "captcha_token",
  "code",
];

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function scrub(value) {
  return String(value)
    .replace(/[0-9a-f]{32,}/gi, "[hex]")
    .replace(/verifier=[^&\s]+/gi, "verifier=[redacted]")
    .replace(/code_verifier=[^&\s]+/gi, "code_verifier=[redacted]")
    .replace(/id_token=[^&\s]+/gi, "id_token=[redacted]")
    .replace(/publicKey=[^&\s]+/gi, "publicKey=[redacted]")
    .replace(/synthetic-[a-z0-9-]+/gi, "[fixture]")
    .replace(/decoy-verifier/g, "[decoy]")
    .slice(0, 280);
}

function fail(message) {
  throw new Error(message);
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
  assert.equal(result["--mode"], "popup", "--mode must be popup");
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
  const evidencePath = path.join(runDir, "evidence", "popup-observations.jsonl");
  const rawPath = path.join(runDir, "evidence", "popup-raw.log");
  writeExclusive(evidencePath, "");
  writeExclusive(rawPath, "");
  const started = Date.now();
  const record = (value) => {
    const safe = {
      caseId: value.caseId,
      phase: value.phase,
      result: value.result,
      counts: value.counts ?? null,
      elapsedMs: Date.now() - started,
    };
    fs.appendFileSync(evidencePath, `${JSON.stringify(safe)}\n`, { mode: 0o600 });
    fs.appendFileSync(rawPath, `${safe.caseId}: ${safe.result}\n`, { mode: 0o600 });
    process.stdout.write(`${safe.caseId}: ${safe.result}\n`);
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
  const playwrightBundle = fs.readFileSync(path.join(PLAYWRIGHT_ROOT, "lib/coreBundle.js"), "utf8");
  assert.equal(
    playwrightBundle.includes('"--disable-popup-blocking"'),
    true,
    "pinned Playwright is missing its popup-blocking switch",
  );
  record({ caseId: "runtime-pins", phase: "prelaunch", result: "matched" });
}

function bundleFixture(runDir, record) {
  const bundleDir = path.join(runDir, "tmp", "bundle");
  fs.mkdirSync(bundleDir, 0o700);
  const sourcePaths = [
    FIXTURE_PATH,
    path.join(__dirname, "oauth-provider-popup.cjs"),
    SHIM_PATH,
    path.join(PACKAGE_ROOT, "src/providers/client/Provider.tsx"),
    path.join(PACKAGE_ROOT, "src/utils/oauth/popup-flow.ts"),
    path.join(PACKAGE_ROOT, "src/utils/oauth/popup-response.ts"),
    path.join(PACKAGE_ROOT, "src/utils/oauth/popup-binding.ts"),
    path.join(PACKAGE_ROOT, "src/utils/oauth/completion.ts"),
    path.join(PACKAGE_ROOT, "src/utils/oauth/pkce.ts"),
    path.join(PACKAGE_ROOT, "src/utils/oauth/url.ts"),
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
  assert.ok(files.includes("provider-popup-fixture.js"), "bundle entry missing");
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
      harnessAddedPopupBlockingFlag: 0,
    },
  });
  return bundleDir;
}

function startServer(bundleDir, record) {
  const page =
    "<!doctype html><html><head><meta charset=utf-8><meta name=referrer content=no-referrer>" +
    "<title>oauth provider popup</title></head><body><div id=root></div>" +
    '<script type=module src="/bundle/provider-popup-fixture.js"></script></body></html>';
  // The popup poll only needs a same-origin URL. This document does not boot the provider.
  const inert = "<!doctype html><meta charset=utf-8><title>oauth popup return</title>";
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
    if (requestUrl.pathname === "/start") {
      response.writeHead(200, { ...headers, "content-type": "text/html; charset=utf-8" });
      response.end(page);
      return;
    }
    if (requestUrl.pathname === "/return" || requestUrl.pathname === "/inspect.html") {
      response.writeHead(200, { ...headers, "content-type": "text/html; charset=utf-8" });
      response.end(inert);
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
      network.authCount += 1;
      const target = route.request().url();
      await route.abort("blockedbyclient");
      if (network.resolveAuth) network.resolveAuth(target);
      return;
    }
    if (isExchange(requestUrl)) {
      const request = route.request();
      if (request.method() === "OPTIONS") {
        network.options += 1;
        await route.fulfill({ status: 204, headers: corsHeaders(request) });
        return;
      }
      const verifier = verifierFromBody(request.postData() ?? "");
      const decoy = verifier === "decoy-verifier";
      const leaked =
        typeof verifier === "string" &&
        typeof network.authUrl === "string" &&
        network.authUrl.includes(verifier);
      network.exchanges.push({
        host: requestUrl.hostname,
        verifierOk:
          typeof verifier === "string" && verifier.length >= 20 && !decoy && !leaked,
        decoy,
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

function forgedState(provider) {
  const base = `provider=${provider.id}&flow=popup&publicKey=${"02"}${"ab".repeat(32)}`;
  return provider.pkce ? `${base}&nonce=${"aa".repeat(16)}` : base;
}

function returnUrl(origin, provider, state, forge) {
  const usedState = forge ? forgedState(provider) : state;
  if (provider.pkce) {
    const params = new URLSearchParams();
    params.set("code", "synthetic-code");
    params.set("state", usedState);
    return `${origin}/return?${params.toString()}`;
  }
  if (provider.id === "apple") {
    return `${origin}/return#state=${usedState}&code=synthetic-apple-code&id_token=synthetic-apple-token`;
  }
  const hash = new URLSearchParams({
    state: usedState,
    id_token: "synthetic-google-token",
  }).toString();
  return `${origin}/return#${hash}`;
}

function parseAuthUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function assertAuthShape(provider, origin, authUrl) {
  const url = parseAuthUrl(authUrl);
  if (!url) fail(`${provider.id} authorization unparsed`);
  if (url.host !== provider.host) fail(`${provider.id} authorization host`);
  if (url.hash !== "") fail(`${provider.id} authorization hash`);
  for (const key of FORBIDDEN_AUTH_KEYS) {
    if (url.searchParams.has(key)) fail(`${provider.id} authorization has ${key}`);
  }
  const state = url.searchParams.get("state") || "";
  if (!state.includes("flow=popup")) fail(`${provider.id} popup flow`);
  if (state.includes("flow=redirect")) fail(`${provider.id} redirect flow`);
  if (!state.includes(`provider=${provider.id}`)) fail(`${provider.id} provider state`);
  if (!/(?:^|&)publicKey=[0-9a-f]{64,}/i.test(state)) {
    fail(`${provider.id} public key missing from state`);
  }
  if (url.searchParams.get("redirect_uri") !== `${origin}/return`) {
    fail(`${provider.id} redirect uri`);
  }
  return state;
}

function assertStorage(provider, storage, phase) {
  if (!storage || storage.error) fail(`${provider.id} ${phase} storage`);
  if (storage.dbPresent !== false || storage.rows !== 0) {
    fail(`${provider.id} ${phase} transaction database`);
  }
  for (const id of ["discord", "x", "facebook"]) {
    if (storage[id] !== "decoy") fail(`${provider.id} ${phase} verifier slot`);
  }
}

function assertExchange(provider, exchange) {
  if (!provider.pkce) {
    if (exchange) fail(`${provider.id} unexpected exchange`);
    return;
  }
  if (!exchange) fail(`${provider.id} exchange missing`);
  const expectedHost = provider.id === "facebook" ? "graph.facebook.com" : "auth.example.test";
  if (exchange.host !== expectedHost) fail(`${provider.id} exchange host`);
  if (exchange.decoy) fail(`${provider.id} exchanged decoy`);
  if (!exchange.verifierOk) fail(`${provider.id} verifier shape`);
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

async function readStorage(page) {
  return page.evaluate(async (name) => {
    const names = (await indexedDB.databases()).map((database) => database.name || "");
    let rows = 0;
    if (names.includes(name)) {
      rows = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(new Error("snapshot-open-failed"));
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("transactions")) {
            database.close();
            resolve(0);
            return;
          }
          const requestRows = database
            .transaction("transactions", "readonly")
            .objectStore("transactions")
            .getAll();
          requestRows.onsuccess = () => {
            database.close();
            resolve(requestRows.result.length);
          };
          requestRows.onerror = () => {
            database.close();
            reject(new Error("snapshot-read-failed"));
          };
        };
      });
    }
    const classify = (key) => {
      const value = window.localStorage.getItem(key);
      if (value === null) return "empty";
      if (value === "decoy-verifier") return "decoy";
      return "replaced";
    };
    return {
      dbPresent: names.includes(name),
      rows,
      discord: classify("discord_verifier"),
      x: classify("x_verifier"),
      facebook: classify("facebook_verifier"),
    };
  }, DATABASE_NAME);
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

async function openerFailure(page) {
  return page
    .evaluate(() => ({
      clientState: document.documentElement.dataset.clientState || "",
      startError: document.documentElement.dataset.startError || "",
      windowError: document.documentElement.dataset.windowError || "",
      unhandled: document.documentElement.dataset.unhandled || "",
      oauthError: document.documentElement.dataset.oauthError || "",
    }))
    .catch(() => null);
}

async function openStart(context, origin, network, provider) {
  network.authCount = 0;
  network.authUrl = "";
  network.exchanges = [];
  network.unexpected = [];
  network.options = 0;
  const logs = [];
  const page = await context.newPage();
  watchPage(page, logs);
  const popupPromise = page.waitForEvent("popup", { timeout: 30_000 });
  const authPromise = expectAuth(network);
  await page.goto(`${origin}/start?provider=${provider.id}&plantDecoy=1`, {
    waitUntil: "domcontentloaded",
  });
  let authUrl;
  let popup;
  try {
    [popup, authUrl] = await Promise.all([popupPromise, authPromise]);
  } catch (error) {
    const outcome = await openerFailure(page);
    fail(
      `${provider.id} start failed: ${scrub(error.message)} outcome=${scrub(JSON.stringify(outcome))} unexpected=${network.unexpected.slice(0, 8).join(",")} logs=${logs.slice(-6).join(" | ")}`,
    );
  }
  if (!popup) fail(`${provider.id} popup missing`);
  network.authUrl = authUrl;
  const state = assertAuthShape(provider, origin, authUrl);
  if (network.authCount !== 1) fail(`${provider.id} auth navigations ${network.authCount}`);
  if (network.exchanges.length !== 0) fail(`${provider.id} exchanged during start`);
  if (network.unexpected.length !== 0) {
    fail(`${provider.id} unexpected during start ${network.unexpected.slice(0, 8).join(",")}`);
  }
  const storage = await readStorage(page);
  assertStorage(provider, storage, "start");
  return { page, popup, state, logs };
}

async function waitOutcome(page, logs) {
  try {
    await page.waitForFunction(
      () => {
        const data = document.documentElement.dataset;
        return Boolean(
          data.oauthResult || data.startError || data.windowError || data.unhandled,
        );
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    const outcome = await openerFailure(page);
    fail(
      `popup outcome timed out: ${scrub(error.message)} outcome=${scrub(JSON.stringify(outcome))} logs=${logs.slice(-6).join(" | ")}`,
    );
  }
  return page.evaluate(() => {
    const data = document.documentElement.dataset;
    return {
      oauthResult: data.oauthResult || "",
      idTokenMatches: data.idTokenMatches === "1",
      hasPublicKey: data.hasPublicKey === "1",
      completions: Number(data.oauthCompletions || "0"),
      startError: data.startError || "",
      windowError: data.windowError || "",
      unhandled: data.unhandled || "",
      oauthError: data.oauthError || "",
    };
  });
}

async function deliver(opener, url) {
  const assigned = await opener.evaluate((target) => {
    const child = window.__oauthPopupProbe && window.__oauthPopupProbe[0];
    if (!child) return "missing";
    if (child.closed) return "closed";
    try {
      child.location.href = target;
      return "assigned";
    } catch {
      return "assign-failed";
    }
  }, url);
  if (assigned !== "assigned") fail(`popup return ${assigned}`);
  try {
    await opener.waitForFunction(
      () => {
        const child = window.__oauthPopupProbe && window.__oauthPopupProbe[0];
        if (!child || child.closed) return false;
        try {
          const current = new URL(child.location.href);
          const hash = current.hash;
          return (
            current.pathname === "/return" &&
            (current.search.includes("code=") ||
              hash.includes("id_token=") ||
              hash.includes("state="))
          );
        } catch {
          return false;
        }
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    const readable = await opener
      .evaluate(() => {
        const child = window.__oauthPopupProbe && window.__oauthPopupProbe[0];
        if (!child) return "missing";
        if (child.closed) return "closed";
        try {
          const current = new URL(child.location.href);
          const query = [...current.searchParams.keys()].sort().join(",");
          const hash = current.hash
            ? [...new URLSearchParams(current.hash.slice(1)).keys()].sort().join(",")
            : "";
          return `path=${current.pathname} query=${query || "-"} hash=${hash || "-"}`;
        } catch {
          return "unreadable";
        }
      })
      .catch(() => "unreadable");
    fail(`popup return unread: ${readable} ${scrub(error.message)}`);
  }
}

function countsFrom(network, storage, extra) {
  return {
    exchanges: network.exchanges.length,
    unexpected: network.unexpected.length,
    authNavigations: network.authCount,
    indexedDbRows: storage.rows,
    dbPresent: storage.dbPresent ? 1 : 0,
    slotDecoy:
      storage.discord === "decoy" && storage.x === "decoy" && storage.facebook === "decoy"
        ? 1
        : 0,
    exchangedDecoy: network.exchanges.some((exchange) => exchange.decoy) ? 1 : 0,
    ...extra,
  };
}

async function runRoundTrip(context, origin, network, provider, record) {
  await resetOrigin(context, origin);
  const started = await openStart(context, origin, network, provider);
  await deliver(started.page, returnUrl(origin, provider, started.state, false));
  const outcome = await waitOutcome(started.page, started.logs);
  if (outcome.oauthResult !== "popup") fail(`${provider.id} popup result`);
  if (!outcome.idTokenMatches) fail(`${provider.id} id token`);
  if (!outcome.hasPublicKey) fail(`${provider.id} public key`);
  if (outcome.completions !== 1) fail(`${provider.id} completions ${outcome.completions}`);
  if (outcome.startError) fail(`${provider.id} start error ${scrub(outcome.startError)}`);
  if (outcome.windowError || outcome.unhandled) fail(`${provider.id} page error`);
  if (network.exchanges.length !== (provider.pkce ? 1 : 0)) {
    fail(`${provider.id} exchange count ${network.exchanges.length}`);
  }
  assertExchange(provider, network.exchanges[0] ?? null);
  const storage = await readStorage(started.page);
  assertStorage(provider, storage, "return");
  const exchangesAfterReturn = network.exchanges.length;
  const second = await context.newPage();
  await second.goto(returnUrl(origin, provider, started.state, false), {
    waitUntil: "domcontentloaded",
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  if (network.exchanges.length !== exchangesAfterReturn) fail(`${provider.id} second exchange`);
  const afterSecond = await waitOutcome(started.page, started.logs).catch(() => outcome);
  if (afterSecond.completions !== 1) fail(`${provider.id} second completion`);
  await second.close();
  const finalStorage = await readStorage(started.page);
  assertStorage(provider, finalStorage, "second");
  if (network.unexpected.length !== 0) {
    fail(`${provider.id} unexpected ${network.unexpected.slice(0, 8).join(",")}`);
  }
  network.authUrl = "";
  record({
    caseId: `${provider.id}-start-return`,
    phase: "claimed",
    result: "passed",
    counts: countsFrom(network, finalStorage, {
      flowPopup: 1,
      idTokenMatches: 1,
      hasPublicKey: 1,
      completions: 1,
      secondExchanges: 0,
    }),
  });
}

async function runWrongState(context, origin, network, provider, record) {
  await resetOrigin(context, origin);
  const started = await openStart(context, origin, network, provider);
  await deliver(started.page, returnUrl(origin, provider, started.state, true));
  const outcome = await waitOutcome(started.page, started.logs);
  if (outcome.oauthResult === "popup") fail(`${provider.id} wrong-state completed`);
  if (outcome.completions !== 0) fail(`${provider.id} wrong-state completions`);
  if (outcome.startError !== "OAuth popup response was rejected.") {
    fail(`${provider.id} wrong-state result ${scrub(outcome.startError)}`);
  }
  if (network.exchanges.length !== 0) fail(`${provider.id} wrong-state exchange`);
  const storage = await readStorage(started.page);
  assertStorage(provider, storage, "wrong-state");
  if (network.unexpected.length !== 0) {
    fail(`${provider.id} wrong-state unexpected ${network.unexpected.slice(0, 8).join(",")}`);
  }
  network.authUrl = "";
  record({
    caseId: `${provider.id}-wrong-state`,
    phase: "rejected",
    result: "passed",
    counts: countsFrom(network, storage, {
      flowPopup: 1,
      idTokenMatches: 0,
      hasPublicKey: 0,
      completions: 0,
      startRejected: 1,
    }),
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
  const network = {
    authCount: 0,
    authUrl: "",
    exchanges: [],
    unexpected: [],
    options: 0,
    resolveAuth: null,
  };
  let context;
  try {
    context = await playwright.chromium.launchPersistentContext(
      path.join(runDir, "profile"),
      launchOptions(runDir),
    );
    record({
      caseId: "browser-launch",
      phase: "launched",
      result: "passed",
      counts: { harnessAddedPopupBlockingFlag: 0 },
    });
    await installRoutes(context, origin, network);
    for (const provider of PROVIDERS) {
      await runRoundTrip(context, origin, network, provider, record);
    }
    await runWrongState(context, origin, network, providerById("discord"), record);
    await runWrongState(context, origin, network, providerById("google"), record);
    await resetOrigin(context, origin);
    record({ caseId: "provider-popup", phase: "finished", result: "passed" });
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
