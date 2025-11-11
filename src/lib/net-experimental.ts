type Opts = { retries?: number; timeoutMs?: number; backoffMs?: number };
export async function fetchWithRetry(url: string, init: RequestInit = {}, opts: Opts = {}) {
  const retries = opts.retries ?? 2, timeout = opts.timeoutMs ?? 10000, backoff = opts.backoffMs ?? 400;
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), timeout);
      const res = await fetch(url, { ...init, signal: c.signal }); clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`); return res;
    } catch (e) { lastErr = e; if (i === retries) break; await new Promise(r => setTimeout(r, backoff * (i + 1))); }
  }
  throw lastErr;
}
