// Manual RED capability gate. Run with:
// node packages/core/src/__tests__/rn-sqlite-capability.red.cjs
// It is intentionally outside Jest discovery until the fixed native build
// and its cross-runtime transaction behavior have been verified.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "../../../..");
const samplePath = path.join(
  root,
  "examples/authentication/captcha-rn-expo/package.json",
);
const sample = JSON.parse(fs.readFileSync(samplePath, "utf8"));
const sampleLock = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(samplePath), "package-lock.json"),
    "utf8",
  ),
);
const workspace = fs.readFileSync(
  path.join(root, "pnpm-workspace.yaml"),
  "utf8",
);

assert.equal(sample.dependencies.expo, "56.0.22");
assert.equal(
  sample.dependencies["expo-sqlite"],
  "56.0.6",
  "RED: Expo SDK 56 candidate has no exact expo-sqlite dependency",
);
assert.match(
  workspace,
  /^\s*-\s*["']?!examples\/authentication\/captcha-rn-expo\/\*\*["']?$/m,
  "RED: Expo candidate must remain isolated from the pnpm workspace",
);
assert.equal(
  sampleLock.packages?.[""]?.dependencies?.["expo-sqlite"],
  "56.0.6",
  "RED: isolated npm lockfile has no exact expo-sqlite dependency",
);
assert.equal(
  sampleLock.packages?.["node_modules/expo-sqlite"]?.version,
  "56.0.6",
  "RED: isolated npm lockfile does not resolve expo-sqlite 56.0.6",
);

const candidateRequire = createRequire(samplePath);
const sqlitePath = candidateRequire.resolve("expo-sqlite/package.json");
const installed = JSON.parse(fs.readFileSync(sqlitePath, "utf8"));
assert.equal(
  installed.version,
  "56.0.6",
  "RED: installed expo-sqlite version differs",
);
console.log("Expo SQLite package graph is locally verifiable");
