const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 300;
const DEFAULT_MAX_DELAY_MS = 5_000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const ERROR_BODY_LIMIT = 2_048;
const TX_RETRYABLE_HEADERS = ['retry-after'];

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
      controller.abort((signal as any).reason ?? createAbortError());
    } catch {
      controller.abort(createAbortError());
    }
  };
  for (const sig of signals) {
    if (sig.aborted) {
      abortFrom(sig);
      break;
    }
    sig.addEventListener('abort', () => abortFrom(sig), { once: true });
  }
  return controller.signal;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoffDelay(attempt: number, base: number, cap: number, random: () => number): number {
  const exp = Math.min(cap, base * 2 ** attempt);
  const jitter = Math.max(0, Math.floor(random() * exp));
  return Math.min(cap, jitter);
}

function parseRetryAfter(header: string | null | undefined): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric * 1_000;
  }
  const parsedDate = Date.parse(trimmed);
  if (Number.isNaN(parsedDate)) return null;
  const diff = parsedDate - Date.now();
  return diff > 0 ? diff : 0;
}

function truncateBody(body: string): string {
  if (body.length <= ERROR_BODY_LIMIT) return body;
  return `${body.slice(0, ERROR_BODY_LIMIT)}…`;
}

async function extractErrorBody(response: Response | any): Promise<string | undefined> {
  try {
    if (response && typeof response.clone === 'function') {
      const clone = response.clone();
      const contentType = clone.headers?.get?.('content-type') ?? '';
      if (contentType.includes('json') && typeof clone.json === 'function') {
        const json = await clone.json();
        const serialized = typeof json === 'string' ? json : JSON.stringify(json);
        return truncateBody(serialized);
      }
      if (typeof clone.text === 'function') {
        const text = await clone.text();
        if (!text) return undefined;
        return truncateBody(text);
      }
    }

    if (response && typeof response.text === 'function') {
      const text = await response.text();
      if (!text) return undefined;
      return truncateBody(text);
    }

    if (response && typeof response.json === 'function') {
      const json = await response.json();
      const serialized = typeof json === 'string' ? json : JSON.stringify(json);
      return truncateBody(serialized);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function isProduction(): boolean {
  if (typeof __DEV__ === 'boolean') {
    return !__DEV__;
  }
  return process.env.NODE_ENV === 'production';
}

function isAllowedInsecureHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '10.0.2.2' ||
    hostname.startsWith('192.168.')
  );
}

function enforceHttps(url: string, method: string): void {
  if (!isProduction()) return;
  if (!url.startsWith('http://')) return;
  try {
    const parsed = new URL(url);
    if (isAllowedInsecureHost(parsed.hostname)) {
      return;
    }
  } catch {
    // If URL parsing fails, fall back to generic error
  }
  throw new NetworkError('Insecure HTTP URLs are blocked in production builds', {
    url,
    method,
  });
}

function ensureFetchImplementation(fetchImpl?: typeof fetch): typeof fetch {
  const impl = fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!impl) {
    throw new Error('No fetch implementation available for safeFetch');
  }
  return impl;
}

export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries: explicitMaxRetries,
    retry,
    fetchImpl,
    retryStatuses = Array.from(RETRYABLE_STATUS),
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    random = Math.random,
    signal,
    method: rawMethod,
    omitAbortSignal = false,
    ...init
  } = options;

  const method = (rawMethod ?? 'GET').toUpperCase();
  const maxRetries =
    typeof explicitMaxRetries === 'number'
      ? explicitMaxRetries
      : typeof retry === 'number'
        ? retry
        : DEFAULT_MAX_RETRIES;
  enforceHttps(url, method);

  const doFetch = ensureFetchImplementation(fetchImpl);
  const retryable = new Set(retryStatuses);
  let lastNetworkError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let didTimeout = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
      let response: Response;
      if (omitAbortSignal) {
        response = await Promise.race([
          doFetch(url, { ...init, method, signal: signal ?? undefined }),
          new Promise<Response>((_, reject) => {
            timer = setTimeout(() => {
              didTimeout = true;
              reject(new TimeoutError(`Request timed out after ${timeoutMs}ms`, { url, method }));
            }, timeoutMs);
          }),
        ]);
      } else {
        const timeoutController = new AbortController();
        const combinedSignal = combineSignals(signal ?? undefined, timeoutController.signal);
        timer = setTimeout(() => {
          didTimeout = true;
          try {
            timeoutController.abort(createAbortError());
          } catch {
            timeoutController.abort();
          }
        }, timeoutMs);
        response = await doFetch(url, { ...init, method, signal: combinedSignal });
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      if (!response.ok) {
        if (retryable.has(response.status) && attempt < maxRetries) {
          const retryAfterHeader = TX_RETRYABLE_HEADERS.map((header) => response.headers.get(header)).find(Boolean);
          const retryAfterMs = parseRetryAfter(retryAfterHeader ?? null);
          const delayMs = retryAfterMs ?? computeBackoffDelay(attempt, baseDelayMs, maxDelayMs, random);
          await sleep(delayMs);
          continue;
        }

        const body = await extractErrorBody(response);
        throw new HTTPError(`Request failed with status ${response.status}`, {
          url,
          method,
          status: response.status,
          statusText: response.statusText,
          body,
        }, response);
      }

      return response;
    } catch (error: any) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      if (error instanceof HTTPError) {
        throw error;
      }

      if (error instanceof TimeoutError) {
        if (attempt < maxRetries) {
          const delayMs = computeBackoffDelay(attempt, baseDelayMs, maxDelayMs, random);
          await sleep(delayMs);
          continue;
        }
        throw error;
      }

      const hasDomException = typeof DOMException !== 'undefined';
      const isAbort = error?.name === 'AbortError' || (hasDomException && error instanceof DOMException);
      if (isAbort) {
        if (didTimeout) {
          if (attempt < maxRetries) {
            const delayMs = computeBackoffDelay(attempt, baseDelayMs, maxDelayMs, random);
            await sleep(delayMs);
            continue;
          }
          throw new TimeoutError(`Request timed out after ${timeoutMs}ms`, { url, method });
        }
        throw new NetworkError('Request was aborted', { url, method });
      }

      lastNetworkError = error;

      if (attempt < maxRetries) {
        const delayMs = computeBackoffDelay(attempt, baseDelayMs, maxDelayMs, random);
        await sleep(delayMs);
        continue;
      }

      const reason = error instanceof Error ? error.message : String(error);
      throw new NetworkError(reason || 'Network request failed', { url, method });
    }
  }

  const fallbackReason = lastNetworkError instanceof Error ? lastNetworkError.message : 'Network request failed';
  throw new NetworkError(fallbackReason, { url, method });
}
