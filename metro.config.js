const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  "expo-audio": path.resolve(__dirname, "src/lib/expo-audio-shim"),
};

module.exports = config;
module.exports = getDefaultConfig(__dirname);