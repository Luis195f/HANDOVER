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
      // Necesario para NativeWind v3/v4
      'nativewind/babel',
      // SIEMPRE el último
      'react-native-reanimated/plugin',
    ],
  };
};


