import { spawnSync } from "node:child_process";

/**
 * Supported consumer floor: TypeScript >= 5.4 with `moduleResolution: "Bundler"`.
 * Consumer gates must run on the floor compiler itself so a root TypeScript
 * upgrade cannot silently stop exercising it.
 */
export const SUPPORTED_TYPESCRIPT_FLOOR = "5.4";

/**
 * @param {string} versionOutput
 */
export function assertTypeScriptFloorVersion(versionOutput) {
  const match = /Version (\d+)\.(\d+)\.\d+/.exec(versionOutput);
  if (!match || `${match[1]}.${match[2]}` !== SUPPORTED_TYPESCRIPT_FLOOR) {
    throw new Error(
      `Consumer typechecks must run on TypeScript ${SUPPORTED_TYPESCRIPT_FLOOR}.x, found ${versionOutput.trim() || "no version output"}`,
    );
  }
}

/**
 * @param {string} command
 * @param {string[]} [prefixArgs]
 */
export function assertTypeScriptFloorCompiler(command, prefixArgs = []) {
  const result = spawnSync(command, [...prefixArgs, "--version"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `TypeScript version check failed: ${[result.stdout, result.stderr].filter(Boolean).join("\n")}`,
    );
  }
  assertTypeScriptFloorVersion(result.stdout ?? "");
}
