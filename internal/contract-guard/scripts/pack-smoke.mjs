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
  const manifest = JSON.parse(
    run("tar", ["-xOf", tarball, "package/package.json"]),
  );
  return manifest;
}

/**
 * @param {unknown} manifest
 * @param {string} label
 * @returns {{ name: string, version: string, [key: string]: unknown }}
 */
function validatePackedManifest(manifest, label) {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest)
  ) {
    throw new Error(`${label}: Packed artifact manifest must be an object`);
  }
  const { name, version } = manifest;
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error(
      `${label}: Packed artifact manifest name must be a non-empty string`,
    );
  }
  if (typeof version !== "string" || version.trim() === "") {
    throw new Error(
      `${label}: Packed artifact manifest version must be a non-empty string`,
    );
  }
  return /** @type {{ name: string, version: string, [key: string]: unknown }} */ (
    manifest
  );
}

/**
 * @param {string[]} tarballs
 */
function indexPackedTarballs(tarballs) {
  /** @type {Map<string, { tarball: string, manifest: ReturnType<typeof validatePackedManifest> }>} */
  const byName = new Map();
  for (const tarball of tarballs) {
    let manifest;
    try {
      manifest = validatePackedManifest(
        readPackedManifest(tarball),
        path.basename(tarball),
      );
    } catch (error) {
      throw new Error(
        `${path.basename(tarball)}: Packed artifact manifest is invalid: ${errorMessage(error)}`,
      );
    }
    if (byName.has(manifest.name)) {
      throw new Error(`Duplicate packed artifact identity ${manifest.name}`);
    }
    byName.set(manifest.name, { tarball, manifest });
  }
  return byName;
}

/**
 * @param {Map<string, { tarball: string, manifest: ReturnType<typeof validatePackedManifest> }>} artifactsByName
 * @param {unknown} nodePackageNames
 */
function selectNodeArtifacts(artifactsByName, nodePackageNames) {
  const requestedNames =
    nodePackageNames === undefined
      ? [...artifactsByName.keys()]
      : nodePackageNames;
  if (!Array.isArray(requestedNames) || requestedNames.length === 0) {
    throw new Error("Node package selection must contain at least one package");
  }
  const seen = new Set();
  return requestedNames.map((packageName) => {
    if (typeof packageName !== "string" || packageName.trim() === "") {
      throw new Error("Node package selection names must be non-empty strings");
    }
    if (seen.has(packageName)) {
      throw new Error(
        `Node package selection contains duplicate name ${packageName}`,
      );
    }
    seen.add(packageName);
    const artifact = artifactsByName.get(packageName);
    if (!artifact) {
      throw new Error(
        `Node package selection contains unknown name ${packageName}`,
      );
    }
    return artifact;
  });
}

/**
 * pnpm may append a parenthesized peer-context suffix to a file resolution.
 * Compare the file path itself, not a substring of the complete lock value.
 *
 * @param {unknown} resolution
 * @param {string} tarball
 * @param {string} consumerDir
 */
