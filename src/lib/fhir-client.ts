/* src/lib/fhir-client.ts
 * ------------------------------------------------------------
 * LECTURA desde FHIR (Patient/Encounter/Location) + PREFILL
 *  - fetchPatientsFromFHIR, getPatientsByUnit, getPatientsBySpecialty
 *  - Helpers: fhirUrl, fhirGet, parseName, parseBed, unitIdFromDisplay, patIdFromRef
 *
 * ENVÍO a FHIR (Bundles) con timeout + Idempotency-Key
 *  - class FhirClient (postBundle)
 *  - postBundleSmart (POST inteligente con fallback + defaultHeaders)
 *  - createFhirClient / postTransactionBundle (compat)
 *
 * NOTA: Fusión idempotente. Mantiene API previa y añade postBundleSmart requerido por queueBootstrap.
 * ------------------------------------------------------------
 */

import { FHIR_BASE_URL } from '@/src/config/env';
import { ensureFreshToken, logout } from '@/src/lib/auth';
import { prefillFromFHIR } from "./prefill";
import { safeFetch, HTTPError } from './net';

async function readJsonFromResponse(response: any): Promise<unknown> {
  if (!response) return undefined;

  const parseText = async (source: any) => {
    if (typeof source?.text !== 'function') return undefined;
    try {
      const text = await source.text();
      if (!text) return undefined;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch {
      return undefined;
    }
  };

  if (typeof response.clone === 'function') {
    const clone = response.clone();
    if (typeof clone.json === 'function') {
      try {
        return await clone.json();
      } catch {
        // fallthrough to text parsing
      }
    }
    const fromText = await parseText(clone);
    if (fromText !== undefined) {
      return fromText;
    }
  }

  if (typeof response.json === 'function') {
    try {
      return await response.json();
    } catch {
      // continue to text parsing
    }
  }

  return await parseText(response);
}

export type OperationIssue = {
  severity?: string;
  code?: string;
  diagnostics?: string;
  details?: { text?: string };
};

export type ResponseLike = {
  ok: boolean;
  status: number;
  json?: unknown;
  issue?: OperationIssue[];
  location?: string;
};

export type Bundle = {
  resourceType: 'Bundle';
  type?: string;
  entry?: Array<{
    fullUrl?: string;
    resource?: { [key: string]: unknown };
  }>;
};

function ensureBundle(bundle: Bundle): string {
  if (!bundle || bundle.resourceType !== 'Bundle') {
    throw new Error('Expected FHIR Bundle');
  }
  return JSON.stringify(bundle);
}

function readOperationOutcome(payload: unknown): OperationIssue[] | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const maybeIssue = (payload as { issue?: unknown }).issue;
  if (!Array.isArray(maybeIssue)) return undefined;
  return maybeIssue.filter((issue) => !!issue && typeof issue === 'object') as OperationIssue[];
}

async function resolveAccessToken(provided?: string): Promise<string> {
  if (provided && provided.trim()) {
    return provided;
  }
  return ensureFreshToken();
}

export type PostBundleOptions = { token?: string };

