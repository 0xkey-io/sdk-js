"use strict";

// Local tool locations for the manual browser OAuth tests. Required values
// have no portable default and must be provided by the caller.
const path = require("node:path");

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Set ${name} to run this browser test (see browser-env.cjs).`,
    );
  }
  return value;
}

module.exports = {
  nodePath: () => process.env.BROWSER_TEST_NODE || process.execPath,
  playwrightCoreRoot: () =>
    process.env.PLAYWRIGHT_CORE_ROOT ||
    path.dirname(require.resolve("playwright-core/package.json")),
  esbuildBinary: () => required("ESBUILD_BINARY_PATH"),
  esbuildPackageJson: () =>
    process.env.ESBUILD_PACKAGE_JSON || require.resolve("esbuild/package.json"),
  chromiumExecutable: () => required("CHROMIUM_EXECUTABLE"),
  servicesGoDir: () => required("SERVICES_GO_DIR"),
  typescriptLib: () =>
    process.env.TYPESCRIPT_LIB || require.resolve("typescript"),
};
