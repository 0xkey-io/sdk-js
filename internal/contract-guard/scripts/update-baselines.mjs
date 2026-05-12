import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const GUARD_DIR = path.join(REPO_ROOT, "internal/contract-guard");

const scripts = [
  "audit-package-surfaces.mjs",
  "audit-runtime-exports.mjs",
  "audit-declarations.mjs",
];

for (const script of scripts) {
  const result = spawnSync(
    process.execPath,
    [path.join(GUARD_DIR, "scripts", script), "--update"],
    { cwd: GUARD_DIR, stdio: "inherit" },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("Contract guard baselines updated.");
