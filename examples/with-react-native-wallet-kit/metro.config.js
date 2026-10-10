const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { createSdkResolveRequest } = require("./metro.resolver");

const exampleRoot = __dirname;
const sdkRoot = path.resolve(exampleRoot, "../..");

const config = getDefaultConfig(exampleRoot);
config.watchFolders = [...(config.watchFolders || []), sdkRoot];
config.resolver.nodeModulesPaths = [
  path.join(exampleRoot, "node_modules"),
  path.join(sdkRoot, "node_modules"),
];
config.resolver.resolveRequest = createSdkResolveRequest({
  exampleRoot,
  sdkRoot,
});

module.exports = config;
