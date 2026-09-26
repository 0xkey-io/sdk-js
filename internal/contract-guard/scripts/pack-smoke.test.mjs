import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";

import * as packSmoke from "./pack-smoke.mjs";

const {
  packedConsumerInstallArgs,
  selectPilotPackageClosure,
  verifyPackedConsumer,
} = packSmoke;

/**
 * @param {string} name
 * @param {Record<string, unknown>} [pkg]
 */
function packageMeta(name, pkg = {}) {
  const dirName = name.split("/").at(-1);
  return {
    dirName,
    dirPath: `/fixture/${dirName}`,
    packageJsonPath: `/fixture/${dirName}/package.json`,
    pkg: { name, ...pkg },
  };
}

/**
 * @param {string} tempRoot
 * @param {{ name: string, version: string, [key: string]: unknown }} manifest
 * @param {Record<string, string>} files
 */
function createTarball(tempRoot, manifest, files) {
  return createRawTarball(
    tempRoot,
    `${JSON.stringify(manifest)}\n`,
    files,
    `${manifest.name.replaceAll("/", "-").replaceAll("@", "")}-${manifest.version}`,
  );
}

/**
 * @param {string} tempRoot
 * @param {string} packageJson
 * @param {Record<string, string>} files
 * @param {string} label
 */
function createRawTarball(tempRoot, packageJson, files, label) {
  const fixtureRoot = fs.mkdtempSync(path.join(tempRoot, "fixture-"));
  const packageRoot = path.join(fixtureRoot, "package");
  fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "package.json"), packageJson);
  for (const [relativePath, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(packageRoot, relativePath)), {
      recursive: true,
    });
    fs.writeFileSync(path.join(packageRoot, relativePath), content);
  }
  const tarball = path.join(tempRoot, `${label}.tgz`);
  execFileSync("tar", ["-czf", tarball, "-C", fixtureRoot, "package"]);
  return tarball;
}

/**
 * @param {string} tempRoot
 * @param {unknown} lockfile
 * @param {() => void} callback
 */
