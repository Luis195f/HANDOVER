/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/fhir-client.ts
import { authService } from './auth/AuthService';
import { fetchWithRetry } from './net';
import { logger } from './logger';

type AuthHooks = {
  ensureFreshToken?: () => Promise<string | null>;
  logout?: () => Promise<void> | void;
  getBaseUrl?: () => string | undefined;
  /** Compat: algunos callers pasan baseUrl directo */
  baseUrl?: string;
};

let hooks: AuthHooks = {
  ensureFreshToken: async () => authService.getAccessToken(),
  logout: async () => authService.logout(),
};

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
  const fromEnv =
    process.env.EXPO_PUBLIC_FHIR_BASE_URL ?? ((process.env as any)?.FHIR_BASE_URL as string | undefined);
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
  if (!authToken) {
    logger.warn('FHIR client: blocked request without access token', { path });
    throw new Error('NOT_AUTHENTICATED');
  }

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
        Authorization: `Bearer ${authToken}`,
        ...headers,
      },
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      signal,
    }
  );

  // Comportamiento esperado por los tests
  if (res.status === 401 || res.status === 403) {
    logger.warn('FHIR client: received unauthorized response', { path, status: res.status });
    // Futuro: aquí podríamos intentar refrescar el token antes de forzar logout.
    try {
      await hooks.logout?.();
    } catch (logoutError) {
      logger.error('FHIR client: failed to logout after unauthorized response', {
        path,
        status: res.status,
        error: logoutError instanceof Error ? logoutError.message : String(logoutError),
      });
    }
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
    const normalizedMessage = String(error?.message ?? error).toLowerCase();
    const isUnauthorized =
      normalizedMessage.includes('unauthorized') || normalizedMessage.includes('not_authenticated');
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
