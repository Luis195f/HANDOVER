/** Expo + RN 0.81 + Reanimated + NativeWind + alias "@/src" */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module-resolver', {
        root: ['./'],
        alias: {
          '@/src': './src',
          '@': './'              // opcional, por si usaste "@/*"
        },
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json']
      }],
      'nativewind/babel',
      'react-native-reanimated/plugin'
    ],
  };
};
