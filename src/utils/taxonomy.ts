// src/utils/taxonomy.ts
import { toSlug } from "./slug";

export type Taxonomy = {
  units: string[];         // ids/slug de unidades
  specialties: string[];   // ids/slug de especialidades (si aplican)
};

export function buildTaxonomy(
  patients: Array<{ location?: string; specialtyId?: string }> = [],
  known: Partial<Taxonomy> = {}
): Taxonomy {
  const u = new Set<string>();
  const s = new Set<string>();

  (known.units ?? []).forEach((x) => u.add(toSlug(x)));
  (known.specialties ?? []).forEach((x) => s.add(toSlug(x)));

  for (const p of patients) {
    if (p.location) u.add(toSlug(p.location));
    if (p.specialtyId) s.add(toSlug(p.specialtyId));
  }
  return { units: Array.from(u).sort(), specialties: Array.from(s).sort() };
}

/** OR dentro de cada categoría; AND entre categorías */
export function filterPatients<T extends {
  name?: string; id?: string; shift?: string;
  location?: string; specialtyId?: string;
}>(
  list: T[],
  opts: {
    q?: string;
    units?: string[];            // slugs seleccionados
    specialties?: string[];      // slugs seleccionados
    shifts?: string[];           // mañana/tarde/noche (o lo que uses)
    ignoreFilters?: boolean;
  }
): T[] {
  const q = opts.q?.trim().toLowerCase();
  const has = (arr?: string[]) => !!(arr && arr.length);

  return list.filter((p) => {
    if (opts.ignoreFilters) return true;

    const unit = toSlug(p.location ?? "");
    const spec = toSlug(p.specialtyId ?? "");
    const shift = (p.shift ?? "").toLowerCase();

    const unitOk = has(opts.units) ? opts.units!.includes(unit) : true;
    const specOk = has(opts.specialties) ? opts.specialties!.includes(spec) : true;
    const shiftOk = has(opts.shifts) ? opts.shifts!.includes(shift) : true;

    const textOk = q
      ? (p.name ?? "").toLowerCase().includes(q) ||
        (p.id ?? "").toLowerCase().includes(q)
      : true;

    return unitOk && specOk && shiftOk && textOk;
  });
}
