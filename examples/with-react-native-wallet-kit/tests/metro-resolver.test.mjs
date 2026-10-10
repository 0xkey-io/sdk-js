import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const require = createRequire(import.meta.url);
const { createSdkResolveRequest } = require("../metro.resolver.js");

const root = mkdtempSync(path.join(tmpdir(), "rnwk-metro-"));
after(() => rmSync(root, { recursive: true, force: true }));

const sdkRoot = path.join(root, "sdk");
const exampleRoot = path.join(sdkRoot, "examples", "demo");

function writePackage(dir, manifest, files = []) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
  for (const file of files) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), "");
  }
}

writePackage(
  path.join(sdkRoot, "packages", "react-native-wallet-kit"),
  { name: "@0xkey-io/react-native-wallet-kit", main: "./dist/index.js" },
  ["dist/index.js"],
);
writePackage(
  path.join(sdkRoot, "packages", "core"),
  {
    name: "@0xkey-io/core",
    main: "./dist/index.js",
    "react-native": "./dist/index.native.js",
  },
  ["dist/index.js", "dist/index.native.js", "dist/__types__/enums.js"],
);
writePackage(path.join(sdkRoot, "packages", "no-name"), {}, []);
writePackage(exampleRoot, {
  dependencies: {
    "@0xkey-io/react-native-wallet-kit": "*",
    react: "19.1.0",
    "react-native": "0.81.4",
    "react-native-passkey": "^3.3.1",
  },
});

const resolveRequest = createSdkResolveRequest({ exampleRoot, sdkRoot });

function fakeContext(originModulePath) {
  const calls = [];
  return {
    calls,
    context: {
      originModulePath,
      resolveRequest: (context, moduleName, platform) => {
        calls.push({ origin: context.originModulePath, moduleName, platform });
        return { type: "sourceFile", filePath: `resolved:${moduleName}` };
      },
    },
  };
}

const fromExample = path.join(exampleRoot, "app", "index.tsx");
const fromSdk = path.join(
  sdkRoot,
  "packages",
  "react-native-wallet-kit",
  "dist",
  "index.js",
);

test("resolves the wallet kit from the local monorepo build", () => {
  const { context, calls } = fakeContext(fromExample);
  assert.deepEqual(
    resolveRequest(context, "@0xkey-io/react-native-wallet-kit", "ios"),
    {
      type: "sourceFile",
      filePath: path.join(
        sdkRoot,
        "packages",
        "react-native-wallet-kit",
        "dist",
        "index.js",
      ),
    },
  );
  assert.equal(calls.length, 0);
});

test("prefers the react-native entry and resolves deep dist imports", () => {
  const { context } = fakeContext(fromSdk);
  assert.equal(
    resolveRequest(context, "@0xkey-io/core", "android").filePath,
    path.join(sdkRoot, "packages", "core", "dist", "index.native.js"),
  );
  assert.equal(
    resolveRequest(context, "@0xkey-io/core/dist/__types__/enums", "android")
      .filePath,
    path.join(sdkRoot, "packages", "core", "dist", "__types__", "enums.js"),
  );
});

test("fails loudly when the local SDK package has not been built", () => {
  const { context } = fakeContext(fromExample);
  assert.throws(
    () => resolveRequest(context, "@0xkey-io/core/dist/missing", "ios"),
    /@0xkey-io\/core\/dist\/missing.*pnpm/s,
  );
});

test("routes React Native singletons imported by SDK packages to the app", () => {
  const { context, calls } = fakeContext(fromSdk);
  resolveRequest(context, "react-native", "ios");
  resolveRequest(context, "react-native-passkey/lib/module", "ios");
  resolveRequest(context, "react", "ios");
  assert.deepEqual(
    calls.map((call) => [call.moduleName, call.origin]),
    [
      ["react-native", path.join(exampleRoot, "package.json")],
      [
        "react-native-passkey/lib/module",
        path.join(exampleRoot, "package.json"),
      ],
      ["react", path.join(exampleRoot, "package.json")],
    ],
  );
});

test("leaves other modules to Metro's default resolution", () => {
  const { context, calls } = fakeContext(fromSdk);
  resolveRequest(context, "@noble/hashes/sha256", "ios");
  resolveRequest(context, "react-native-passkeys", "ios");
  resolveRequest(context, "@0xkey-io/not-in-monorepo", "ios");
  assert.deepEqual(
    calls.map((call) => [call.moduleName, call.origin]),
    [
      ["@noble/hashes/sha256", fromSdk],
      ["react-native-passkeys", fromSdk],
      ["@0xkey-io/not-in-monorepo", fromSdk],
    ],
  );
});
