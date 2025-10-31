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

// Normaliza la opción retry (número u objeto) a una configuración concreta
function normalizeRetry(r?: RetryOptions) {
  if (typeof r === 'number') return { retries: r, baseDelayMs: 1000, maxDelayMs: 8000 };
  return {
    retries: r?.retries ?? 2,
    baseDelayMs: r?.baseDelayMs ?? 1000,
    maxDelayMs: r?.maxDelayMs ?? 8000,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** En producción, bloquea URLs http:// salvo loopback (localhost/127.0.0.1/::1) */
function assertHttpsIfProd(urlStr: string) {
  if (process.env.NODE_ENV !== 'production') return;

  // Solo queremos capturar errores al parsear la URL, NO tragarnos el throw de abajo.
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    // URLs relativas: no aplicamos esta validación aquí.
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

  // Consideramos transitorios (para reintento) 408/429 y 5xx
  const isTransient = (s: number) => s === 408 || s === 429 || (s >= 500 && s < 600);

  while (attempt <= retries) {
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

    try {
      // Bloqueo HTTP en producción (excepto loopback)
      assertHttpsIfProd(url);

      const res = await fetchImpl(url, { ...init, signal: composedSignal });
      clearTimeout(timer);

      // Decidir reintento por status (no dependemos de res.ok por si está mal stubbeado)
      if (isTransient(res.status) && attempt < retries) {
        const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
        attempt += 1;
        await sleep(delay);
        continue;
      }

      return res;
    } catch (err: any) {
      clearTimeout(timer);

      // Abort / ECONNRESET: también reintentar si quedan intentos
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
// Soporta tanto la firma moderna (url, options) como la heredada (url, init, retry)
export function fetchWithRetry(url: string, options?: FetchOptions): Promise<Response>;
export function fetchWithRetry(url: string, init?: RequestInit, legacyRetry?: RetryOptions): Promise<Response>;
export function fetchWithRetry(
  url: string,
  a?: RequestInit | FetchOptions,
  b?: RetryOptions
): Promise<Response> {
  const opts: FetchOptions = a ? { ...(a as any) } : {};
  if (typeof b !== 'undefined') opts.retry = b;
  return safeFetch(url, opts);
}





