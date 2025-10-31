// safeFetch con timeout + backoff y AbortController por intento
export async function safeFetch(
  url: string,
  options: {
    timeoutMs?: number;
    retry?: number;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal | null;
  } & RequestInit = {}
): Promise<Response> {
  const {
    timeoutMs = 10_000,
    retry = 2,
    fetchImpl = fetch,
    signal,
    ...init
  } = options;

  let attempt = 0;
  let lastError: unknown;

  const isRetryableStatus = (s: number) => s === 502 || s === 503 || s === 504;
  const backoff = (n: number) => Math.min(1000 * 2 ** n, 8000);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  while (attempt <= retry) {
    // 🔴 nuevo controller/timeout EN CADA INTENTO
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new DOMException('Timeout', 'AbortError'));
    }, timeoutMs);

    // Componer signal externo con el local
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
      // HTTPS obligatorio en prod (no afecta a Jest/Node por el typeof window)
      if (
        typeof window !== 'undefined' &&
        process.env.NODE_ENV === 'production' &&
        window.location.protocol !== 'https:'
      ) {
        throw new Error('HTTPS is required in production');
      }

      const res = await fetchImpl(url, { ...init, signal: composedSignal });
      clearTimeout(timer);

      if (!res.ok && isRetryableStatus(res.status) && attempt < retry) {
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

      if ((aborted || err?.code === 'ECONNRESET') && attempt < retry) {
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

// Compat: algunos tests importan fetchWithRetry con otra firma (url, init, opts)
export function fetchWithRetry(
  url: string,
  init?: RequestInit,
  opts?: { timeoutMs?: number; retry?: number; fetchImpl?: typeof fetch; signal?: AbortSignal | null }
) {
  const merged = { ...(init ?? {}), ...(opts ?? {}) } as RequestInit & {
    timeoutMs?: number; retry?: number; fetchImpl?: typeof fetch; signal?: AbortSignal | null;
  };
  return safeFetch(url, merged);
}
export { safeFetch as fetchWithRetry };

