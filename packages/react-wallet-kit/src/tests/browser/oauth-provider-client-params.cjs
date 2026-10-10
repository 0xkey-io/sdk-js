"use strict";

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
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
const SERVICES_GO =
  "/Users/torben/codes/0xkey-workspace/.work/oauth-turnkey-parity/services/go";
const FIXTURE_PATH = path.join(__dirname, "provider-client-params-fixture.tsx");
const SHIM_PATH = path.join(__dirname, "provider-redirect-process-shim.js");
const STUB_PATH = path.join(__dirname, "provider-redirect-native-stub.js");
const MODES = ["unavailable", "closed", "enabled"];
const EXPECTED_CLASS = {
  unavailable: "client-params-unavailable",
  closed: "otp-rejected",
  enabled: "turnstile-unavailable",
};
const PUBLIC_FIXTURE_BODY = '{"turnstileSiteKey":"PUBLIC_TEST_SITE_KEY"}';
const PINNED = new Map([
  [NODE_PATH, "53dc65febda99ecaafe692de5ec60efdc2f7bd4fb14d1ba8cd30dc2af103953f"],
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
  [BROWSER_PATH, "11e393326c7d20a7c56641a7c65def33ea9c280da3b0b74cf8563b07989a0ee3"],
  [ESBUILD_BIN, "3e030ee2aa86ad3c33e5e95ae0e53bb03de40e0da35c9b1180a67de4a497cae5"],
  [ESBUILD_PACKAGE, "cb7d5b1fe478f8cbaae566a86031b6fdf5f7d444354f35d1cb3cba9adf6d2935"],
]);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function scrub(value) {
  return String(value)
    .replaceAll("PUBLIC_TEST_SITE_KEY", "[site-key]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/organizationId[^,\n}]*/gi, "organizationId=[redacted]")
    .replace(/[0-9a-f]{32,}/gi, "[hex]")
    .slice(0, 280);
}

function parseArguments() {
  const allowed = new Set(["--run-dir"]);
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
  return { runDir: result["--run-dir"] };
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
  const evidencePath = path.join(runDir, "evidence", "client-params-observations.jsonl");
  writeExclusive(evidencePath, "");
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
    fs.appendFileSync(evidencePath, `${JSON.stringify(safe)}\n`);
    process.stdout.write(
      `${safe.caseId}: ${safe.result}${safe.reason ? ` (${safe.reason})` : ""}\n`,
    );
  };
  return { evidencePath, record };
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

function sourcePaths() {
  return [
    FIXTURE_PATH,
    SHIM_PATH,
    path.join(PACKAGE_ROOT, "src/providers/client/Provider.tsx"),
    path.join(PACKAGE_ROOT, "../core/src/client-params.ts"),
    path.join(PACKAGE_ROOT, "src/utils/captcha-attempt-gate.ts"),
    path.join(PACKAGE_ROOT, "src/utils/captcha-turnstile-renderer.ts"),
    path.join(SERVICES_GO, "internal/authproxy/handler/client_params.go"),
    path.join(SERVICES_GO, "internal/authproxy/server.go"),
    path.join(SERVICES_GO, "internal/authproxy/client_params_browser_serve_test.go"),
  ];
}

function bundleFixture(runDir, record) {
  const bundleDir = path.join(runDir, "tmp", "bundle");
  fs.mkdirSync(bundleDir, 0o700);
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
      `--alias:react-native=${STUB_PATH}`,
      `--alias:react-native-keychain=${STUB_PATH}`,
      `--alias:@react-native-async-storage/async-storage=${STUB_PATH}`,
      `--alias:@0xkey-io/react-native-passkey-stamper=${STUB_PATH}`,
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
    throw new Error(`provider bundle failed (${built.status}): ${scrub(built.stderr || built.stdout)}`);
  }
  const files = fs.readdirSync(bundleDir).sort();
  assert.ok(files.includes("provider-client-params-fixture.js"), "bundle entry missing");
  const hashes = {
    sources: sourcePaths().map((file) => ({ file, sha256: sha256(fs.readFileSync(file)) })),
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

function compileServer(runDir, record) {
  const binary = path.join(runDir, "tmp", "authproxy.test");
  const compiled = spawnSync(
    "go",
    ["test", "-c", "-o", binary, "./internal/authproxy"],
    { cwd: SERVICES_GO, encoding: "utf8", timeout: 180000 },
  );
  if (compiled.status !== 0) {
    throw new Error(`auth proxy compile failed (${compiled.status}): ${scrub(compiled.stderr || compiled.stdout)}`);
  }
  const stat = fs.lstatSync(binary);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), "compiled server is not a regular file");
  assert.ok((stat.mode & 0o111) !== 0, "compiled server is not executable");
  record({
    caseId: "authproxy-compile",
    phase: "prelaunch",
    result: "compiled",
    counts: { bytes: stat.size },
  });
  return binary;
}

