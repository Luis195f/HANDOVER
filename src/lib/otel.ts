// @ts-nocheck
export function mark(name: string, attrs: Record<string, any> = {}) {
  // Hook de observabilidad simple; en prod, envíalo a tu APM/OTel
  console.log(`[otel] ${name}`, { t: Date.now(), ...attrs });
}
