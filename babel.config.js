// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: { '@': './src', '@src': './src' },
          extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
        },
      ],
      'nativewind/babel',
      'react-native-reanimated/plugin',
    ],
  };
};
