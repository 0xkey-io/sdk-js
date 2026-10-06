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
const FIXTURE_PATH = path.join(__dirname, "provider-client-params-routes-fixture.tsx");
const SHIM_PATH = path.join(__dirname, "provider-redirect-process-shim.js");
const STUB_PATH = path.join(__dirname, "provider-redirect-native-stub.js");
const MODES = ["unavailable", "closed", "enabled"];
const STEPS = ["otp-init-v2", "otp-init", "signup", "signup-v2"];
const STEP_PATH = {
  "otp-init-v2": "/v1/otp_init_v2",
  "otp-init": "/v1/otp_init",
  signup: "/v1/signup",
  "signup-v2": "/v1/signup_v2",
};
const STEP_CLASS = {
  "otp-init-v2": "classOtpInitV2",
  "otp-init": "classOtpInit",
  signup: "classSignup",
  "signup-v2": "classSignupV2",
};
const EXPECTED_CLASS = {
  unavailable: {
    "otp-init-v2": "client-params-unavailable",
    "otp-init": "client-params-unavailable",
    signup: "client-params-unavailable",
    "signup-v2": "client-params-unavailable",
  },
  closed: {
    "otp-init-v2": "otp-rejected",
    "otp-init": "response-read",
    signup: "response-read",
    "signup-v2": "response-read",
  },
  enabled: {
    "otp-init-v2": "turnstile-unavailable",
    "otp-init": "turnstile-unavailable",
    signup: "turnstile-unavailable",
    "signup-v2": "turnstile-unavailable",
  },
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
  const evidencePath = path.join(runDir, "evidence", "protected-routes-observations.jsonl");
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
    path.join(PACKAGE_ROOT, "../core/src/__generated__/sdk-client-base.ts"),
    path.join(PACKAGE_ROOT, "src/utils/captcha-attempt-gate.ts"),
    path.join(PACKAGE_ROOT, "src/utils/captcha-turnstile-renderer.ts"),
    path.join(SERVICES_GO, "internal/authproxy/handler/client_params.go"),
    path.join(SERVICES_GO, "internal/authproxy/handler/otp.go"),
    path.join(SERVICES_GO, "internal/authproxy/handler/signup.go"),
    path.join(SERVICES_GO, "internal/authproxy/captcha_routes.go"),
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
  assert.ok(files.includes("provider-client-params-routes-fixture.js"), "bundle entry missing");
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
    "<title>protected routes</title></head><body><div id=root></div>" +
    '<script type=module src="/bundle/provider-client-params-routes-fixture.js"></script></body></html>';
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
  const captchaHeader = Object.prototype.hasOwnProperty.call(headers, "x-captcha-token");
  const captchaQuery = requestUrl.searchParams.has("captcha_config_id");
  if (captchaHeader) network.captchaHeader = true;
  if (captchaQuery) network.captchaQuery = true;
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
    path: requestUrl.pathname,
    status: response.status(),
    siteKeyPresent: flags.siteKeyPresent,
    siteKeyIsPublicFixture: flags.siteKeyIsPublicFixture,
    responseHasContact: flags.responseHasContact,
    cacheNoStore: cache.includes("no-store"),
    captchaHeader,
    captchaQuery,
  };
  if (route.request().method() === "POST" && requestUrl.pathname === "/v1/wallet_kit_client_params") {
    network.clientParams.push(record);
  } else if (
    route.request().method() === "POST" &&
    Object.prototype.hasOwnProperty.call(STEP_PATH, pathStep(requestUrl.pathname))
  ) {
    network.routes.push(record);
  } else {
    network.unexpected += 1;
  }
  await route.fulfill({ status: response.status(), headers: responseHeaders, body: text });
}

