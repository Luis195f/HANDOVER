// src/utils/units.ts
import { toSlug } from "./slug";

export const uniq = (xs: string[]) => Array.from(new Set(xs));

/** Intenta deducir la unidad desde unitId/location/bed */
export function guessUnitId(p: { unitId?: string; location?: string; bed?: string }) {
  if (p.unitId) return toSlug(p.unitId);
  const from = [p.location, p.bed].filter(Boolean).join(" ");
  return toSlug(from.split(/[•·|,;:]/)[0] || "");
}

/** Une catálogo + datos sin filtrar para chips */
export function collectUnitChips(allPatients: Array<{ unitId?: string; location?: string; bed?: string }>, knownUnitIds: string[]) {
  const fromKnown = (knownUnitIds ?? []).map(toSlug);
  const fromData = allPatients.map(guessUnitId).filter(Boolean);
  return uniq([...fromKnown, ...fromData]).sort();
}
