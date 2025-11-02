/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/fhir-client.ts
import { fetchWithRetry } from './net';

type AuthHooks = {
  ensureFreshToken?: () => Promise<string | null>;
  logout?: () => void;
  getBaseUrl?: () => string | undefined;
};

let hooks: AuthHooks = {};

export function configureFHIRClient(h: AuthHooks) {
  hooks = { ...hooks, ...h };
}

function getBaseUrl(): string {
  // 1) hook, 2) env, 3) fallback
  const fromHook = hooks.getBaseUrl?.();
  const fromEnv = (process.env as any)?.FHIR_BASE_URL as string | undefined;
  return (fromHook || fromEnv || 'https://example.invalid/fhir').replace(/\/$/, '');
}

export type FetchFHIRParams = {
  path: string; // '/Observation' | 'http...'
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  token?: string; // fuerza token custom
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export async function fetchFHIR(params: FetchFHIRParams) {
  const { path, method = 'GET', body, token, headers, signal } = params;

  // token preferente -> si no, pedimos uno fresco
  const authToken = token ?? (await hooks.ensureFreshToken?.() ?? undefined);

  const url = /^https?:\/\//i.test(path)
    ? path
    : `${getBaseUrl()}/${path.replace(/^\//, '')}`;

  try {
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
      },
      { retries: 2 }
    );

    if (res.status === 401 || res.status === 403) {
      // Los tests esperan logout en 401/403
      hooks.logout?.();
    }

    const text = await res.text();
    let json: any = undefined;
    try { json = text ? JSON.parse(text) : undefined; } catch { /* noop */ }

    return { ok: res.ok, response: res, data: json };
  } catch (error) {
    // Propaga pero con shape consistente para tests
    return { ok: false, response: undefined, data: { error: String(error) } };
  }
}

export async function postBundle(
  bundle: any,
  opts?: { token?: string; headers?: Record<string, string> }
) {
  const r = await fetchFHIR({
    path: '/Bundle',
    method: 'POST',
    body: bundle,
    token: opts?.token,
    headers: { ...opts?.headers },
  });

  if (!r.ok) {
    // Los tests esperan issues (OperationOutcome-like)
    const status = r.response?.status ?? 0;
    const data = r.data || {};
    const issues =
      (data.issue || data.issues) ??
      [{ severity: 'error', code: 'exception', diagnostics: `HTTP ${status}` }];
    return { ok: false, status, issues, body: data };
  }
  return { ok: true, status: r.response!.status, body: r.data };
}