function withFakePnpmLockfile(tempRoot, lockfile, callback) {
  const binDir = path.join(tempRoot, "fake-bin");
  fs.mkdirSync(binDir, { recursive: true });
  const pnpmPath = path.join(binDir, "pnpm");
  fs.writeFileSync(
    pnpmPath,
    [
      "#!/usr/bin/env node",
      'import fs from "node:fs";',
      'fs.writeFileSync("pnpm-lock.yaml", process.env.PACK_SMOKE_FAKE_LOCKFILE);',
      "",
    ].join("\n"),
  );
  fs.chmodSync(pnpmPath, 0o755);
  const previousPath = process.env.PATH;
  const previousLockfile = process.env.PACK_SMOKE_FAKE_LOCKFILE;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath}`;
  process.env.PACK_SMOKE_FAKE_LOCKFILE = YAML.stringify(lockfile);
  try {
    callback();
  } finally {
    process.env.PATH = previousPath;
    if (previousLockfile === undefined) {
      delete process.env.PACK_SMOKE_FAKE_LOCKFILE;
    } else {
      process.env.PACK_SMOKE_FAKE_LOCKFILE = previousLockfile;
    }
  }
}

test("permits registry metadata lookup while preserving tarball resolution checks", () => {
  assert.deepEqual(packedConsumerInstallArgs(), [
    "install",
    "--ignore-scripts",
    "--prefer-offline",
    "--frozen-lockfile=false",
  ]);
});

test("includes runtime workspace dependencies in the pilot package closure", () => {
  const packages = [
    {
      dirName: "pilot",
      dirPath: "/fixture/pilot",
      packageJsonPath: "/fixture/pilot/package.json",
      pkg: {
        name: "@0xkey-io/pilot",
        dependencies: { "@0xkey-io/runtime": "workspace:*" },
      },
    },
    {
      dirName: "runtime",
      dirPath: "/fixture/runtime",
      packageJsonPath: "/fixture/runtime/package.json",
      pkg: { name: "@0xkey-io/runtime" },
    },
  ];

  assert.deepEqual(
    selectPilotPackageClosure(packages, new Set(["@0xkey-io/pilot"])).map(
      ({ pkg }) => pkg.name,
    ),
    ["@0xkey-io/pilot", "@0xkey-io/runtime"],
  );
});

test("keeps optional peers for artifacts but omits them from the Node closure", () => {
  const packages = [
    packageMeta("@0xkey-io/pilot", {
      peerDependencies: { "@0xkey-io/optional": "workspace:*" },
      peerDependenciesMeta: { "@0xkey-io/optional": { optional: true } },
    }),
    packageMeta("@0xkey-io/optional"),
  ];

  assert.deepEqual(
    selectPilotPackageClosure(packages, new Set(["@0xkey-io/pilot"])).map(
      ({ pkg }) => pkg.name,
    ),
    ["@0xkey-io/pilot", "@0xkey-io/optional"],
  );
  assert.deepEqual(
    selectPilotPackageClosure(packages, new Set(["@0xkey-io/pilot"]), {
      includeOptionalPeers: false,
    }).map(({ pkg }) => pkg.name),
    ["@0xkey-io/pilot"],
  );
});

test("retains required peers and their ordinary transitive dependencies in Node", () => {
  const packages = [
    packageMeta("@0xkey-io/pilot", {
      peerDependencies: { "@0xkey-io/peer": "workspace:*" },
    }),
    packageMeta("@0xkey-io/peer", {
      dependencies: { "@0xkey-io/runtime": "workspace:*" },
    }),
    packageMeta("@0xkey-io/runtime"),
  ];

  assert.deepEqual(
    selectPilotPackageClosure(packages, new Set(["@0xkey-io/pilot"]), {
      includeOptionalPeers: false,
    }).map(({ pkg }) => pkg.name),
    ["@0xkey-io/pilot", "@0xkey-io/peer", "@0xkey-io/runtime"],
  );
});

test("does not let optional peer metadata suppress an ordinary dependency", () => {
  const packages = [
    packageMeta("@0xkey-io/pilot", {
      dependencies: { "@0xkey-io/shared": "workspace:*" },
      peerDependencies: { "@0xkey-io/shared": "workspace:*" },
      peerDependenciesMeta: { "@0xkey-io/shared": { optional: true } },
    }),
    packageMeta("@0xkey-io/shared"),
  ];

  assert.deepEqual(
    selectPilotPackageClosure(packages, new Set(["@0xkey-io/pilot"]), {
      includeOptionalPeers: false,
    }).map(({ pkg }) => pkg.name),
    ["@0xkey-io/pilot", "@0xkey-io/shared"],
  );
});

test("keeps explicit optional-peer seeds while artifact-only seeds stay out of Node", () => {
  const packages = [
    packageMeta("@0xkey-io/pilot", {
      peerDependencies: { "@0xkey-io/optional": "workspace:*" },
      peerDependenciesMeta: { "@0xkey-io/optional": { optional: true } },
    }),
    packageMeta("@0xkey-io/optional"),
    packageMeta("@0xkey-io/artifact-only"),
  ];

  assert.deepEqual(
    selectPilotPackageClosure(
      packages,
      new Set(["@0xkey-io/pilot", "@0xkey-io/optional"]),
      { includeOptionalPeers: false },
    ).map(({ pkg }) => pkg.name),
    ["@0xkey-io/pilot", "@0xkey-io/optional"],
  );
  assert.deepEqual(
    selectPilotPackageClosure(
      packages,
      new Set(["@0xkey-io/pilot", "@0xkey-io/artifact-only"]),
    ).map(({ pkg }) => pkg.name),
    ["@0xkey-io/pilot", "@0xkey-io/artifact-only", "@0xkey-io/optional"],
  );
  assert.deepEqual(
    selectPilotPackageClosure(packages, new Set(["@0xkey-io/pilot"]), {
      includeOptionalPeers: false,
    }).map(({ pkg }) => pkg.name),
    ["@0xkey-io/pilot"],
  );
});

test("preserves breadth-first declaration order through diamonds and cycles", () => {
  const packages = [
    packageMeta("@0xkey-io/a", {
      dependencies: {
        "@0xkey-io/b": "workspace:*",
        "@0xkey-io/c": "workspace:*",
      },
      peerDependencies: { "@0xkey-io/optional": "workspace:*" },
      peerDependenciesMeta: { "@0xkey-io/optional": { optional: true } },
    }),
    packageMeta("@0xkey-io/b", {
      dependencies: { "@0xkey-io/shared": "workspace:*" },
    }),
    packageMeta("@0xkey-io/c", {
      dependencies: {
        "@0xkey-io/shared": "workspace:*",
        "@0xkey-io/a": "workspace:*",
      },
    }),
    packageMeta("@0xkey-io/shared"),
    packageMeta("@0xkey-io/optional", {
      dependencies: { "@0xkey-io/shared": "workspace:*" },
    }),
  ];

  assert.deepEqual(
    selectPilotPackageClosure(packages, new Set(["@0xkey-io/a"]), {
      includeOptionalPeers: false,
    }).map(({ pkg }) => pkg.name),
    ["@0xkey-io/a", "@0xkey-io/b", "@0xkey-io/c", "@0xkey-io/shared"],
  );
});

test("does not require a skipped optional peer target but artifact selection does", () => {
  const packages = [
    packageMeta("@0xkey-io/pilot", {
      peerDependencies: { "@0xkey-io/missing": "workspace:*" },
      peerDependenciesMeta: { "@0xkey-io/missing": { optional: true } },
    }),
  ];

  assert.deepEqual(
    selectPilotPackageClosure(packages, new Set(["@0xkey-io/pilot"]), {
      includeOptionalPeers: false,
    }).map(({ pkg }) => pkg.name),
    ["@0xkey-io/pilot"],
  );
  assert.throws(
    () => selectPilotPackageClosure(packages, new Set(["@0xkey-io/pilot"])),
    /Pilot workspace dependency @0xkey-io\/missing is not a public package/,
  );
  assert.throws(
    () =>
      selectPilotPackageClosure(
        packages,
        new Set(["@0xkey-io/explicit-missing"]),
        { includeOptionalPeers: false },
      ),
    /Pilot workspace dependency @0xkey-io\/explicit-missing is not a public package/,
  );
});

test("rejects empty and malformed Node selections before creating a consumer", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    const tarball = createTarball(
      tempRoot,
      {
        name: "@fixture/valid",
        version: "1.0.0",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
      },
      {
        "dist/index.js": "module.exports = {};\n",
        "dist/index.d.ts": "export {};\n",
      },
    );
    const selections = [
      [],
      "@fixture/valid",
      [42],
      [""],
      ["   "],
      ["@fixture/valid", "@fixture/valid"],
      ["@fixture/unknown"],
    ];

    for (const [index, nodePackageNames] of selections.entries()) {
      const consumerRoot = path.join(tempRoot, `invalid-${index}`);
      assert.throws(
        () =>
          verifyPackedConsumer({
            tarballs: [tarball],
            nodePackageNames,
            tempRoot: consumerRoot,
          }),
        /Node package selection/,
      );
      assert.equal(fs.existsSync(path.join(consumerRoot, "consumer")), false);
    }

    const emptyRoot = path.join(tempRoot, "empty-tarballs");
    assert.throws(
      () => verifyPackedConsumer({ tarballs: [], tempRoot: emptyRoot }),
      /Node package selection/,
    );
    assert.equal(fs.existsSync(path.join(emptyRoot, "consumer")), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("validates every tarball identity before creating a selected consumer", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    const validFiles = {
      "dist/index.js": "module.exports = {};\n",
      "dist/index.d.ts": "export {};\n",
    };
    const invalidTarballs = [
      createRawTarball(tempRoot, "null\n", validFiles, "null-manifest"),
      createRawTarball(tempRoot, "[]\n", validFiles, "array-manifest"),
      createRawTarball(
        tempRoot,
        '"primitive"\n',
        validFiles,
        "primitive-manifest",
      ),
      createRawTarball(
        tempRoot,
        '{"name":" ","version":"1.0.0"}\n',
        validFiles,
        "empty-name",
      ),
      createRawTarball(
        tempRoot,
        '{"name":"@fixture/bad","version":" "}\n',
        validFiles,
        "empty-version",
      ),
      createRawTarball(
        tempRoot,
        '{"name":7,"version":"1.0.0"}\n',
        validFiles,
        "non-string-name",
      ),
    ];

    for (const [index, invalidTarball] of invalidTarballs.entries()) {
      const consumerRoot = path.join(tempRoot, `identity-${index}`);
      assert.throws(
        () =>
          verifyPackedConsumer({
            tarballs: [invalidTarball],
            tempRoot: consumerRoot,
          }),
        /Packed artifact manifest/,
      );
      assert.equal(fs.existsSync(path.join(consumerRoot, "consumer")), false);
    }

    const duplicateOne = createTarball(
      tempRoot,
      { name: "@fixture/duplicate", version: "1.0.0" },
      validFiles,
    );
    const duplicateTwo = createRawTarball(
      tempRoot,
      '{"name":"@fixture/duplicate","version":"2.0.0"}\n',
      validFiles,
      "duplicate-two",
    );
    const duplicateRoot = path.join(tempRoot, "duplicate-root");
    assert.throws(
      () =>
        verifyPackedConsumer({
          tarballs: [duplicateOne, duplicateTwo],
          tempRoot: duplicateRoot,
        }),
      /Duplicate packed artifact identity @fixture\/duplicate/,
    );
    assert.equal(fs.existsSync(path.join(duplicateRoot, "consumer")), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("builds and verifies a Node consumer from only the requested artifacts", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    const selected = createTarball(
      tempRoot,
      {
        name: "@0xkey-io/selected",
        version: "1.0.0",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        peerDependencies: { "@0xkey-io/artifact-only": "^1.0.0" },
        peerDependenciesMeta: {
          "@0xkey-io/artifact-only": { optional: true },
        },
      },
      {
        "dist/index.js": "module.exports = {};\n",
        "dist/index.d.ts": "export {};\n",
      },
    );
    const artifactOnly = createTarball(
      tempRoot,
      {
        name: "@0xkey-io/artifact-only",
        version: "1.0.0",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
      },
      {
        "dist/index.js": 'throw new Error("must not execute");\n',
        "dist/index.d.ts": "export {};\n",
      },
    );
    const consumerRoot = path.join(tempRoot, "selected-root");

    verifyPackedConsumer({
      tarballs: [selected, artifactOnly],
      nodePackageNames: ["@0xkey-io/selected"],
      tempRoot: consumerRoot,
    });

    const consumerDir = path.join(consumerRoot, "consumer");
    const consumerPackage = JSON.parse(
      fs.readFileSync(path.join(consumerDir, "package.json"), "utf8"),
    );
    assert.deepEqual(Object.keys(consumerPackage.dependencies), [
      "@0xkey-io/selected",
    ]);
    assert.deepEqual(Object.keys(consumerPackage.pnpm.overrides), [
      "@0xkey-io/selected",
    ]);
    for (const fileName of ["consumer.cjs", "consumer.mjs", "consumer.ts"]) {
      const source = fs.readFileSync(path.join(consumerDir, fileName), "utf8");
      assert.match(source, /@0xkey-io\/selected/);
      assert.doesNotMatch(source, /@0xkey-io\/artifact-only/);
    }

    const lockfile = fs.readFileSync(
      path.join(consumerDir, "pnpm-lock.yaml"),
      "utf8",
    );
    const parsedLockfile = YAML.parse(lockfile);
    assert.deepEqual(
      Object.keys(parsedLockfile.importers?.["."]?.dependencies ?? {}),
      ["@0xkey-io/selected"],
    );
    for (const resolutionKey of [
      ...Object.keys(parsedLockfile.packages ?? {}),
      ...Object.keys(parsedLockfile.snapshots ?? {}),
    ]) {
      assert.doesNotMatch(resolutionKey, /@0xkey-io\/artifact-only/);
    }
    assert.equal(
      fs.existsSync(
        path.join(consumerDir, "node_modules/@0xkey-io/artifact-only"),
      ),
      false,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("rejects selected artifacts resolved from a non-file or wrong file", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    const tarball = createTarball(
      tempRoot,
      {
        name: "@fixture/selected",
        version: "1.0.0",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
      },
      {
        "dist/index.js": "module.exports = {};\n",
        "dist/index.d.ts": "export {};\n",
      },
    );
    const tarballName = path.basename(tarball);
    const unrelatedDir = path.join(tempRoot, "unrelated");
    fs.mkdirSync(unrelatedDir, { recursive: true });
    const unrelatedSameName = path.join(unrelatedDir, tarballName);
    fs.copyFileSync(tarball, unrelatedSameName);
    const resolutions = [
      { specifier: "1.0.0", version: "1.0.0" },
      { specifier: "file:/tmp/wrong.tgz", version: "file:/tmp/wrong.tgz" },
      {
        specifier: `file:/tmp/copy-${tarballName}`,
        version: `file:/tmp/copy-${tarballName}`,
      },
      {
        specifier: `file:${unrelatedSameName}`,
        version: `file:${unrelatedSameName}`,
      },
    ];

    for (const [index, resolution] of resolutions.entries()) {
      withFakePnpmLockfile(
        path.join(tempRoot, `fake-${index}`),
        {
          lockfileVersion: "9.0",
          importers: {
            ".": { dependencies: { "@fixture/selected": resolution } },
          },
          packages: {},
          snapshots: {},
        },
        () => {
          assert.throws(
            () =>
              verifyPackedConsumer({
                tarballs: [tarball],
                tempRoot: path.join(tempRoot, `wrong-resolution-${index}`),
              }),
            /@fixture\/selected was not resolved from its packed file artifact/,
          );
        },
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("rejects a selected internal lock key with the same basename from another directory", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    const tarball = createTarball(
      tempRoot,
      {
        name: "@0xkey-io/selected",
        version: "1.0.0",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
      },
      {
        "dist/index.js": "module.exports = {};\n",
        "dist/index.d.ts": "export {};\n",
      },
    );
    const unrelatedDir = path.join(tempRoot, "unrelated-internal");
    fs.mkdirSync(unrelatedDir, { recursive: true });
    const unrelatedSameName = path.join(unrelatedDir, path.basename(tarball));
    fs.copyFileSync(tarball, unrelatedSameName);
    const consumerRoot = path.join(tempRoot, "internal-same-name");
    const consumerDir = path.join(consumerRoot, "consumer");
    const matchingRelativeReference = path.relative(consumerDir, tarball);
    const unrelatedRelativeReference = path.relative(
      consumerDir,
      unrelatedSameName,
    );

    withFakePnpmLockfile(
      path.join(tempRoot, "fake-internal-same-name"),
      {
        lockfileVersion: "9.0",
        importers: {
          ".": {
            dependencies: {
              "@0xkey-io/selected": {
                specifier: `file:${matchingRelativeReference}`,
                version: `file:${matchingRelativeReference}`,
              },
            },
          },
        },
        packages: {
          [`@0xkey-io/selected@file:${unrelatedRelativeReference}`]: {},
        },
        snapshots: {},
      },
      () => {
        assert.throws(
          () =>
            verifyPackedConsumer({
              tarballs: [tarball],
              tempRoot: consumerRoot,
            }),
          /Internal public package resolved outside packed artifacts: @0xkey-io\/selected@file:/,
        );
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("accepts legitimate relative selected paths with peer context", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    const manifest = {
      name: "@0xkey-io/relative-selected",
      version: "1.0.0",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
    };
    const files = {
      "dist/index.js": "module.exports = {};\n",
      "dist/index.d.ts": "export {};\n",
    };
    const tarball = createTarball(tempRoot, manifest, files);
    const consumerRoot = path.join(tempRoot, "relative-positive");
    const consumerDir = path.join(consumerRoot, "consumer");
    const installedRoot = path.join(
      consumerDir,
      "node_modules/@0xkey-io/relative-selected",
    );
    fs.mkdirSync(path.join(installedRoot, "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(installedRoot, "package.json"),
      `${JSON.stringify(manifest)}\n`,
    );
    for (const [relativePath, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(installedRoot, relativePath), content);
    }
    const matchingRelativeReference = path.relative(consumerDir, tarball);
    const matchingPeerContextReference = `file:${matchingRelativeReference}(@fixture/peer@1.0.0)`;
    const selectedResolutionKey = `@0xkey-io/relative-selected@${matchingPeerContextReference}`;

    withFakePnpmLockfile(
      path.join(tempRoot, "fake-relative-positive"),
      {
        lockfileVersion: "9.0",
        importers: {
          ".": {
            dependencies: {
              "@0xkey-io/relative-selected": {
                specifier: `file:${matchingRelativeReference}`,
                version: matchingPeerContextReference,
              },
            },
          },
        },
        packages: { [selectedResolutionKey]: {} },
        snapshots: { [selectedResolutionKey]: {} },
      },
      () => {
        verifyPackedConsumer({ tarballs: [tarball], tempRoot: consumerRoot });
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("rejects an omitted internal peer resolved outside selected artifacts", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    const tarball = createTarball(
      tempRoot,
      {
        name: "@0xkey-io/selected",
        version: "1.0.0",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        peerDependencies: { "@0xkey-io/omitted": "1.0.0" },
        peerDependenciesMeta: { "@0xkey-io/omitted": { optional: true } },
      },
      {
        "dist/index.js": "module.exports = {};\n",
        "dist/index.d.ts": "export {};\n",
      },
    );
    const omittedResolutionKeys = [
      "@0xkey-io/omitted@1.0.0",
      "@0xkey-io/omitted@file:omitted-1.0.0.tgz",
    ];
    for (const [
      index,
      omittedResolutionKey,
    ] of omittedResolutionKeys.entries()) {
      const consumerRoot = path.join(tempRoot, `internal-resolution-${index}`);
      const consumerDir = path.join(consumerRoot, "consumer");
      const matchingRelativeReference = path.relative(consumerDir, tarball);
      const matchingPeerContextReference = `file:${matchingRelativeReference}(@fixture/peer@1.0.0)`;
      withFakePnpmLockfile(
        path.join(tempRoot, `fake-internal-${index}`),
        {
          lockfileVersion: "9.0",
          importers: {
            ".": {
              dependencies: {
                "@0xkey-io/selected": {
                  specifier: `file:${matchingRelativeReference}`,
                  version: matchingPeerContextReference,
                },
              },
            },
          },
          packages: {
            [`@0xkey-io/selected@${matchingPeerContextReference}`]: {},
            [omittedResolutionKey]: {},
          },
          snapshots: {},
        },
        () => {
          assert.throws(
            () =>
              verifyPackedConsumer({
                tarballs: [tarball],
                tempRoot: consumerRoot,
              }),
            new RegExp(
              `Internal public package resolved outside packed artifacts: ${omittedResolutionKey.replaceAll(
                ".",
                "\\.",
              )}`,
            ),
          );
        },
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("rejects invalid identities across the complete artifact set", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    const files = { "dist/index.js": "module.exports = {};\n" };
    const invalidCases = [
      {
        label: "invalid-json",
        artifacts: [
          {
            expectedName: "@fixture/invalid-json",
            tarball: createRawTarball(
              tempRoot,
              "{\n",
              files,
              "inspection-invalid-json",
            ),
          },
        ],
        pattern: /Packed artifact manifest is invalid/,
      },
      ...[
        ["null", "null\n"],
        ["array", "[]\n"],
        ["primitive", "7\n"],
        ["missing-name", '{"version":"1.0.0"}\n'],
        ["empty-name", '{"name":" ","version":"1.0.0"}\n'],
        ["non-string-name", '{"name":7,"version":"1.0.0"}\n'],
        ["missing-version", '{"name":"@fixture/missing-version"}\n'],
        ["empty-version", '{"name":"@fixture/empty-version","version":" "}\n'],
        ["non-string-version", '{"name":"@fixture/bad-version","version":7}\n'],
      ].map(([label, packageJson]) => ({
        label,
        artifacts: [
          {
            expectedName: `@fixture/${label}`,
            tarball: createRawTarball(
              tempRoot,
              packageJson,
              files,
              `inspection-${label}`,
            ),
          },
        ],
        pattern: /Packed artifact manifest/,
      })),
      {
        label: "wrong-name",
        artifacts: [
          {
            expectedName: "@fixture/expected",
            tarball: createTarball(
              tempRoot,
              { name: "@fixture/actual", version: "1.0.0" },
              files,
            ),
          },
        ],
        pattern: /expected @fixture\/expected, found @fixture\/actual/,
      },
      {
        label: "duplicate-name",
        artifacts: [
          {
            expectedName: "@fixture/duplicate",
            tarball: createTarball(
              tempRoot,
              { name: "@fixture/duplicate", version: "1.0.0" },
              files,
            ),
          },
          {
            expectedName: "@fixture/duplicate-copy",
            tarball: createRawTarball(
              tempRoot,
              '{"name":"@fixture/duplicate","version":"2.0.0"}\n',
              files,
              "inspection-duplicate-two",
            ),
          },
        ],
        pattern: /Duplicate packed artifact identity @fixture\/duplicate/,
      },
    ];

    for (const { label, artifacts, pattern } of invalidCases) {
      assert.throws(
        () =>
          packSmoke.inspectPackedArtifacts({
            artifacts,
            tempRoot: path.join(tempRoot, `inspect-${label}`),
          }),
        pattern,
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("continues artifact inspection after failures and records later successes", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    const files = { "dist/index.js": "module.exports = {};\n" };
    const artifacts = [
      {
        expectedName: "@fixture/invalid-json",
        tarball: createRawTarball(
          tempRoot,
          "{\n",
          files,
          "continue-invalid-json",
        ),
      },
      {
        expectedName: "@fixture/null",
        tarball: createRawTarball(tempRoot, "null\n", files, "continue-null"),
      },
      {
        expectedName: "@fixture/valid",
        tarball: createTarball(
          tempRoot,
          { name: "@fixture/valid", version: "1.0.0" },
          files,
        ),
      },
    ];

    assert.throws(
      () =>
        packSmoke.inspectPackedArtifacts({
          artifacts,
          tempRoot: path.join(tempRoot, "continue-inspection"),
        }),
      (error) => {
        assert.equal(error.failures.length, 2);
        assert.deepEqual(error.inspectedArtifactNames, ["@fixture/valid"]);
        return true;
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("applies every artifact guard to artifact-only tarballs", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    const notTarball = path.join(tempRoot, "not-a-tarball.tgz");
    fs.writeFileSync(notTarball, "not a tarball\n");
    const cases = [
      {
        expectedName: "@fixture/extraction",
        tarball: notTarball,
        pattern: /extract failed/,
      },
      {
        expectedName: "@fixture/missing-dist",
        tarball: createTarball(
          tempRoot,
          { name: "@fixture/missing-dist", version: "1.0.0" },
          {},
        ),
        pattern: /dist\/index\.js missing/,
      },
      {
        expectedName: "@fixture/manifest-leak",
        tarball: createTarball(
          tempRoot,
          {
            name: "@fixture/manifest-leak",
            version: "1.0.0",
            dependencies: { "@0xkey-io/internal-secret": "1.0.0" },
          },
          { "dist/index.js": "module.exports = {};\n" },
        ),
        pattern: /internal dep.*leaked into published manifest/,
      },
      {
        expectedName: "@fixture/built-leak",
        tarball: createTarball(
          tempRoot,
          { name: "@fixture/built-leak", version: "1.0.0" },
          {
            "dist/index.js":
              'module.exports = require("@0xkey-io/internal-secret");\n',
          },
        ),
        pattern: /internal reference/,
      },
    ];

    for (const [index, fixture] of cases.entries()) {
      assert.throws(
        () =>
          packSmoke.inspectPackedArtifacts({
            artifacts: [fixture],
            tempRoot: path.join(tempRoot, `guard-${index}`),
          }),
        fixture.pattern,
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("rejects an empty required Node profile before packing or installation", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    let packCalls = 0;
    let verifierCalls = 0;
    const result = packSmoke.runPackageCompatibility({
      packages: [packageMeta("@fixture/artifact-only")],
      nodeSeeds: new Set(),
      artifactOnlySeeds: new Set(["@fixture/artifact-only"]),
      nodeVerification: "required",
      tempRoot,
      packPackage() {
        packCalls += 1;
        throw new Error("must not pack");
      },
      verifyConsumer() {
        verifierCalls += 1;
      },
    });

    assert.equal(result.exitCode, 1);
    assert.equal(packCalls, 0);
    assert.equal(verifierCalls, 0);
    assert.match(result.lines.join("\n"), /Node verification: failed/);
    assert.doesNotMatch(result.lines.join("\n"), /not requested/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("accepts not-requested only with explicitly empty Node seeds", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    const artifactOnly = createTarball(
      tempRoot,
      { name: "@fixture/artifact-only", version: "1.0.0" },
      { "dist/index.js": "module.exports = {};\n" },
    );
    let verifierCalls = 0;
    const common = {
      packages: [packageMeta("@fixture/artifact-only")],
      artifactOnlySeeds: new Set(["@fixture/artifact-only"]),
      nodeVerification: "not-requested",
      packPackage() {
        return artifactOnly;
      },
      verifyConsumer() {
        verifierCalls += 1;
      },
    };

    const omitted = packSmoke.runPackageCompatibility({
      ...common,
      tempRoot: path.join(tempRoot, "omitted"),
    });
    const nonempty = packSmoke.runPackageCompatibility({
      ...common,
      nodeSeeds: new Set(["@fixture/artifact-only"]),
      tempRoot: path.join(tempRoot, "nonempty"),
    });
    const accepted = packSmoke.runPackageCompatibility({
      ...common,
      nodeSeeds: new Set(),
      tempRoot: path.join(tempRoot, "accepted"),
    });

    assert.equal(omitted.exitCode, 1);
    assert.equal(nonempty.exitCode, 1);
    assert.equal(accepted.exitCode, 0);
    assert.equal(verifierCalls, 0);
    assert.ok(accepted.lines.includes("Node verification: not requested"));
    assert.equal(
      accepted.lines.filter(
        (line) => line === "Node verification: not requested",
      ).length,
      1,
    );
    assert.doesNotMatch(
      accepted.lines.join("\n"),
      /Packages verified in Node|CJS|ESM|types consumers/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("reports exact artifact and Node sets from real profile selection", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    const nodeTarball = createTarball(
      tempRoot,
      {
        name: "@fixture/node",
        version: "1.0.0",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        peerDependencies: { "@fixture/optional": "^1.0.0" },
        peerDependenciesMeta: { "@fixture/optional": { optional: true } },
      },
      {
        "dist/index.js": "module.exports = {};\n",
        "dist/index.d.ts": "export {};\n",
      },
    );
    const optionalTarball = createTarball(
      tempRoot,
      { name: "@fixture/optional", version: "1.0.0" },
      { "dist/index.js": 'throw new Error("artifact only");\n' },
    );
    const packages = [
      packageMeta("@fixture/node", {
        peerDependencies: { "@fixture/optional": "workspace:*" },
        peerDependenciesMeta: { "@fixture/optional": { optional: true } },
      }),
      packageMeta("@fixture/optional"),
    ];
    const tarballsByName = new Map([
      ["@fixture/node", nodeTarball],
      ["@fixture/optional", optionalTarball],
    ]);
    const result = packSmoke.runPackageCompatibility({
      packages,
      nodeSeeds: new Set(["@fixture/node"]),
      artifactOnlySeeds: new Set(["@fixture/optional"]),
      nodeVerification: "required",
      tempRoot: path.join(tempRoot, "orchestration"),
      packPackage(pkgMeta) {
        return tarballsByName.get(pkgMeta.pkg.name);
      },
    });

    assert.equal(result.exitCode, 0);
    assert.ok(
      result.lines.includes(
        "Artifacts inspected: @fixture/node, @fixture/optional",
      ),
    );
    assert.ok(
      result.lines.includes("Packages verified in Node: @fixture/node"),
    );
    assert.ok(
      result.lines.includes(
        "Runtime-unverified artifact-only packages: @fixture/optional",
      ),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("reports artifact and Node failure states without false success", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-pack-smoke-test-"),
  );
  try {
    const invalid = createRawTarball(
      tempRoot,
      "null\n",
      { "dist/index.js": "module.exports = {};\n" },
      "status-invalid",
    );
    const valid = createTarball(
      tempRoot,
      { name: "@fixture/valid", version: "1.0.0" },
      { "dist/index.js": "module.exports = {};\n" },
    );
    const packages = [packageMeta("@fixture/valid")];
    let verifierCalls = 0;
    const artifactFailure = packSmoke.runPackageCompatibility({
      packages,
      nodeSeeds: new Set(["@fixture/valid"]),
      artifactOnlySeeds: new Set(),
      nodeVerification: "required",
      tempRoot: path.join(tempRoot, "artifact-failure"),
      packPackage() {
        return invalid;
      },
      verifyConsumer() {
        verifierCalls += 1;
      },
    });
    assert.equal(artifactFailure.exitCode, 1);
    assert.equal(verifierCalls, 0);
    assert.ok(artifactFailure.lines.includes("Artifact inspection: failed"));
    assert.ok(
      artifactFailure.lines.includes(
        "Node verification: not run because artifact inspection failed",
      ),
    );
    assert.doesNotMatch(
      artifactFailure.lines.join("\n"),
      /Packages verified in Node/,
    );

    const nodeFailure = packSmoke.runPackageCompatibility({
      packages,
      nodeSeeds: new Set(["@fixture/valid"]),
      artifactOnlySeeds: new Set(),
      nodeVerification: "required",
      tempRoot: path.join(tempRoot, "node-failure"),
      packPackage() {
        return valid;
      },
      verifyConsumer() {
        throw new Error("synthetic Node failure");
      },
    });
    assert.equal(nodeFailure.exitCode, 1);
    assert.ok(
      nodeFailure.lines.includes("Artifacts inspected: @fixture/valid"),
    );
    assert.ok(nodeFailure.lines.includes("Node verification: failed"));
    assert.doesNotMatch(nodeFailure.lines.join("\n"), /not requested/);

    const notRequestedArtifactFailure = packSmoke.runPackageCompatibility({
      packages,
      nodeSeeds: new Set(),
      artifactOnlySeeds: new Set(["@fixture/valid"]),
      nodeVerification: "not-requested",
      tempRoot: path.join(tempRoot, "not-requested-failure"),
      packPackage() {
        return invalid;
      },
      verifyConsumer() {
        verifierCalls += 1;
      },
    });
    assert.equal(notRequestedArtifactFailure.exitCode, 1);
    assert.ok(
      notRequestedArtifactFailure.lines.includes(
        "Node verification: not requested",
      ),
    );
    assert.equal(verifierCalls, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
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
