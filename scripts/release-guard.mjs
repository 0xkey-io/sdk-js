#!/usr/bin/env node
// Release guards for the generic Changesets release (version-and-publish.yml).
//
//   node scripts/release-guard.mjs assert-unpublished --changeset-status <file>
//   node scripts/release-guard.mjs assert-unpublished --since-ref <git-ref>
//   node scripts/release-guard.mjs pack-smoke
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

import { execFileSync } from "node:child_process";
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

/** @returns {{ checked: string[], failures: string[] }} */
export function runPackSmoke({ repoRoot = REPO_ROOT, only } = {}) {
  const packages = listGenericPackages(repoRoot);
  const workspaceVersions = new Map(packages.map((p) => [p.name, p.version]));
  const selected = only
    ? packages.filter((p) => only.includes(p.name))
    : packages;
  const tarballs = fs.mkdtempSync(
    path.join(os.tmpdir(), "0xkey-release-pack-"),
  );
  const failures = [];
  const checked = [];
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
      } catch (error) {
        failures.push(`${source.name}: ${error.message}`);
      } finally {
        fs.rmSync(extractRoot, { recursive: true, force: true });
      }
    }
  } finally {
    fs.rmSync(tarballs, { recursive: true, force: true });
  }
  return { checked, failures };
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

  throw new Error(
    "usage: release-guard.mjs assert-unpublished (--changeset-status <file> | --since-ref <ref>) | pack-smoke [name...]",
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
