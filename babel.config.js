// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      ['module-resolver', {
        root: ['./'],
        alias: { '@': './src', '@src': './src' },
        extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
      }],
      'react-native-reanimated/plugin', // siempre al final
    ],
  };
};
