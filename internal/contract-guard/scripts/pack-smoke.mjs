import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listPublicPackages } from "./lib/paths.mjs";

const PILOT_PACKAGES = new Set([
  "@0xkey-io/encoding",
  "@0xkey-io/crypto",
  "@0xkey-io/api-key-stamper",
]);

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "0xkey-pack-smoke-"));
  const failures = [];

  for (const pkgMeta of listPublicPackages()) {
    if (!PILOT_PACKAGES.has(pkgMeta.pkg.name)) {
      continue;
    }

    const packResult = spawnSync(
      "pnpm",
      ["pack", "--pack-destination", tempRoot],
      {
        cwd: pkgMeta.dirPath,
        stdio: "pipe",
        encoding: "utf8",
      },
    );

    if (packResult.status !== 0) {
      failures.push(`${pkgMeta.pkg.name}: pack failed`);
      continue;
    }

    const tarball = fs
      .readdirSync(tempRoot)
      .filter((name) => name.endsWith(".tgz"))
      .sort()
      .at(-1);

    if (!tarball) {
      failures.push(`${pkgMeta.pkg.name}: missing tarball`);
      continue;
    }

    const extractDir = path.join(tempRoot, pkgMeta.dirName);
    fs.mkdirSync(extractDir, { recursive: true });
    const extractResult = spawnSync(
      "tar",
      ["-xzf", path.join(tempRoot, tarball), "-C", extractDir],
      {
        stdio: "inherit",
      },
    );
    if (extractResult.status !== 0) {
      failures.push(`${pkgMeta.pkg.name}: extract failed`);
      continue;
    }

    const packageRoot = path.join(extractDir, "package");
    const distIndex = path.join(packageRoot, "dist/index.js");
    if (!fs.existsSync(distIndex)) {
      failures.push(
        `${pkgMeta.pkg.name}: dist/index.js missing in packed artifact`,
      );
    }

    /** @param {string} dir */
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (/\.(js|mjs|d\.ts)$/.test(entry.name)) {
          const content = fs.readFileSync(fullPath, "utf8");
          if (content.includes("@0xkey-io/internal-")) {
            failures.push(
              `${pkgMeta.pkg.name}: internal reference in ${fullPath}`,
            );
          }
        }
      }
    };
    walk(packageRoot);
  }

  if (failures.length > 0) {
    console.error("Pack smoke test failures:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log("Pack smoke tests passed for pilot packages.");
}

main();
