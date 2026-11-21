#!/usr/bin/env node
// Release guards for the generic Changesets release (version-and-publish.yml).
//
//   node scripts/release-guard.mjs assert-unpublished --changeset-status <file>
//   node scripts/release-guard.mjs assert-unpublished --since-ref <git-ref>
//   node scripts/release-guard.mjs pack-smoke
//   node scripts/release-guard.mjs assert-repository
//   node scripts/release-guard.mjs assert-republishable <name>
//   node scripts/release-guard.mjs pack-republish <name> <out-dir>
//
// `changeset publish` silently skips any name@version that already exists on
// npm. That is how a release from main can claim a version (in package.json,
// CHANGELOG and git tags) whose npm tarball was actually built from another
// line, for example a security release line. `assert-unpublished` turns that
// silent skip into a hard failure before anything is published.
//
// `pack-smoke` packs every generic public package exactly as pnpm publishes it
// and checks the tarball: manifest version, resolved internal dependency
// ranges, and a small set of key exported symbols.
//
// npm rejects a provenance publish whose package.json `repository.url` does
// not match the repository that built it, but only at upload time and per
// package, which leaves a partial release. `assert-repository` checks this
// before anything is published.
//
// `assert-republishable` and `pack-republish` back the single-package
// republish path: publish one version that a partial release left out, from a
// default branch whose other package versions are all on npm already.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Packages with a dedicated release path are never published by the generic
// workflow (see packages/pay/scripts/check-generic-release-exclusion.mjs).
const GENERIC_RELEASE_EXCLUDED = new Set(["@0xkey-io/pay"]);

// The repository npm compares against the provenance statement.
export const RELEASE_REPOSITORY_URL = "https://github.com/0xkey-io/sdk-js";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
];

// Key exported symbols that must exist in the packed artifact. `runtime`
// packages are loaded from the packed dist in Node; the others (React Native)
// are checked statically in the packed declaration and JavaScript files.
export const KEY_EXPORTS = Object.freeze({
  "@0xkey-io/core": { runtime: true, symbols: ["ZeroXKeyClient"] },
  "@0xkey-io/react-wallet-kit": {
    runtime: false,
    symbols: ["ZeroXKeyProvider", "useZeroXKey"],
  },
  "@0xkey-io/react-native-wallet-kit": {
    runtime: false,
    symbols: ["ZeroXKeyProvider", "useZeroXKey", "permitsCaptchaNavigation"],
  },
  "@0xkey-io/viem": {
    runtime: true,
    symbols: ["createAccount", "createApiKeyAccount"],
  },
  "@0xkey-io/ethers": { runtime: true, symbols: ["ZeroXKeySigner"] },
  "@0xkey-io/solana": { runtime: true, symbols: ["ZeroXKeySigner"] },
  "@0xkey-io/cosmjs": { runtime: true, symbols: ["ZeroXKeyDirectWallet"] },
  "@0xkey-io/eip-1193-provider": {
    runtime: true,
    symbols: ["createEIP1193Provider"],
  },
  "@0xkey-io/attested-stamper": {
    runtime: true,
    symbols: ["AttestedStamper", "AttestedScheme"],
  },
});

