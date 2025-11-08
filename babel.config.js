// babel.config.js
module.exports = function (api) {
  api.cache(true);

  const plugins = [
    [
      "module-resolver",
      {
        root: ["./"],
        alias: { "@": "./src" },
        extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
      },
    ],
  ];

  try {
  
    require.resolve("react-native-css-interop/babel");
    plugins.push("react-native-css-interop/babel");
  } catch {
    plugins.push("nativewind/babel");
  }

  plugins.push("react-native-reanimated/plugin");

  return {
    presets: ["babel-preset-expo"],
    plugins,
  };
};

