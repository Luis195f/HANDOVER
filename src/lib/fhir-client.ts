// src/lib/fhir-client.ts
import { HTTPError, fetchWithRetry } from './net';
import { getValidationErrorsFromBundle, validateBundle as validateFhirBundle } from './fhir-validation';
import { formatIssuesForUser, isOperationOutcome, type OperationOutcome, type OperationIssue } from './fhir-outcome';
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
export type ResponseLike = {
  ok: boolean;
  status: number;
  issue?: OperationIssue[];
  issues?: OperationIssue[];
  body?: unknown;
};

type PostBundleSuccess = {
  ok: true;
  status: number;
  json?: unknown;
  location?: string;
  body?: unknown;
  issue?: OperationIssue[];
  issues?: OperationIssue[];
  message?: string;
  outcome?: OperationOutcome;
};
type PostBundleFailure = {
  ok: false;
  status: number;
  issues?: OperationIssue[];
  issue?: OperationIssue[];
  json?: unknown;
  body?: unknown;
  message?: string;
  location?: string;
  outcome?: OperationOutcome;
};
type PostBundleResult = PostBundleSuccess | PostBundleFailure;

type BundleEntryLike = {
  resource?: { resourceType?: string; id?: string; identifier?: unknown; [key: string]: unknown };
};
type BundleLike = { resourceType?: string; type?: string; entry?: BundleEntryLike[] };

