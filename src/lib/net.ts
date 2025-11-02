/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/net.ts
export type RetryOptions = {
  retries?: number;           // intentos adicionales (default 3)
  backoffMs?: number;         // base del backoff (default 500 ms)
  retryOn?: number[];         // HTTP que reintentan (default 408,429,5xx)
  signal?: AbortSignal;
};

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

/**
 * fetchWithRetry: wrapper con backoff exponencial + jitter.
 * Exportado porque los tests lo piden explícitamente.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const {
    retries = 3,
    backoffMs = 500,
    retryOn = [408, 429, 500, 502, 503, 504],
    signal,
  } = opts;

  let attempt = 0;
  let lastErr: any;

  while (attempt <= retries) {
    try {
      const res = await fetch(input, { ...init, signal });
      // Si no es reintitable o ya es el último intento, devolvemos:
      if (!retryOn.includes(res.status) || attempt === retries) return res;
    } catch (err) {
      lastErr = err;
      if (attempt === retries) throw err;
    }
    // Backoff exponencial con un poquito de jitter:
    const delay = backoffMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
    await sleep(delay);
    attempt += 1;
  }
  // TS guard
  if (lastErr) throw lastErr;
  throw new Error('fetchWithRetry: fallthrough inesperado');
}

export default fetchWithRetry;
