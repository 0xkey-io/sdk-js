import fs from "node:fs";
import path from "node:path";
import {
  BASELINES_DIR,
  listPublicPackages,
  readJson,
  stableSortObject,
  writeJson,
} from "./lib/paths.mjs";

const BASELINE_PATH = path.join(BASELINES_DIR, "package-surfaces.json");
const UPDATE = process.argv.includes("--update");

/** @param {import("./lib/paths.mjs").PkgMeta} pkgMeta */
function extractSurface(pkgMeta) {
  const { pkg, dirName } = pkgMeta;
  return stableSortObject({
    name: pkg.name,
    dirName,
    main: pkg.main ?? null,
    module: pkg.module ?? null,
    types: pkg.types ?? null,
    exports: pkg.exports ?? null,
    files: pkg.files ?? null,
    sideEffects: pkg.sideEffects ?? false,
  });
}

/**
 * @param {unknown} baseline
 * @param {unknown} current
 */
function diffSurfaces(baseline, current) {
  const baselineJson = JSON.stringify(baseline, null, 2);
  const currentJson = JSON.stringify(current, null, 2);
  if (baselineJson === currentJson) {
    return null;
  }
  return { baseline, current };
}

function main() {
  const packages = listPublicPackages();
  const current = packages.map(extractSurface);

  if (UPDATE || !fs.existsSync(BASELINE_PATH)) {
    writeJson(BASELINE_PATH, current);
    console.log(`Updated package surface baseline: ${BASELINE_PATH}`);
    return;
  }

  const baseline = readJson(BASELINE_PATH);
  const diff = diffSurfaces(baseline, current);
  if (diff) {
    console.error("Package surface baseline mismatch.");
    console.error(`Expected baseline at ${BASELINE_PATH}`);
    process.exit(1);
  }

  console.log(`Package surface audit passed (${current.length} packages).`);
}

main();
