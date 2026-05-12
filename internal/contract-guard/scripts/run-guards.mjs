import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUARD_DIR = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(GUARD_DIR, "fixtures/consumer-typechecks");

const scripts = [
  "audit-package-surfaces.mjs",
  "audit-runtime-exports.mjs",
  "audit-declarations.mjs",
  "check-internal-leaks.mjs",
];

/** @param {string} scriptName */
function runScript(scriptName) {
  const scriptPath = path.join(GUARD_DIR, "scripts", scriptName);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: GUARD_DIR,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runConsumerTypechecks() {
  const tsconfigPath = path.join(FIXTURES_DIR, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    console.warn("Skipping consumer typechecks: fixtures not found.");
    return;
  }

  const encodingTypes = path.join(
    GUARD_DIR,
    "../../packages/encoding/dist/index.d.ts",
  );
  if (!fs.existsSync(encodingTypes)) {
    console.warn(
      "Skipping consumer typechecks: pilot package dist artifacts not found. Run pnpm run build-all first.",
    );
    return;
  }

  const tscPath = path.join(GUARD_DIR, "../../node_modules/typescript/bin/tsc");
  const result = spawnSync(
    process.execPath,
    [tscPath, "-p", tsconfigPath, "--noEmit"],
    {
      cwd: FIXTURES_DIR,
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  console.log("Consumer typecheck fixtures passed.");
}

for (const script of scripts) {
  runScript(script);
}

runConsumerTypechecks();
console.log("All contract guards passed.");
