// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");

let config = getDefaultConfig(__dirname);

// Asegura el transformer de Metro correcto (evita “transformer.transform is not a function”)
config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve("metro-react-native-babel-transformer"),
};
// metro.config.js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

module.exports = (async () => {
  const defaultConfig = await getDefaultConfig(__dirname);

  // Config mínima compatible con Expo SDK 54 / RN 0.81
  return mergeConfig(defaultConfig, {
    transformer: {
      // Evita errores con require.context en dependencias
      unstable_allowRequireContext: true,
    },
    // Nada de babelTransformerPath personalizado (quitamos css-interop aquí)
  });
})();

