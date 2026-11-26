import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  KEY_EXPORTS,
  checkAllRepositories,
  checkPackedEntrypoints,
  checkPackedManifest,
  checkRepository,
  checkRepublishTarget,
  checkStaticExports,
  fetchRegistryVersions,
  findCollisions,
  listGenericPackages,
  manifestEntrypoints,
  plannedFromChangesetStatus,
  satisfiesPackedRange,
} from "./release-guard.mjs";

const registryResponse = (status, body = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

test("changeset status plan keeps only generic public packages", () => {
  const planned = plannedFromChangesetStatus(
    {
      releases: [
        { name: "@0xkey-io/core", type: "minor", newVersion: "0.3.0" },
        { name: "@0xkey-io/viem", type: "patch", newVersion: "0.1.5" },
        { name: "@0xkey-io/pay", type: "none", newVersion: "1.0.0-rc.1" },
        { name: "with-0x", type: "patch", newVersion: "0.1.28" },
      ],
    },
    ["@0xkey-io/core", "@0xkey-io/viem"],
  );
  assert.deepEqual(planned, [
    { name: "@0xkey-io/core", version: "0.3.0" },
    { name: "@0xkey-io/viem", version: "0.1.5" },
  ]);
  assert.throws(() => plannedFromChangesetStatus({}, []), /releases array/);
});

test("registry lookup includes unpublished versions and treats 404 as new", async () => {
  const seen = [];
  const versions = await fetchRegistryVersions("@0xkey-io/viem", {
    fetchImpl: async (url) => {
      seen.push(url);
      return registryResponse(200, {
        versions: { "0.1.3": {} },
        time: { created: "x", modified: "x", "0.1.3": "x", "0.1.4": "x" },
      });
    },
  });
  assert.deepEqual(seen, ["https://registry.npmjs.org/@0xkey-io%2fviem"]);
  assert.deepEqual([...versions].sort(), ["0.1.3", "0.1.4"]);

  const missing = await fetchRegistryVersions("@0xkey-io/new", {
    fetchImpl: async () => registryResponse(404),
  });
  assert.equal(missing.size, 0);

  await assert.rejects(
    fetchRegistryVersions("@0xkey-io/core", {
      fetchImpl: async () => registryResponse(503),
    }),
    /HTTP 503/,
  );
});

test("a planned version that already exists on npm is a collision", async () => {
  // The security line published rnwk 0.1.4 while main still said 0.1.3; a
  // patch release from main would plan 0.1.4 again.
  const published = new Map([
    ["@0xkey-io/react-native-wallet-kit", new Set(["0.1.3", "0.1.4"])],
    ["@0xkey-io/core", new Set(["0.2.0", "0.2.1"])],
  ]);
  const { ok, collisions } = await findCollisions(
    [
      { name: "@0xkey-io/react-native-wallet-kit", version: "0.1.4" },
      { name: "@0xkey-io/core", version: "0.3.0" },
    ],
    { lookup: async (name) => published.get(name) ?? new Set() },
  );
  assert.deepEqual(collisions, [
    { name: "@0xkey-io/react-native-wallet-kit", version: "0.1.4" },
  ]);
  assert.deepEqual(ok, [{ name: "@0xkey-io/core", version: "0.3.0" }]);
});

test("packed internal ranges must match the workspace version", () => {
  assert.equal(satisfiesPackedRange("0.2.1", "0.2.1"), true);
  assert.equal(satisfiesPackedRange("0.2.0", "0.2.1"), false);
  assert.equal(satisfiesPackedRange("^0.2.0", "0.2.1"), true);
  assert.equal(satisfiesPackedRange("^0.2.0", "0.3.0"), false);
  assert.equal(satisfiesPackedRange("^1.2.0", "1.9.0"), true);
  assert.equal(satisfiesPackedRange("~0.2.0", "0.2.5"), true);
  assert.equal(satisfiesPackedRange("*", "0.2.1"), false);

  const workspace = new Map([
    ["@0xkey-io/core", "0.2.1"],
    ["@0xkey-io/http", "0.1.3"],
  ]);
  const source = { name: "@0xkey-io/viem", version: "0.1.4" };
  assert.deepEqual(
    checkPackedManifest(
      {
        name: "@0xkey-io/viem",
        version: "0.1.4",
        dependencies: { "@0xkey-io/core": "0.2.1", viem: "^2.0.0" },
        peerDependencies: { "@0xkey-io/http": "^0.1.0" },
      },
      source,
      workspace,
    ),
    [],
  );
  const failures = checkPackedManifest(
    {
      name: "@0xkey-io/viem",
      version: "0.1.3",
      dependencies: {
        "@0xkey-io/core": "0.2.0",
        "@0xkey-io/http": "workspace:*",
        "@0xkey-io/internal-codec": "0.0.0",
      },
    },
    source,
    workspace,
  );
  assert.equal(failures.length, 4);
  assert.match(failures[0], /packed version 0\.1\.3 differs/);
  assert.match(failures[1], /@0xkey-io\/core@0\.2\.0 does not match/);
  assert.match(failures[2], /still uses workspace:\*/);
  assert.match(failures[3], /leaks @0xkey-io\/internal-codec/);
});

test("static export check finds declared and missing symbols", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-guard-test-"));
  try {
    fs.mkdirSync(path.join(root, "dist/captcha"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "dist/index.d.ts"),
      'export { permitsCaptchaNavigation } from "./captcha";\nexport declare function ZeroXKeyProvider(): void;\n',
    );
    fs.writeFileSync(
      path.join(root, "dist/index.js"),
      "exports.ZeroXKeyProvider = ZeroXKeyProvider; exports.permitsCaptchaNavigation = permitsCaptchaNavigation;\n",
    );
    assert.deepEqual(
      checkStaticExports(root, "rnwk", [
        "ZeroXKeyProvider",
        "permitsCaptchaNavigation",
      ]),
      [],
    );
    assert.deepEqual(checkStaticExports(root, "rnwk", ["useZeroXKey"]), [
      "rnwk: key export useZeroXKey missing from packed dist",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("repository metadata must match the provenance repository", () => {
  const RELEASE_URL = "git+https://github.com/0xkey-io/sdk-js.git";
  const repository = (url, directory = "packages/core") => ({
    name: "@0xkey-io/core",
    repository: { type: "git", url, directory },
  });
  for (const url of [
    "git+https://github.com/0xkey-io/sdk-js.git",
    "https://github.com/0xkey-io/sdk-js",
    "git+ssh://git@github.com/0xkey-io/sdk-js.git",
    "git@github.com:0xkey-io/sdk-js.git",
  ]) {
    assert.deepEqual(
      checkRepository(repository(url), "packages/core"),
      [],
      url,
    );
  }
  assert.match(
    checkRepository({ name: "@0xkey-io/attested-stamper" }, "packages/x")[0],
    /repository\.url is ""/,
  );
  assert.match(
    checkRepository(
      repository("git+https://github.com/someone/fork.git"),
      "packages/core",
    )[0],
    /expected https:\/\/github\.com\/0xkey-io\/sdk-js/,
  );
  assert.match(
    checkRepository(
      repository(RELEASE_URL, "packages/http"),
      "packages/core",
    )[0],
    /repository\.directory/,
  );
  assert.deepEqual(checkAllRepositories(), []);
});

test("a single package is republishable only when everything else is on npm", async () => {
  const packages = [
    { name: "@0xkey-io/attested-stamper", version: "0.1.1", manifest: {} },
    {
      name: "@0xkey-io/core",
      version: "0.3.0",
      manifest: {
        dependencies: { "@0xkey-io/attested-stamper": "workspace:*" },
      },
    },
    { name: "@0xkey-io/http", version: "0.2.0", manifest: {} },
  ];
  const npm = new Map([
    ["@0xkey-io/attested-stamper", new Set(["0.1.0"])],
    ["@0xkey-io/core", new Set(["0.2.1", "0.3.0"])],
    ["@0xkey-io/http", new Set(["0.2.0"])],
  ]);
  const options = (pinned = "0.1.1", registry = npm) => ({
    lookup: async (name) => registry.get(name) ?? new Set(),
    fetchManifest: async (name, version) =>
      registry.get(name)?.has(version)
        ? { dependencies: { "@0xkey-io/attested-stamper": pinned } }
        : null,
  });

  const ok = await checkRepublishTarget(
    "@0xkey-io/attested-stamper",
    packages,
    options(),
  );
  assert.deepEqual(ok.failures, []);
  assert.deepEqual(ok.dependents, [
    { name: "@0xkey-io/core", version: "0.3.0", range: "0.1.1" },
  ]);

  const mismatch = await checkRepublishTarget(
    "@0xkey-io/attested-stamper",
    packages,
    options("0.1.2"),
  );
  assert.match(
    mismatch.failures[0],
    /pins dependencies\.@0xkey-io\/attested-stamper@0\.1\.2/,
  );

  const unsynced = new Map(npm);
  unsynced.set("@0xkey-io/http", new Set(["0.1.3"]));
  const behind = await checkRepublishTarget(
    "@0xkey-io/attested-stamper",
    packages,
    options("0.1.1", unsynced),
  );
  assert.match(behind.failures[0], /@0xkey-io\/http@0\.2\.0 is not on npm/);

  // A default branch that never registered core 0.3.0 has no dependent that
  // pins the target, so only the highest-version check stops it.
  const stale = packages.map((entry) =>
    entry.name === "@0xkey-io/core"
      ? { ...entry, version: "0.2.1", manifest: {} }
      : entry,
  );
  const outdated = await checkRepublishTarget(
    "@0xkey-io/attested-stamper",
    stale,
    options(),
  );
  assert.deepEqual(outdated.failures, [
    "@0xkey-io/core@0.2.1 is behind npm (0.3.0); register the published versions on the default branch first",
  ]);

  const already = await checkRepublishTarget(
    "@0xkey-io/http",
    packages,
    options(),
  );
  assert.ok(
    already.failures.some((failure) =>
      /@0xkey-io\/http@0\.2\.0 already exists on npm/.test(failure),
    ),
  );

  const unknown = await checkRepublishTarget(
    "@0xkey-io/pay",
    packages,
    options(),
  );
  assert.match(unknown.failures[0], /not a generic public workspace package/);
});

test("every key-export entry names a generic public package", () => {
  const names = new Set(listGenericPackages().map(({ name }) => name));
  assert.equal(names.has("@0xkey-io/pay"), false);
  for (const name of Object.keys(KEY_EXPORTS)) {
    assert.equal(names.has(name), true, `${name} is not a generic package`);
  }
});

const writePackedFiles = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "0xkey-entrypoints-"));
  for (const file of files) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "");
  }
  return root;
};