/** @returns {{ name: string, version: string, dir: string, manifest: any }[]} */
export function listGenericPackages(repoRoot = REPO_ROOT) {
  const packagesDir = path.join(repoRoot, "packages");
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = path.join(packagesDir, entry.name, "package.json");
      if (!fs.existsSync(file)) return null;
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      if (manifest.private || GENERIC_RELEASE_EXCLUDED.has(manifest.name)) {
        return null;
      }
      return {
        name: manifest.name,
        version: manifest.version,
        dir: path.join(packagesDir, entry.name),
        manifest,
      };
    })
    .filter((value) => value !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Generic packages planned by `changeset status --output <file>`. Private
 * workspaces (examples, internal tooling) are versioned but never published,
 * so they are not checked against npm.
 * @param {any} status
 * @param {Iterable<string>} publishable names of generic public packages
 * @returns {{ name: string, version: string }[]}
 */
export function plannedFromChangesetStatus(status, publishable) {
  if (!status || !Array.isArray(status.releases)) {
    throw new Error("changeset status output has no releases array");
  }
  const names = new Set(publishable);
  return status.releases
    .filter((release) => release.type !== "none")
    .filter((release) => names.has(release.name))
    .map((release) => ({ name: release.name, version: release.newVersion }));
}

/**
 * Packages whose version on HEAD differs from `ref`: what this release
 * branch versioned and `changeset publish` is about to publish.
 * @returns {{ name: string, version: string }[]}
 */
export function plannedSinceRef(ref, repoRoot = REPO_ROOT) {
  return listGenericPackages(repoRoot)
    .filter(({ dir, version }) => {
      const relative = path.relative(repoRoot, path.join(dir, "package.json"));
      let base;
      try {
        base = JSON.parse(
          execFileSync("git", ["show", `${ref}:${relative}`], {
            cwd: repoRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          }),
        ).version;
      } catch {
        base = undefined; // package is new since ref
      }
      return base !== version;
    })
    .map(({ name, version }) => ({ name, version }));
}

/**
 * Registry lookup. Returns every version npm has ever accepted for `name`,
 * including unpublished ones (they can never be published again).
 * @returns {Promise<Set<string>>}
 */
export async function fetchRegistryVersions(
  name,
  { registry = "https://registry.npmjs.org", fetchImpl = fetch } = {},
) {
  const url = `${registry.replace(/\/$/, "")}/${name.replace("/", "%2f")}`;
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return new Set();
  if (!response.ok) {
    throw new Error(
      `${name}: registry lookup failed (HTTP ${response.status})`,
    );
  }
  const document = await response.json();
  const versions = new Set(Object.keys(document.versions ?? {}));
  for (const key of Object.keys(document.time ?? {})) {
    if (key !== "created" && key !== "modified") versions.add(key);
  }
  return versions;
}

/**
 * @param {{ name: string, version: string }[]} planned
 * @returns {Promise<{ ok: { name: string, version: string }[], collisions: { name: string, version: string }[] }>}
 */
export async function findCollisions(
  planned,
  { lookup = (name) => fetchRegistryVersions(name) } = {},
) {
  const ok = [];
  const collisions = [];
  for (const release of planned) {
    if (!release.version) {
      throw new Error(`${release.name}: planned release has no version`);
    }
    const versions = await lookup(release.name);
    (versions.has(release.version) ? collisions : ok).push(release);
  }
  return { ok, collisions };
}

/** The forms npm accepts for a GitHub `repository.url`, reduced to https. */
export function normalizeRepositoryUrl(url) {
  return String(url ?? "")
    .trim()
    .replace(/^git\+/, "")
    .replace(/^(git|ssh):\/\/(git@)?github\.com[/:]/, "https://github.com/")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

/**
 * @param {any} manifest package.json (workspace or packed)
 * @param {string} directory package directory relative to the repository root
 * @returns {string[]}
 */
export function checkRepository(
  manifest,
  directory,
  expected = RELEASE_REPOSITORY_URL,
) {
  const repository =
    typeof manifest.repository === "string"
      ? { url: manifest.repository }
      : (manifest.repository ?? {});
  const failures = [];
  if (normalizeRepositoryUrl(repository.url) !== expected) {
    failures.push(
      `${manifest.name}: repository.url is ${JSON.stringify(repository.url ?? "")}, expected ${expected}`,
    );
  }
  if (repository.directory !== directory) {
    failures.push(
      `${manifest.name}: repository.directory is ${JSON.stringify(repository.directory ?? "")}, expected ${directory}`,
    );
  }
  return failures;
}

/** @returns {string[]} */
export function checkAllRepositories(repoRoot = REPO_ROOT) {
  return listGenericPackages(repoRoot).flatMap(({ manifest, dir }) =>
    checkRepository(manifest, path.relative(repoRoot, dir)),
  );
}

/**
 * Registry manifest of one published version, or null if npm has none.
 * @returns {Promise<any | null>}
 */
export async function fetchPublishedManifest(
  name,
  version,
  { registry = "https://registry.npmjs.org", fetchImpl = fetch } = {},
) {
  const url = `${registry.replace(/\/$/, "")}/${name.replace("/", "%2f")}/${version}`;
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `${name}@${version}: registry lookup failed (HTTP ${response.status})`,
    );
  }
  return response.json();
}

