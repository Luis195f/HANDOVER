const expoPreset = require("babel-preset-expo");

module.exports = function (api, opts = {}) {
  // Usa el preset de Expo como base
  const cfg = expoPreset(api, { ...opts, jsxRuntime: "automatic" });

  // Plugins que provocan el 'Duplicate __self'
  const STRIP = new Set([
    "@babel/plugin-transform-react-jsx-self",
    "@babel/plugin-transform-react-jsx-source",
    "transform-react-jsx-self",
    "transform-react-jsx-source",
  ]);

  // 1) Quitar los plugins conflictivos del array plugins
  cfg.plugins = (cfg.plugins || []).filter((p) => {
    const name = Array.isArray(p) ? p[0] : p;
    if (typeof name === "string") {
      return ![...STRIP].some((s) => name.includes(s));
    }
    if (name && name.key && STRIP.has(name.key)) return false;
    if (name && name.name && STRIP.has(name.name)) return false;
    return true;
  });

  // 2) Forzar preset-react sin "development" para no usar jsxDEV
  cfg.presets = (cfg.presets || []).map((preset) => {
    if (Array.isArray(preset)) {
      const id = preset[0];
      if (typeof id === "string" && id.includes("@babel/preset-react")) {
        return [id, { ...(preset[1] || {}), development: false }];
      }
    }
    return preset;
  });

  return cfg;
};
