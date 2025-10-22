// src/config/units.ts

/**
 * URL de la extensión FHIR que usamos en Location para codificar la especialidad.
 * Si en tu servidor es otra, cámbiala aquí y todo lo demás se mantiene coherente.
 */
export const SPECIALTY_EXT_URL = "http://example.com/fhir/extension/specialty";

/**
 * Mapa local: specialtyId -> unitIds (coherentes con Location.id o Location.name).
 * Útil como fallback offline/mock, para UI y para inferencias rápidas.
 */
export const UNITS_BY_SPECIALTY: Record<string, string[]> = {
  urgencias: ['urgencias-24h', 'emergencias-triage'],
  hospitalizacion: ['medicina-interna', 'cirugia-general', 'pediatria-piso', 'ginecologia-piso'],
  uci: ['uci-adulto', 'uci-neonatal', 'uci-pediatrica'],
  'uci-especial': ['uci-cardio', 'uci-neuro', 'uci-quemados'],
  'materno-perinatal': ['sala-parto-alto-riesgo', 'neonatologia'],
  quirofanos: ['quirofano-alta-complejidad', 'recuperacion-postcirugia'],
  'consulta-externa': ['clinica-ambulatoria', 'seguimiento-no-hospitalizados'],
  rehabilitacion: ['unidad-rehab', 'terapias-fisicas'],
  especiales: ['residencia-geriatrica', 'salud-mental', 'atencion-domiciliaria'],
  cardiologia: ['post-angioplastia', 'cuidados-marcapasos'],
  neurologia: ['acv-trauma', 'cirugia-columna'],
  oncologia: ['quimioterapia', 'cuidados-paliativos'],
  traumatologia: ['politraumatizados', 'protesis-reconstructiva'],
  nefrologia: ['dialisis', 'trasplante-renal'],
  gastroenterologia: ['hemorragias-digestivas', 'trasplante-hepatico'],
  endocrinologia: ['diabetes-compleja', 'crisis-tiroideas'],
  neumologia: ['ventilacion-prolongada', 'trasplante-pulmonar'],
  infectologia: ['vih-infecciones', 'multi-resistentes'],
  pediatria: ['neonatos-congenitas', 'onco-pediatria'],
  ginecologia: ['embarazos-alto-riesgo', 'post-cesareas'],
  oftalmologia: ['post-operatorios-especializados'],
  'cirugia-plastica': ['grandes-quemados', 'reconstrucciones'],
  'medicina-critica': ['emergencias-generales'],
  trasplantes: ['trasplante-corazon', 'trasplante-higado', 'trasplante-rinon', 'trasplante-pancreas'],
};

// ===== Tipos y utils =====

export type Unit = {
  /** id estable (coincide con Location.id/name cuando sea posible) */
  id: string;
  /** nombre para UI */
  name: string;
  /** especialidad a la que pertenece (specialtyId) */
  specialtyId: string;
  /** metadatos opcionales por si quieres mapear con Location.type, etc. */
  fhir?: {
    /** p. ej. 'icu', 'ward', 'er', 'or', etc. */
    locationType?: string;
    /** si la unidad quisiera sobreescribir el code de SPECIALTY_EXT_URL */
    specialtyCodeOverride?: string;
  };
};

/** Normaliza una cadena para comparaciones robustas (búsquedas/filtros). */
export function normalize(s?: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Nombre “bonito” para UI a partir del id (UCI -> UCI, etc.). */
function prettyUnitName(id: string): string {
  const ACRONYMS = new Set(["uci", "er", "or", "qx"]);
  return id
    .split("-")
    .map((w) =>
      ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(" ");
}

/**
 * Genera UNITS a partir del mapa UNITS_BY_SPECIALTY.
 * Puedes cambiar/añadir metadatos por cada unidad aquí si lo necesitas.
 */
export const UNITS: Unit[] = Object.entries(UNITS_BY_SPECIALTY).flatMap(
  ([specialtyId, unitIds]) =>
    unitIds.map((id) => ({
      id,
      name: prettyUnitName(id),
      specialtyId,
      fhir: {
        // ejemplo de tipos por familia (ajusta si quieres usarlo en búsquedas avanzadas)
        locationType:
          specialtyId.includes("uci") ? "icu" :
          specialtyId === "quirofanos" ? "or" :
          specialtyId === "urgencias" ? "er" :
          specialtyId === "consulta-externa" ? "amb" :
          "ward",
      },
    }))
);

/** Índice por id para lookups O(1). */
export const UNITS_BY_ID: Record<string, Unit> = UNITS.reduce((acc, u) => {
  acc[u.id] = u;
  return acc;
}, {} as Record<string, Unit>);

/** Devuelve los ids de unidad para una especialidad. */
export function getUnitsForSpecialty(specialtyId: string): string[] {
  return UNITS_BY_SPECIALTY[specialtyId] ?? [];
}

/** ¿Esta unidad pertenece a esta especialidad? */
export function isUnitOfSpecialty(unitId: string, specialtyId: string): boolean {
  const list = UNITS_BY_SPECIALTY[specialtyId] ?? [];
  return list.includes(unitId);
}

/**
 * Intenta encontrar el unitId dentro de un texto de ubicación (p.ej. "uci-cardio-3").
 * Devuelve el unitId o null si no encuentra coincidencia.
 */
export function matchLocationToUnit(locationText?: string): string | null {
  const loc = normalize(locationText);
  if (!loc) return null;
  for (const u of UNITS) {
    if (loc.includes(normalize(u.id))) return u.id;
  }
  return null;
}

/**
 * A partir de un texto de ubicación (Encounter.location/Location.name),
 * intenta deducir specialtyId buscando el unitId dentro de la cadena.
 */
export function guessSpecialtyFromLocation(locationText?: string): string | null {
  const unitId = matchLocationToUnit(locationText);
  if (!unitId) return null;
  return UNITS_BY_ID[unitId]?.specialtyId ?? null;
}
