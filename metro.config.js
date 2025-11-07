const { getDefaultConfig } = require("@expo/metro-config");

const config = getDefaultConfig(__dirname);
config.transformer.babelTransformerPath = require.resolve("react-native-css-interop/metro");

if (!config.resolver.sourceExts.includes("cjs")) {
  config.resolver.sourceExts.push("cjs");
}

module.exports = config;
