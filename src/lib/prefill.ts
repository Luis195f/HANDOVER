/* [NURSEOS PRO PATCH 2025-10-22] prefill.ts
   - Acepta string | PrefillInput y opts
   - Devuelve { dxText, location, bed, vitals, news2, priority, priorityLabel }
   - Extrae últimos signos (RR, SpO2, Temp, SBP/DBP, HR, ACVPU, O2/FiO2/Flow) desde Observation
   - Calcula NEWS2 (escala 1) y prioridad (low/medium/high)
   - Fallback offline seguro (no rompe la UI)
*/

import { LOINC, TERMINOLOGY_SYSTEMS } from "./codes";
import { parseRespiratoryRate, readRrReview, type RrReview } from './news2-input';
import { computeNEWS2 as computeCanonicalNEWS2 } from './news2';
import { resolveSupplementalOxygen } from './oxygen';
import type { OxygenTherapy } from '../types/handover';
import { resolveAcvpu } from './fhir-map';

const LOINC_SYSTEM = TERMINOLOGY_SYSTEMS.LOINC;

// Tipos públicos que usa la UI / tests
export type PrefillInput = {
  patientId: string;
  fhirBase?: string;
  token?: string;            // "Bearer ..." o solo token (se normaliza)
  fetchImpl?: typeof fetch;  // para testear / inyectar fetch
};

export type VitalPrefill = {
  // Núcleo previo
  o2?: boolean;
  acvpu?: "A" | "C" | "V" | "P" | "U";
  // Extendidos (para UI/NEWS2)
  rr?: number;
  spo2?: number;
  temp?: number;
  sbp?: number;
  dbp?: number;
  hr?: number;
};

export type PrefillOutput = {
  dxText?: string;
  location?: string;
  bed?: string;
  vitals?: VitalPrefill;
  oxygenTherapy?: Pick<OxygenTherapy, 'fio2' | 'flowLMin'>;
  legacyOxygen?: boolean;
} & ({
  news2InputState?: { status: 'eligible' };
  rrReview?: never;
  news2?: number;
  priority?: "low" | "medium" | "high";
  priorityLabel?: string; // "Low", "Medium", "High"
} | {
  news2InputState: { status: 'not-calculable'; reason: 'RR_NON_INTEGER' };
  rrReview: RrReview;
  news2?: never;
  priority?: never;
  priorityLabel?: never;
});

/**
 * Prefill desde FHIR (opcional). Si no hay red/credenciales, retorna parcial seguro.
 * - input: string (patientId) o PrefillInput
 * - opts: permite pasar fhirBase/token/fetchImpl cuando el primer arg es string
 */
