const babel = require("@babel/core");
const cfg = babel.loadPartialConfig({ filename: "index.ts" });
console.log("=== BABEL CONFIG FILE ===");
console.log(cfg && cfg.options && cfg.options.configFile || "(sin config detectado)");
console.log("=== PLUGINS ===");
console.log((cfg && cfg.options && cfg.options.plugins || []).map(p => (p && p.key) || (p && p.file && p.file.request) || typeof p === "string" ? p : typeof p));
