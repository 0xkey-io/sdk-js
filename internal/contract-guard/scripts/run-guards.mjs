import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTypeScriptFloorCompiler } from "./lib/typescript-floor.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUARD_DIR = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(GUARD_DIR, "fixtures/consumer-typechecks");

const scripts = [
  "audit-activity-contracts.mjs",
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

/**
 * `tsconfig.bundler.json` is the supported consumer floor (TypeScript 5.4 +
 * Bundler) and covers Core and React Wallet Kit. `tsconfig.json` (NodeNext)
 * is kept only for the pilot fixtures that already pass it.
 */
const CONSUMER_TYPECHECK_CONFIGS = ["tsconfig.bundler.json", "tsconfig.json"];

function runConsumerTypechecks() {
  const tsconfigPaths = CONSUMER_TYPECHECK_CONFIGS.map((name) =>
    path.join(FIXTURES_DIR, name),
  );
  if (!tsconfigPaths.every((tsconfigPath) => fs.existsSync(tsconfigPath))) {
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
  try {
    assertTypeScriptFloorCompiler(process.execPath, [tscPath]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  for (const tsconfigPath of tsconfigPaths) {
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
    console.log(
      `Consumer typecheck fixtures passed: ${path.basename(tsconfigPath)}`,
    );
  }
}

for (const script of scripts) {
  runScript(script);
}

runConsumerTypechecks();
console.log("All contract guards passed.");
