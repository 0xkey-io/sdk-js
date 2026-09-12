const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const packages = ["core", "sdk-browser", "sdk-server", "sdk-types"];

for (const packageName of packages) {
  const input = path.join(
    root,
    "packages",
    packageName,
    "src",
    "__inputs__",
    "public_api.swagger.json",
  );
  const output = path.join(
    root,
    "packages",
    packageName,
    "src",
    "__inputs__",
    "public_api.types.ts",
  );
  const result = spawnSync(
    "npx",
    ["--yes", "openapi-typescript@5.4.2", input, "--output", output],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