/** Orders x.y.z[-pre] versions; a prerelease sorts below its release. */
export function compareVersions(a, b) {
  const parse = (value) => {
    const [core, pre = ""] = String(value).split("-", 2);
    return { parts: core.split(".").map(Number), pre };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.parts[index] ?? 0) - (right.parts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre < right.pre ? -1 : 1;
}

/** @param {Iterable<string>} versions */
function highestVersion(versions) {
  let highest;
  for (const version of versions) {
    if (!highest || compareVersions(version, highest) > 0) highest = version;
  }
  return highest;
}

/**
 * A single-package republish is only valid when every other generic package
 * on the default branch is already on npm at its workspace version, no
 * workspace version is behind the highest version on npm, the target version
 * is not on npm, and each published dependent pins a range that the target
 * version satisfies.
 * @param {string} target package name
 * @param {{ name: string, version: string }[]} packages generic packages
 * @returns {Promise<{ failures: string[], dependents: { name: string, version: string, range: string }[] }>}
 */
export async function checkRepublishTarget(
  target,
  packages,
  {
    lookup = (name) => fetchRegistryVersions(name),
    fetchManifest = (name, version) => fetchPublishedManifest(name, version),
  } = {},
) {
  const source = packages.find(({ name }) => name === target);
  if (!source) {
    return {
      failures: [`${target} is not a generic public workspace package`],
      dependents: [],
    };
  }
  const failures = [];
  for (const { name, version } of packages) {
    const versions = await lookup(name);
    const published = versions.has(version);
    if (name === target && published) {
      failures.push(`${name}@${version} already exists on npm`);
    }
    if (name !== target && !published) {
      failures.push(
        `${name}@${version} is not on npm; the default branch does not match npm, use the generic release`,
      );
    }
    const highest = highestVersion(versions);
    if (highest && compareVersions(highest, version) > 0) {
      failures.push(
        `${name}@${version} is behind npm (${highest}); register the published versions on the default branch first`,
      );
    }
  }
  const dependents = [];
  for (const { name, version, manifest } of packages) {
    if (name === target) continue;
    const declared = DEPENDENCY_FIELDS.some(
      (field) => manifest?.[field]?.[target] !== undefined,
    );
    if (!declared) continue;
    const published = await fetchManifest(name, version);
    if (!published) continue; // already reported above
    for (const field of DEPENDENCY_FIELDS) {
      const range = published[field]?.[target];
      if (range === undefined) continue;
      dependents.push({ name, version, range: String(range) });
      if (!satisfiesPackedRange(String(range), source.version)) {
        failures.push(
          `${name}@${version} on npm pins ${field}.${target}@${range}, which ${source.version} does not satisfy`,
        );
      }
    }
  }
  return { failures, dependents };
}

/** Minimal range check for ranges pnpm writes when packing workspace deps. */
export function satisfiesPackedRange(range, version) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(value);
    if (!match) return null;
    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
      pre: match[4] ?? "",
    };
  };
  const target = parse(version);
  if (!target) return false;
  if (parse(range)) return range === version;
  const operator = range[0];
  const base = parse(range.slice(1));
  if (!base || (operator !== "^" && operator !== "~")) return false;
  if (base.pre !== target.pre && target.pre !== "") return false;
  const compare = (a, b) =>
    a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (compare(target, base) < 0) return false;
  if (operator === "~") {
    return target.major === base.major && target.minor === base.minor;
  }
  if (base.major !== 0) return target.major === base.major;
  if (base.minor !== 0)
    return target.major === 0 && target.minor === base.minor;
  return compare(target, base) === 0;
}

/**
 * Check the manifest pnpm wrote into a packed tarball.
 * @param {any} packed
 * @param {{ name: string, version: string }} source
 * @param {Map<string, string>} workspaceVersions
 * @returns {string[]}
 */
export function checkPackedManifest(packed, source, workspaceVersions) {
  const failures = [];
  if (packed.name !== source.name) {
    failures.push(`${source.name}: packed name is ${packed.name}`);
  }
  if (packed.version !== source.version) {
    failures.push(
      `${source.name}: packed version ${packed.version} differs from workspace ${source.version}`,
    );
  }
  for (const field of [
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const [dependency, range] of Object.entries(packed[field] ?? {})) {
      if (String(range).startsWith("workspace:")) {
        failures.push(
          `${source.name}: ${field}.${dependency} still uses ${range}`,
        );
        continue;
      }
      if (!dependency.startsWith("@0xkey-io/")) continue;
      if (dependency.startsWith("@0xkey-io/internal-")) {
        failures.push(`${source.name}: ${field} leaks ${dependency}`);
        continue;
      }
      const current = workspaceVersions.get(dependency);
      if (current === undefined) continue; // not a generic workspace package
      if (!satisfiesPackedRange(String(range), current)) {
        failures.push(
          `${source.name}: ${field}.${dependency}@${range} does not match workspace ${dependency}@${current}`,
        );
      }
    }
  }
  return failures;
}

