// src/lib/net.ts

// --- Tipos ---------------------------------------------------------------
export type RetryOptions =
  | number
  | {
      retries?: number;
      baseDelayMs?: number;
      maxDelayMs?: number;
    };

// RequestInit extendido con opciones reales de red
export type FetchOptions = RequestInit & {
  timeoutMs?: number;
  retry?: RetryOptions; // <- acepta número u objeto
  fetchImpl?: typeof fetch;
  signal?: AbortSignal | null;
};

// Normaliza la opción retry (número u objeto) a una configuración concreta
function normalizeRetry(r?: RetryOptions) {
  if (typeof r === 'number') {
    return { retries: r, baseDelayMs: 1000, maxDelayMs: 8000 };
  }
  return {
    retries: r?.retries ?? 2,
    baseDelayMs: r?.baseDelayMs ?? 1000,
    maxDelayMs: r?.maxDelayMs ?? 8000,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Implementación ------------------------------------------------------
export async function safeFetch(url: string, options: FetchOptions = {}): Promise<Response> {
  const {
    timeoutMs = 10_000,
    retry, // puede ser número u objeto
    fetchImpl = fetch,
    signal,
    ...init
  } = options;

  const { retries, baseDelayMs, maxDelayMs } = normalizeRetry(retry);
  let attempt = 0;
  let lastError: unknown;

  const isRetryableStatus = (s: number) => s === 502 || s === 503 || s === 504;

  while (attempt <= retries) {
    // controller/timeout NUEVOS por intento
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        // DOMException puede no existir en algunos entornos de Node
        controller.abort(new DOMException('Timeout', 'AbortError'));
      } catch {
        controller.abort(new Error('Timeout') as any);
      }
    }, timeoutMs);

    // compón señal externa + local
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
      // HTTPS obligatorio en prod (no afecta a Jest/Node)
      if (
        typeof window !== 'undefined' &&
        process.env.NODE_ENV === 'production' &&
        window.location.protocol !== 'https:'
      ) {
        throw new Error('HTTPS is required in production');
      }

      const res = await fetchImpl(url, { ...init, signal: composedSignal });
      clearTimeout(timer);

      if (!res.ok && isRetryableStatus(res.status) && attempt < retries) {
        const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
        attempt += 1;
        await sleep(delay);
        continue;
      }

      return res;
    } catch (err: any) {
      clearTimeout(timer);

      const isAbort =
        err?.name === 'AbortError' ||
        (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError');

      if ((isAbort || err?.code === 'ECONNRESET') && attempt < retries) {
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
// Overload 1: firma moderna (dos parámetros)
export function fetchWithRetry(url: string, options?: FetchOptions): Promise<Response>;
// Overload 2: firma antigua (tres parámetros); el 3º se fusiona como `retry`
export function fetchWithRetry(
  url: string,
  init?: RequestInit,
  legacyRetry?: RetryOptions
): Promise<Response>;

export function fetchWithRetry(
  url: string,
  a?: RequestInit | FetchOptions,
  b?: RetryOptions
): Promise<Response> {
  const opts: FetchOptions = a ? { ...(a as any) } : {};
  
  if (typeof b !== 'undefined') {
    // compat triple-arg: el tercer parámetro es retry
    opts.retry = b;
  }
  
  return safeFetch(url, opts);
}