export async function postBundle(bundle: Bundle, { token }: PostBundleOptions = {}): Promise<ResponseLike> {
  const resolvedToken = await resolveAccessToken(token);
  if (!resolvedToken) {
    throw new Error('OAuth token is required');
  }

  const serialized = ensureBundle(bundle);
  const response = await fetch(FHIR_BASE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resolvedToken}`,
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json',
    },
    body: serialized,
  });

    const location = response.headers?.get?.('location') ?? undefined;
    const body = await readJsonFromResponse(response);

    return {
      ok: true,
      status: response.status,
      json: body,
      location,
    };
  } catch (error) {
    if (error instanceof HTTPError) {
      const response = error.response;
      const location = response.headers?.get?.('location') ?? undefined;
      let parsed: unknown;
      const payloadBody = error.payload?.body;
      if (typeof payloadBody === 'string' && payloadBody.length > 0) {
        try {
          parsed = JSON.parse(payloadBody);
        } catch {
          parsed = payloadBody;
        }
      } else {
        parsed = await readJsonFromResponse(response);
      }

      return {
        ok: false,
        status: response.status,
        json: parsed,
        issue: readOperationOutcome(parsed),
        location,
      };
    }
    throw error;
  }
}

/** ===== Tipos mínimos FHIR (lectura) ===== */
export type PatientBasic = {
  id: string;
  name?: string;
  location?: string;
  bed?: string;
  specialtyId?: string;
  unitId?: string;
  vitals?: Record<string, any>;
};

export type FetchOpts = {
  fhirBase: string;
  token?: string;
  fetchImpl?: typeof fetch; // para tests
  includeVitals?: boolean;  // si true, intenta prefill de vitals por paciente
  /** filtros server-side opcionales (no todos los servidores los soportan) */
  status?: "in-progress" | "finished" | string;
  count?: number; // default 50, [1..200]
};

type Coding = { system?: string; code?: string; display?: string };
type CodeableConcept = { coding?: Coding[]; text?: string };
type HumanName = { given?: string[]; family?: string; text?: string };
type Ref = { reference?: string; display?: string };

type Encounter = {
  resourceType: "Encounter";
  id: string;
  subject?: Ref;
  location?: { location?: Ref }[];
  serviceProvider?: Ref;
  serviceType?: CodeableConcept[];
  class?: { code?: string };
};

type Patient = {
  resourceType: "Patient";
  id: string;
  name?: HumanName[];
};

type Location = {
  resourceType: "Location";
  id: string;
  name?: string;
  description?: string;
};

/** ===== Helpers HTTP básicos ===== */
function fhirUrl(base: string, path: string) {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

async function fhirGet(
  base: string,
  path: string,
  token?: string,
  fetchImpl?: typeof fetch
) {
  const f = fetchImpl ?? fetch;
  const res = await f(fhirUrl(base, path), {
    headers: {
      Accept: "application/fhir+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`FHIR GET ${path} -> ${res.status}`);
  return res.json();
}

export type FetchFHIRInit = RequestInit & {
  token?: string;
  fetchImpl?: typeof fetch;
};

export async function fetchFHIR(path: string, init: FetchFHIRInit = {}): Promise<Response> {
  const { fetchImpl, token: providedToken, headers, ...rest } = init;
  const token = await resolveAccessToken(providedToken);
  const mergedHeaders = new Headers(headers ?? {});
  if (!mergedHeaders.has('Accept')) {
    mergedHeaders.set('Accept', 'application/fhir+json');
  }
  mergedHeaders.set('Authorization', `Bearer ${token}`);
  const fetchFn = fetchImpl ?? fetch;
  const requestInit: RequestInit = {
    ...rest,
    headers: mergedHeaders,
  };
  const response = await fetchFn(fhirUrl(FHIR_BASE_URL, path), requestInit);
  if (response.status === 401 || response.status === 403) {
    await logout();
    throw new Error(`FHIR request unauthorized (${response.status})`);
  }
  return response;
}

/** ===== Helpers de parsing ===== */
function parseName(p?: Patient): string | undefined {
  const n = p?.name?.[0];
  if (!n) return;
  if (n.text) return String(n.text);
  const given = (n.given ?? []).join(" ");
  const family = n.family ?? "";
  const full = [given, family].filter(Boolean).join(" ").trim();
  return full || undefined;
}

/** Intenta extraer "Cama XX" de un display libre. Best effort. */
function parseBed(display?: string): string | undefined {
  if (!display) return;
  const m = display.match(/(Cama|Bed)\s*[A-Za-z0-9\-]+/i);
  return m?.[0];
}

/**
 * Normaliza nombre de unidad a id, limpiando:
 *  - "Cama X"
 *  - lo posterior a separadores (· • | , ; :)
 *  - tildes/espacios/caracteres especiales
 *  - sufijo numérico final ("-3", "-12", etc.)
 */
function unitIdFromDisplay(display?: string): string | undefined {
  if (!display) return;
  let base = display.trim();

  // 1) quita "Cama X"
  const bedMatch = base.match(/(Cama|Bed)\s*[A-Za-z0-9\-]+/i);
  if (bedMatch) base = base.replace(bedMatch[0], "").trim();

  // 2) corta en separadores típicos de UIs
  const seps = ["·", "•", "|", ",", "; ", ":", ";"];
  const idxs = seps.map((s) => base.indexOf(s)).filter((i) => i >= 0);
  if (idxs.length) base = base.slice(0, Math.min(...idxs)).trim();

  // 3) normaliza (minúsculas, sin tildes, no alfanumérico → '-')
  base = base
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // 4) quita sufijo numérico típico (p.ej. "uci-cardio-3" → "uci-cardio")
  base = base.replace(/-\d+$/, "");

  return base || undefined;
}

function patIdFromRef(ref?: string): string | undefined {
  if (!ref) return;
  const m = ref.match(/Patient\/([^/]+)/i);
  return m?.[1];
}

/** ===== Lectura principal: Encounter + Patient + Location (con opción prefill vitals) ===== */
export async function fetchPatientsFromFHIR(opts: FetchOpts): Promise<PatientBasic[]> {
  const fhirBase = opts.fhirBase;
  const token = opts.token;
  const fetchImpl = opts.fetchImpl;

  const includeVitals = !!opts.includeVitals;
  const status = (opts.status ?? "in-progress") as string;
  const count = Math.max(1, Math.min(200, opts.count ?? 50));

  // Query principal: Encounter en curso con includes
  const encPath =
    `/Encounter?status=${encodeURIComponent(status)}` +
    `&_sort=-date&_count=${count}` +
    `&_include=Encounter:subject&_include=Encounter:location`;

  const bundle = await fhirGet(fhirBase, encPath, token, fetchImpl);
  const entries: any[] = Array.isArray(bundle?.entry) ? bundle.entry : [];

  const patientsMap = new Map<string, Patient>();
  const locationsMap = new Map<string, Location>();
  const encounters: Encounter[] = [];

  for (const e of entries) {
    const r = e?.resource;
    if (!r) continue;
    if (r.resourceType === "Encounter") encounters.push(r as Encounter);
    else if (r.resourceType === "Patient") patientsMap.set(r.id, r as Patient);
    else if (r.resourceType === "Location") locationsMap.set(r.id, r as Location);
  }

  // Armado de filas por Encounter (de-duplicando por patientId)
  const rowsByPatient = new Map<string, PatientBasic>();

  for (const enc of encounters) {
    const patientId = patIdFromRef(enc.subject?.reference);
    if (!patientId) continue;

    // Display de ubicación preferente
    const locRef = enc.location?.[0]?.location?.reference;
    let locDisplay =
      enc.location?.[0]?.location?.display ||
      enc.serviceProvider?.display ||
      enc.serviceType?.[0]?.coding?.[0]?.display;

    if (!locDisplay && locRef) {
      const locId = locRef.split("/")[1];
      if (!locId) throw new Error("Missing location id");
      const loc = locationsMap.get(locId);
      locDisplay = loc?.name || loc?.description;
    }

    const pat = patientsMap.get(patientId);
    const name = parseName(pat);

    const unitId = unitIdFromDisplay(locDisplay);
    const bed = parseBed(locDisplay);

    const specialtyId =
      enc?.serviceType?.[0]?.coding?.[0]?.code?.toLowerCase() ||
      enc?.class?.code?.toLowerCase();

    if (!rowsByPatient.has(patientId)) {
      rowsByPatient.set(patientId, {
        id: patientId,
        name,
        location: locDisplay,
        bed,
        specialtyId,
        unitId,
      });
    }
  }

  let rows = Array.from(rowsByPatient.values());

  if (includeVitals && rows.length > 0) {
    // Obtén vitals con prefill (paralelo, tolerante a fallos).
    rows = await Promise.all(
      rows.map(async (row) => {
        try {
          const pf = await prefillFromFHIR(row.id, { fhirBase, token, fetchImpl });
          if (pf && pf.vitals) {
            return { ...row, vitals: pf.vitals as Record<string, any> };
          }
        } catch {
          // noop (no romper UI si falla prefill)
        }
        return row;
      })
    );
  }

  return rows;
}

/** Conveniencia: filtros client-side si el servidor no soporta */
export async function getPatientsByUnit(
  unitId: string,
  opts?: Omit<FetchOpts, "status" | "count">
) {
  const rows = await fetchPatientsFromFHIR({ ...(opts ?? ({} as any)) });
  return rows.filter((r) => r.unitId === unitId);
}

export async function getPatientsBySpecialty(
  specialtyId: string,
  opts?: Omit<FetchOpts, "status" | "count">
) {
  const rows = await fetchPatientsFromFHIR({ ...(opts ?? ({} as any)) });
  return rows.filter(
    (r) => (r.specialtyId ?? "").toLowerCase() === specialtyId.toLowerCase()
  );
}

/* ======================================================================== */
/* =========================  CLIENTE DE ENVÍO  =========================== */
/* ======================================================================== */
/**
 * Cliente FHIR con Authorization + Idempotency-Key y timeouts.
 * - Idempotency-Key opcional: si no se provee, se calcula con FNV-1a sobre un JSON estable.
 * - Timeout con AbortController (si existe) o fallback por Promise.race.
 * - fetchImpl opcional para pruebas.
 */

export type GetToken = () => Promise<string | null>;

export type FhirClientOptions = {
  baseUrl: string;                // e.g., "https://hce.example/fhir"
  getToken?: GetToken;            // función que obtiene el token (OAuth/SSO)
  timeoutMs?: number;             // p.ej. 15000
  fetchImpl?: typeof fetch;       // inyectable en tests
  preferReturnMinimal?: boolean;  // añade Prefer: return=minimal si true
  defaultHeaders?: Record<string, string>; // cabeceras extra por defecto
};

export class FhirClient {
  constructor(private opts: FhirClientOptions) {}

  private async fetchWithTimeout(input: RequestInfo, init?: RequestInit) {
    const f = this.opts.fetchImpl ?? fetch;
    const timeout = this.opts.timeoutMs ?? 15000;

    // Si AbortController existe, úsalo; si no, fallback a Promise.race
    const AC: any = (globalThis as any).AbortController;
    if (AC) {
      const controller = new AC();
      const t = setTimeout(() => controller.abort(), timeout);
      try {
        const resp = await f(input, { ...(init || {}), signal: (controller as AbortController).signal });
        return resp;
      } finally {
        clearTimeout(t);
      }
    } else {
      // Fallback
      const timer = new Promise<Response>((_, rej) =>
        setTimeout(() => rej(new Error("Timeout")), timeout)
      );
      return Promise.race([f(input, init), timer]) as Promise<Response>;
    }
  }

  /**
   * POST de un FHIR Bundle (batch/transaction). Si no pasas idempotencyKey,
   * se calcula automáticamente con JSON estable + FNV-1a (hex).
   * Usa endpoint /Bundle por compatibilidad amplia.
   */
  async postBundle(bundle: any, idempotencyKey?: string): Promise<Response> {
    const token = await this.opts.getToken?.();
    const headers: Record<string, string> = {
      "Content-Type": "application/fhir+json",
      Accept: "application/fhir+json",
      ...(this.opts.defaultHeaders ?? {}),
    };
    if (this.opts.preferReturnMinimal) headers["Prefer"] = "return=minimal";

    const key = idempotencyKey ?? fnv1aHex(stableStringify(bundle));
    if (key) headers["Idempotency-Key"] = key;

    if (token) headers["Authorization"] = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

    // Compat amplia: {base}/Bundle
    const url = `${this.opts.baseUrl.replace(/\/+$/, "")}/Bundle`;

    return this.fetchWithTimeout(url, {
      method: "POST",
      headers,
      body: JSON.stringify(bundle),
    });
  }
}

/** ===== Utilidades ligeras para Idempotency-Key (sin deps) ===== */
function stableStringify(obj: unknown): string {
  return JSON.stringify(sortObj(obj));
}
function sortObj<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortObj) as any;
  return Object.keys(obj as any)
    .sort()
    .reduce((acc: any, k) => {
      acc[k] = sortObj((obj as any)[k]);
      return acc;
    }, {});
}
// FNV-1a 32-bit (hex)
function fnv1aHex(str: string): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

/* ======================================================================== */
/* =====================  postBundleSmart + helpers  ====================== */
/* ======================================================================== */

type PostBundleParams = {
  fhirBase: string;                      // base del servidor FHIR
  bundle: any;                           // Bundle R4 (transaction o batch)
  token?: string;
  fetchImpl?: typeof fetch;
  defaultHeaders?: Record<string, string>;
};

/** Normaliza la base FHIR asegurando barra final */
function normalizeBaseUrl(u: string): string {
  if (!u) throw new Error("fhirBase no especificado.");
  return u.endsWith("/") ? u : `${u}/`;
}

/** Construye headers finales (Content-Type + Accept + token + defaultHeaders) */
function buildHeaders(
  token?: string,
  defaultHeaders?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/fhir+json",
    Accept: "application/fhir+json",
    ...(defaultHeaders ?? {}),
  };
  if (token) headers.Authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  return headers;
}

/**
 * Envía un Bundle con estrategia inteligente:
 * 1) Intenta POST a `${fhirBase}` (transacción FHIR estándar).
 * 2) Si el server responde 404/405/501, reintenta en `${fhirBase}/Bundle`.
 * Lanza si la respuesta NO es ok (>=200 && <300).
 */
export async function postBundleSmart(params: PostBundleParams): Promise<Response> {
  const { fhirBase, bundle, token, fetchImpl, defaultHeaders } = params;
  const doFetch = fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!doFetch) throw new Error("No hay 'fetch' disponible. Inyecta fetchImpl en postBundleSmart().");

  const base = normalizeBaseUrl(fhirBase);
  const headers = buildHeaders(token, defaultHeaders);

  const requestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify(bundle),
    fetchImpl: doFetch,
  } as const;

  try {
    return await safeFetch(base, requestInit);
  } catch (error) {
    if (error instanceof HTTPError) {
      const status = error.payload.status ?? error.response.status;
      if ([404, 405, 501].includes(status)) {
        try {
          return await safeFetch(`${base}Bundle`, requestInit);
        } catch (fallbackError) {
          if (fallbackError instanceof HTTPError) {
            fallbackError.message = `[FHIR] POST Bundle fallback failed (${fallbackError.payload.status ?? fallbackError.response.status})`;
          }
          throw fallbackError;
        }
      }
      error.message = `[FHIR] POST Bundle failed (${status})`;
    }
    throw error;
  }
}

/* ======================================================================== */
/* ==============  Compat: factories y wrappers de conveniencia  ========== */
/* ======================================================================== */

/** Cliente simple de conveniencia (usa postBundleSmart internamente) */
export function createFhirClient(opts: {
  fhirBase: string;
  token?: string;
  fetchImpl?: typeof fetch;
  defaultHeaders?: Record<string, string>;
}) {
  const base = normalizeBaseUrl(opts.fhirBase);
  const doFetch = opts.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!doFetch) throw new Error("No hay 'fetch' disponible. Inyecta fetchImpl en createFhirClient().");

  const headers = buildHeaders(opts.token, opts.defaultHeaders);

  return {
    /** POST genérico a FHIR (ruta relativa o absoluta) */
    async post(pathOrUrl: string, body: unknown, extraHeaders?: Record<string, string>) {
      const url = pathOrUrl.includes("://") ? pathOrUrl : `${base}${pathOrUrl.replace(/^\/+/, "")}`;
      const res = await doFetch(url, {
        method: "POST",
        headers: { ...headers, ...(extraHeaders ?? {}) },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`[FHIR] POST ${url} → ${res.status} ${res.statusText}`);
      return res;
    },

    /** GET genérico a FHIR (útil para tests o prefill) */
    async get(pathOrUrl: string, extraHeaders?: Record<string, string>) {
      const url = pathOrUrl.includes("://") ? pathOrUrl : `${base}${pathOrUrl.replace(/^\/+/, "")}`;
      const res = await doFetch(url, {
        method: "GET",
        headers: { ...headers, ...(extraHeaders ?? {}) },
      });
      if (!res.ok) throw new Error(`[FHIR] GET ${url} → ${res.status} ${res.statusText}`);
      return res;
    },

    /** Helper específico: envía Bundle transaccional/batch con fallback */
    async postBundle(bundle: any) {
      return postBundleSmart({
        fhirBase: base,
        bundle,
        token: opts.token,
        fetchImpl: doFetch,
        defaultHeaders: opts.defaultHeaders,
      });
    },
  };
}

/** Wrapper de compatibilidad (firma usada en algunas capas legacy) */
export type PostTransactionParams = {
  fhirBase: string;
  bundle: any;
  token?: string;
  headers?: Record<string, string>;
  idempotencyKey?: string; // aceptado pero no usado aquí (lo maneja FhirClient si lo prefieres)
  timeoutMs?: number;      // aceptado para compat (no usado por postBundleSmart)
};

export async function postTransactionBundle({
  fhirBase,
  bundle,
  token,
  headers,
}: PostTransactionParams): Promise<Response> {
  return postBundleSmart({
    fhirBase,
    bundle,
    token,
    defaultHeaders: headers,
  });
}

/** Fábrica que devuelve un FhirClient con tus opciones */
export function createFhirClientFor({
  fhirBase,
  token,
  headers,
  timeoutMs,
}: Omit<PostTransactionParams, "bundle" | "idempotencyKey">): FhirClient {
  return new FhirClient({
    baseUrl: fhirBase,
    getToken: token ? async () => token : undefined,
    defaultHeaders: headers,
    timeoutMs,
  });
}