function walkFiles(dir, filter, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, filter, out);
    else if (filter(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Static check: each symbol is exported by name from some packed declaration
 * file and appears in the packed JavaScript.
 * @returns {string[]}
 */
export function checkStaticExports(packageRoot, name, symbols) {
  const dist = path.join(packageRoot, "dist");
  if (!fs.existsSync(dist)) return [`${name}: packed artifact has no dist/`];
  const declarations = walkFiles(dist, (file) => file.endsWith(".d.ts"))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  const javascript = walkFiles(dist, (file) => /\.(c|m)?js$/.test(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  const failures = [];
  for (const symbol of symbols) {
    const declared = new RegExp(
      `export\\s+(declare\\s+)?(const|let|function|class|enum|async\\s+function)\\s+${symbol}\\b|export\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}`,
    ).test(declarations);
    const present = new RegExp(`\\b${symbol}\\b`).test(javascript);
    if (!declared || !present) {
      failures.push(`${name}: key export ${symbol} missing from packed dist`);
    }
  }
  return failures;
}

/** Runtime check: load the packed CommonJS entry with the package's deps. */
export function checkRuntimeExports(packageRoot, name, symbols) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  );
  const entry = path.join(packageRoot, manifest.main ?? "dist/index.js");
  let loaded;
  try {
    loaded = createRequire(entry)(entry);
  } catch (error) {
    return [
      `${name}: packed entry ${manifest.main} failed to load: ${error.message}`,
    ];
  }
  return symbols
    .filter((symbol) => loaded[symbol] === undefined)
    .map((symbol) => `${name}: key export ${symbol} missing at runtime`);
}

function pnpmPack(dir, destination) {
  const before = new Set(fs.readdirSync(destination));
  execFileSync("pnpm", ["pack", "--pack-destination", destination], {
    cwd: dir,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const created = fs
    .readdirSync(destination)
    .filter((file) => file.endsWith(".tgz") && !before.has(file));
  if (created.length !== 1) {
    throw new Error(`${dir}: expected one tarball, found ${created.length}`);
  }
  return path.join(destination, created[0]);
}

/**
 * With `destination`, the checked tarballs are kept there and returned.
 * @returns {{ checked: string[], failures: string[], tarballs: string[] }}
 */
export function runPackSmoke({ repoRoot = REPO_ROOT, only, destination } = {}) {
  const packages = listGenericPackages(repoRoot);
  const workspaceVersions = new Map(packages.map((p) => [p.name, p.version]));
  const selected = only
    ? packages.filter((p) => only.includes(p.name))
    : packages;
  const tarballs =
    destination ??
    fs.mkdtempSync(path.join(os.tmpdir(), "0xkey-release-pack-"));
  const failures = [];
  const checked = [];
  const kept = [];
  try {
    for (const source of selected) {
      // Extract inside the package directory so Node resolves the packed
      // entry's dependencies from that package's installed node_modules.
      const extractRoot = fs.mkdtempSync(
        path.join(source.dir, ".release-pack-smoke-"),
      );
      try {
        const tarball = pnpmPack(source.dir, tarballs);
        execFileSync("tar", ["-xzf", tarball, "-C", extractRoot]);
        const packageRoot = path.join(extractRoot, "package");
        const packed = JSON.parse(
          fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
        );
        failures.push(
          ...checkPackedManifest(packed, source, workspaceVersions),
          ...checkRepository(packed, path.relative(repoRoot, source.dir)),
        );
        const key = KEY_EXPORTS[source.name];
        if (key) {
          failures.push(
            ...checkStaticExports(packageRoot, source.name, key.symbols),
          );
          if (key.runtime) {
            failures.push(
              ...checkRuntimeExports(packageRoot, source.name, key.symbols),
            );
          }
        }
        checked.push(`${packed.name}@${packed.version}`);
        kept.push(tarball);
      } catch (error) {
        failures.push(`${source.name}: ${error.message}`);
      } finally {
        fs.rmSync(extractRoot, { recursive: true, force: true });
      }
    }
  } finally {
    if (!destination) fs.rmSync(tarballs, { recursive: true, force: true });
  }
  return { checked, failures, tarballs: destination ? kept : [] };
}

async function main(argv) {
  const [command, ...rest] = argv;
  const option = (flag) => {
    const index = rest.indexOf(flag);
    return index === -1 ? undefined : rest[index + 1];
  };

  if (command === "assert-unpublished") {
    const statusFile = option("--changeset-status");
    const ref = option("--since-ref");
    if (Boolean(statusFile) === Boolean(ref)) {
      throw new Error("pass exactly one of --changeset-status or --since-ref");
    }
    const planned = statusFile
      ? plannedFromChangesetStatus(
          JSON.parse(fs.readFileSync(path.resolve(statusFile), "utf8")),
          listGenericPackages().map(({ name }) => name),
        )
      : plannedSinceRef(ref);
    if (planned.length === 0) {
      throw new Error("no packages are planned for publication");
    }
    const { ok, collisions } = await findCollisions(planned);
    for (const { name, version } of ok) {
      console.log(`not on npm yet: ${name}@${version}`);
    }
    if (collisions.length > 0) {
      for (const { name, version } of collisions) {
        console.error(`already on npm: ${name}@${version}`);
      }
      throw new Error(
        `${collisions.length} planned version(s) already exist on npm; ` +
          "changeset publish would skip them silently. Register the published " +
          "versions on main first (see RELEASING.md).",
      );
    }
    return;
  }

  if (command === "pack-smoke") {
    const only = rest.filter((arg) => !arg.startsWith("--"));
    const { checked, failures } = runPackSmoke({
      only: only.length > 0 ? only : undefined,
    });
    for (const id of checked) console.log(`packed: ${id}`);
    if (failures.length > 0) {
      for (const failure of failures) console.error(`  - ${failure}`);
      throw new Error(`pack smoke failed (${failures.length} problem(s))`);
    }
    return;
  }

  if (command === "assert-repository") {
    const failures = checkAllRepositories();
    if (failures.length > 0) {
      for (const failure of failures) console.error(`  - ${failure}`);
      throw new Error(
        `${failures.length} package(s) would fail npm provenance verification`,
      );
    }
    console.log(`repository metadata matches ${RELEASE_REPOSITORY_URL}`);
    return;
  }

  if (command === "assert-republishable") {
    const [target] = rest;
    if (!target) throw new Error("assert-republishable needs a package name");
    const { failures, dependents } = await checkRepublishTarget(
      target,
      listGenericPackages(),
    );
    for (const { name, version, range } of dependents) {
      console.log(
        `published dependent: ${name}@${version} -> ${target}@${range}`,
      );
    }
    if (failures.length > 0) {
      for (const failure of failures) console.error(`  - ${failure}`);
      throw new Error(`${target} cannot be republished alone`);
    }
    return;
  }

  // Prints one JSON line (name, version, tarball, sha256) on stdout.
  if (command === "pack-republish") {
    const [target, destination] = rest;
    if (!target || !destination) {
      throw new Error("pack-republish needs a package name and an output dir");
    }
    fs.mkdirSync(destination, { recursive: true });
    const { checked, failures, tarballs } = runPackSmoke({
      only: [target],
      destination: path.resolve(destination),
    });
    if (failures.length > 0 || tarballs.length !== 1) {
      for (const failure of failures) console.error(`  - ${failure}`);
      throw new Error(`${target}: packed tarball failed its checks`);
    }
    const [id] = checked;
    const at = id.lastIndexOf("@");
    console.log(
      JSON.stringify({
        name: id.slice(0, at),
        version: id.slice(at + 1),
        tarball: tarballs[0],
        sha256: createHash("sha256")
          .update(fs.readFileSync(tarballs[0]))
          .digest("hex"),
      }),
    );
    return;
  }

  throw new Error(
    "usage: release-guard.mjs assert-unpublished (--changeset-status <file> | --since-ref <ref>) | pack-smoke [name...] | assert-repository | assert-republishable <name> | pack-republish <name> <out-dir>",
  );
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`release-guard: ${error.message}`);
    process.exitCode = 1;
  });
}