const typedManifest = {
  main: "./dist/index.js",
  module: "./dist/index.mjs",
  types: "./dist/index.d.ts",
  exports: {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.mjs",
      require: "./dist/index.js",
      default: "./dist/index.mjs",
    },
    "./package.json": "./package.json",
    "./styles/*": "./dist/styles/*",
  },
};

test("manifest entrypoints cover main, types and nested exports, not patterns", () => {
  const targets = manifestEntrypoints(typedManifest).map((e) => e.target);
  assert.deepEqual([...new Set(targets)].sort(), [
    "./dist/index.d.ts",
    "./dist/index.js",
    "./dist/index.mjs",
    "./package.json",
  ]);
  assert.deepEqual(manifestEntrypoints({ main: "lodash" }), []);
});

test("a packed artifact must contain every file its manifest points at", () => {
  const complete = writePackedFiles([
    "package.json",
    "dist/index.js",
    "dist/index.mjs",
    "dist/index.d.ts",
  ]);
  const withoutTypes = writePackedFiles([
    "package.json",
    "dist/index.js",
    "dist/index.mjs",
    "dist/util.d.ts",
  ]);
  try {
    assert.deepEqual(
      checkPackedEntrypoints(complete, typedManifest, "@0xkey-io/example"),
      [],
    );
    const failures = checkPackedEntrypoints(
      withoutTypes,
      typedManifest,
      "@0xkey-io/example",
    );
    assert.equal(failures.length, 2);
    assert.match(
      failures[0],
      /^@0xkey-io\/example: types points at \.\/dist\/index\.d\.ts/,
    );
    assert.match(
      failures[1],
      /exports\["\."\]\.types points at \.\/dist\/index\.d\.ts/,
    );
  } finally {
    fs.rmSync(complete, { recursive: true, force: true });
    fs.rmSync(withoutTypes, { recursive: true, force: true });
  }
});

test("rollup base config fails the build on TypeScript errors", () => {
  // A TypeScript error otherwise only warns, and the plugin skips the
  // declaration file of the failing module while the build still exits 0.
  const config = fs.readFileSync(
    new URL("../rollup.config.base.mjs", import.meta.url),
    "utf8",
  );
  assert.match(config, /noEmitOnError:\s*true/);
});