export async function prefillFromFHIR(
  input: string | PrefillInput,
  opts?: Omit<PrefillInput, "patientId">
): Promise<PrefillOutput> {
  const { patientId, fhirBase, token, fetchImpl } =
    typeof input === "string" ? { patientId: input, ...(opts ?? {}) } : input;

  // Siempre devolver estructura segura
  const baseOut: PrefillOutput = {
    dxText: undefined,
    location: undefined,
    bed: undefined,
    vitals: {}
  };

  // Sin base o sin fetch: devolvemos parcial (offline-ready)
  const fx = fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!patientId || !fhirBase || !fx) return baseOut;

  try {
    const base = normalizeBaseUrl(fhirBase);
    const headers: Record<string, string> = { Accept: "application/fhir+json" };
    if (token) headers.Authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

    const getJson = async (path: string): Promise<any | null> => {
      try {
        const url = path.includes("://") ? path : `${base}${path}`;
        const res = await fx(url, { headers });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    };

    // 1) Encuentro más reciente → Location/bed
    const encBundle =
      (await getJson(`Encounter?subject=Patient/${encodeURIComponent(patientId)}&_sort=-date&_count=1`)) ??
      (await getJson(`Encounter?patient=${encodeURIComponent(patientId)}&_sort=-date&_count=1`));

    const encounter = firstResource(encBundle, "Encounter");
    const encLocRef = first(encounter?.location)?.location;
    let locationName: string | undefined;
    let bedName: string | undefined;

    if (encLocRef?.reference) {
      const loc = await resolveRef(getJson, encLocRef.reference);
      locationName = (loc?.name as string) || encLocRef.display || undefined;
      bedName = deriveBedName(loc) ?? deriveBedFromDisplay(encLocRef.display);
    } else {
      locationName = deriveLocationFromDisplay(encLocRef?.display);
      bedName = deriveBedFromDisplay(encLocRef?.display);
    }

    // 2) Diagnóstico principal (última Condition activa)
    const condBundle = await getJson(
      `Condition?subject=Patient/${encodeURIComponent(patientId)}&clinical-status=active&_sort=-_lastUpdated&_count=1`
    );
    const condition = firstResource(condBundle, "Condition");
    const dxText =
      condition?.code?.text ??
      first(condition?.code?.coding)?.display ??
      undefined;

    // 3) Observations recientes → extraer últimos valores por parámetro
    const obsBundle = await getJson(
      `Observation?subject=Patient/${encodeURIComponent(patientId)}&_sort=-date&_count=50`
    );
    const obs = listResources(obsBundle, "Observation");

    const latest = extractLatestVitals(obs);
    const acvpu = findACVPU(obs);
    if (acvpu === 'conflict') return baseOut;
    const hasStructuredOxygen = latest.fio2Pct !== undefined || latest.flowLMin !== undefined;
    const oxygenTherapy: Pick<OxygenTherapy, 'fio2' | 'flowLMin'> = {};
    if (latest.fio2Pct !== undefined) oxygenTherapy.fio2 = latest.fio2Pct;
    if (latest.flowLMin !== undefined) oxygenTherapy.flowLMin = latest.flowLMin;
    const legacyOxygen = hasStructuredOxygen ? undefined : guessO2FromNotes(obs);
    const o2 = resolveSupplementalOxygen(oxygenTherapy, legacyOxygen);

    const vitals: VitalPrefill = {
      rr: latest.rr,
      spo2: latest.spo2,
      temp: latest.temp,
      sbp: latest.sbp,
      dbp: latest.dbp,
      hr: latest.hr,
      acvpu: acvpu ?? undefined,
      o2
    };

    if (latest.rrReview) return {
      dxText, location: locationName, bed: bedName, vitals, oxygenTherapy, legacyOxygen, rrReview: latest.rrReview,
      news2InputState: { status: 'not-calculable', reason: 'RR_NON_INTEGER' },
    };

    // 4) NEWS2 + prioridad (escala 1 por defecto)
    const news = computeCanonicalNEWS2({
      rr: vitals.rr,
      spo2: vitals.spo2,
      temp: vitals.temp,
      sbp: vitals.sbp,
      hr: vitals.hr,
      avpu: vitals.acvpu,
      o2: vitals.o2,
      scale2: false,
    });
    const { priority, label } = priorityFromNEWS2(news.total, news.anyThree);

    return {
      dxText,
      location: locationName,
      bed: bedName,
      vitals,
      oxygenTherapy,
      legacyOxygen,
      news2: news.total,
      priority,
      priorityLabel: label
    };
  } catch {
    // Cualquier error: devolvemos parcial seguro sin romper UI
    return baseOut;
  }
}

/** ===== Helpers de acceso seguro y parsing ===== */

// corrige accesos "unknown" a direcciones
export const safeAddr = (a: any) => {
  const lines = (a?.line ?? []) as string[];
  return {
    line: lines,
    city: (a?.city as string | undefined) ?? undefined,
    country: (a?.country as string | undefined) ?? undefined
  };
};

// —— utilidades internas ——

function normalizeBaseUrl(u: string) {
  return u.endsWith("/") ? u : `${u}/`;
}

function first<T = any>(arr?: T[] | null): T | undefined {
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined;
}

function isBundle(b: any): boolean {
  return b && typeof b === "object" && b.resourceType === "Bundle" && Array.isArray(b.entry);
}

function firstResource<T = any>(bundle: any, type?: string): T | undefined {
  if (!isBundle(bundle)) return undefined;
  const entries = (bundle.entry as any[]) ?? [];
  const found = type ? entries.find(e => e?.resource?.resourceType === type) : entries[0];
  return found?.resource as T | undefined;
}

