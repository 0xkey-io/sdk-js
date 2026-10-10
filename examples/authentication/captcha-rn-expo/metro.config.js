const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const sdkRoot = path.resolve(__dirname, "../../..");
config.watchFolders = [...(config.watchFolders || []), sdkRoot];
config.resolver.nodeModulesPaths = [
  path.join(__dirname, "node_modules"),
  path.join(sdkRoot, "node_modules"),
];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  "@0xkey-io/core": path.join(sdkRoot, "packages/core"),
};
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@walletconnect/sign-client") {
    return {
      type: "sourceFile",
      filePath: path.join(__dirname, "wallet-connect-disabled.js"),
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
