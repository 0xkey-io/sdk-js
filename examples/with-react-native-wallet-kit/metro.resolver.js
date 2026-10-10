const fs = require("node:fs");
const path = require("node:path");

const SDK_SCOPE = "@0xkey-io/";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function workspacePackages(sdkRoot) {
  const packagesDir = path.join(sdkRoot, "packages");
  const byName = new Map();
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(packagesDir, entry.name);
    const manifestPath = path.join(dir, "package.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    if (typeof manifest.name === "string") {
      byName.set(manifest.name, { dir, manifest });
    }
  }
  return byName;
}

function splitPackageName(moduleName) {
  const parts = moduleName.split("/");
  const nameLength = moduleName.startsWith("@") ? 2 : 1;
  return {
    name: parts.slice(0, nameLength).join("/"),
    subpath: parts.slice(nameLength).join("/"),
  };
}

function firstFile(candidates) {
  return candidates.find(
    (file) => fs.existsSync(file) && fs.statSync(file).isFile(),
  );
}

/**
 * Resolves `@0xkey-io/*` imports to the local monorepo build and forces the
 * app's copy of React, React Native, and native modules so SDK packages never
 * load a second instance from their own pnpm `node_modules`.
 */
function createSdkResolveRequest({ exampleRoot, sdkRoot }) {
  const packages = workspacePackages(sdkRoot);
  const appManifest = readJson(path.join(exampleRoot, "package.json"));
  const singletons = Object.keys(appManifest.dependencies || {}).filter(
    (name) => !name.startsWith(SDK_SCOPE),
  );
  const appOrigin = path.join(exampleRoot, "package.json");
  const insideApp = (file) =>
    !path.relative(exampleRoot, file).startsWith("..");

  return function resolveRequest(context, moduleName, platform) {
    const { name, subpath } = splitPackageName(moduleName);
    const local = packages.get(name);
    if (local) {
      const target = subpath
        ? path.join(local.dir, subpath)
        : path.join(
            local.dir,
            typeof local.manifest["react-native"] === "string"
              ? local.manifest["react-native"]
              : local.manifest.main || "index.js",
          );
      const filePath = firstFile([
        target,
        `${target}.js`,
        `${target}.mjs`,
        path.join(target, "index.js"),
      ]);
      if (!filePath) {
        throw new Error(
          `Cannot resolve ${moduleName} from the local SDK. Build it first: ` +
            `pnpm --filter "@0xkey-io/react-native-wallet-kit..." build`,
        );
      }
      return { type: "sourceFile", filePath };
    }

    if (
      singletons.includes(name) &&
      context.originModulePath &&
      !insideApp(context.originModulePath)
    ) {
      return context.resolveRequest(
        { ...context, originModulePath: appOrigin },
        moduleName,
        platform,
      );
    }

    return context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = { createSdkResolveRequest };