function fileResolutionMatchesTarball(resolution, tarball, consumerDir) {
  const reference = String(resolution);
  if (!reference.startsWith("file:")) return false;
  const peerContextIndex = reference.indexOf("(");
  const fileReference =
    peerContextIndex === -1
      ? reference.slice("file:".length)
      : reference.slice("file:".length, peerContextIndex);
  const resolvedReference = path.resolve(consumerDir, fileReference);
  const selectedTarball = path.resolve(tarball);
  return resolvedReference === selectedTarball;
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Extract and inspect every packed artifact before any consumer installation.
 * Failures are aggregated so one malformed artifact cannot hide later results.
 *
 * @param {{
 *   artifacts: { expectedName: string, tarball: string }[],
 *   tempRoot: string,
 * }} options
 */
export function inspectPackedArtifacts({ artifacts, tempRoot }) {
  fs.mkdirSync(tempRoot, { recursive: true });
  /** @type {{ expectedName: string, message: string }[]} */
  const failures = [];
  /** @type {string[]} */
  const inspectedArtifactNames = [];
  /** @type {{ expectedName: string, tarball: string, manifest: ReturnType<typeof validatePackedManifest>, packageRoot: string }[]} */
  const records = [];
  /** @type {Map<string, string>} */
  const identityOwners = new Map();

  for (const [index, artifact] of artifacts.entries()) {
    const { expectedName, tarball } = artifact;
    const extractDir = path.join(tempRoot, `artifact-${index}`);
    const packageRoot = path.join(extractDir, "package");
    /** @type {string[]} */
    const artifactFailures = [];
    /** @type {ReturnType<typeof validatePackedManifest> | undefined} */
    let manifest;

    fs.mkdirSync(extractDir, { recursive: true });
    try {
      run("tar", ["-xzf", tarball, "-C", extractDir], {
        label: `${expectedName} extract`,
      });
    } catch (error) {
      artifactFailures.push(errorMessage(error));
    }

    if (artifactFailures.length === 0) {
      if (!fs.existsSync(path.join(packageRoot, "dist/index.js"))) {
        artifactFailures.push(
          `${expectedName}: dist/index.js missing in packed artifact`,
        );
      }

      try {
        const packageJsonPath = path.join(packageRoot, "package.json");
        let parsedManifest;
        try {
          parsedManifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        } catch (error) {
          throw new Error(
            `Packed artifact manifest is invalid: ${errorMessage(error)}`,
          );
        }
        manifest = validatePackedManifest(parsedManifest, expectedName);
        if (manifest.name !== expectedName) {
          artifactFailures.push(
            `${path.basename(tarball)}: expected ${expectedName}, found ${manifest.name}`,
          );
        }

        const previousOwner = identityOwners.get(manifest.name);
        if (previousOwner) {
          artifactFailures.push(
            `Duplicate packed artifact identity ${manifest.name} in ${previousOwner} and ${expectedName}`,
          );
        } else {
          identityOwners.set(manifest.name, expectedName);
        }

        const runtimeDependencies = {
          ...(manifest.dependencies && typeof manifest.dependencies === "object"
            ? manifest.dependencies
            : {}),
          ...(manifest.peerDependencies &&
          typeof manifest.peerDependencies === "object"
            ? manifest.peerDependencies
            : {}),
        };
        for (const dependencyName of Object.keys(runtimeDependencies)) {
          if (dependencyName.startsWith("@0xkey-io/internal-")) {
            artifactFailures.push(
              `${expectedName}: internal dep "${dependencyName}" leaked into published manifest`,
            );
          }
        }
      } catch (error) {
        artifactFailures.push(`${expectedName}: ${errorMessage(error)}`);
      }

      /** @param {string} dir */
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(fullPath);
          else if (/\.(js|mjs|d\.ts)$/.test(entry.name)) {
            const content = fs.readFileSync(fullPath, "utf8");
            if (content.includes("@0xkey-io/internal-")) {
              artifactFailures.push(
                `${expectedName}: internal reference in ${fullPath}`,
              );
            }
          }
        }
      };
      try {
        walk(packageRoot);
      } catch (error) {
        artifactFailures.push(
          `${expectedName}: packed artifact traversal failed: ${errorMessage(error)}`,
        );
      }
    }

    for (const message of artifactFailures) {
      failures.push({ expectedName, message });
    }
    if (artifactFailures.length === 0 && manifest) {
      inspectedArtifactNames.push(expectedName);
      records.push({ expectedName, tarball, manifest, packageRoot });
    }
  }

  if (failures.length > 0) {
    const error = new Error(failures.map(({ message }) => message).join("\n"));
    Object.assign(error, { failures, inspectedArtifactNames });
    throw error;
  }
  return records;
}

/**
 * Include every public package reached through an ordinary runtime dependency
 * or workspace peer. Optional peers are included for artifact inspection by
 * default and may be omitted for Node consumers. Dev-only dependencies are
 * intentionally excluded. Ordinary dependency edges remain required even when
 * peer metadata marks the same package optional.
 *
 * @param {ReturnType<typeof listPublicPackages>} packages
 * @param {Set<string>} seeds
 * @param {{ includeOptionalPeers?: boolean }} options
 */
