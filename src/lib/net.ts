// src/lib/net.ts

// --- Tipos ---------------------------------------------------------------
export type RetryOptions =
  | number
  | {
      retries?: number;
      baseDelayMs?: number;
      maxDelayMs?: number;
    };

export type FetchOptions = RequestInit & {
  timeoutMs?: number;
  retry?: RetryOptions;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal | null;
};

// Normaliza retry (número u objeto) a una config concreta
function normalizeRetry(r?: RetryOptions) {
  if (typeof r === 'number') return { retries: r, baseDelayMs: 1000, maxDelayMs: 8000 };
  return {
    retries: r?.retries ?? 2,
    baseDelayMs: r?.baseDelayMs ?? 1000,
    maxDelayMs: r?.maxDelayMs ?? 8000,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** En producción, bloquea http:// salvo loopback (localhost/127.0.0.1/::1) */
function assertHttpsIfProd(urlStr: string) {
  const nodeEnv = String((globalThis as any)?.process?.env?.NODE_ENV ?? '');
  if (nodeEnv !== 'production') return;

  // Solo capturamos errores de parseo, no el throw de política
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    // URL relativa: no validamos aquí
    return;
  }

  const host = u.hostname.toLowerCase();
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (u.protocol === 'http:' && !isLoopback) {
    throw new Error('HTTPS is required in production');
  }
}

// --- Implementación ------------------------------------------------------
export async function safeFetch(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 10_000, retry, fetchImpl = fetch, signal, ...init } = options;

  const { retries, baseDelayMs, maxDelayMs } = normalizeRetry(retry);
  let attempt = 0;
  let lastError: unknown;

  // Transitorios: 408/429 y 5xx (incluye 500)
  const isTransient = (s: number) => s === 408 || s === 429 || (s >= 500 && s < 600);

  while (attempt <= retries) {
    // AbortController NUEVO por intento
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Componer señal externa + local por intento
    const composedSignal =
      signal && signal !== controller.signal
        ? (() => {
            const anyAbort = new AbortController();
            const onAbort = () => anyAbort.abort();
            signal.addEventListener('abort', onAbort, { once: true });
            controller.signal.addEventListener('abort', onAbort, { once: true });
            return anyAbort.signal;
          })()
        : controller.signal;

export type SafeFetchOptions = RequestInit & {
  timeoutMs?: number;
  maxRetries?: number;
  retry?: number;
  fetchImpl?: typeof fetch;
  retryStatuses?: number[];
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  omitAbortSignal?: boolean;
};

export type SafeFetchErrorPayload = {
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  body?: string;
};

class SafeFetchError extends Error {
  readonly payload: SafeFetchErrorPayload;

  constructor(message: string, payload: SafeFetchErrorPayload) {
    super(message);
    this.payload = payload;
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NetworkError extends SafeFetchError {}
export class TimeoutError extends SafeFetchError {}
export class HTTPError extends SafeFetchError {
  readonly response: Response;

  constructor(message: string, payload: SafeFetchErrorPayload, response: Response) {
    super(message, payload);
    this.response = response;
  }
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}

export function isHTTPError(error: unknown): error is HTTPError {
  return error instanceof HTTPError;
}

function createAbortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('Aborted', 'AbortError');
  }
  const abortError = new Error('Aborted');
  (abortError as any).name = 'AbortError';
  return abortError;
}

function combineSignals(signalA?: AbortSignal | null, signalB?: AbortSignal | null): AbortSignal | undefined {
  const signals = [signalA, signalB].filter(Boolean) as AbortSignal[];
  if (signals.length === 0) {
    return undefined;
  }
  if (signals.length === 1) {
    return signals[0];
  }
  const controller = new AbortController();
  const abortFrom = (signal: AbortSignal) => {
    if (controller.signal.aborted) return;
    try {
      // Bloqueo HTTP en producción (funciona en Node/Jest y en runtime)
      assertHttpsIfProd(url);

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

      // Decide reintento por STATUS, no por res.ok
      if (isTransient(res.status) && attempt < retries) {
        const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
        attempt += 1;
        await sleep(delay);
        continue;
      }

      return res;
    } catch (err: any) {
      clearTimeout(timer);

      // Abort/ECONNRESET: también reintenta
      const isAbort =
        err?.name === 'AbortError' ||
        (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') ||
        err?.code === 'ECONNRESET';

      if (isAbort && attempt < retries) {
        const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
        attempt += 1;
        await sleep(delay);
        lastError = err;
        continue;
      }

      lastError = err;
      break;
    }
  }

  throw lastError ?? new Error('Network error');
}

// --- API pública (compat) -----------------------------------------------
// Firma moderna (url, options) y heredada (url, init, retry)
export function fetchWithRetry(url: string, options?: FetchOptions): Promise<Response>;
export function fetchWithRetry(url: string, init?: RequestInit, legacyRetry?: RetryOptions): Promise<Response>;
export function fetchWithRetry(url: string, a?: RequestInit | FetchOptions, b?: RetryOptions): Promise<Response> {
  const opts: FetchOptions = a ? { ...(a as any) } : {};
  if (typeof b !== 'undefined') opts.retry = b;
  return safeFetch(url, opts);
}






