// Exponential backoff con jitter (full jitter).
export type BackoffOpts = {
  retries?: number;   // intentos totales, p.ej. 5
  minMs?: number;     // delay base, p.ej. 500 ms
  maxMs?: number;     // tope, p.ej. 15 s
};

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  { retries = 5, minMs = 500, maxMs = 15000 }: BackoffOpts = {}
): Promise<T> {
  let attempt = 0;
  let lastErr: any;
  while (attempt <= retries) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const exp = Math.min(maxMs, Math.pow(2, attempt) * minMs);
      const jitter = Math.random() * exp; // full jitter
      await sleep(jitter);
      attempt++;
    }
  }
  throw lastErr;
}
