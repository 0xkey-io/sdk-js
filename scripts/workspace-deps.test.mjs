// Contract for how workspace packages declare each other.
// Run with: node --test scripts/workspace-deps.test.mjs
//
// turbo (`turbo run build --filter=...`) orders tasks by `dependencies`,
// `devDependencies` and `optionalDependencies`, not by `peerDependencies`. A
// package that only lists a workspace package as a peer, or imports one it does
// not declare, is therefore built without that package's `dist/` when a
// workflow builds a filtered subgraph (Commerce verifier, pay-v1,
// Commerce contract), and its type check fails. A workspace peer must also be
// a devDependency (the usual peer + dev pattern).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SOURCE_FILE = /\.(c|m)?[jt]sx?$/;
const TEST_FILE = /(\.test\.|-test\.|\.red\.)|(^|\/)(__tests__|__fixtures__)\//;
const IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\btypeof\s+import\s*\(\s*)["'](@0xkey-io\/[a-z0-9-]+)/g;

/** Names that make a package a build-order dependency for turbo and pnpm. */
export function buildDependencies(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
}

/**
 * @param {{ manifest: object, imports: Iterable<string> }[]} packages
 * @returns {string[]} one message per violation
 */
export function checkWorkspaceDeclarations(packages) {
  const workspaceNames = new Set(packages.map(({ manifest }) => manifest.name));
  const problems = [];
  for (const { manifest, imports } of packages) {
    const declared = buildDependencies(manifest);
    for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
      if (workspaceNames.has(peer) && !declared.has(peer)) {
        problems.push(
          `${manifest.name}: workspace peer ${peer} must also be in devDependencies so that filtered builds build it first`,
        );
      }
    }
    for (const name of new Set(imports)) {
      if (
        name !== manifest.name &&
        workspaceNames.has(name) &&
        !declared.has(name)
      ) {
        problems.push(
          `${manifest.name}: imports ${name} but does not list it in dependencies, devDependencies or optionalDependencies`,
        );
      }
    }
  }
  return problems;
}

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") {
        sourceFiles(full, out);
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function readWorkspacePackages() {
  const packages = [];
  for (const group of ["packages", "internal"]) {
    const groupDir = path.join(REPO_ROOT, group);
    if (!fs.existsSync(groupDir)) continue;
    for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
      const manifestPath = path.join(groupDir, entry.name, "package.json");
      if (!entry.isDirectory() || !fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const srcDir = path.join(groupDir, entry.name, "src");
      const imports = new Set();
      if (fs.existsSync(srcDir)) {
        for (const file of sourceFiles(srcDir)) {
          const relative = path
            .relative(srcDir, file)
            .split(path.sep)
            .join("/");
          if (TEST_FILE.test(relative)) continue;
          const text = fs.readFileSync(file, "utf8");
          for (const match of text.matchAll(IMPORT)) imports.add(match[1]);
        }
      }
      packages.push({ manifest, imports });
    }
  }
  return packages;
}

test("a workspace peer dependency must also be a build dependency", () => {
  const problems = checkWorkspaceDeclarations([
    {
      manifest: { name: "@0xkey-io/a", version: "1.0.0" },
      imports: [],
    },
    {
      manifest: {
        name: "@0xkey-io/b",
        peerDependencies: { "@0xkey-io/a": "workspace:*", react: "^18" },
      },
      imports: [],
    },
    {
      manifest: {
        name: "@0xkey-io/c",
        peerDependencies: { "@0xkey-io/a": "workspace:*" },
        devDependencies: { "@0xkey-io/a": "workspace:*" },
      },
      imports: [],
    },
  ]);
  assert.deepEqual(problems, [
    "@0xkey-io/b: workspace peer @0xkey-io/a must also be in devDependencies so that filtered builds build it first",
  ]);
});

test("a workspace package that is imported must be declared", () => {
  const problems = checkWorkspaceDeclarations([
    { manifest: { name: "@0xkey-io/a" }, imports: [] },
    {
      manifest: { name: "@0xkey-io/b", dependencies: { "@0xkey-io/a": "*" } },
      imports: ["@0xkey-io/a", "@0xkey-io/b", "@types/node"],
    },
    { manifest: { name: "@0xkey-io/c" }, imports: ["@0xkey-io/a"] },
  ]);
  assert.deepEqual(problems, [
    "@0xkey-io/c: imports @0xkey-io/a but does not list it in dependencies, devDependencies or optionalDependencies",
  ]);
});

test("every workspace package declares the workspace packages it uses", () => {
  const packages = readWorkspacePackages();
  assert.ok(packages.length > 10, "workspace packages were not found");
  assert.deepEqual(checkWorkspaceDeclarations(packages), []);
});
