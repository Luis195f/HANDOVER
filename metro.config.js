// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const config = getDefaultConfig(__dirname);
// Si no usas global.css, igual funciona; deja la línea siguiente tal cual:
module.exports = withNativeWind(config /*, { input: './global.css' }*/);
