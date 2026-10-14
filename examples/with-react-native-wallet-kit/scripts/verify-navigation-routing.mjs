import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const webViewRoot = new URL(
  "../node_modules/react-native-webview/",
  import.meta.url,
);
const upstream = readFileSync(
  new URL("src/WebViewShared.tsx", webViewRoot),
  "utf8",
);
assert.equal(
  createHash("sha256").update(upstream).digest("hex"),
  "a85133cde2acb5d511ee20c8b6f651119829f7ce38e5236d6c249cf27c3eeafb",
  "Pinned WebViewShared routing changed",
);
assert.match(
  upstream,
  /if \(!passesWhitelist\(compileWhitelist\(originWhitelist\), url\)\) \{/,
);
assert.match(upstream, /Linking\.canOpenURL\(url\)/);
assert.match(upstream, /else if \(onShouldStartLoadWithRequest\) \{/);

// Pinned WebViewShared converts '*' to /^.*/, including unknown origins.
const require = createRequire(new URL("package.json", webViewRoot));
const escapeStringRegexp = require("escape-string-regexp");
const wildcard = new RegExp(
  `^${escapeStringRegexp("*").replace(/\\\*/g, ".*")}`,
);
for (const origin of ["https://evil.example", "intent://external", ""]) {
  assert.equal(wildcard.test(origin), true);
}

const challenge = readFileSync(
  new URL("../components/captcha/captcha-challenge.tsx", import.meta.url),
  "utf8",
);
assert.ok(
  /originWhitelist=\{\["\*"\]\}/.test(challenge),
  "the challenge must route every origin through its guard",
);
assert.ok(
  /onShouldStartLoadWithRequest=\{allowNavigation\}/.test(challenge),
  "the challenge navigation callback is missing",
);
assert.ok(
  /permitsCaptchaNavigation\(origin, request\)/.test(challenge),
  "the challenge must use the exact navigation guard",
);
console.log("All WebView navigation reaches the Captcha guard before Linking");
