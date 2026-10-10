import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const upstream = readFileSync(
  new URL(
    "../node_modules/react-native-webview/src/WebViewShared.tsx",
    import.meta.url,
  ),
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
const escapeStringRegexp = require("escape-string-regexp");
const wildcard = new RegExp(
  `^${escapeStringRegexp("*").replace(/\\\*/g, ".*")}`,
);
for (const origin of ["https://evil.example", "intent://external", ""]) {
  assert.equal(wildcard.test(origin), true);
}

const sample = readFileSync(
  new URL("../CaptchaChallenge.tsx", import.meta.url),
  "utf8",
);
assert.ok(
  /originWhitelist=\{\["\*"\]\}/.test(sample),
  "sample must route every origin through its guard",
);
assert.ok(
  /onShouldStartLoadWithRequest=\{allowNavigation\}/.test(sample),
  "sample navigation callback is missing",
);
assert.ok(
  /permitsCaptchaNavigation\(origin, request\)/.test(sample),
  "sample must use the exact navigation guard",
);
console.log("All WebView navigation reaches the Captcha guard before Linking");
