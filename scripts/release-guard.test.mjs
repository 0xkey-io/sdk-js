import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  KEY_EXPORTS,
  checkPackedManifest,
  checkStaticExports,
  fetchRegistryVersions,
  findCollisions,
  listGenericPackages,
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

test("every key-export entry names a generic public package", () => {
  const names = new Set(listGenericPackages().map(({ name }) => name));
  assert.equal(names.has("@0xkey-io/pay"), false);
  for (const name of Object.keys(KEY_EXPORTS)) {
    assert.equal(names.has(name), true, `${name} is not a generic package`);
  }
});
