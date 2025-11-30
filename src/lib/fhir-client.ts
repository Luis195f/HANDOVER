/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/fhir-client.ts
import { fetchWithRetry } from './net';
import { getValidationErrorsFromBundle, validateBundle as validateFhirBundle } from './fhir-validation';
import type { GeneratedPdf } from './export/export-pdf';
// BEGIN HANDOVER D2 – VitalTrends fhir-client
import { LOINC, TERMINOLOGY_SYSTEMS } from './codes';
import type { VitalPoint, VitalTrendsData } from '../../types/vitals';
// END HANDOVER D2 – VitalTrends fhir-client
// BEGIN HANDOVER D6 – fetchPatientSummary
export interface PatientSummary {
  id: string;
  name: string;
  gender?: string;
  age?: number;
  bed?: string;
  mrn?: string;
  allergies?: string[];
}

/**
 * Obtiene un resumen de paciente a partir de su ID.
 * - Lee el recurso Patient (nombre, fecha de nacimiento, género, identificadores MRN).
 * - Lee Encounter/Location para obtener la cama actual.
 * - Lee AllergyIntolerance para listar alergias activas.
 * - Si algo falla o no hay datos, devuelve un objeto con los campos disponibles.
 * - En entorno __DEV__, si no hay servidor FHIR, devuelve datos mock para no romper la UI.
 */
export async function fetchPatientSummary(
  patientId: string,
): Promise<PatientSummary> {
  const baseFromEnv = (process.env as any)?.FHIR_BASE_URL as string | undefined;
  const baseFromHook = hooks.getBaseUrl?.();
  if (
    __DEV__ &&
    !baseFromHook &&
    (!baseFromEnv || baseFromEnv.includes('example.invalid'))
  ) {
    return {
      id: patientId,
      name: 'Paciente Demo',
      gender: 'female',
      age: 65,
      bed: 'A-12',
      mrn: 'MRN123',
      allergies: ['Penicilina'],
    };
  }

  let patient: any | undefined;
  let bed: string | undefined;
  let allergies: string[] | undefined;

  try {
    const { ok, data } = await fetchFHIR(`Patient/${encodeURIComponent(patientId)}`);
    if (ok && data) {
      patient = data;
    }
  } catch (error) {
    console.warn('fetchPatientSummary: error fetching Patient', error);
  }

  try {
    const { ok, data } = await fetchFHIR(
      `Encounter?subject=Patient/${encodeURIComponent(patientId)}&_include=Encounter:location`,
    );
    if (ok && data?.resourceType === 'Bundle' && Array.isArray(data.entry)) {
      const locations = new Map<string, any>();
      for (const entry of data.entry) {
        const res = entry?.resource;
        if (res?.resourceType === 'Location' && res.id) {
          locations.set(`Location/${res.id}`, res);
        }
      }

      const encounterEntry = data.entry.find((entry: any) => entry?.resource?.resourceType === 'Encounter');
      const encounter = encounterEntry?.resource;
      const encounterLocations = Array.isArray(encounter?.location) ? encounter.location : [];
      for (const loc of encounterLocations) {
        const locRef = loc?.location?.reference as string | undefined;
        const locDisplay = loc?.location?.display as string | undefined;
        const locResource = locRef ? locations.get(locRef) : undefined;
        const identifierValue = Array.isArray(locResource?.identifier)
          ? locResource.identifier.find((id: any) => {
              const system = id?.system ?? '';
              const typeText = id?.type?.text ?? '';
              return /bed|cama|room/i.test(system) || /bed|cama|habitación/i.test(typeText);
            })?.value
          : undefined;
        bed = locDisplay || identifierValue || bed;
        if (bed) break;
      }
    }
  } catch (error) {
    console.warn('fetchPatientSummary: error fetching Encounter/Location', error);
  }

  try {
    const { ok, data } = await fetchFHIR(
      `AllergyIntolerance?patient=Patient/${encodeURIComponent(patientId)}&clinical-status=active`,
    );
    if (ok && data?.resourceType === 'Bundle' && Array.isArray(data.entry)) {
      allergies = data.entry
        .map((entry: any) => {
          const resource = entry?.resource;
          const coding = (resource?.code?.coding ?? []) as any[];
          const codingDisplay = coding.find((c) => c?.display)?.display as string | undefined;
          return (resource?.code?.text as string | undefined) || codingDisplay;
        })
        .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0);
    }
  } catch (error) {
    console.warn('fetchPatientSummary: error fetching AllergyIntolerance', error);
  }

  const summary: PatientSummary = {
    id: patient?.id ?? patientId,
    name: extractPatientName(patient) ?? `Paciente #${patientId}`,
    gender: extractGender(patient),
    age: extractAge(patient),
    bed,
    mrn: extractMrn(patient),
    allergies,
  };

  return summary;
}