export function selectPilotPackageClosure(
  packages,
  seeds = PILOT_PACKAGES,
  { includeOptionalPeers = true } = {},
) {
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

    for (const [dependencyName, dependencyVersion] of Object.entries(
      packageMeta.pkg.dependencies ?? {},
    )) {
      if (
        dependencyName.startsWith("@0xkey-io/") &&
        String(dependencyVersion).startsWith("workspace:")
      ) {
        pending.push(dependencyName);
      }
    }
    for (const [dependencyName, dependencyVersion] of Object.entries(
      packageMeta.pkg.peerDependencies ?? {},
    )) {
      const optional =
        packageMeta.pkg.peerDependenciesMeta?.[dependencyName]?.optional ===
        true;
      if (
        (includeOptionalPeers || !optional) &&
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
 * @param {{ tarballs: string[], tempRoot: string, nodePackageNames?: string[] }} options
 */
export function verifyPackedConsumer({ tarballs, tempRoot, nodePackageNames }) {
  const artifactsByName = indexPackedTarballs(tarballs);
  const selectedArtifacts = selectNodeArtifacts(
    artifactsByName,
    nodePackageNames,
  );
  const consumerDir = path.join(tempRoot, "consumer");
  fs.mkdirSync(consumerDir, { recursive: true });

  const packageNames = selectedArtifacts.map(({ manifest }) => manifest.name);
  /** @type {Record<string, string>} */
  const dependencies = {};
  for (const { tarball, manifest } of selectedArtifacts) {
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
  for (const { manifest, tarball } of selectedArtifacts) {
    const packageName = manifest.name;
    const resolution = installedDependencies[packageName];
    if (
      !resolution ||
      !fileResolutionMatchesTarball(
        resolution.specifier,
        tarball,
        consumerDir,
      ) ||
      !fileResolutionMatchesTarball(resolution.version, tarball, consumerDir)
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
      if (resolutionKey.includes("@0xkey-io/")) {
        const backedBySelectedArtifact = selectedArtifacts.some(
          ({ manifest, tarball }) => {
            const prefix = `${manifest.name}@`;
            return (
              manifest.name.startsWith("@0xkey-io/") &&
              resolutionKey.startsWith(prefix) &&
              fileResolutionMatchesTarball(
                resolutionKey.slice(prefix.length),
                tarball,
                consumerDir,
              )
            );
          },
        );
        if (backedBySelectedArtifact) continue;
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

/**
 * @param {ReturnType<typeof listPublicPackages>[number]} pkgMeta
 * @param {string} tempRoot
 */
function packWorkspacePackage(pkgMeta, tempRoot) {
  const before = new Set(fs.readdirSync(tempRoot));
  run("pnpm", ["pack", "--pack-destination", tempRoot], {
    cwd: pkgMeta.dirPath,
    label: `${pkgMeta.pkg.name} pack`,
  });
  const newTarballs = fs
    .readdirSync(tempRoot)
    .filter((name) => !before.has(name) && name.endsWith(".tgz"));
  if (newTarballs.length !== 1) {
    throw new Error(
      `${pkgMeta.pkg.name}: expected one tarball, found ${newTarballs.length}`,
    );
  }
  return path.join(tempRoot, newTarballs[0]);
}

/**
 * @param {{
 *   packages?: ReturnType<typeof listPublicPackages>,
 *   nodeSeeds?: Set<string>,
 *   artifactOnlySeeds?: Set<string>,
 *   nodeVerification?: "required" | "not-requested",
 *   tempRoot?: string,
 *   packPackage?: typeof packWorkspacePackage,
 *   verifyConsumer?: typeof verifyPackedConsumer,
 * }} options
 */
export function runPackageCompatibility(options = {}) {
  const {
    packages = listPublicPackages(),
    nodeSeeds = PILOT_PACKAGES,
    artifactOnlySeeds = new Set(),
    nodeVerification = "required",
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "0xkey-pack-smoke-run-")),
    packPackage = packWorkspacePackage,
    verifyConsumer = verifyPackedConsumer,
  } = options;
  fs.mkdirSync(tempRoot, { recursive: true });

  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const failures = [];
  const configurationFailure = (message) => {
    failures.push(message);
    lines.push("Configuration: failed", "Node verification: failed");
    return { exitCode: 1, lines, failures };
  };

  if (nodeVerification !== "required" && nodeVerification !== "not-requested") {
    return configurationFailure(
      `Invalid Node verification profile ${String(nodeVerification)}`,
    );
  }
  if (
    nodeVerification === "not-requested" &&
    (!Object.hasOwn(options, "nodeSeeds") || nodeSeeds.size !== 0)
  ) {
    return configurationFailure(
      "Node verification not-requested requires explicitly empty nodeSeeds",
    );
  }

  let artifactClosure;
  let nodeClosure;
  try {
    const artifactSeeds = new Set([...nodeSeeds, ...artifactOnlySeeds]);
    artifactClosure = selectPilotPackageClosure(packages, artifactSeeds);
    nodeClosure =
      nodeVerification === "required"
        ? selectPilotPackageClosure(packages, nodeSeeds, {
            includeOptionalPeers: false,
          })
        : [];
  } catch (error) {
    return configurationFailure(errorMessage(error));
  }
  if (nodeVerification === "required" && nodeClosure.length === 0) {
    return configurationFailure(
      "Required Node verification computed an empty package set",
    );
  }

  const artifactNames = artifactClosure.map(({ pkg }) => pkg.name);
  const nodePackageNames = nodeClosure.map(({ pkg }) => pkg.name);
  const nodeNameSet = new Set(nodePackageNames);
  const artifactOnlyNames = artifactNames.filter(
    (packageName) => !nodeNameSet.has(packageName),
  );
  /** @type {{ expectedName: string, tarball: string }[]} */
  const artifacts = [];
  for (const pkgMeta of artifactClosure) {
    try {
      const tarball = packPackage(pkgMeta, tempRoot);
      if (typeof tarball !== "string" || tarball.trim() === "") {
        throw new Error(`${pkgMeta.pkg.name}: packed tarball path is missing`);
      }
      artifacts.push({ expectedName: pkgMeta.pkg.name, tarball });
    } catch (error) {
      failures.push(errorMessage(error));
    }
  }

  let artifactInspectionFailed = failures.length > 0;
  try {
    inspectPackedArtifacts({
      artifacts,
      tempRoot: path.join(tempRoot, "inspection"),
    });
  } catch (error) {
    artifactInspectionFailed = true;
    if (Array.isArray(error?.failures)) {
      for (const failure of error.failures) failures.push(failure.message);
    } else {
      failures.push(errorMessage(error));
    }
  }

  if (artifactInspectionFailed) {
    lines.push("Artifact inspection: failed");
  } else {
    lines.push(`Artifacts inspected: ${artifactNames.join(", ")}`);
  }
  if (artifactOnlyNames.length > 0) {
    lines.push(
      `Runtime-unverified artifact-only packages: ${artifactOnlyNames.join(", ")}`,
    );
  }

  if (nodeVerification === "not-requested") {
    lines.push("Node verification: not requested");
  } else if (artifactInspectionFailed) {
    lines.push("Node verification: not run because artifact inspection failed");
  } else {
    try {
      verifyConsumer({
        tarballs: artifacts.map(({ tarball }) => tarball),
        nodePackageNames,
        tempRoot,
      });
      lines.push(`Packages verified in Node: ${nodePackageNames.join(", ")}`);
    } catch (error) {
      failures.push(errorMessage(error));
      lines.push("Node verification: failed");
    }
  }

  return { exitCode: failures.length > 0 ? 1 : 0, lines, failures };
}

export function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "0xkey-pack-smoke-"));
  try {
    const result = runPackageCompatibility({ tempRoot });
    for (const line of result.lines) console.log(line);
    if (result.failures.length > 0) {
      console.error("Pack smoke test failures:");
      for (const failure of result.failures) console.error(`  - ${failure}`);
    }
    return result.exitCode;
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
