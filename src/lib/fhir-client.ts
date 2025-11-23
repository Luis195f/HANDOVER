/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/fhir-client.ts
import { fetchWithRetry } from './net';
import type { GeneratedPdf } from './export/export-pdf';
// BEGIN HANDOVER D2 – VitalTrends fhir-client
import { LOINC, TERMINOLOGY_SYSTEMS } from './codes';
import type { VitalPoint, VitalTrendsData } from '../../types/vitals';
// END HANDOVER D2 – VitalTrends fhir-client

type AuthHooks = {
  ensureFreshToken?: () => Promise<string | null>;
  logout?: () => void;
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
    hooks.logout?.();
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
