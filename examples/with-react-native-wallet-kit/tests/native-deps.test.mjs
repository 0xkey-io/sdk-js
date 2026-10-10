import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const exampleRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sdkRoot = path.resolve(exampleRoot, "../..");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

const example = readJson(path.join(exampleRoot, "package.json"));
const declared = new Set(Object.keys(example.dependencies ?? {}));

const sdkPackages = ["react-native-wallet-kit", "react-native-passkey-stamper"];
const isNativeModule = (name) =>
  name.startsWith("react-native-") || name.startsWith("@react-native-");

test("declares every native module the local SDK packages load", () => {
  // Autolinking only links native modules listed by the app itself.
  const required = new Set();
  for (const dir of sdkPackages) {
    const manifest = readJson(
      path.join(sdkRoot, "packages", dir, "package.json"),
    );
    for (const name of [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]) {
      if (isNativeModule(name)) required.add(name);
    }
  }
  assert.ok(required.size > 0);
  const missing = [...required].filter((name) => !declared.has(name)).sort();
  assert.deepEqual(missing, []);
});

test("does not install a published wallet kit that would shadow the local build", () => {
  for (const field of ["dependencies", "devDependencies"]) {
    assert.equal(
      example[field]?.["@0xkey-io/react-native-wallet-kit"],
      undefined,
      field,
    );
  }
});
