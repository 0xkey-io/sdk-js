import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { listPublicPackages, REPO_ROOT } from "./lib/paths.mjs";

const PILOT_PACKAGES = new Set([
  "@0xkey-io/encoding",
  "@0xkey-io/crypto",
  "@0xkey-io/api-key-stamper",
  "@0xkey-io/attested-stamper",
]);

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, label?: string }} options
 */
function run(command, args, options = {}) {
  const { label, ...spawnOptions } = options;
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...spawnOptions,
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(
      `${label ?? command} failed${output ? `:\n${output}` : ""}`,
    );
  }
  return result.stdout ?? "";
}

/** @param {string} tarball */
function readPackedManifest(tarball) {
  /** @type {{ name: string, version: string }} */
  const manifest = JSON.parse(
    run("tar", ["-xOf", tarball, "package/package.json"]),
  );
  return manifest;
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Include every public package reached through a runtime or peer workspace
 * dependency. Dev-only workspace dependencies are intentionally excluded.
 *
 * @param {ReturnType<typeof listPublicPackages>} packages
 * @param {Set<string>} seeds
 */
export function selectPilotPackageClosure(packages, seeds = PILOT_PACKAGES) {
  const packagesByName = new Map(
    packages.map((packageMeta) => [packageMeta.pkg.name, packageMeta]),
  );
  const selected = [];
  const pending = [...seeds];
  const visited = new Set();

  while (pending.length > 0) {
    const packageName = pending.shift();
    if (visited.has(packageName)) continue;
    visited.add(packageName);

    const packageMeta = packagesByName.get(packageName);
    if (!packageMeta) {
      throw new Error(
        `Pilot workspace dependency ${packageName} is not a public package`,
      );
    }
    selected.push(packageMeta);

    const runtimeDependencies = {
      ...packageMeta.pkg.dependencies,
      ...packageMeta.pkg.peerDependencies,
    };
    for (const [dependencyName, dependencyVersion] of Object.entries(
      runtimeDependencies,
    )) {
      if (
        dependencyName.startsWith("@0xkey-io/") &&
        String(dependencyVersion).startsWith("workspace:")
      ) {
        pending.push(dependencyName);
      }
    }
  }

  return selected;
}

/**
 * Install packed artifacts together, then exercise their public runtime and
 * type entry points from outside the workspace.
 *
 * @param {{ tarballs: string[], tempRoot: string }} options
 */
export function verifyPackedConsumer({ tarballs, tempRoot }) {
  const consumerDir = path.join(tempRoot, "consumer");
  fs.mkdirSync(consumerDir, { recursive: true });

  /** @type {string[]} */
  const packageNames = [];
  /** @type {Record<string, string>} */
  const dependencies = {};
  for (const tarball of tarballs) {
    const manifest = readPackedManifest(tarball);
    packageNames.push(manifest.name);
    dependencies[manifest.name] = `file:${path.resolve(tarball)}`;
  }

  fs.writeFileSync(
    path.join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "packed-artifact-consumer",
        private: true,
        packageManager: "pnpm@10.6.3",
        dependencies,
        pnpm: { overrides: dependencies },
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(consumerDir, "consumer.cjs"),
    `${packageNames.map((name) => `require(${JSON.stringify(name)});`).join("\n")}\n`,
  );
  fs.writeFileSync(
    path.join(consumerDir, "consumer.mjs"),
    `${packageNames.map((name) => `await import(${JSON.stringify(name)});`).join("\n")}\n`,
  );
  fs.writeFileSync(
    path.join(consumerDir, "consumer.ts"),
    `${packageNames.map((name, index) => `import * as package${index} from ${JSON.stringify(name)};\nvoid package${index};`).join("\n")}\n`,
  );
  fs.writeFileSync(
    path.join(consumerDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "Node16",
          moduleResolution: "Node16",
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: "ES2022",
        },
        files: ["consumer.ts"],
      },
      null,
      2,
    )}\n`,
  );

  run(
    "pnpm",
    ["install", "--ignore-scripts", "--offline", "--frozen-lockfile=false"],
    {
      cwd: consumerDir,
      label: "Packed consumer install",
    },
  );

  /** @type {{
   *   importers?: Record<string, { dependencies?: Record<string, { specifier?: unknown, version?: unknown }> }>,
   *   packages?: Record<string, unknown>,
   *   snapshots?: Record<string, unknown>
   * }} */
  const lockfile = YAML.parse(
    fs.readFileSync(path.join(consumerDir, "pnpm-lock.yaml"), "utf8"),
  );
  const installedDependencies = lockfile.importers?.["."]?.dependencies ?? {};
  for (const [packageName, tarball] of Object.entries(dependencies)) {
    const resolution = installedDependencies[packageName];
    if (
      !resolution ||
      !String(resolution.specifier).startsWith("file:") ||
      !String(resolution.version).startsWith("file:") ||
      !String(resolution.specifier).endsWith(path.basename(tarball)) ||
      !String(resolution.version).endsWith(path.basename(tarball))
    ) {
      throw new Error(
        `${packageName} was not resolved from its packed file artifact`,
      );
    }
  }
  for (const resolutions of [
    lockfile.packages ?? {},
    lockfile.snapshots ?? {},
  ]) {
    for (const resolutionKey of Object.keys(resolutions)) {
      if (
        resolutionKey.includes("@0xkey-io/") &&
        !resolutionKey.includes("@file:")
      ) {
        throw new Error(
          `Internal public package resolved outside packed artifacts: ${resolutionKey}`,
        );
      }
    }
  }
  run(process.execPath, ["consumer.cjs"], {
    cwd: consumerDir,
    label: "CommonJS consumer",
  });
  run(process.execPath, ["consumer.mjs"], {
    cwd: consumerDir,
    label: "ESM consumer",
  });
  run(
    path.join(REPO_ROOT, "node_modules/.bin/tsc"),
    ["--noEmit", "-p", "tsconfig.json"],
    {
      cwd: consumerDir,
      label: "TypeScript consumer",
    },
  );
}

export function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "0xkey-pack-smoke-"));
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const tarballs = [];

  try {
    const packageClosure = selectPilotPackageClosure(listPublicPackages());
    for (const pkgMeta of packageClosure) {
      const before = new Set(fs.readdirSync(tempRoot));
      try {
        run("pnpm", ["pack", "--pack-destination", tempRoot], {
          cwd: pkgMeta.dirPath,
          label: `${pkgMeta.pkg.name} pack`,
        });
      } catch (error) {
        failures.push(errorMessage(error));
        continue;
      }

      const newTarballs = fs
        .readdirSync(tempRoot)
        .filter((name) => !before.has(name) && name.endsWith(".tgz"));
      if (newTarballs.length !== 1) {
        failures.push(
          `${pkgMeta.pkg.name}: expected one tarball, found ${newTarballs.length}`,
        );
        continue;
      }

      const tarballName = newTarballs[0];
      if (!tarballName) {
        failures.push(`${pkgMeta.pkg.name}: packed tarball name is missing`);
        continue;
      }
      const tarball = path.join(tempRoot, tarballName);
      tarballs.push(tarball);
      const extractDir = path.join(tempRoot, pkgMeta.dirName);
      fs.mkdirSync(extractDir, { recursive: true });
      try {
        run("tar", ["-xzf", tarball, "-C", extractDir], {
          label: `${pkgMeta.pkg.name} extract`,
        });
      } catch (error) {
        failures.push(errorMessage(error));
        continue;
      }

      const packageRoot = path.join(extractDir, "package");
      if (!fs.existsSync(path.join(packageRoot, "dist/index.js"))) {
        failures.push(
          `${pkgMeta.pkg.name}: dist/index.js missing in packed artifact`,
        );
      }

      const packedPkg = JSON.parse(
        fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
      );
      const runtimeDeps = {
        ...packedPkg.dependencies,
        ...packedPkg.peerDependencies,
      };
      for (const dep of Object.keys(runtimeDeps)) {
        if (dep.startsWith("@0xkey-io/internal-")) {
          failures.push(
            `${pkgMeta.pkg.name}: internal dep "${dep}" leaked into published manifest`,
          );
        }
      }

      /** @param {string} dir */
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(fullPath);
          else if (/\.(js|mjs|d\.ts)$/.test(entry.name)) {
            const content = fs.readFileSync(fullPath, "utf8");
            if (content.includes("@0xkey-io/internal-")) {
              failures.push(
                `${pkgMeta.pkg.name}: internal reference in ${fullPath}`,
              );
            }
          }
        }
      };
      walk(packageRoot);
    }

    if (failures.length === 0) {
      try {
        verifyPackedConsumer({ tarballs, tempRoot });
      } catch (error) {
        failures.push(errorMessage(error));
      }
    }

    if (failures.length > 0) {
      console.error("Pack smoke test failures:");
      for (const failure of failures) console.error(`  - ${failure}`);
      return 1;
    }

    console.log(
      "Pack smoke tests passed for pilot packages, including CJS, ESM, and types consumers.",
    );
    return 0;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main();
}
