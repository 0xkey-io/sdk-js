import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = new URL("../../", import.meta.url);
const baseline = JSON.parse(
  await readFile(new URL("../prettier-debt-baseline.json", import.meta.url)),
);
if (
  baseline.schemaVersion !== "sdk-js.prettier-debt/v1" ||
  !Array.isArray(baseline.files)
) {
  throw new Error("Invalid Prettier debt baseline");
}

const { stdout: trackedBytes } = await execute(
  "git",
  ["-c", "core.fsmonitor=false", "ls-files", "-z"],
  { cwd: root, encoding: "buffer", maxBuffer: 4 * 1024 * 1024 },
);
const tracked = trackedBytes
  .toString("utf8")
  .split("\0")
  .filter((path) =>
    /\.(?:css|html|js|json|md|ts|tsx|yaml|yml|mjs)$/.test(path),
  );

let prettierOutput = "";
try {
  await execute(
    new URL("../../node_modules/.bin/prettier", import.meta.url).pathname,
    ["--list-different", "--ignore-path", "./.prettierignore", ...tracked],
    { cwd: root, maxBuffer: 4 * 1024 * 1024 },
  );
} catch (error) {
  if (error.code !== 1) throw error;
  prettierOutput = error.stdout;
}

const different = prettierOutput
  .split("\n")
  .map((path) => path.trim())
  .filter(Boolean)
  .sort();
const actual = await Promise.all(
  different.map(async (path) => ({
    path,
    sha256: createHash("sha256")
      .update(await readFile(new URL(`../../${path}`, import.meta.url)))
      .digest("hex"),
  })),
);

const expected = [...baseline.files].sort((left, right) =>
  left.path.localeCompare(right.path),
);
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  const expectedPaths = new Set(expected.map(({ path }) => path));
  const actualPaths = new Set(actual.map(({ path }) => path));
  const added = actual.filter(({ path }) => !expectedPaths.has(path));
  const removed = expected.filter(({ path }) => !actualPaths.has(path));
  const changed = actual.filter(({ path, sha256 }) => {
    const prior = expected.find((entry) => entry.path === path);
    return prior && prior.sha256 !== sha256;
  });
  console.error(
    JSON.stringify({
      error: "PRETTIER_DEBT_DRIFT",
      added: added.map(({ path }) => path),
      removed: removed.map(({ path }) => path),
      changed: changed.map(({ path }) => path),
    }),
  );
  process.exit(1);
}

console.log(
  `Prettier passed with ${actual.length} exact byte-pinned debt files`,
);
