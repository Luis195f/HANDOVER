// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");

let config = getDefaultConfig(__dirname);

// Asegura el transformer de Metro correcto (evita “transformer.transform is not a function”)
config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve("metro-react-native-babel-transformer"),
};

// Suele ser útil permitir .cjs en dependencias
config.resolver = {
  ...config.resolver,
  sourceExts: Array.from(new Set([...(config.resolver?.sourceExts ?? []), "cjs"])),
};

// Integra NativeWind en Metro si está instalado (vale para v3 y v4)
try {
  const { withNativeWind } = require("nativewind/metro");
  const fs = require("fs");
  const path = require("path");
  // Usa un css si existe (opcional). No rompe si no está.
  const cssCandidates = ["./global.css", "./src/styles/global.css"];
  const cssInput =
    cssCandidates.map((p) => path.resolve(__dirname, p)).find((p) => fs.existsSync(p));

  config = withNativeWind(config, cssInput ? { input: path.relative(__dirname, cssInput) } : {});
} catch {
  // NativeWind no instalado: seguimos con config por defecto.
}

module.exports = config;

