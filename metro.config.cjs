/** metro.config.cjs — Expo 54 + pnpm (symlinks/exports) */
const { getDefaultConfig } = require('expo/metro-config');

module.exports = (() => {
  const config = getDefaultConfig(__dirname);
  config.resolver.unstable_enableSymlinks = true;
  config.resolver.unstable_enablePackageExports = true;
  return config;
})();
