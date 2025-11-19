/* [NURSEOS PRO PATCH 2025-10-22] prefill.ts
   - Acepta string | PrefillInput y opts
   - Devuelve { dxText, location, bed, vitals, news2, priority, priorityLabel }
   - Extrae últimos signos (RR, SpO2, Temp, SBP/DBP, HR, ACVPU, O2/FiO2/Flow) desde Observation
   - Calcula NEWS2 (escala 1) y prioridad (low/medium/high)
   - Fallback offline seguro (no rompe la UI)
*/

import { LOINC, TERMINOLOGY_SYSTEMS } from "./codes";

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
  // Añadidos
  news2?: number;
  priority?: "low" | "medium" | "high";
  priorityLabel?: string; // "Low", "Medium", "High"
};

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
    const hasFiO2 = !!findByLoinc(obs, LOINC.fio2);
    const hasO2Flow = !!findByLoinc(obs, LOINC.o2Flow);
    const o2 = hasFiO2 || hasO2Flow || guessO2FromNotes(obs) || !!latest.fio2Pct;

    const vitals: VitalPrefill = {
      rr: latest.rr,
      spo2: latest.spo2,
      temp: latest.temp,
      sbp: latest.sbp,
      dbp: latest.dbp,
      hr: latest.hr,
      acvpu: acvpu ?? undefined,
      o2: o2 || undefined
    };

    // 4) NEWS2 + prioridad (escala 1 por defecto)
    const news = computeNEWS2({
      rr: vitals.rr,
      spo2: vitals.spo2,
      temp: vitals.temp,
      sbp: vitals.sbp,
      hr: vitals.hr,
      acvpu: vitals.acvpu,
      o2: vitals.o2
    });
    const { priority, label } = priorityFromNEWS2(news.score, news.any3);

    return {
      dxText,
      location: locationName,
      bed: bedName,
      vitals,
      news2: news.score,
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

function findByLoinc(obsList: any[], loincCode: string): any | undefined {
  return obsList.find(o =>
    (o?.code?.coding ?? []).some((c: any) => c?.system === LOINC_SYSTEM && c?.code === loincCode)
  );
}

function findACVPU(obsList: any[]): VitalPrefill["acvpu"] | undefined {
  // Busca Observations con code.text "ACVPU/AVPU scale" y lee valueCodeableConcept.text o valueString
  // (Compat con lo que genera fhir-map.ts)
  const cand = obsList
    .filter(o => {
      const t = (o?.code?.text as string | undefined)?.toLowerCase?.();
      return t?.includes("acvpu") || t?.includes("avpu");
    })
    .sort((a, b) => getTs(b) - getTs(a))[0];

  const val =
    (cand?.valueCodeableConcept?.text as string | undefined) ??
    (cand?.valueString as string | undefined);
  if (!val) return undefined;
  const v = val.trim().toUpperCase();
  return ["A", "C", "V", "P", "U"].includes(v) ? (v as VitalPrefill["acvpu"]) : undefined;
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
  type K = "rr" | "spo2" | "temp" | "sbp" | "dbp" | "hr" | "fio2Pct";
  const latest: Record<K, { t: number; v: number } | undefined> = {
    rr: undefined, spo2: undefined, temp: undefined, sbp: undefined, dbp: undefined, hr: undefined, fio2Pct: undefined
  };

  const setLatest = (k: K, o: any, val?: number) => {
    if (val === undefined) return;
    const t = getTs(o);
    if (!latest[k] || t > (latest[k]!.t)) {
      latest[k] = { t, v: val };
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
      setLatest("rr", o, numOrUndefined(o?.valueQuantity?.value));
    } else if (codes.some(c => c?.system === LOINC_SYSTEM && c?.code === LOINC.spo2)) {
      setLatest("spo2", o, numOrUndefined(o?.valueQuantity?.value));
    } else if (codes.some(c => c?.system === LOINC_SYSTEM && c?.code === LOINC.temp)) {
      setLatest("temp", o, numOrUndefined(o?.valueQuantity?.value));
    } else if (codes.some(c => c?.system === LOINC_SYSTEM && c?.code === LOINC.hr)) {
      setLatest("hr", o, numOrUndefined(o?.valueQuantity?.value));
    } else if (codes.some(c => c?.system === LOINC_SYSTEM && c?.code === LOINC.fio2)) {
      // FiO2 → porcentaje (value ya suele venir en %)
      setLatest("fio2Pct", o, numOrUndefined(o?.valueQuantity?.value));
    }
  }

  return {
    rr: latest.rr?.v,
    spo2: latest.spo2?.v,
    temp: latest.temp?.v,
    sbp: latest.sbp?.v,
    dbp: latest.dbp?.v,
    hr: latest.hr?.v,
    fio2Pct: latest.fio2Pct?.v
  };
}

/** NEWS2 escala 1 (sin COPD). Devuelve score y si hay algún 3 en cualquier parámetro. */
function computeNEWS2(v: {
  rr?: number; spo2?: number; temp?: number; sbp?: number; hr?: number; acvpu?: VitalPrefill["acvpu"]; o2?: boolean;
}) {
  let score = 0;
  let any3 = false;

  // RR
  const rrS =
    v.rr === undefined ? 0 :
    (v.rr <= 8 ? 3 :
     v.rr <= 11 ? 1 :
     v.rr <= 20 ? 0 :
     v.rr <= 24 ? 2 : 3);
  score += rrS; if (rrS === 3) any3 = true;

  // SpO2 (escala 1)
  const s = v.spo2;
  const spo2S =
    s === undefined ? 0 :
    (s <= 91 ? 3 :
     s <= 93 ? 2 :
     s <= 95 ? 1 : 0);
  score += spo2S; if (spo2S === 3) any3 = true;

  // Temp
  const t = v.temp;
  const tempS =
    t === undefined ? 0 :
    (t <= 35.0 ? 3 :
     t <= 36.0 ? 1 :
     t <= 38.0 ? 0 :
     t <= 39.0 ? 1 : 2);
  score += tempS; if (tempS === 3) any3 = true;

  // SBP
  const p = v.sbp;
  const sbpS =
    p === undefined ? 0 :
    (p <= 90 ? 3 :
     p <= 100 ? 2 :
     p <= 110 ? 1 :
     p <= 219 ? 0 : 3);
  score += sbpS; if (sbpS === 3) any3 = true;

  // HR
  const h = v.hr;
  const hrS =
    h === undefined ? 0 :
    (h <= 40 ? 3 :
     h <= 50 ? 1 :
     h <= 90 ? 0 :
     h <= 110 ? 1 :
     h <= 130 ? 2 : 3);
  score += hrS; if (hrS === 3) any3 = true;

  // ACVPU
  const concS = v.acvpu && v.acvpu !== "A" ? 3 : 0;
  score += concS; if (concS === 3) any3 = true;

  // O2 suplementario
  const o2S = v.o2 ? 2 : 0;
  score += o2S;

  return { score, any3 };
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