const extractPatientName = (patient: any): string | undefined => {
  if (!patient) return undefined;
  const name = Array.isArray(patient.name) ? patient.name[0] : undefined;
  if (!name) return undefined;
  if (name.text) return name.text;
  const family = name.family ?? '';
  const given = Array.isArray(name.given) ? name.given.join(' ') : '';
  const full = `${given} ${family}`.trim();
  return full || undefined;
};

const extractGender = (patient: any): string | undefined => {
  const gender = typeof patient?.gender === 'string' ? patient.gender : undefined;
  if (!gender || gender === 'unknown') return undefined;
  return gender;
};

const extractAge = (patient: any): number | undefined => {
  const birthDate = patient?.birthDate;
  if (!birthDate) return undefined;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return undefined;
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  const dayDiff = now.getDate() - birth.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    years -= 1;
  }
  return years >= 0 ? years : undefined;
};

const extractMrn = (patient: any): string | undefined => {
  const identifiers = Array.isArray(patient?.identifier) ? patient.identifier : [];
  const mrnIdentifier = identifiers.find((id: any) => {
    const system = (id?.system as string | undefined)?.toLowerCase() ?? '';
    const typeText = (id?.type?.text as string | undefined)?.toLowerCase() ?? '';
    const coding = Array.isArray(id?.type?.coding) ? id.type.coding : [];
    const codingMatch = coding.some((c: any) => {
      const code = (c?.code as string | undefined)?.toLowerCase() ?? '';
      const display = (c?.display as string | undefined)?.toLowerCase() ?? '';
      return code === 'mr' || display.includes('mrn');
    });
    return system.includes('mrn') || typeText.includes('mrn') || codingMatch;
  });
  return mrnIdentifier?.value as string | undefined;
};
// END HANDOVER D6 – fetchPatientSummary

type AuthHooks = {
  ensureFreshToken?: () => Promise<string | null>;
  logout?: () => Promise<void> | void;
  getBaseUrl?: () => string | undefined;
  /** Compat: algunos callers pasan baseUrl directo */
  baseUrl?: string;
};

let hooks: AuthHooks = {};

/** Permite inyectar hooks desde Auth u otros módulos (token/baseURL/logout). */
export function configureFHIRClient(h: AuthHooks) {
  // Si pasan baseUrl sin getBaseUrl, lo normalizamos
  const mapped: AuthHooks = { ...h };
  if (mapped.baseUrl && !mapped.getBaseUrl) {
    const fixed = mapped.baseUrl.replace(/\/$/, '');
    mapped.getBaseUrl = () => fixed;
  }
  hooks = { ...hooks, ...mapped };
}

function getBaseUrl(): string {
  const fromHook = hooks.getBaseUrl?.();
  const fromEnv = (process.env as any)?.FHIR_BASE_URL as string | undefined;
  return (fromHook || fromEnv || 'https://example.invalid/fhir').replace(/\/$/, '');
}

