import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const root = new URL("../node_modules/react-native-webview/", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
if (pkg.version !== "13.16.1") {
  throw new Error(
    `Captcha WebView patch requires 13.16.1, found ${pkg.version}`,
  );
}

// Exact outputs from npm tarball 13.16.1 plus the reviewed patch. Together
// with package-lock integrity, these detect an unapplied or drifted patch.
const expected = {
  "android/src/main/java/com/reactnativecommunity/webview/RNCWebView.java":
    "b76d1bfe88aefa42bb50d7bd024b3527168d49e8c16257d08bf7b801b1250cb1",
  "android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java":
    "dc316ce1d69aa04a05c57f85e6d5bf1276f20dd223b936506c96fa90143dd9b8",
  "apple/RNCWebViewImpl.m":
    "d7a8df9403ffcba86c58673f0fa033e88c285472ada7decda370c43073c03523",
  "src/WebViewTypes.ts":
    "5bf4e7547cbee42b832ed89086007b7c4d5ac8ccaf6201964c69e0dc72f45746",
  "lib/WebViewTypes.d.ts":
    "d87b84cd3152bc245480df412c2fd1df863483a818db7af909b8edcd8914a00d",
};

for (const [path, wanted] of Object.entries(expected)) {
  const actual = createHash("sha256")
    .update(readFileSync(new URL(path, root)))
    .digest("hex");
  if (actual !== wanted) {
    throw new Error(`Captcha WebView native patch mismatch: ${path}`);
  }
}
const androidNavigation = readFileSync(
  new URL(
    "android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java",
    root,
  ),
  "utf8",
);
if (
  !androidNavigation.includes(
    "return shouldOverrideUrlLoading(view, url, null);",
  ) ||
  !androidNavigation.includes(
    "return this.shouldOverrideUrlLoading(view, url, request.isForMainFrame());",
  ) ||
  (
    androidNavigation.match(/event\.putBoolean\("isTopFrame", isTopFrame\)/g) ??
    []
  ).length !== 2
) {
  throw new Error("Captcha WebView Android navigation frame proof is missing");
}
console.log("Captcha WebView 13.16.1 native provenance patch verified");
