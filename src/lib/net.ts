/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/net.ts

import { getSession, logout, refreshTokenIfNeeded } from '@/src/security/auth';

/** Opciones de reintento para fetchWithRetry */
export type RetryOptions = {
  /** Intentos adicionales (default 3) */
  retries?: number;
  /** Base del backoff exponencial en ms (default 500) */
  backoffMs?: number;
  /** Códigos HTTP que disparan reintento (default 408,429,5xx) */
  retryOn?: number[];
  /** AbortSignal externo */
  signal?: AbortSignal;
};

/** Extiende RequestInit para permitir un fetch alternativo y flags usados en tests */
export interface ExtendedRequestInit extends RequestInit {
  /** Implementación custom de fetch (usado por jest/vitest) */
  fetchImpl?: typeof fetch;
  /** Puede ser número (p.ej., 0) o objeto con overrides (usado por tests) */
  retry?: number | {
    retries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  /** Timeout duro en ms (se cancela la petición) */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * fetchWithRetry: wrapper de fetch con backoff exponencial + jitter.
 * - Acepta `init.fetchImpl` para inyectar un fetch simulado en tests.
 * - Acepta `init.retry` (number | object) y `init.timeoutMs`.
 * - Reintenta en 408, 429 y 5xx por defecto.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: ExtendedRequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const {
    retries: optRetries = 3,
    backoffMs: optBackoff = 500,
    retryOn = [408, 429, 500, 502, 503, 504],
    signal: optSignal,
  } = opts;

  // Separa extensiones de init y decide qué fetch usar
  const { fetchImpl, retry, timeoutMs, ...initRest } = init;
  const doFetch = fetchImpl ?? fetch;

  // Overrides provenientes de init.retry
  const retries =
    typeof retry === 'number' ? retry :
    (retry?.retries ?? optRetries);

  const baseDelayMs =
    typeof retry === 'number' ? optBackoff :
    (retry?.baseDelayMs ?? optBackoff);

  const maxDelayMs =
    typeof retry === 'number' ? Number.POSITIVE_INFINITY :
    (retry?.maxDelayMs ?? Number.POSITIVE_INFINITY);

  let attempt = 0;
  let lastErr: any;

  const authorize = async () => {
    try {
      await refreshTokenIfNeeded();
      const session = await getSession();
      if (!session?.accessToken) return initRest.headers ?? {};
      return {
        ...(initRest.headers ?? {}),
        Authorization: (initRest.headers as Record<string, string> | undefined)?.Authorization
          ? (initRest.headers as Record<string, string>).Authorization
          : `Bearer ${session.accessToken}`,
      } as Record<string, string>;
    } catch {
      return initRest.headers ?? {};
    }
  };

  let authHeaders = await authorize();

  while (attempt <= retries) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const controller = timeoutMs ? new AbortController() : null;
    const finalSignal = optSignal ?? controller?.signal;
    if (timeoutMs && controller) {
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      const res = await doFetch(input, {
        ...initRest,
        headers: authHeaders,
        signal: finalSignal,
      });
      if (res.status === 401) {
        try {
          await refreshTokenIfNeeded();
          authHeaders = await authorize();
          const retryRes = await doFetch(input, {
            ...initRest,
            headers: authHeaders,
            signal: finalSignal,
          });
          if (retryRes.status !== 401) {
            if (timeoutId) clearTimeout(timeoutId);
            return retryRes;
          }
        } catch (error) {
          await logout();
          throw error;
        }
      }
      // Si no es reintitable o ya es el último intento, devolvemos la respuesta
      if (!retryOn.includes(res.status) || attempt === retries) {
        if (timeoutId) clearTimeout(timeoutId);
        return res;
      }
    } catch (err) {
      lastErr = err;
      if (attempt === retries) {
        if (timeoutId) clearTimeout(timeoutId);
        throw err; // último intento: propaga error
      }
    }

    if (timeoutId) clearTimeout(timeoutId);

    // Backoff exponencial + jitter (0..99 ms), acotado por maxDelayMs
    const backoff = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
    const delay = Math.min(backoff, maxDelayMs);
    await sleep(delay);
    attempt += 1;
  }

  if (timeoutId) clearTimeout(timeoutId);
  if (lastErr) throw lastErr; // TS guard
  throw new Error('fetchWithRetry: fallthrough inesperado');
}

export function safeFetch(input: RequestInfo | URL, init: ExtendedRequestInit = {}): Promise<Response> {
  return fetchWithRetry(input, init);
}

export default fetchWithRetry;