function pathStep(pathname) {
  return Object.keys(STEP_PATH).find((step) => STEP_PATH[step] === pathname) ?? "";
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

function readDataset(page) {
  return page.evaluate(() => ({
    clientState: document.documentElement.dataset.clientState || "",
    boot: document.documentElement.dataset.boot || "",
    done: document.documentElement.dataset.done || "",
    step: document.documentElement.dataset.step || "",
    settle: document.documentElement.dataset.settle || "",
    classOtpInitV2: document.documentElement.dataset.classOtpInitV2 || "",
    classOtpInit: document.documentElement.dataset.classOtpInit || "",
    classSignup: document.documentElement.dataset.classSignup || "",
    classSignupV2: document.documentElement.dataset.classSignupV2 || "",
  }));
}

function assertMode(mode, steps, tail) {
  const problems = [];
  if (tail.clientState !== "ready") problems.push(`clientState ${tail.clientState}`);
  if (tail.boot) problems.push(`boot ${tail.boot}`);
  if (tail.done !== "1") problems.push("done missing");
  if (tail.clientParamsPost !== 4) problems.push(`clientParamsPost ${tail.clientParamsPost}`);
  if (tail.captchaHeader !== false) problems.push("captcha header");
  if (tail.captchaQuery !== false) problems.push("captcha query");
  if (tail.responseHasContact !== false) problems.push("response had contact");
  if (tail.unexpectedHosts !== 0) problems.push(`unexpected ${tail.unexpectedHosts}`);
  for (const step of steps) {
    const expectedClass = EXPECTED_CLASS[mode][step.step];
    if (step.className !== expectedClass) problems.push(`${step.step} class ${step.className}`);
    if (step.clientParamsPost !== 1) problems.push(`${step.step} clientParams ${step.clientParamsPost}`);
    if (step.cacheNoStore !== true) problems.push(`${step.step} cache`);
    if (step.captchaHeader !== false || step.captchaQuery !== false) {
      problems.push(`${step.step} captcha marker`);
    }
    if (mode === "unavailable") {
      if (step.clientParamsStatus !== 503) problems.push(`${step.step} params ${step.clientParamsStatus}`);
      if (step.siteKeyPresent !== false) problems.push(`${step.step} site key`);
      if (step.routePost !== 0) problems.push(`${step.step} post ${step.routePost}`);
      if (step.turnstileDelta !== 0) problems.push(`${step.step} turnstile ${step.turnstileDelta}`);
      if (step.coordinatorDelta !== 0) problems.push(`${step.step} coordinator ${step.coordinatorDelta}`);
    } else if (mode === "closed") {
      if (step.clientParamsStatus !== 200) problems.push(`${step.step} params ${step.clientParamsStatus}`);
      if (step.siteKeyPresent !== false || step.siteKeyIsPublicFixture !== false) {
        problems.push(`${step.step} site key`);
      }
      if (step.turnstileDelta !== 0) problems.push(`${step.step} turnstile ${step.turnstileDelta}`);
      if (step.routePost !== 1) problems.push(`${step.step} post ${step.routePost}`);
      if (step.routeSiteKeyPresent !== false || step.routeHasContact !== false) {
        problems.push(`${step.step} route body marker`);
      }
      if (step.step === "otp-init" || step.step === "otp-init-v2") {
        if (step.routeStatus !== 403) problems.push(`${step.step} status ${step.routeStatus}`);
        if (step.coordinatorDelta !== 0) problems.push(`${step.step} coordinator ${step.coordinatorDelta}`);
      } else if (step.routeStatus < 400 || step.routeStatus > 599 || step.routeStatus === 429) {
        problems.push(`${step.step} status ${step.routeStatus}`);
      } else if (step.coordinatorDelta !== 0 && step.coordinatorDelta !== 1) {
        problems.push(`${step.step} coordinator ${step.coordinatorDelta}`);
      }
    } else if (mode === "enabled") {
      if (step.clientParamsStatus !== 200) problems.push(`${step.step} params ${step.clientParamsStatus}`);
      if (step.siteKeyIsPublicFixture !== true) problems.push(`${step.step} site key fixture`);
      if (step.routePost !== 0) problems.push(`${step.step} post ${step.routePost}`);
      if (step.turnstileDelta < 1) problems.push(`${step.step} turnstile ${step.turnstileDelta}`);
      if (step.coordinatorDelta !== 0) problems.push(`${step.step} coordinator ${step.coordinatorDelta}`);
    }
  }
  if (problems.length > 0) throw new Error(problems.join(", "));
}

function countsOf(steps, tail) {
  return {
    clientState: tail.clientState,
    clientParamsPost: tail.clientParamsPost,
    options: tail.options,
    turnstileRequests: tail.turnstileRequests,
    unexpectedHosts: tail.unexpectedHosts,
    captchaHeader: tail.captchaHeader,
    captchaQuery: tail.captchaQuery,
    responseHasContact: tail.responseHasContact,
    coordinatorHits: tail.coordinatorHits,
    routes: Object.fromEntries(
      steps.map((step) => [
        step.step,
        {
          className: step.className,
          clientParamsPost: step.clientParamsPost,
          clientParamsStatus: step.clientParamsStatus,
          siteKeyPresent: step.siteKeyPresent,
          siteKeyIsPublicFixture: step.siteKeyIsPublicFixture,
          routePost: step.routePost,
          routeStatus: step.routeStatus,
          coordinatorDelta: step.coordinatorDelta,
          turnstileDelta: step.turnstileDelta,
        },
      ]),
    ),
  };
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
    routes: [],
    options: 0,
    turnstile: 0,
    unexpected: 0,
    captchaHeader: false,
    captchaQuery: false,
  };
  const steps = [];
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
    let seenParams = 0;
    let seenRoutes = 0;
    let seenTurnstile = 0;
    let previousHits = readHits(hitsFile);
    for (const step of STEPS) {
      await page.waitForFunction(
        (name) =>
          document.documentElement.dataset.settle === name ||
          document.documentElement.dataset.done === "1",
        step,
        { timeout: 45000 },
      );
      const dataset = await readDataset(page);
      if (dataset.settle !== step) {
        throw new Error(`stopped before ${step}: ${dataset.boot || dataset.done || "no settle"}`);
      }
      const params = network.clientParams.slice(seenParams);
      const routes = network.routes.slice(seenRoutes);
      const turnstileDelta = network.turnstile - seenTurnstile;
      seenParams = network.clientParams.length;
      seenRoutes = network.routes.length;
      seenTurnstile = network.turnstile;
      const hits = readHits(hitsFile);
      const coordinatorDelta = hits - previousHits;
      previousHits = hits;
      const route = routes[0] ?? null;
      const capability = params[0] ?? null;
      steps.push({
        step,
        className: dataset[STEP_CLASS[step]] || "",
        clientParamsPost: params.length,
        clientParamsStatus: capability ? capability.status : null,
        siteKeyPresent: capability ? capability.siteKeyPresent : null,
        siteKeyIsPublicFixture: capability ? capability.siteKeyIsPublicFixture : null,
        cacheNoStore: capability ? capability.cacheNoStore : null,
        captchaHeader: params.some((item) => item.captchaHeader) || routes.some((item) => item.captchaHeader),
        captchaQuery: params.some((item) => item.captchaQuery) || routes.some((item) => item.captchaQuery),
        routePost: routes.length,
        routeStatus: route ? route.status : null,
        routeSiteKeyPresent: routes.some((item) => item.siteKeyPresent),
        routeHasContact: routes.some((item) => item.responseHasContact),
        coordinatorDelta,
        turnstileDelta,
      });
      await page.evaluate((name) => {
        document.documentElement.dataset.ack = name;
      }, step);
    }
    await page.waitForFunction(() => document.documentElement.dataset.done === "1", null, {
      timeout: 5000,
    });
    const dataset = await readDataset(page);
    const tail = {
      clientState: dataset.clientState,
      boot: dataset.boot,
      done: dataset.done,
      clientParamsPost: network.clientParams.length,
      options: network.options,
      turnstileRequests: network.turnstile,
      unexpectedHosts: network.unexpected,
      captchaHeader: network.captchaHeader,
      captchaQuery: network.captchaQuery,
      responseHasContact:
        network.clientParams.some((item) => item.responseHasContact) ||
        network.routes.some((item) => item.responseHasContact),
      coordinatorHits: readHits(hitsFile),
    };
    assertMode(mode, steps, tail);
    record({ caseId: mode, phase: "browser", result: "passed", counts: countsOf(steps, tail) });
  } catch (error) {
    let dataset = {
      clientState: "",
      boot: "",
      done: "",
    };
    if (context) {
      const page = context.pages()[0];
      if (page) dataset = await readDataset(page).catch(() => dataset);
    }
    const tail = {
      clientState: dataset.clientState || "",
      boot: dataset.boot || "",
      done: dataset.done || "",
      clientParamsPost: network.clientParams.length,
      options: network.options,
      turnstileRequests: network.turnstile,
      unexpectedHosts: network.unexpected,
      captchaHeader: network.captchaHeader,
      captchaQuery: network.captchaQuery,
      responseHasContact:
        network.clientParams.some((item) => item.responseHasContact) ||
        network.routes.some((item) => item.responseHasContact),
      coordinatorHits: safeHits(hitsFile),
    };
    record({
      caseId: mode,
      phase: "browser",
      result: "failed",
      reason: error instanceof Error ? error.message : "mode failed",
      counts: countsOf(steps, tail),
    });
    throw error;
  } finally {
    if (context) await context.close().catch(() => undefined);
    await stopChild(child);
  }
}

function assertEvidenceClean(runDir) {
  const evidenceDir = path.join(runDir, "evidence");
  const banned = ["PUBLIC_TEST_SITE_KEY", "example.test", "org-oauth", "browser-otp"];
  for (const name of fs.readdirSync(evidenceDir)) {
    const file = path.join(evidenceDir, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("evidence entry rejected");
    const text = fs.readFileSync(file, "utf8");
    if (banned.some((marker) => text.includes(marker))) {
      throw new Error("evidence leaked a fixture marker");
    }
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
    assertEvidenceClean(runDir);
    if (failures.length > 0) {
      record({
        caseId: "protected-routes",
        phase: "finished",
        result: "failed",
        reason: failures.join("; "),
      });
      process.exitCode = 1;
      return;
    }
    record({ caseId: "protected-routes", phase: "finished", result: "passed" });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

main().catch((error) => {
  process.stderr.write(`${scrub(error && error.stack ? error.stack : error)}\n`);
  process.exitCode = 1;
});
