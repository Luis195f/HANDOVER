// security/sensitiveFields.ts
// Lista central de rutas de campos sensibles que se deben tratar con cuidado
// (encriptar, no loguear en claro, etc.)

export const SENSITIVE_FIELDS = [
  "patient.name",
  "patient.identifier",
  "patient.telecom",
  "patient.address",
  "encounter.identifier",
  "encounter.location",
  "handover.summary",
] as const;

// Tipo que representa cualquiera de las rutas sensibles
export type SensitiveFieldPath = (typeof SENSITIVE_FIELDS)[number];

// Helper para comprobar si una ruta es sensible
export function isSensitiveField(path: string): path is SensitiveFieldPath {
  return (SENSITIVE_FIELDS as readonly string[]).includes(path);
}
