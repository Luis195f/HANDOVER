// @ts-nocheck
// src/lib/patient-filters.ts
// Filtros + orden PRO para PatientList.
// - Texto: busca en name e id (case/acentos insensitive).
// - Unidades/Especialidad (client-side).
// - Orden NEWS2 descendente: prioriza p.news2, luego p.latestNews2.score, luego calcula con vitals.
// - Desempate estable por name/id asc.

import { news2Score } from "@/src/lib/priority";

export type PatientLike = {
  id: string;
  name?: string;
  unitId?: string;
  specialtyId?: string;
  location?: string;
  bed?: string;
  vitals?: Record<string, any>;
  news2?: number;
  latestNews2?: { score?: number };
};

function normalize(s?: string) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function scoreOf(p: PatientLike): number {
  // Preferencia explícita: news2 > latestNews2.score > cálculo por vitals
  if (typeof p.news2 === "number") return p.news2;
  const maybe = p.latestNews2?.score;
  if (typeof maybe === "number") return maybe;
  return news2Score(p.vitals ?? {});
}

export function applyPatientFilters<T extends PatientLike>(
  list: T[],
  opts: { text?: string; unitId?: string; specialty?: string }
): T[] {
  const q = normalize(opts.text);
  const unitId = opts.unitId?.toLowerCase();
  const specId = opts.specialty?.toLowerCase();

  return list.filter((p) => {
    if (q) {
      const nm = normalize(p.name);
      const idn = normalize(p.id);
      if (!nm.includes(q) && !idn.includes(q)) return false;
    }
    if (unitId && unitId !== "todos") {
      if ((p.unitId ?? "").toLowerCase() !== unitId) return false;
    }
    if (specId && specId !== "todos") {
      if ((p.specialtyId ?? "").toLowerCase() !== specId) return false;
    }
    return true;
  });
}

export function sortPatientsByNEWS2Desc<T extends PatientLike>(list: T[]): T[] {
  // Copia estable + orden:
  // 1) score desc
  // 2) tie-break por (name ?? id) asc
  return [...list].sort((a, b) => {
    const sa = scoreOf(a);
    const sb = scoreOf(b);
    if (sb !== sa) return sb - sa;
    const ka = normalize(a.name) || normalize(a.id);
    const kb = normalize(b.name) || normalize(b.id);
    return ka.localeCompare(kb);
  });
}
