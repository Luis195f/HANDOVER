// metro.config.js
const { getDefaultConfig } = require("@expo/metro-config");

const config = getDefaultConfig(__dirname);

// Opcional: alias seguros
config.resolver.alias = {
  "@": __dirname,
  "@src": __dirname + "/src",
};

module.exports = config;
