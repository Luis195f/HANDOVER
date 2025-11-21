// src/lib/zod-compat.ts
// Polyfill para versiones antiguas de Zod que no tienen .passthrough()

let z: any;
try {
  // Intenta importar Zod desde las dependencias normales
  z = require("zod");
} catch (e) {
  console.warn("⚠️ No se pudo cargar zod desde node_modules");
}

if (z) {
  try {
    const sample = z.object({});
    const proto = Object.getPrototypeOf(sample);

    if (proto && typeof proto.passthrough !== "function") {
      console.log("🔧 Aplicando polyfill Zod .passthrough()");
      proto.passthrough = function () {
        if (typeof this.nonstrict === "function") return this.nonstrict();
        return this;
      };
    }
  } catch (e) {
    console.error("Error aplicando polyfill Zod:", e);
  }
}
