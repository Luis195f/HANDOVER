// src/lib/patient-filters.ts
// Filtros + orden PRO para PatientList.
// - Texto: busca en name e id (case/acentos insensitive).
// - Unidades/Especialidad (client-side).
// - Orden NEWS2 descendente: prioriza p.news2, luego p.latestNews2.score, luego calcula con vitals.
// - Desempate estable por name/id asc.

import { computeNEWS2 } from "@/src/lib/news2";
import { evaluateNews2Input, selectNews2Temperature, type News2InputResult } from "@/src/lib/news2-input";
import type { VitalsSnapshot } from "@/src/types/handover";

export type PatientLike = {
  id: string;
  name?: string;
  unitId?: string;
  specialtyId?: string;
  location?: string;
  bed?: string;
  vitals?: VitalsSnapshot;
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

export function resolvePatientNews2(patient: PatientLike): News2InputResult<{ score: number; source: 'news2' | 'latestNews2' | 'vitals' }> {
  // Preferencia explícita: news2 > latestNews2.score > cálculo por vitals
  if (typeof patient.news2 === "number") return { status: 'calculated', result: { score: patient.news2, source: 'news2' } };
  const stored = patient.latestNews2?.score;
  if (typeof stored === "number") return { status: 'calculated', result: { score: stored, source: 'latestNews2' } };
  return evaluateNews2Input(patient.vitals?.rr, () => ({
    score: computeNEWS2({ ...patient.vitals, temp: selectNews2Temperature(patient.vitals) }).total,
    source: 'vitals',
  }));
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
    const first = resolvePatientNews2(a);
    const second = resolvePatientNews2(b);
    if (first.status === 'blocked') return second.status === 'blocked' ? 0 : 1;
    if (second.status === 'blocked') return -1;
    if (second.result.score !== first.result.score) return second.result.score - first.result.score;
    const ka = normalize(a.name) || normalize(a.id);
    const kb = normalize(b.name) || normalize(b.id);
    return ka.localeCompare(kb);
  });
}
