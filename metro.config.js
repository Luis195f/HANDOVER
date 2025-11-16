const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// Aliases personalizados
config.resolver.alias = { "@": __dirname, "@src": __dirname + "/src" };
module.exports = config;

