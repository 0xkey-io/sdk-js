import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  selectPilotPackageClosure,
  verifyPackedConsumer,
} from "./pack-smoke.mjs";

function createTarball(tempRoot, manifest, files) {
  const fixtureRoot = fs.mkdtempSync(path.join(tempRoot, "fixture-"));
  const packageRoot = path.join(fixtureRoot, "package");
  fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(manifest)}\n`,
  );
  for (const [relativePath, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(packageRoot, relativePath), content);
  }
  const tarball = path.join(
    tempRoot,
    `${manifest.name.replaceAll("/", "-").replaceAll("@", "")}-${manifest.version}.tgz`,
  );
  execFileSync("tar", ["-czf", tarball, "-C", fixtureRoot, "package"]);
  return tarball;
}

test("includes runtime workspace dependencies in the pilot package closure", () => {
  const packages = [
    {
      pkg: {
        name: "@0xkey-io/pilot",
        dependencies: { "@0xkey-io/runtime": "workspace:*" },
      },
    },
    { pkg: { name: "@0xkey-io/runtime" } },
  ];

  assert.deepEqual(
    selectPilotPackageClosure(packages, new Set(["@0xkey-io/pilot"])).map(
      ({ pkg }) => pkg.name,
    ),
    ["@0xkey-io/pilot", "@0xkey-io/runtime"],
  );
});

test("rejects a packed package whose CommonJS entry cannot be loaded", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );

  try {
    const tarball = createTarball(
      tempRoot,
      {
        name: "@fixture/broken",
        version: "1.0.0",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
      },
      {
        "dist/index.js": 'require("./missing-runtime-dependency.js");\n',
        "dist/index.d.ts": "export {};\n",
      },
    );

    assert.throws(
      () =>
        verifyPackedConsumer({
          tarballs: [tarball],
          tempRoot: path.join(tempRoot, "consumer-root"),
        }),
      /CommonJS consumer failed/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("rejects a packed package whose ESM entry cannot be loaded", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    const tarball = createTarball(
      tempRoot,
      {
        name: "@fixture/broken-esm",
        version: "1.0.0",
        main: "./dist/index.js",
        module: "./dist/index.mjs",
        exports: {
          ".": {
            types: "./dist/index.d.ts",
            require: "./dist/index.js",
            import: "./dist/index.mjs",
          },
        },
        types: "./dist/index.d.ts",
      },
      {
        "dist/index.js": "module.exports = {};\n",
        "dist/index.mjs": 'import "./missing-runtime-dependency.mjs";\n',
        "dist/index.d.ts": "export {};\n",
      },
    );
    assert.throws(
      () =>
        verifyPackedConsumer({
          tarballs: [tarball],
          tempRoot: path.join(tempRoot, "consumer-root"),
        }),
      /ESM consumer failed/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("rejects a packed package with an invalid declaration", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    const tarball = createTarball(
      tempRoot,
      {
        name: "@fixture/broken-types",
        version: "1.0.0",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
      },
      {
        "dist/index.js": "module.exports = {};\n",
        "dist/index.d.ts": "export interface Broken extends string {}\n",
      },
    );
    assert.throws(
      () =>
        verifyPackedConsumer({
          tarballs: [tarball],
          tempRoot: path.join(tempRoot, "consumer-root"),
        }),
      /TypeScript consumer failed/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("rejects a packed package with a missing declaration entry", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    const tarball = createTarball(
      tempRoot,
      {
        name: "@fixture/missing-types",
        version: "1.0.0",
        main: "./dist/index.js",
        types: "./dist/missing.d.ts",
      },
      { "dist/index.js": "module.exports = {};\n" },
    );
    assert.throws(
      () =>
        verifyPackedConsumer({
          tarballs: [tarball],
          tempRoot: path.join(tempRoot, "consumer-root"),
        }),
      /TypeScript consumer failed/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
