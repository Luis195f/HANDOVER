module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxRuntime: 'automatic', development: false }]],
    plugins: [
      // Actívalo luego si lo necesitas:
      // 'react-native-reanimated/plugin',
    ],
  };
};