function startServer(bundleDir, record) {
  let connectOrigin = "";
  const page =
    "<!doctype html><html><head><meta charset=utf-8><meta name=referrer content=no-referrer>" +
    "<title>client params</title></head><body><div id=root></div>" +
    '<script type=module src="/bundle/provider-client-params-fixture.js"></script></body></html>';
  const server = http.createServer((request, response) => {
    const expectedHost = `127.0.0.1:${server.address().port}`;
    if (request.method !== "GET" || request.headers.host !== expectedHost) {
      response.writeHead(400, { "content-type": "text/plain", "cache-control": "no-store" });
      response.end("rejected");
      return;
    }
    const requestUrl = new URL(request.url, `http://${expectedHost}`);
    const connect = connectOrigin ? `'self' ${connectOrigin}` : "'self'";
    const headers = {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; " +
        `connect-src ${connect}; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; ` +
        "base-uri 'none'; form-action 'none'; frame-src 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    };
    if (requestUrl.pathname === "/start") {
      response.writeHead(200, { ...headers, "content-type": "text/html; charset=utf-8" });
      response.end(page);
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
      assert.equal(address.address, "127.0.0.1");
      const origin = `http://127.0.0.1:${address.port}`;
      record({ caseId: "owned-origin", phase: "listen", result: "ready" });
      resolve({
        server,
        origin,
        setConnectOrigin(value) {
          connectOrigin = value;
        },
      });
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

function assertLoopback(raw) {
  const url = new URL(raw);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(url.port);
  assert.equal(url.username, "");
  assert.equal(url.password, "");
  assert.equal(url.pathname, "/");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  assert.equal(raw, url.origin);
  assert.notEqual(url.port, "1");
  return url.origin;
}

function openLog(file) {
  writeExclusive(file, "");
  return fs.createWriteStream(file, { flags: "a", mode: 0o600 });
}

function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function waitForAddress(file, child, spawnFailure) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const failed = spawnFailure();
      if (failed) {
        clearInterval(timer);
        reject(failed);
        return;
      }
      if (child.exitCode !== null || child.signalCode) {
        clearInterval(timer);
        reject(new Error(`go exited ${child.exitCode ?? child.signalCode} before listen`));
        return;
      }
      if (!fs.existsSync(file)) {
        if (Date.now() - started > 20000) {
          clearInterval(timer);
          reject(new Error("timed out waiting for listen address"));
        }
        return;
      }
      const text = fs.readFileSync(file, "utf8").trim();
      if (!text) return;
      clearInterval(timer);
      resolve(assertLoopback(text));
    }, 50);
  });
}

function readHits(file) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), "hits file is not a regular file");
  assert.equal(stat.mode & 0o777, 0o600);
  const text = fs.readFileSync(file, "utf8").trim();
  assert.match(text, /^(?:0|[1-9][0-9]*)$/);
  return Number(text);
}

function safeHits(file) {
  try {
    return fs.existsSync(file) ? readHits(file) : -1;
  } catch {
    return -1;
  }
}

function responseFlags(text) {
  const trimmed = text.trim();
  return {
    siteKeyPresent: trimmed.includes("turnstileSiteKey"),
    siteKeyIsPublicFixture: trimmed === PUBLIC_FIXTURE_BODY,
    responseHasContact: /example\.test|@/.test(text),
    cacheNoStore: false,
  };
}

async function observe(route, network, proxyOrigin) {
  const requestUrl = new URL(route.request().url());
  if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
    await route.continue();
    return;
  }
  if (requestUrl.origin !== proxyOrigin) {
    if (requestUrl.hostname === "challenges.cloudflare.com") {
      network.turnstile += 1;
      await route.abort("failed");
      return;
    }
    network.unexpected += 1;
    await route.abort("blockedbyclient");
    return;
  }
  const headers = route.request().headers();
  if (Object.prototype.hasOwnProperty.call(headers, "x-captcha-token")) network.captchaHeader = true;
  if (requestUrl.searchParams.has("captcha_config_id")) network.captchaQuery = true;
  if (route.request().method() === "OPTIONS") {
    network.options += 1;
    await route.continue();
    return;
  }
  const response = await route.fetch();
  const text = await response.text();
  const flags = responseFlags(text);
  const responseHeaders = { ...response.headers() };
  const cache = String(responseHeaders["cache-control"] || "");
  delete responseHeaders["content-length"];
  delete responseHeaders["transfer-encoding"];
  const record = {
    status: response.status(),
    siteKeyPresent: flags.siteKeyPresent,
    siteKeyIsPublicFixture: flags.siteKeyIsPublicFixture,
    responseHasContact: flags.responseHasContact,
    cacheNoStore: cache.includes("no-store"),
  };
  if (route.request().method() === "POST" && requestUrl.pathname === "/v1/wallet_kit_client_params") {
    network.clientParams.push(record);
  } else if (route.request().method() === "POST" && requestUrl.pathname === "/v1/otp_init_v2") {
    network.otp.push(record);
  } else {
    network.unexpected += 1;
  }
  await route.fulfill({ status: response.status(), headers: responseHeaders, body: text });
}

