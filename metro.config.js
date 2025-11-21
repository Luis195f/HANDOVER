// metro.config.js
// Configuración mínima compatible con Expo + Node (usada por Reanimated en el build)
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
