// src/lib/net.ts

export type RetryOptions =
  | number
  | { retries?: number; baseDelayMs?: number; maxDelayMs?: number };

// RequestInit extendido con opciones reales de red
export type FetchOptions = RequestInit & {
  timeoutMs?: number;
  retry?: RetryOptions;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal | null;
};

// safeFetch con timeout + backoff y AbortController por intento
export async function safeFetch(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const {
    timeoutMs = 10_000,
    retry = 2,
    fetchImpl = fetch,
    signal,
    ...init
  } = options;

  // Soporta retry como número o como objeto
  const retries =
    typeof retry === 'number' ? retry : retry?.retries ?? 2;
  const baseDelay =
    typeof retry === 'number' ? 200 : retry?.baseDelayMs ?? 200;
  const maxDelay =
    typeof retry === 'number' ? 8000 : retry?.maxDelayMs ?? 8000;

  let attempt = 0;
  let lastError: unknown;

  const isRetryableStatus = (s: number) => s === 502 || s === 503 || s === 504;
  const backoff = (n: number) => Math.min(baseDelay * 2 ** n, maxDelay);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  while (attempt <= retries) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try { controller.abort(new DOMException('Timeout', 'AbortError')); }
      catch { controller.abort(new Error('Timeout') as any); }
    }, timeoutMs);

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
        await wait(backoff(attempt));
        attempt += 1;
        continue;
      }

      return res;
    } catch (err: any) {
      clearTimeout(timer);

      const aborted =
        err?.name === 'AbortError' ||
        (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError');

      if ((aborted || err?.code === 'ECONNRESET') && attempt < retries) {
        await wait(backoff(attempt));
        attempt += 1;
        lastError = err;
        continue;
      }

      lastError = err;
      break;
    }
  }

  throw lastError ?? new Error('Network error');
}

/** ÚNICO export público compatible con los tests */
export function fetchWithRetry(url: string, options?: FetchOptions) {
  return safeFetch(url, options);
}


