export async function safeFetch(
  url: string,
  options: { timeoutMs?: number; retry?: number; fetchImpl?: typeof fetch; signal?: AbortSignal | null } & RequestInit = {}
): Promise<Response> {
  const { timeoutMs = 10_000, retry = 2, fetchImpl = fetch, signal, ...init } = options;

  const isRetryableStatus = (s: number) => s === 502 || s === 503 || s === 504;
  const backoff = (n: number) => Math.min(1000 * 2 ** n, 8000);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let attempt = 0; attempt <= retry; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'AbortError')), timeoutMs);

    const composedSignal =
      signal && signal !== controller.signal
        ? (() => {
            const any = new AbortController();
            const onAbort = () => any.abort();
            signal.addEventListener('abort', onAbort, { once: true });
            controller.signal.addEventListener('abort', onAbort, { once: true });
            return any.signal;
          })()
        : controller.signal;

    try {
      if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production' && window.location.protocol !== 'https:')
        throw new Error('HTTPS is required in production');

      const res = await fetchImpl(url, { ...init, signal: composedSignal });
      clearTimeout(timer);

      if (!res.ok && isRetryableStatus(res.status) && attempt < retry) {
        await wait(backoff(attempt));
        continue;
      }
      return res;
    } catch (err: any) {
      clearTimeout(timer);
      const aborted = err?.name === 'AbortError' || (err instanceof DOMException && err.name === 'AbortError');
      if ((aborted || err?.code === 'ECONNRESET') && attempt < retry) {
        await wait(backoff(attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Network error');
}