function installRoutes(context, pageOrigin, proxyOrigin, network) {
  return context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
      await route.continue();
      return;
    }
    if (requestUrl.origin === pageOrigin) {
      await route.continue();
      return;
    }
    await observe(route, network, proxyOrigin);
  });
}

function countsOf(network, hits, dataset) {
  const clientParams = network.clientParams[0] ?? null;
  const otp = network.otp[0] ?? null;
  return {
    clientParamsPost: network.clientParams.length,
    clientParamsStatus: clientParams ? clientParams.status : null,
    siteKeyPresent: clientParams ? clientParams.siteKeyPresent : null,
    siteKeyIsPublicFixture: clientParams ? clientParams.siteKeyIsPublicFixture : null,
    cacheNoStore: clientParams ? clientParams.cacheNoStore : null,
    options: network.options,
    otpPost: network.otp.length,
    otpStatus: otp ? otp.status : null,
    otpResponseHasContact: network.otp.some((item) => item.responseHasContact) ||
      network.clientParams.some((item) => item.responseHasContact),
    captchaHeader: network.captchaHeader,
    captchaQuery: network.captchaQuery,
    turnstileRequests: network.turnstile,
    unexpectedHosts: network.unexpected,
    coordinatorHits: hits,
    otpClass: dataset.otpClass,
    clientState: dataset.clientState,
  };
}

function assertMode(mode, counts) {
  const problems = [];
  if (counts.otpClass !== EXPECTED_CLASS[mode]) problems.push(`class ${counts.otpClass}`);
  if (counts.clientState !== "ready") problems.push(`clientState ${counts.clientState}`);
  if (counts.clientParamsPost !== 1) problems.push(`clientParamsPost ${counts.clientParamsPost}`);
  if (counts.captchaHeader !== false) problems.push("captcha header");
  if (counts.captchaQuery !== false) problems.push("captcha query");
  if (counts.otpResponseHasContact !== false) problems.push("response had contact");
  if (counts.cacheNoStore !== true) problems.push("cache");
  if (counts.unexpectedHosts !== 0) problems.push(`unexpected ${counts.unexpectedHosts}`);
  if (counts.coordinatorHits !== 0) problems.push(`coordinator ${counts.coordinatorHits}`);
  if (mode === "unavailable") {
    if (counts.clientParamsStatus !== 503) problems.push(`status ${counts.clientParamsStatus}`);
    if (counts.siteKeyPresent !== false) problems.push("site key present");
    if (counts.otpPost !== 0) problems.push(`otpPost ${counts.otpPost}`);
    if (counts.turnstileRequests !== 0) problems.push(`turnstile ${counts.turnstileRequests}`);
  } else if (mode === "closed") {
    if (counts.clientParamsStatus !== 200) problems.push(`status ${counts.clientParamsStatus}`);
    if (counts.siteKeyPresent !== false || counts.siteKeyIsPublicFixture !== false) problems.push("site key present");
    if (counts.otpPost !== 1 || counts.otpStatus !== 403) problems.push(`otp ${counts.otpPost}/${counts.otpStatus}`);
    if (counts.turnstileRequests !== 0) problems.push(`turnstile ${counts.turnstileRequests}`);
  } else if (mode === "enabled") {
    if (counts.clientParamsStatus !== 200) problems.push(`status ${counts.clientParamsStatus}`);
    if (counts.siteKeyIsPublicFixture !== true) problems.push("site key fixture mismatch");
    if (counts.otpPost !== 0) problems.push(`otpPost ${counts.otpPost}`);
    if (counts.turnstileRequests !== 1) problems.push(`turnstile ${counts.turnstileRequests}`);
  }
  if (problems.length > 0) throw new Error(problems.join(", "));
}

