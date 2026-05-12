import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  BASELINES_DIR,
  listPublicPackages,
  readJson,
  writeJson,
} from "./lib/paths.mjs";

const require = createRequire(import.meta.url);

const BASELINE_DIR = path.join(BASELINES_DIR, "runtime-exports");
const UPDATE = process.argv.includes("--update");

/**
 * @param {string} name
 * @param {unknown} value
 */
function describeExport(name, value) {
  if (value === null) {
    return { name, kind: "null" };
  }

  if (typeof value === "function") {
    return {
      name,
      kind: value.prototype?.constructor === value ? "class" : "function",
      arity: value.length,
    };
  }

  if (typeof value === "object") {
    if (Array.prototype.toString.call(value) === "[object Object]") {
      return { name, kind: "object" };
    }
    return { name, kind: "object", tag: Object.prototype.toString.call(value) };
  }

  return { name, kind: typeof value };
}

/** @param {import("./lib/paths.mjs").PkgMeta} pkgMeta */
function loadRuntimeExports(pkgMeta) {
  const distDir = path.join(pkgMeta.dirPath, "dist");
  const cjsEntry = path.join(distDir, "index.js");
  if (!fs.existsSync(cjsEntry)) {
    return { skipped: true, reason: "missing dist/index.js" };
  }

  try {
    const mod = require(cjsEntry);
    const names = Object.keys(mod).sort();
    return {
      skipped: false,
      exports: names.map((name) => describeExport(name, mod[name])),
    };
  } catch (error) {
    return {
      skipped: true,
      reason: `unable to require dist/index.js: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function main() {
  const packages = listPublicPackages();
  const failures = [];

  for (const pkgMeta of packages) {
    const baselinePath = path.join(BASELINE_DIR, `${pkgMeta.dirName}.json`);
    const current = {
      name: pkgMeta.pkg.name,
      ...loadRuntimeExports(pkgMeta),
    };

    if (current.skipped) {
      console.warn(
        `Skipping runtime export audit for ${pkgMeta.pkg.name}: ${current.reason}`,
      );
      continue;
    }

    if (UPDATE || !fs.existsSync(baselinePath)) {
      writeJson(baselinePath, current);
      console.log(`Updated runtime export baseline: ${pkgMeta.pkg.name}`);
      continue;
    }

    const baseline = readJson(baselinePath);
    const baselineJson = JSON.stringify(baseline.exports);
    const currentJson = JSON.stringify(current.exports);
    if (baselineJson !== currentJson) {
      failures.push(pkgMeta.pkg.name);
      console.error(`Runtime export mismatch: ${pkgMeta.pkg.name}`);
    }
  }

  if (failures.length > 0) {
    console.error(
      `Runtime export audit failed for ${failures.length} package(s).`,
    );
    process.exit(1);
  }

  console.log("Runtime export audit passed.");
}

main();