export type FetchFHIRParams = {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  token?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

// === Sobrecargas para que los tests puedan llamar fetchFHIR('/Patient', {...})
export async function fetchFHIR(
  path: string,
  opts?: Omit<FetchFHIRParams, 'path'>
): Promise<{ ok: boolean; response: Response; data: any }>;
export async function fetchFHIR(
  params: FetchFHIRParams
): Promise<{ ok: boolean; response: Response; data: any }>;

/** Client FHIR con inyección de Authorization + manejo de 401/403. */
export async function fetchFHIR(
  arg1: string | FetchFHIRParams,
  arg2?: Omit<FetchFHIRParams, 'path'>
) {
  const p: FetchFHIRParams =
    typeof arg1 === 'string' ? { path: arg1, ...(arg2 || {}) } : arg1;

  const { path, method = 'GET', body, token, headers, signal } = p;

  // Token preferente → si no, pedimos uno fresco (si hay hook)
  const authToken = token ?? (await hooks.ensureFreshToken?.() ?? undefined);

  const url = /^https?:\/\//i.test(path)
    ? path
    : `${getBaseUrl()}/${path.replace(/^\//, '')}`;

  const res = await fetchWithRetry(
    url,
    {
      method,
      headers: {
        Accept: 'application/fhir+json',
        ...(body ? { 'Content-Type': 'application/fhir+json' } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...headers,
      },
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      signal,
    }
  );

  // Comportamiento esperado por los tests
  if (res.status === 401 || res.status === 403) {
    if (hooks.logout) await hooks.logout();
    throw new Error('unauthorized');
  }

  // Soporta mocks que no implementan text()
  let json: any = undefined;
  const anyRes = res as any;
  if (typeof anyRes?.json === 'function') {
    json = await anyRes.json();
  } else if (typeof anyRes?.text === 'function') {
    const text = await anyRes.text();
    try { json = text ? JSON.parse(text) : undefined; } catch { /* noop */ }
  }

  return { ok: res.ok, response: res, data: json };
}

/**
 * POST /Bundle con shape de respuesta compatible con OperationOutcome.
 * En caso de error, devuelve tanto `issues` como alias `issue` (para compat tests).
 * Acepta `opts` objeto o una *string* tratada como `Idempotency-Key` (compat sync).
 */
export async function postBundle(
  bundle: any,
  opts?: { token?: string; headers?: Record<string, string> } | string
) {
  const validation = validateFhirBundle(bundle);
  const embeddedErrors = getValidationErrorsFromBundle(bundle);
  if (!validation.isValid || embeddedErrors) {
    const errors = embeddedErrors || validation.errors;
    return {
      ok: false,
      status: 400,
      issues: errors.map((err) => ({ severity: 'error', code: 'invalid', diagnostics: `${err.path}: ${err.message}` })),
      issue: errors.map((err) => ({ severity: 'error', code: 'invalid', diagnostics: `${err.path}: ${err.message}` })),
      body: {
        error: 'FHIR bundle failed validation',
        details: errors,
      },
    } as const;
  }

  try {
    // ensureFreshToken si no hay token explícito
    let token: string | undefined;
    let headers: Record<string, string> | undefined;

    if (typeof opts === 'string') {
      headers = { 'Idempotency-Key': opts };
    } else {
      token = opts?.token;
      headers = opts?.headers;
    }

    if (!token) token = (await hooks.ensureFreshToken?.()) ?? undefined;

    const r = await fetchFHIR({
      path: '/Bundle',
      method: 'POST',
      body: bundle,
      token,
      headers,
    });

    if (!r.ok) {
      const status = r.response?.status ?? 0;
      const data = r.data || {};
      const issues =
        (data.issue || data.issues) ??
        [{ severity: 'error', code: 'invalid', diagnostics: `HTTP ${status}` }];

      // Alias para compatibilidad con tests que esperan .issue
      return { ok: false, status, issues, issue: issues, body: data };
    }
    return { ok: true, status: r.response!.status, body: r.data };
  } catch (error: any) {
    // Si fue 401/403 (lanzamos 'unauthorized'), devolvemos shape coherente.
    const isUnauthorized = String(error?.message ?? error).toLowerCase().includes('unauthorized');
    const code = isUnauthorized ? 'login' : 'invalid';
    return {
      ok: false,
      status: isUnauthorized ? 401 : 400,
      issues: [{ severity: 'error', code, diagnostics: String(error?.message ?? error) }],
      issue: [{ severity: 'error', code, diagnostics: String(error?.message ?? error) }],
      body: { error: String(error?.message ?? error) },
    };
  }
}

/** === Compat con código existente === */
export const postBundleSmart = postBundle;

export interface PdfUploadContext {
  patientId: string;
  handoverId: string;
}

export async function uploadSignedHandoverPdf(
  pdf: GeneratedPdf,
  ctx: PdfUploadContext,
): Promise<void> {
  // TODO: cuando el backend exponga endpoint /upload/pdf-to-fhir,
  // implementar aquí la llamada POST usando el mismo cliente HTTP FHIR.
  // Por ahora, no hacer nada (stub) para mantener idempotencia.
  void pdf;
  void ctx;
  return;
}

// BEGIN HANDOVER D2 – VitalTrends fhir-client
const LOINC_SYSTEM = TERMINOLOGY_SYSTEMS.LOINC;

const createEmptyVitalTrends = (): VitalTrendsData => ({
  hr: [],
  sbp: [],
  rr: [],
  spo2: [],
  temp: [],
});

const getObservationTime = (observation: any): string | null => {
  const ts =
    (observation?.effectiveDateTime as string | undefined) ??
    (observation?.effectiveInstant as string | undefined) ??
    (observation?.issued as string | undefined);
  return typeof ts === 'string' ? ts : null;
};

const pushPoint = (series: VitalPoint[], observation: any, value?: number | null) => {
  const time = getObservationTime(observation);
  if (time && typeof value === 'number' && Number.isFinite(value)) {
    series.push({ time, value });
  }
};

const mapObservationToVitalTrends = (
  observation: any,
  trends: VitalTrendsData,
) => {
  const coding = (observation?.code?.coding ?? []) as any[];
  const hasCode = (code: string) =>
    coding.some((c) => c?.code === code && (!c?.system || c?.system === LOINC_SYSTEM));

  if (hasCode(LOINC.bpPanel) && Array.isArray(observation?.component)) {
    for (const comp of observation.component) {
      const compCoding = (comp?.code?.coding ?? []) as any[];
      const compHasCode = (code: string) =>
        compCoding.some((c) => c?.code === code && (!c?.system || c?.system === LOINC_SYSTEM));
      if (compHasCode(LOINC.sbp)) {
        pushPoint(trends.sbp, observation, (comp as any)?.valueQuantity?.value as number | undefined);
      }
    }
    return;
  }

  if (hasCode(LOINC.hr)) {
    pushPoint(trends.hr, observation, observation?.valueQuantity?.value as number | undefined);
  } else if (hasCode(LOINC.sbp)) {
    pushPoint(trends.sbp, observation, observation?.valueQuantity?.value as number | undefined);
  } else if (hasCode(LOINC.rr)) {
    pushPoint(trends.rr, observation, observation?.valueQuantity?.value as number | undefined);
  } else if (hasCode(LOINC.spo2)) {
    pushPoint(trends.spo2, observation, observation?.valueQuantity?.value as number | undefined);
  } else if (hasCode(LOINC.temp)) {
    pushPoint(trends.temp, observation, observation?.valueQuantity?.value as number | undefined);
  }
};

export interface FetchVitalTrendsOptions {
  hoursBack?: number; // por defecto 24 o 48
  maxPointsPerSeries?: number; // por defecto 20–30
}

export async function fetchVitalTrends(
  patientId: string,
  options: FetchVitalTrendsOptions = {},
): Promise<VitalTrendsData> {
  const hoursBack = options.hoursBack ?? 24;
  const maxPointsPerSeries = options.maxPointsPerSeries ?? 24;
  const sinceIso = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();
  const count = Math.max(20, maxPointsPerSeries * 5);

  const basePath =
    `/Observation?category=vital-signs&patient=${encodeURIComponent(patientId)}` +
    `&date=ge${encodeURIComponent(sinceIso)}&_sort=date&_count=${count}`;

  const fallback = (error?: unknown) => {
    if (__DEV__) {
      return buildMockVitalTrendsData();
    }
    if (error) {
      console.warn('[fhir] fetchVitalTrends fallback', error);
    }
    return createEmptyVitalTrends();
  };

  try {
    const { ok, data } = await fetchFHIR(basePath);
    if (!ok || !data) {
      return fallback(!ok ? new Error('fetchVitalTrends response not ok') : undefined);
    }

    const observations = Array.isArray(data?.entry)
      ? (data.entry as any[])
          .map((entry) => entry?.resource)
          .filter((res) => res?.resourceType === 'Observation')
      : [];

    if (!observations.length) {
      return fallback();
    }

    const trends = createEmptyVitalTrends();
    for (const obs of observations) {
      mapObservationToVitalTrends(obs, trends);
    }

    (Object.keys(trends) as Array<keyof VitalTrendsData>).forEach((key) => {
      trends[key] = trends[key]
        .slice()
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
        .slice(-maxPointsPerSeries);
    });

    const hasAnyData = Object.values(trends).some((series) => series.length > 0);
    if (!hasAnyData) {
      return fallback();
    }

    return trends;
  } catch (error) {
    return fallback(error);
  }
}

// Solo para desarrollo / demo – no usar en producción
// BEGIN HANDOVER D2 – VitalTrends mocks
function buildMockVitalTrendsData(): VitalTrendsData {
  const trends = createEmptyVitalTrends();
  const now = Date.now();
  const buildSeries = (base: number, variance: number) => {
    const points: VitalPoint[] = [];
    const totalPoints = 18;
    for (let i = totalPoints - 1; i >= 0; i -= 1) {
      const time = new Date(now - i * (3600 * 1000) / 2).toISOString();
      const drift = (Math.sin(i / 2) * variance) / 2;
      const value = Math.round(base + drift + (Math.random() - 0.5) * variance * 0.6);
      points.push({ time, value });
    }
    return points;
  };

  trends.hr = buildSeries(88, 8);
  trends.sbp = buildSeries(115, 12);
  trends.rr = buildSeries(18, 4);
  trends.spo2 = buildSeries(96, 2);
  trends.temp = buildSeries(37, 0.6);

  return trends;
}
// END HANDOVER D2 – VitalTrends mocks
// END HANDOVER D2 – VitalTrends fhir-client

/** Clase para compat con sync: permite new FhirClient(hooks) + idemKey → Response-like */
export class FhirClient {
  constructor(h?: AuthHooks) {
    if (h) configureFHIRClient(h);
  }

  async fetchFHIR(pathOrParams: any, opts?: any) {
    return (fetchFHIR as any)(pathOrParams, opts);
  }

  // Overloads: si segundo parámetro es string (idemKey) => Response-like
  async postBundle(bundle: any, idemKey: string): Promise<Response>;
  async postBundle(bundle: any, opts?: { token?: string; headers?: Record<string, string> }): Promise<any>;
  async postBundle(bundle: any, opts?: any): Promise<any> {
    if (typeof opts === 'string') {
      const result = await postBundle(bundle, opts);
      // Devuelve objeto con .text() para compat con sync
      const resp = {
        ok: !!result.ok,
        status: result.status ?? (result.ok ? 200 : 400),
        text: async () => JSON.stringify(result.body ?? {}),
        json: async () => result.body ?? {},
      } as unknown as Response;
      return resp;
    }
    return postBundle(bundle, opts);
  }
}
