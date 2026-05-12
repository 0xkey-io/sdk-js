import fs from "node:fs";
import path from "node:path";
import { listPublicPackages } from "./lib/paths.mjs";

const INTERNAL_IMPORT_PATTERN = /@0xkey-io\/internal-/g;

/**
 * @param {string} filePath
 * @param {{ filePath: string; line: number; text: string }[]} hits
 */
function scanFile(filePath, hits) {
  if (!/\.(js|mjs|d\.ts|d\.mts)$/.test(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  if (!INTERNAL_IMPORT_PATTERN.test(content)) {
    return;
  }

  INTERNAL_IMPORT_PATTERN.lastIndex = 0;
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    if (line.includes("@0xkey-io/internal-")) {
      hits.push({ filePath, line: index + 1, text: line.trim() });
    }
  });
}

/**
 * @param {string} dirPath
 * @param {{ filePath: string; line: number; text: string }[]} hits
 */
function walkDist(dirPath, hits) {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkDist(fullPath, hits);
      continue;
    }

    if (entry.name.endsWith(".map")) {
      continue;
    }

    scanFile(fullPath, hits);
  }
}

function main() {
  const packages = listPublicPackages();
  /** @type {{ filePath: string; line: number; text: string }[]} */
  const hits = [];

  for (const pkgMeta of packages) {
    walkDist(path.join(pkgMeta.dirPath, "dist"), hits);
  }

  if (hits.length > 0) {
    console.error("Internal package references found in publish artifacts:");
    for (const hit of hits) {
      console.error(`  ${hit.filePath}:${hit.line} ${hit.text}`);
    }
    process.exit(1);
  }

  console.log("Internal leak audit passed.");
}

main();
