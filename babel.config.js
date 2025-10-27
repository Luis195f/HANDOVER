// babel.config.js
module.exports = function (api) {
  api.cache(true);

  const plugins = [
    [
      'module-resolver',
      {
        root: ['./'],
        alias: {
          'expo-audio': './src/lib/expo-audio-shim',
          '@/src': './src',
        },
        extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
      },
    ],
  ];

  // Debe ir el ÚLTIMO y solo si existe: evita crashear si aún no está instalado
  try {
    require.resolve('react-native-reanimated/plugin');
    plugins.push('react-native-reanimated/plugin');
  } catch {}

  return { presets: ['babel-preset-expo'], plugins };
};

