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
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
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

export class ConfigError extends Error {
  readonly kind = 'config';

  constructor(message: string, public meta?: Record<string, unknown>) {
    super(message);
  }
}

function normalizeRetry(retry?: RetryOptions) {
  if (typeof retry === 'number') {
    return { retries: retry, baseDelayMs: 1000, maxDelayMs: 8000 };
  }
  return {
    retries: retry?.retries ?? 2,
    baseDelayMs: retry?.baseDelayMs ?? 1000,
    maxDelayMs: retry?.maxDelayMs ?? 8000,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function assertHttpsIfProd(urlStr: string, method: string) {
  const env = String((globalThis as any)?.process?.env?.NODE_ENV ?? '');
  if (env !== 'production') return;

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return;
  }

  const host = parsed.hostname.toLowerCase();
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (parsed.protocol === 'http:' && !isLoopback) {
    throw new ConfigError('HTTPS is required in production', { url: urlStr, method });
  }
}

const RETRYABLE_HTTP_STATUSES = new Set([502, 503, 504]);
const toMethod = (method?: string) => (method ? method.toUpperCase() : 'GET');

const isAbortError = (error: unknown) => {
  if (!error) return false;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  return (error as any)?.name === 'AbortError';
};

function combineSignals(primary?: AbortSignal | null, secondary?: AbortSignal): AbortSignal | undefined {
  const signals = [primary, secondary].filter(Boolean) as AbortSignal[];
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];

  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

export async function safeFetch(url: string, options: FetchOptions = {}): Promise<Response> {
  const {
    timeoutMs = 10_000,
    retry,
    fetchImpl = fetch,
    signal,
    baseDelayMs,
    maxDelayMs,
    random = Math.random,
    ...init
  } = options;

  const normalized = normalizeRetry(retry);
  const retries = normalized.retries;
  const delayBase = baseDelayMs ?? normalized.baseDelayMs;
  const delayMax = maxDelayMs ?? normalized.maxDelayMs;
  const method = toMethod(init.method);

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    const controller = new AbortController();
    const mergedSignal = combineSignals(signal, controller.signal);
    const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

    try {
      assertHttpsIfProd(url, method);
      const response = await fetchImpl(url, { ...init, signal: mergedSignal ?? undefined });

      if (timeout) clearTimeout(timeout);

      if (!response.ok) {
        if (RETRYABLE_HTTP_STATUSES.has(response.status) && attempt < retries) {
          attempt += 1;
          const delay = Math.min(delayBase * 2 ** (attempt - 1), delayMax);
          await sleep(delay);
          continue;
        }

        throw new HTTPError(
          `HTTP ${response.status}`,
          {
            url,
            method,
            status: response.status,
            statusText: response.statusText,
          },
          response,
        );
      }

      return response;
    } catch (error) {
      if (timeout) clearTimeout(timeout);

      if (error instanceof ConfigError) {
        throw error;
      }

      if (error instanceof HTTPError) {
        throw error;
      }

      if (error instanceof TimeoutError) {
        lastError = error;
        if (attempt < retries) {
          attempt += 1;
          const delay = Math.min(delayBase * 2 ** (attempt - 1), delayMax);
          await sleep(delay);
          continue;
        }
        throw error;
      }

      if (error instanceof NetworkError) {
        lastError = error;
        if (attempt < retries) {
          attempt += 1;
          const jitter = 1 + (random?.() ?? Math.random()) * 0.1;
          const delay = Math.min(delayBase * 2 ** (attempt - 1) * jitter, delayMax);
          await sleep(delay);
          continue;
        }
        throw error;
      }

      if (isAbortError(error)) {
        lastError = error;
        if (attempt < retries) {
          attempt += 1;
          const delay = Math.min(delayBase * 2 ** (attempt - 1), delayMax);
          await sleep(delay);
          continue;
        }
        throw new TimeoutError('Request aborted by timeout', { url, method });
      }

      lastError = error;
      const message = (error as Error)?.message ?? 'Network error';
      throw new NetworkError(message, { url, method });
    }
  }

  const message = (lastError as Error)?.message ?? 'Network error';
  if (isAbortError(lastError)) {
    throw new TimeoutError('Request aborted by timeout', { url, method });
  }
  if (lastError instanceof ConfigError) {
    throw lastError;
  }
  if (lastError instanceof NetworkError || lastError instanceof TimeoutError) {
    throw lastError;
  }
  throw new NetworkError(message, { url, method });
}

export function fetchWithRetry(url: string, options?: FetchOptions): Promise<Response>;
export function fetchWithRetry(url: string, init?: RequestInit, legacyRetry?: RetryOptions): Promise<Response>;
export function fetchWithRetry(url: string, a?: RequestInit | FetchOptions, b?: RetryOptions): Promise<Response> {
  const opts: FetchOptions = a ? { ...(a as FetchOptions) } : {};
  if (typeof b !== 'undefined') {
    opts.retry = b;
  }
  return safeFetch(url, opts);
}

export { SafeFetchError };
