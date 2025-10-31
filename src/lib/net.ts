export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export type SecureFetchOptions = RequestInit & {
  timeoutMs?: number;
  retry?: RetryOptions | number;
  fetchImpl?: FetchLike;
};

function resolveRetries(option?: RetryOptions | number): Required<RetryOptions> {
  if (typeof option === 'number') {
    return { retries: option, baseDelayMs: 250, maxDelayMs: 4000 };
  }
  return {
    retries: option?.retries ?? 2,
    baseDelayMs: option?.baseDelayMs ?? 250,
    maxDelayMs: option?.maxDelayMs ?? 4000,
  };
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureHttps(url: string): void {
  if (/^https:\/\//i.test(url)) {
    return;
  }
  if (
    process.env.NODE_ENV !== 'production' &&
    /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.)/i.test(url)
  ) {
    return;
  }
  throw new Error('Insecure URL blocked: HTTPS is required in production');
}

export async function fetchWithRetry(url: string, options: SecureFetchOptions = {}): Promise<Response> {
  ensureHttps(url);
  const { timeoutMs = 5000, retry, fetchImpl, signal, ...init } = options;
  const controller = new AbortController();
  const composedSignal = signal
    ? createCompositeSignal(signal, controller.signal)
    : controller.signal;

  const { retries, baseDelayMs, maxDelayMs } = resolveRetries(retry);
  const fetchFn: FetchLike = fetchImpl ?? fetch;

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(url, { ...init, signal: composedSignal });
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
        await delay(backoff);
        attempt += 1;
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        break;
      }
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      await delay(backoff);
      attempt += 1;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('fetchWithRetry failed without specific error');
}

function createCompositeSignal(...signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(signals);
  }
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort();
      return controller.signal;
    }
    sig.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
