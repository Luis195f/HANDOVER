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
          alias: { '@': './src' },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      ],
      // Para NativeWind v3/v4
      'nativewind/babel',
      // SIEMPRE al final
      'react-native-reanimated/plugin',
    ],
  };
};


