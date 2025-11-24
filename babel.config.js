module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      ["module-resolver", {
        root: ["./"],
        alias: {
          "@": "./",
          "react-native-exception-handler": "./src/shims/react-native-exception-handler",
        },
      }],
      "react-native-reanimated/plugin",
    ],
  };
};

