#!/usr/bin/env node
// Packs, verifies and publishes exactly the packages listed in
// .github/security-patch.json. Used only by security patch branches, whose
// release must not publish anything else from this (older) tree.
//
//   node scripts/security-patch-release.mjs pack <out-dir>
//   node scripts/security-patch-release.mjs publish <out-dir> [--dry-run]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, ".github", "security-patch.json"), "utf8"),
);
const FORBIDDEN_HOST = /0xkey\.com\b/i;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  }).trim();
}

function npmView(spec, field) {
  try {
    const output = run("npm", ["view", spec, field, "--json"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(output || "null");
  } catch {
    return null;
  }
}

function integrity(file) {
  const digest = createHash("sha512")
    .update(readFileSync(file))
    .digest("base64");
  return `sha512-${digest}`;
}

function workspacePackages() {
  const byName = new Map();
  for (const entry of readdirSync(join(ROOT, "packages"), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const dir = join(ROOT, "packages", entry.name);
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      byName.set(pkg.name, { dir, pkg });
    } catch {
      // not a package directory
    }
  }
  return byName;
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function verifyTarball(file, expected, releaseSet) {
  const unpacked = mkdtempSync(join(tmpdir(), "security-patch-"));
  run("tar", ["-xzf", file, "-C", unpacked]);
  const root = join(unpacked, "package");
  const offenders = filesUnder(root).filter((path) =>
    FORBIDDEN_HOST.test(readFileSync(path, "latin1")),
  );
  if (offenders.length > 0) {
    fail(
      `${expected.name}: packed files still reference 0xkey.com: ${offenders
        .map((path) => path.slice(root.length + 1))
        .join(", ")}`,
    );
  }
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (pkg.name !== expected.name || pkg.version !== expected.version) {
    fail(
      `${file}: packed ${pkg.name}@${pkg.version}, expected ${expected.name}@${expected.version}`,
    );
  }
  for (const [dep, range] of Object.entries(pkg.dependencies ?? {})) {
    if (!dep.startsWith("@0xkey-io/")) continue;
    if (range.startsWith("workspace:")) {
      fail(`${expected.name}: unresolved dependency ${dep}@${range}`);
    }
    const pinned = MANIFEST.dependencyPins?.[dep];
    if (pinned && pinned !== range) {
      fail(`${expected.name}: depends on ${dep}@${range}, expected ${pinned}`);
    }
    if (
      !releaseSet.has(`${dep}@${range}`) &&
      !npmView(`${dep}@${range}`, "version")
    ) {
      fail(
        `${expected.name}: depends on ${dep}@${range}, which is neither in this release nor on npm`,
      );
    }
  }
}

function pack(outDir) {
  mkdirSync(outDir, { recursive: true });
  const packages = workspacePackages();
  const releaseSet = new Set(
    MANIFEST.publish.map((p) => `${p.name}@${p.version}`),
  );
  const lock = [];
  for (const expected of MANIFEST.publish) {
    const found = packages.get(expected.name);
    if (!found) fail(`${expected.name} is not a workspace package`);
    if (found.pkg.private) fail(`${expected.name} is private`);
    if (found.pkg.version !== expected.version) {
      fail(
        `${expected.name} is at ${found.pkg.version}, expected ${expected.version}`,
      );
    }
    const output = run(
      "pnpm",
      ["pack", "--pack-destination", resolve(outDir)],
      {
        cwd: found.dir,
      },
    );
    const file = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".tgz"))
      .pop();
    if (!file) fail(`pnpm pack did not report a tarball for ${expected.name}`);
    verifyTarball(file, expected, releaseSet);
    lock.push({
      ...expected,
      file: file.slice(resolve(outDir).length + 1),
      integrity: integrity(file),
    });
    console.log(
      `packed ${expected.name}@${expected.version} ${lock.at(-1).integrity}`,
    );
  }
  writeFileSync(
    join(outDir, "release-lock.json"),
    `${JSON.stringify(lock, null, 2)}\n`,
  );
}

function publish(outDir, dryRun) {
  const lock = JSON.parse(
    readFileSync(join(outDir, "release-lock.json"), "utf8"),
  );
  const expected = MANIFEST.publish.map((p) => `${p.name}@${p.version}`).sort();
  const locked = lock.map((p) => `${p.name}@${p.version}`).sort();
  if (JSON.stringify(expected) !== JSON.stringify(locked)) {
    fail(
      `release lock ${locked.join(", ")} does not match manifest ${expected.join(", ")}`,
    );
  }
  for (const required of MANIFEST.requirePublished ?? []) {
    if (!npmView(`${required.name}@${required.version}`, "version")) {
      fail(
        `${required.name}@${required.version} must be published (by ${required.from}) before this release`,
      );
    }
  }
  for (const entry of lock) {
    const file = resolve(outDir, entry.file);
    if (integrity(file) !== entry.integrity)
      fail(`${entry.file} changed after packing`);
    const existing = npmView(
      `${entry.name}@${entry.version}`,
      "dist.integrity",
    );
    if (existing) {
      if (existing !== entry.integrity) {
        fail(
          `${entry.name}@${entry.version} is already on npm with different contents`,
        );
      }
      console.log(`skip ${entry.name}@${entry.version}: already published`);
      continue;
    }
    const latest = npmView(entry.name, "dist-tags.latest");
    const tag =
      !latest || compareVersions(entry.version, latest) > 0
        ? "latest"
        : `legacy-${entry.version.split(".").slice(0, 2).join(".")}`;
    const args = ["publish", file, "--tag", tag, "--access", "public"];
    if (dryRun) args.push("--dry-run");
    console.log(`npm ${args.join(" ")}`);
    execFileSync("npm", args, { stdio: "inherit" });
  }
}

const [mode, outDir, flag] = process.argv.slice(2);
if (mode === "pack" && outDir) pack(outDir);
else if (mode === "publish" && outDir) publish(outDir, flag === "--dry-run");
else
  fail("usage: security-patch-release.mjs pack|publish <out-dir> [--dry-run]");