const isBundleLike = (value: unknown): value is BundleLike =>
  typeof value === 'object' && value !== null;

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
    const bundle = ok && isBundleLike(data) && data.resourceType === 'Bundle' ? data : undefined;
    if (bundle && Array.isArray(bundle.entry)) {
      const locations = new Map<string, any>();
      for (const entry of bundle.entry) {
        const res = entry?.resource;
        if (res?.resourceType === 'Location' && res.id) {
          locations.set(`Location/${res.id}`, res);
        }
      }

      const encounterEntry = bundle.entry.find((entry: any) => entry?.resource?.resourceType === 'Encounter');
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
    const bundle = ok && isBundleLike(data) && data.resourceType === 'Bundle' ? data : undefined;
    if (bundle && Array.isArray(bundle.entry)) {
      allergies = bundle.entry
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

type ScopedFHIRClientConfig = {
  baseUrl?: string | (() => string | undefined);
  getToken?: () => Promise<string | null>;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
  logout?: () => Promise<void> | void;
};

export interface FhirClientConfig {
  baseUrl?: string;
  getToken?: () => Promise<string | null>;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
}

export interface FhirOperationOptions {
  token?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  idempotencyKey?: string;
  timeoutMs?: number;
}

let hooks: AuthHooks = {};
let clientConfig: FhirClientConfig = {};

/** Permite inyectar hooks desde Auth u otros módulos (token/baseURL/logout). */
export function configureFHIRClient(h: AuthHooks & FhirClientConfig) {
  const mapped: AuthHooks = { ...h };
  if (mapped.baseUrl && !mapped.getBaseUrl) {
    const fixed = mapped.baseUrl.replace(/\/$/, '');
    mapped.getBaseUrl = () => fixed;
  }
  hooks = { ...hooks, ...mapped };
  clientConfig = { ...clientConfig, ...h };
}

function getBaseUrl(): string {
  const fromHook = hooks.getBaseUrl?.();
  const fromConfig = clientConfig.baseUrl;
  return resolveBaseUrl(fromHook ?? fromConfig);
}

const resolveBaseUrl = (baseUrl?: string | undefined): string => {
  const fromEnv =
    ((process.env as any)?.FHIR_BASE_URL as string | undefined) ||
    ((process.env as any)?.EXPO_PUBLIC_FHIR_BASE_URL as string | undefined);
  const resolved = baseUrl || fromEnv || 'https://example.invalid/fhir';
  return resolved.replace(/\/$/, '');
};

export type FetchFHIRParams<TBody = unknown> = {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: TBody;
} & FhirOperationOptions;

const parseResponseJson = async <T>(response?: Response): Promise<T | undefined> => {
  if (!response) return undefined;
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const looksJson = contentType.includes('json') || contentType.includes('+fhir');
  try {
    return (await response.clone().json()) as T;
  } catch {
    if (!looksJson) {
      return undefined;
    }
  }
  try {
    const text = await response.clone().text();
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
};

type NormalizedOutcome = {
  issues: OperationIssue[];
  userMessage: string;
  fatal: boolean;
  outcome: OperationOutcome;
};

const normalizeOutcome = (maybeOutcome: unknown): NormalizedOutcome | null => {
  if (!maybeOutcome || typeof maybeOutcome !== 'object') return null;
  const outcomeIssues = isOperationOutcome(maybeOutcome)
    ? maybeOutcome.issue
    : Array.isArray((maybeOutcome as { issue?: unknown }).issue)
      ? (maybeOutcome as { issue?: unknown }).issue
      : undefined;
  if (!Array.isArray(outcomeIssues) || outcomeIssues.length === 0) return null;
  const formatted = formatIssuesForUser(outcomeIssues);
  const fatal = outcomeIssues.some((issue) => issue?.severity === 'fatal' || issue?.severity === 'error');
  return {
    issues: outcomeIssues,
    userMessage: formatted.message,
    fatal,
    outcome: { resourceType: 'OperationOutcome', issue: outcomeIssues },
  };
};

const getAuthToken = async (): Promise<string | null> => {
  if (clientConfig.getToken) {
    const token = await clientConfig.getToken();
    if (token) return token;
  }
  return hooks.ensureFreshToken ? await hooks.ensureFreshToken() : null;
};

export type FhirResponse<T = unknown> = {
  ok: boolean;
  response: Response;
  data?: T;
  outcome?: OperationIssue[];
  status: number;
  message?: string;
};

type FhirClientRuntimeConfig = {
  getBaseUrl: () => string;
  getToken?: () => Promise<string | null>;
  logout?: () => Promise<void> | void;
  getDefaultHeaders?: () => Record<string, string> | undefined;
  getTimeout?: () => number | undefined;
};

// === Sobrecargas para que los tests puedan llamar fetchFHIR('/Patient', {...})
export async function fetchFHIR<TResource = unknown, TBody = unknown>(
  path: string,
  opts?: Omit<FetchFHIRParams<TBody>, 'path'>
): Promise<FhirResponse<TResource>>;
export async function fetchFHIR<TResource = unknown, TBody = unknown>(
  params: FetchFHIRParams<TBody>
): Promise<FhirResponse<TResource>>;

/** Client FHIR con inyección de Authorization + manejo de 401/403. */
export async function fetchFHIR<TResource = unknown, TBody = unknown>(
  arg1: string | FetchFHIRParams<TBody>,
  arg2?: Omit<FetchFHIRParams<TBody>, 'path'>
) {
  return fetchFHIRWithConfig(defaultClientConfig)(arg1 as any, arg2 as any);
}

const fetchFHIRWithConfig = (runtimeConfig: FhirClientRuntimeConfig) => {
  const fetcher = async <TResource = unknown, TBody = unknown>(
    arg1: string | FetchFHIRParams<TBody>,
    arg2?: Omit<FetchFHIRParams<TBody>, 'path'>
  ) => {
    const p: FetchFHIRParams<TBody> =
      typeof arg1 === 'string' ? { path: arg1, ...(arg2 || {}) } : arg1;

    const { path, method = 'GET', body, token, headers, signal, timeoutMs, idempotencyKey } = p;

    const authToken = token ?? (runtimeConfig.getToken ? await runtimeConfig.getToken() ?? undefined : undefined);

    const url = /^https?:\/\//i.test(path)
      ? path
      : `${runtimeConfig.getBaseUrl()}/${path.replace(/^\//, '')}`;

    const buildHeaders = (tokenOverride?: string): Record<string, string> => {
      const bearer = tokenOverride ?? authToken;
      const built = {
        Accept: 'application/fhir+json',
        ...(body ? { 'Content-Type': 'application/fhir+json' } : {}),
        ...(runtimeConfig.getDefaultHeaders?.() ?? {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...headers,
      };
      if (idempotencyKey && !('Idempotency-Key' in built)) {
        return { ...built, 'Idempotency-Key': idempotencyKey };
      }
      return built;
    };

    const fetchOnce = async (tokenOverride?: string) => {
      const response = await fetchWithRetry(
        url,
        {
          method,
          headers: buildHeaders(tokenOverride),
          body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
          signal,
          timeoutMs: timeoutMs ?? runtimeConfig.getTimeout?.(),
        },
        { signal, retryOn: [] },
      );
      const hasClone = typeof (response as Response).clone === 'function';
      let data: TResource | undefined = await parseResponseJson<TResource>(response);
      if (!hasClone && data === undefined && typeof (response as Response).text === 'function') {
        try {
          const text = await response.text();
          data = text ? (JSON.parse(text) as TResource) : undefined;
        } catch {
          data = undefined;
        }
      }
      if (!response.ok) {
        const HTTPErrorCtor: any = HTTPError;
        if (typeof HTTPErrorCtor === 'function') {
          throw new HTTPErrorCtor(response.status, response.statusText, false, response);
        }
        const fallbackError = new Error(response.statusText || `HTTP ${response.status}`);
        (fallbackError as HTTPError).status = response.status;
        (fallbackError as HTTPError).response = response;
        throw fallbackError;
      }
      return { raw: response, data, status: response.status };
    };

    const handleHttpError = async (httpError: HTTPError): Promise<FhirResponse<TResource>> => {
      const hasClone = typeof httpError.response?.clone === 'function';
      let data: TResource | undefined = await parseResponseJson<TResource>(httpError.response);
      if (!hasClone && data === undefined && typeof httpError.response?.text === 'function') {
        try {
          const text = await httpError.response.text();
          data = text ? (JSON.parse(text) as TResource) : undefined;
        } catch {
          data = undefined;
        }
      }
      const response =
        httpError.response ?? new Response('', { status: httpError.status ?? 0, statusText: httpError.message });
      const outcomeInfo = normalizeOutcome(data);
      const outcome = outcomeInfo?.issues ?? (isOperationOutcome(data) ? data.issue : undefined);
      return {
        ok: false,
        response,
        data,
        outcome,
        status: httpError.status ?? response.status ?? 0,
        message: outcomeInfo?.userMessage ?? (outcome ? formatIssuesForUser(outcome).message : httpError.message),
      };
    };

    const attempt = async (tokenOverride?: string, retried = false): Promise<FhirResponse<TResource>> => {
      try {
        const res = await fetchOnce(tokenOverride);
        return { ok: true, response: res.raw, data: res.data, status: res.status };
      } catch (error) {
        const HTTPErrorCtor: any = HTTPError;
        const maybeHttpError = error as HTTPError;
        const isHTTPError = typeof HTTPErrorCtor === 'function' && error instanceof HTTPErrorCtor;
        const isHttpErrorLike =
          !isHTTPError && typeof error === 'object' && error !== null && 'status' in error;
        if (isHTTPError || isHttpErrorLike) {
          if (maybeHttpError.status === 401 && !retried) {
            const freshToken = hooks.ensureFreshToken ? await hooks.ensureFreshToken() : null;
            if (freshToken) {
              try {
                return await attempt(freshToken, true);
              } catch (retryError) {
                const retryHTTPErrorCtor: any = HTTPError;
                const maybeRetryHttpError = retryError as HTTPError;
                const isRetryHTTPError =
                  typeof retryHTTPErrorCtor === 'function' && retryError instanceof retryHTTPErrorCtor;
                const isRetryHttpErrorLike =
                  !isRetryHTTPError && typeof retryError === 'object' && retryError !== null && 'status' in retryError;
                if ((isRetryHTTPError || isRetryHttpErrorLike) && maybeRetryHttpError.status === 401) {
                  if (runtimeConfig.logout) await runtimeConfig.logout();
                  throw new Error('unauthorized');
                }
                if (isRetryHTTPError || isRetryHttpErrorLike) {
                  return handleHttpError(maybeRetryHttpError);
                }
                throw retryError;
              }
            }
            if (runtimeConfig.logout) await runtimeConfig.logout();
            throw new Error('unauthorized');
          }

          if (maybeHttpError.status === 401 || maybeHttpError.status === 403) {
            if (runtimeConfig.logout) await runtimeConfig.logout();
            throw new Error('unauthorized');
          }

          return handleHttpError(maybeHttpError);
        }
        throw error;
      }
    };

    return attempt();
  };

  return fetcher as typeof fetchFHIR;
};

const defaultClientConfig: FhirClientRuntimeConfig = {
  getBaseUrl,
  getToken: getAuthToken,
  logout: () => hooks.logout?.(),
  getDefaultHeaders: () => clientConfig.defaultHeaders,
  getTimeout: () => clientConfig.timeoutMs,
};

export function createFHIRClient(config: ScopedFHIRClientConfig) {
  const scopedConfig: FhirClientRuntimeConfig = {
    getBaseUrl: () => resolveBaseUrl(typeof config.baseUrl === 'function' ? config.baseUrl() : config.baseUrl),
    getToken: config.getToken,
    logout: config.logout,
    getDefaultHeaders: () => config.defaultHeaders,
    getTimeout: () => config.timeoutMs,
  };

  return { fetchFHIR: fetchFHIRWithConfig(scopedConfig) };
}

/**
 * POST /Bundle con shape de respuesta compatible con OperationOutcome.
 * En caso de error, devuelve tanto `issues` como alias `issue` (para compat tests).
 * Acepta `opts` objeto o una *string* tratada como `Idempotency-Key` (compat sync).
 */
export async function postBundle(
  bundle: unknown,
  opts?: { token?: string; headers?: Record<string, string>; idempotencyKey?: string } | string
): Promise<PostBundleResult> {
  const embeddedErrors = getValidationErrorsFromBundle(bundle);
  if (embeddedErrors) {
    return {
      ok: false,
      status: 400,
      issues: embeddedErrors.map((err) => ({
        severity: 'error',
        code: 'invalid',
        diagnostics: `${err.path}: ${err.message}`,
      })),
      issue: embeddedErrors.map((err) => ({
        severity: 'error',
        code: 'invalid',
        diagnostics: `${err.path}: ${err.message}`,
      })),
      body: {
        error: 'FHIR bundle failed validation',
        details: embeddedErrors,
      },
    } as const;
  }

  const shouldRunStrictValidation = process.env.EXPO_PUBLIC_STRICT_FHIR_VALIDATION === 'true';
  const bundleObj = (bundle ?? {}) as { resourceType?: string; type?: string; entry?: unknown };
  const structuralErrors: Array<{ path: string; message: string }> = [];
  if (shouldRunStrictValidation) {
    if (bundleObj.resourceType !== 'Bundle') {
      structuralErrors.push({ path: 'resourceType', message: 'Bundle.resourceType must be "Bundle"' });
    }
    if (bundleObj.type !== 'transaction') {
      structuralErrors.push({ path: 'type', message: 'Bundle.type must be "transaction"' });
    }
    if (!Array.isArray(bundleObj.entry) || bundleObj.entry.length === 0) {
      structuralErrors.push({ path: 'entry', message: 'Bundle.entry is required' });
    }
  }

  const embeddedErrors = getValidationErrorsFromBundle(bundle);
  const shouldRunStrictValidation = process.env.EXPO_PUBLIC_STRICT_FHIR_VALIDATION === 'true';
  const validation = shouldRunStrictValidation ? validateFhirBundle(bundle) : { isValid: true, errors: [] };
  const strictErrors: Array<{ path: string; message: string }> = [];
  if (shouldRunStrictValidation && Array.isArray(bundleObj.entry)) {
    bundleObj.entry.forEach((entry, index) => {
      const request = (entry as { request?: { method?: unknown; url?: unknown } } | undefined)?.request;
      if (typeof request?.method !== 'string' || typeof request?.url !== 'string') {
        strictErrors.push({
          path: `entry[${index}].request`,
          message: 'Bundle.entry.request.method and url are required for transaction entries',
        });
      }
    });
  }

  const errors = [
    ...(embeddedErrors ?? []),
    ...structuralErrors,
    ...(validation.isValid ? [] : validation.errors),
    ...strictErrors,
  ];
  if (errors.length > 0) {
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

  const tokenFromOpts = typeof opts === 'string' ? undefined : opts?.token;
  const headersFromOpts = typeof opts === 'string' ? { 'Idempotency-Key': opts } : opts?.headers;
  const idempotencyKey = typeof opts === 'string' ? opts : opts?.idempotencyKey;

  const authHeaderValue = headersFromOpts?.Authorization ?? headersFromOpts?.authorization;
  const hasAuthHeader = typeof authHeaderValue === 'string' && authHeaderValue.trim().length > 0;

  const token = hasAuthHeader ? '' : tokenFromOpts ?? (await getAuthToken() ?? undefined);
  if (!token && !hasAuthHeader) {
    return {
      ok: false,
      status: 401,
      issues: [{ severity: 'error', code: 'login', diagnostics: 'OAuth token is required' }],
      issue: [{ severity: 'error', code: 'login', diagnostics: 'OAuth token is required' }],
      json: { error: 'OAuth token is required' },
      body: { error: 'OAuth token is required' },
    };
  }

  try {
    const result = await fetchFHIR<OperationOutcome | Record<string, unknown>, typeof bundle>({
      path: '/Bundle',
      method: 'POST',
      body: bundle,
      token: hasAuthHeader ? '' : token,
      headers: headersFromOpts,
      idempotencyKey,
    });

    const location =
      result.response.headers.get('location') ?? result.response.headers.get('content-location') ?? undefined;

    if (!result.ok) {
      const json = result.data as OperationOutcome | Record<string, unknown> | undefined;
      const outcomeInfo = normalizeOutcome(json);
      const issues = outcomeInfo?.issues ?? result.outcome ?? (isOperationOutcome(json) ? json.issue : undefined);
      const formatted =
        outcomeInfo ??
        (issues
          ? {
              userMessage: formatIssuesForUser(issues).message,
              fatal: false,
              issues,
              outcome: { resourceType: 'OperationOutcome', issue: issues },
            }
          : undefined);
      return {
        ok: false,
        status: result.status,
        issues: issues ?? undefined,
        issue: issues ?? undefined,
        json,
        location,
        message: formatted?.userMessage ?? result.message,
        outcome: formatted?.outcome ?? (issues ? { resourceType: 'OperationOutcome', issue: issues } : undefined),
      };
    }

    return { ok: true, status: result.response.status, json: result.data, location };
  } catch (error: any) {
    const isUnauthorized = String(error?.message ?? error).toLowerCase().includes('unauthorized');
    const code = isUnauthorized ? 'login' : 'invalid';
    return {
      ok: false,
      status: isUnauthorized ? 401 : 400,
      issues: [{ severity: 'error', code, diagnostics: String(error?.message ?? error) }],
      issue: [{ severity: 'error', code, diagnostics: String(error?.message ?? error) }],
      json: { error: String(error?.message ?? error) },
      body: { error: String(error?.message ?? error) },
    };
  }
}

/** === Compat con código existente === */
export const postBundleSmart = postBundle;
const postBundleFn = postBundle;

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

    const bundle = isBundleLike(data) && data.resourceType === 'Bundle' ? data : undefined;
    const observations = Array.isArray(bundle?.entry)
      ? bundle.entry
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
      const result: PostBundleResult = await postBundleFn(bundle, opts);
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
