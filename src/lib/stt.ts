// src/lib/stt.ts
// Cliente STT para Handover: envía audio (expo-av / m4a) a un endpoint FastAPI/Whisper
// y devuelve el texto transcrito. Seguro ante timeouts, reintentos y configuraciones faltantes.

import Constants from 'expo-constants';
import { ENV } from '../config/env';

type TranscribeOpts = {
  timeoutMs?: number;   // por defecto 45s
  retries?: number;     // por defecto 2 reintentos en fallos de red/5xx
};

// ---- Utilidades internas ----
const pickSttEndpoint = (): string => {
  const envExtra = (Constants?.expoConfig as any)?.extra ?? (Constants?.manifest as any)?.extra ?? {};
  const fromConstants = envExtra?.STT_ENDPOINT;
  const fromConfig = (ENV as Record<string, unknown>)?.STT_ENDPOINT as string | undefined;
  const fromProcess = process?.env?.EXPO_PUBLIC_STT_ENDPOINT ?? process?.env?.STT_ENDPOINT;
  const url = fromConfig || fromConstants || fromProcess;
  if (!url || typeof url !== 'string') {
    throw new Error('STT_ENDPOINT no configurado. Define extra.STT_ENDPOINT en app.json o en CONFIG.');
  }
  return url;
};

const guessExt = (uri: string): string => {
  const m = /\.([a-z0-9]+)$/i.exec(uri.split('?')[0] || '');
  return (m?.[1] || 'm4a').toLowerCase();
};

const mimeByExt: Record<string, string> = {
  m4a: 'audio/m4a',
  mp4: 'audio/mp4',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  caf: 'audio/x-caf',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  '3gp': 'audio/3gpp', // <-- clave NUMÉRICA entre comillas (fix)
};

const getMime = (ext: string): string => mimeByExt[ext] || 'application/octet-stream';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fetchWithTimeout = async (input: RequestInfo, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(to);
  }
};

// ---- API principal ----
export async function transcribeAudio(uri: string, hint?: string, opts: TranscribeOpts = {}): Promise<string> {
  if (!uri || typeof uri !== 'string') {
    throw new Error('URI de audio inválida.');
  }

  const endpoint = pickSttEndpoint();
  const ext = guessExt(uri);
  const mime = getMime(ext);
  const name = `note.${ext}`;

  const { timeoutMs = 45_000, retries = 2 } = opts;

  // Construye el multipart/form-data. ¡No pongas Content-Type a mano!
  const form = new FormData();
  // @ts-ignore: React Native FormData file shape
  form.append('file', { uri, name, type: mime });
  if (hint) form.append('hint', hint);

  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: { Accept: 'application/json' }, // fetch añadirá el boundary automáticamente
          body: form as any,
        },
        timeoutMs
      );

      // 2xx
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        const text = (json?.text ?? '').toString();
        if (!text) {
          const serverErr = (json?.error ?? '').toString();
          if (serverErr) throw new Error(`STT devolvió error: ${serverErr}`);
        }
        return text;
      }

      // 4xx conocidos → no reintentar
      if ([400, 401, 403, 404, 413].includes(res.status)) {
        const body = await res.text().catch(() => '');
        throw new Error(`STT fallo: ${res.status} ${body}`);
      }

      // 5xx → reintento
      const body = await res.text().catch(() => '');
      throw new Error(`STT temporalmente no disponible: ${res.status} ${body}`);
    } catch (e: any) {
      lastErr = e;
      const msg: string = e?.message ?? String(e);
      const retriable =
        /abort|network request failed|temporariamente|temporarily|timeout|ECONNRESET|ENETUNREACH|EAI_AGAIN/i.test(msg) ||
        (typeof e?.name === 'string' && /AbortError/i.test(e.name));

      if (attempt < retries && retriable) {
        await sleep(400 * Math.pow(2, attempt)); // 400ms, 800ms…
        continue;
      }
      break;
    }
  }

  const pretty = lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'Error STT desconocido');
  throw new Error(pretty.startsWith('STT') ? pretty : `STT fallo: ${pretty}`);
}
