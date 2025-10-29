const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Soporte monorepo / pnpm
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

// Shim opcional para expo-audio (si lo usamos)
const expoAudioShim = path.resolve(projectRoot, 'src/shims/expo-audio');
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  'expo-audio': expoAudioShim,
};

module.exports = config;
