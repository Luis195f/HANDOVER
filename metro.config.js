// metro.config.js
const { getDefaultConfig } = require("@expo/metro-config");

const config = getDefaultConfig(__dirname);

// Habilita CSS Interop (NativeWind v4)
config.transformer.babelTransformerPath = require.resolve(
  "react-native-css-interop/metro"
);

// Asegura soporte de .cjs (usado por algunas libs como Reanimated)
if (!config.resolver.sourceExts.includes("cjs")) {
  config.resolver.sourceExts.push("cjs");
}

module.exports = config;

