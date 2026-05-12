import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(__dirname, "../../../..");
export const PACKAGES_DIR = path.join(REPO_ROOT, "packages");
export const BASELINES_DIR = path.join(
  REPO_ROOT,
  "internal/contract-guard/baselines",
);

/**
 * @typedef {{ dirName: string; dirPath: string; packageJsonPath: string; pkg: Record<string, any> }} PkgMeta
 */

/** @returns {PkgMeta[]} */
export function listPublicPackages() {
  return fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const packageJsonPath = path.join(
        PACKAGES_DIR,
        entry.name,
        "package.json",
      );
      if (!fs.existsSync(packageJsonPath)) {
        return null;
      }
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      if (pkg.private) {
        return null;
      }
      return {
        dirName: entry.name,
        dirPath: path.join(PACKAGES_DIR, entry.name),
        packageJsonPath,
        pkg,
      };
    })
    .filter(/** @returns {v is PkgMeta} */ (v) => v !== null)
    .sort((a, b) => a.pkg.name.localeCompare(b.pkg.name));
}

/** @param {string} filePath */
export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * @param {string} filePath
 * @param {unknown} data
 */
export function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/** @param {unknown} value @returns {any} */
export function stableSortObject(value) {
  if (Array.isArray(value)) {
    return value.map(stableSortObject);
  }
  if (value && typeof value === "object") {
    /** @type {Record<string, any>} */
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = stableSortObject(
        /** @type {Record<string, any>} */ (value)[key],
      );
    }
    return sorted;
  }
  return value;
}