async function runMode(mode, tools, record) {
  const { runDir, binary, pageOrigin, playwright, setConnectOrigin } = tools;
  const addrFile = path.join(runDir, "tmp", `go-addr-${mode}`);
  const hitsFile = path.join(runDir, "tmp", `go-hits-${mode}`);
  const child = spawn(
    binary,
    ["-test.run", "^TestClientParamsBrowserServe$", "-test.timeout", "3m"],
    {
      cwd: SERVICES_GO,
      env: {
        PATH: "/usr/bin:/bin:/opt/homebrew/bin",
        HOME: process.env.HOME,
        TMPDIR: path.join(runDir, "tmp"),
        LANG: "C",
        LC_ALL: "C",
        OXKEY_CLIENT_PARAMS_BROWSER: "1",
        OXKEY_CLIENT_PARAMS_MODE: mode,
        OXKEY_CLIENT_PARAMS_ORIGIN: pageOrigin,
        OXKEY_CLIENT_PARAMS_ADDR_FILE: addrFile,
        OXKEY_CLIENT_PARAMS_HITS_FILE: hitsFile,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let spawnError = null;
  child.once("error", (error) => {
    spawnError = error;
  });
  child.stdout.pipe(openLog(path.join(runDir, "tmp", `go-stdout-${mode}.log`)));
  child.stderr.pipe(openLog(path.join(runDir, "tmp", `go-stderr-${mode}.log`)));
  const profileDir = path.join(runDir, "profile", mode);
  fs.mkdirSync(profileDir, 0o700);
  fs.chmodSync(profileDir, 0o700);
  let context;
  const network = {
    clientParams: [],
    otp: [],
    options: 0,
    turnstile: 0,
    unexpected: 0,
    captchaHeader: false,
    captchaQuery: false,
  };
  try {
    const proxyOrigin = await waitForAddress(addrFile, child, () => spawnError);
    setConnectOrigin(proxyOrigin);
    context = await playwright.chromium.launchPersistentContext(profileDir, launchOptions(runDir));
    await installRoutes(context, pageOrigin, proxyOrigin, network);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${pageOrigin}/start?proxy=${encodeURIComponent(proxyOrigin)}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForFunction(() => document.documentElement.dataset.otpClass, null, {
      timeout: 25000,
    });
    const dataset = await page.evaluate(() => ({
      clientState: document.documentElement.dataset.clientState || "",
      otpClass: document.documentElement.dataset.otpClass || "",
    }));
    const counts = countsOf(network, readHits(hitsFile), dataset);
    assertMode(mode, counts);
    record({ caseId: mode, phase: "browser", result: "passed", counts });
  } catch (error) {
    let dataset = { clientState: "", otpClass: "" };
    if (context) {
      const page = context.pages()[0];
      if (page) {
        dataset = await page
          .evaluate(() => ({
            clientState: document.documentElement.dataset.clientState || "",
            otpClass: document.documentElement.dataset.otpClass || "",
          }))
          .catch(() => dataset);
      }
    }
    const counts = countsOf(network, safeHits(hitsFile), dataset);
    record({
      caseId: mode,
      phase: "browser",
      result: "failed",
      reason: error instanceof Error ? error.message : "mode failed",
      counts,
    });
    throw error;
  } finally {
    if (context) await context.close().catch(() => undefined);
    await stopChild(child);
  }
}

async function main() {
  const { runDir } = parseArguments();
  assertOwnedRunDirectory(runDir);
  const { record } = createRecorder(runDir);
  assert.equal(process.execPath, NODE_PATH, "runner must use the accepted Node binary");
  verifyRuntimePins(record);
  const playwright = require(PLAYWRIGHT_ROOT);
  const bundleDir = bundleFixture(runDir, record);
  const binary = compileServer(runDir, record);
  const { server, origin, setConnectOrigin } = await startServer(bundleDir, record);
  const failures = [];
  try {
    for (const mode of MODES) {
      try {
        await runMode(mode, { runDir, binary, pageOrigin: origin, playwright, setConnectOrigin }, record);
      } catch (error) {
        failures.push(`${mode}: ${scrub(error instanceof Error ? error.message : "failed")}`);
      }
    }
    if (failures.length > 0) {
      record({ caseId: "client-params", phase: "finished", result: "failed", reason: failures.join("; ") });
      process.exitCode = 1;
      return;
    }
    record({ caseId: "client-params", phase: "finished", result: "passed" });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

main().catch((error) => {
  process.stderr.write(`${scrub(error && error.stack ? error.stack : error)}\n`);
  process.exitCode = 1;
});