function listResources<T = any>(bundle: any, type?: string): T[] {
  if (!isBundle(bundle)) return [];
  const entries = (bundle.entry as any[]) ?? [];
  return entries
    .map(e => e?.resource)
    .filter(r => (type ? r?.resourceType === type : true)) as T[];
}

async function resolveRef(getJson: (p: string) => Promise<any | null>, reference: string) {
  // reference viene tipo "Location/123" o URL absoluta; soporta relativa
  const path = reference.includes("://") ? reference : reference;
  return await getJson(path);
}

function deriveBedName(loc: any): string | undefined {
  // Heurísticas comunes: Location.name o alias/identifier con "Bed"/"Cama"
  const byName = (loc?.name as string | undefined) ?? undefined;
  if (!byName) return undefined;
  const m = /(?:bed|cama)[\s\-#:]*([A-Za-z0-9]+)$/i.exec(byName);
  return m?.[1] ? `Bed ${m[1]}` : undefined;
}

function deriveLocationFromDisplay(display?: string): string | undefined {
  if (!display) return undefined;
  // Si display es "UCI-3 - Bed 12", devuelve "UCI-3"
  const parts = display.split(/\s*-\s*/);
  return parts[0] || undefined;
}

function deriveBedFromDisplay(display?: string): string | undefined {
  if (!display) return undefined;
  const m = /(bed|cama)\s*([A-Za-z0-9\-]+)/i.exec(display);
  return m?.[2] ? `Bed ${m[2]}` : undefined;
}

function getTs(o: any): number {
  const dt =
    (o?.effectiveDateTime as string | undefined) ??
    (o?.issued as string | undefined) ??
    (o?.meta?.lastUpdated as string | undefined);
  const t = dt ? Date.parse(dt) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function numOrUndefined(x: any): number | undefined {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function readOxygenQuantity(quantity: unknown, expectedUnit: '%' | 'L/min'): number | undefined {
  if (!quantity || typeof quantity !== 'object' || !('value' in quantity) ||
      typeof quantity.value !== 'number' || !Number.isFinite(quantity.value)) return undefined;
  const code = 'code' in quantity ? quantity.code : undefined;
  const unit = 'unit' in quantity ? quantity.unit : undefined;
  const system = 'system' in quantity ? quantity.system : undefined;
  if ((code ?? unit) !== expectedUnit || (system != null && system !== TERMINOLOGY_SYSTEMS.UCUM)) return undefined;
  return quantity.value;
}

function findACVPU(obsList: any[]): VitalPrefill["acvpu"] | 'conflict' {
  const cand = obsList
    .filter(o => {
      const t = (o?.code?.text as string | undefined)?.toLowerCase?.();
      const codings: readonly { system?: unknown; code?: unknown }[] = Array.isArray(o?.code?.coding) ? o.code.coding : [];
      return codings.some(coding => coding?.system === LOINC_SYSTEM && coding?.code === LOINC.acvpu) ||
        t?.includes("acvpu") || t?.includes("avpu");
    })
    .sort((a, b) => getTs(b) - getTs(a))[0];

  const values: unknown[] = [cand?.valueCodeableConcept?.text, cand?.valueString];
  const codings: readonly unknown[] = Array.isArray(cand?.valueCodeableConcept?.coding) ? cand.valueCodeableConcept.coding : [];
  for (const coding of codings) {
    if (!coding || typeof coding !== 'object') continue;
    if ('code' in coding && (!('system' in coding) || coding.system == null || coding.system === TERMINOLOGY_SYSTEMS.SNOMED)) values.push(coding.code);
    if ('display' in coding) values.push(coding.display);
  }
  const recognized = new Set<NonNullable<VitalPrefill['acvpu']>>();
  for (const value of values) {
    const state = resolveAcvpu(value);
    if (state) recognized.add(state);
  }
  return recognized.size > 1 ? 'conflict' : recognized.values().next().value;
}

function guessO2FromNotes(obsList: any[]): boolean {
  // Heurística: si hay texto mencionando O2, cánula, máscara, NRB, FiO2...
  const texty = (o: any) =>
    [
      o?.code?.text,
      o?.valueString,
      o?.valueCodeableConcept?.text
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  return obsList.some(o => {
    const t = texty(o);
    return /fi?o2|oxigen|oxygen|cánula|canula|mask|mascara|nrb|non-?rebreather/.test(t);
  });
}

/** Extrae los últimos valores por parámetro clave (según timestamp) */
function extractLatestVitals(obsList: any[]) {
  let rrReview: RrReview | undefined;
  type K = "rr" | "spo2" | "temp" | "sbp" | "dbp" | "hr" | "fio2Pct" | "flowLMin";
  const latest: Record<K, { t: number; v: number } | undefined> = {
    rr: undefined, spo2: undefined, temp: undefined, sbp: undefined, dbp: undefined, hr: undefined, fio2Pct: undefined, flowLMin: undefined
  };

  const setLatest = (k: K, o: any, val?: number) => {
    if (val === undefined) return;
    const t = getTs(o);
    if (!latest[k] || t > (latest[k]!.t)) {
      latest[k] = { t, v: val };
      if (k === 'rr') rrReview = readRrReview({
        originalValue: val, source: 'fhir', reason: 'RR_NON_INTEGER', resolution: 'pending',
        unit: o?.valueQuantity?.unit,
        observedAt: o?.effectiveDateTime ?? o?.issued ?? o?.meta?.lastUpdated,
      });
    }
  };

  for (const o of obsList) {
    const codes = (o?.code?.coding ?? []) as any[];

    // Panel BP → componentes
    if (codes.some(c => c?.system === LOINC_SYSTEM && c?.code === LOINC.bpPanel) && Array.isArray(o?.component)) {
      for (const comp of o.component) {
        const cc = (comp?.code?.coding ?? []) as any[];
        if (cc.some((c: any) => c?.system === LOINC_SYSTEM && c?.code === LOINC.sbp)) {
          setLatest("sbp", o, numOrUndefined(comp?.valueQuantity?.value));
        }
        if (cc.some((c: any) => c?.system === LOINC_SYSTEM && c?.code === LOINC.dbp)) {
          setLatest("dbp", o, numOrUndefined(comp?.valueQuantity?.value));
        }
      }
      continue;
    }

    // Variables simples
    if (codes.some(c => c?.system === LOINC_SYSTEM && c?.code === LOINC.rr)) {
      setLatest("rr", o, parseRespiratoryRate(o?.valueQuantity?.value));
    } else if (codes.some(c => c?.system === LOINC_SYSTEM && c?.code === LOINC.spo2)) {
      setLatest("spo2", o, numOrUndefined(o?.valueQuantity?.value));
    } else if (codes.some(c => c?.system === LOINC_SYSTEM && c?.code === LOINC.temp)) {
      setLatest("temp", o, numOrUndefined(o?.valueQuantity?.value));
    } else if (codes.some(c => c?.system === LOINC_SYSTEM && c?.code === LOINC.hr)) {
      setLatest("hr", o, numOrUndefined(o?.valueQuantity?.value));
    } else if (codes.some(c => c?.system === LOINC_SYSTEM && c?.code === LOINC.fio2)) {
      // FiO2 → porcentaje (value ya suele venir en %)
      setLatest("fio2Pct", o, readOxygenQuantity(o?.valueQuantity, '%'));
    } else if (codes.some(c => c?.system === LOINC_SYSTEM && c?.code === LOINC.o2Flow)) {
      setLatest("flowLMin", o, readOxygenQuantity(o?.valueQuantity, 'L/min'));
    }
  }

  return {
    rr: latest.rr?.v,
    rrReview,
    spo2: latest.spo2?.v,
    temp: latest.temp?.v,
    sbp: latest.sbp?.v,
    dbp: latest.dbp?.v,
    hr: latest.hr?.v,
    fio2Pct: latest.fio2Pct?.v,
    flowLMin: latest.flowLMin?.v
  };
}

function priorityFromNEWS2(score: number, any3: boolean) {
  // Regla típica: 0-4 Low (pero si any3 => al menos Medium), 5-6 Medium, >=7 High
  let priority: "low" | "medium" | "high" =
    score >= 7 ? "high" :
    score >= 5 ? "medium" :
    any3 ? "medium" : "low";

  const label = priority.charAt(0).toUpperCase() + priority.slice(1);
  return { priority, label };
}
