type RetryOptions = {
  retries?: number;
  backoffMs?: number;
  signal?: AbortSignal;
};

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: RetryOptions | number = 5,
): Promise<Response> {
  const config: RetryOptions = typeof options === 'number' ? { retries: options } : options;
  let delay = config.backoffMs ?? 1000;
  const retries = config.retries ?? (typeof options === 'number' ? options : 5);
  const totalAttempts = retries + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: config.signal });
      if (response.ok) {
        return response;
      }
      if (response.status >= 500) {
        lastError = new Error('server');
      } else {
        return response;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt === totalAttempts - 1) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 15000);
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('fetch failed');
}

export default fetchWithRetry;
