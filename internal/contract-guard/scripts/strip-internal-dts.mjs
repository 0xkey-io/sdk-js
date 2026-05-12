import fs from "node:fs";
import path from "node:path";

/** @param {string} distDir */
export function stripInternalReferencesFromDeclarations(distDir) {
  if (!fs.existsSync(distDir)) {
    return;
  }

  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    const fullPath = path.join(distDir, entry.name);
    if (entry.isDirectory()) {
      stripInternalReferencesFromDeclarations(fullPath);
      continue;
    }

    if (!entry.name.endsWith(".d.ts")) {
      continue;
    }

    const original = fs.readFileSync(fullPath, "utf8");
    const cleaned = original
      .split("\n")
      .filter((line) => !line.includes("@0xkey-io/internal-"))
      .join("\n");

    if (cleaned !== original) {
      fs.writeFileSync(fullPath, cleaned, "utf8");
    }
  }
}
