// metro.config.js — versión limpia para Expo SDK 54

const { getDefaultConfig } = require('@expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('cjs');

module.exports = config;

