import fs from "node:fs";
import path from "node:path";
import {
  BASELINES_DIR,
  listPublicPackages,
  readJson,
  writeJson,
} from "./lib/paths.mjs";

const BASELINE_DIR = path.join(BASELINES_DIR, "declarations");
const UPDATE = process.argv.includes("--update");

/** @param {string} filePath */
function summarizeDeclarationFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  /** @type {{ kind: string; name: string }[]} */
  const exports = [];
  const exportRegex =
    /^export (?:declare )?(class|interface|type|enum|function|const|var|let) ([A-Za-z0-9_$]+)/gm;
  const reExportRegex = /^export \{([^}]+)\}/gm;

  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push({
      kind: /** @type {string} */ (match[1]),
      name: /** @type {string} */ (match[2]),
    });
  }
  while ((match = reExportRegex.exec(content)) !== null) {
    const names = /** @type {string} */ (match[1])
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0])
      .filter(
        /** @returns {s is string} */ (s) =>
          typeof s === "string" && s.length > 0,
      );
    for (const name of names) {
      exports.push({ kind: "re-export", name });
    }
  }

  return exports.sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  const packages = listPublicPackages();
  const failures = [];

  for (const pkgMeta of packages) {
    const declarationPath = path.join(pkgMeta.dirPath, "dist/index.d.ts");
    const baselinePath = path.join(BASELINE_DIR, `${pkgMeta.dirName}.json`);

    if (!fs.existsSync(declarationPath)) {
      console.warn(
        `Skipping declaration audit for ${pkgMeta.pkg.name}: missing dist/index.d.ts`,
      );
      continue;
    }

    const current = {
      name: pkgMeta.pkg.name,
      exports: summarizeDeclarationFile(declarationPath),
    };

    if (UPDATE || !fs.existsSync(baselinePath)) {
      writeJson(baselinePath, current);
      console.log(`Updated declaration baseline: ${pkgMeta.pkg.name}`);
      continue;
    }

    const baseline = readJson(baselinePath);
    if (JSON.stringify(baseline.exports) !== JSON.stringify(current.exports)) {
      failures.push(pkgMeta.pkg.name);
      console.error(`Declaration surface mismatch: ${pkgMeta.pkg.name}`);
    }
  }

  if (failures.length > 0) {
    console.error(
      `Declaration audit failed for ${failures.length} package(s).`,
    );
    process.exit(1);
  }

  console.log("Declaration audit passed.");
}

main();
