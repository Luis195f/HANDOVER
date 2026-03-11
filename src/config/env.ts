import Constants from 'expo-constants';

function isLocalhostUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function shouldAllowInsecureHttp(): boolean {
  const flag = process.env.EXPO_PUBLIC_ALLOW_INSECURE_HTTP ?? process.env.ALLOW_INSECURE_HTTP;
  if (typeof flag === 'string' && flag.trim()) {
    const normalized = flag.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return false;
}

function assertSecureUrl(raw: string, label: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('http://') && isLocalhostUrl(trimmed)) return trimmed;

  const allowInsecure = shouldAllowInsecureHttp();
  const isTestEnv = process.env.NODE_ENV === 'test';
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

  if (allowInsecure || isTestEnv || isDev) {
    console.warn(`[env] ${label} is not HTTPS. Configure HTTPS for production.`);
    return trimmed;
  }

  throw new Error(`${label} must use HTTPS in production.`);
}

function sanitizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

function resolveBaseUrl(): string {
  const expoValue = Constants.expoConfig?.extra?.FHIR_BASE_URL;
  const envValue = process.env.EXPO_PUBLIC_FHIR_BASE_URL ?? process.env.FHIR_BASE_URL;
  const rawSource = typeof expoValue === 'string' ? expoValue : envValue ?? '';
  const raw = rawSource.trim();
  if (!raw) {
    throw new Error('Missing FHIR_BASE_URL');
  }
  return assertSecureUrl(sanitizeBaseUrl(raw), 'FHIR_BASE_URL');
}

export const FHIR_BASE_URL: string = resolveBaseUrl();

function resolveAiBackendBaseUrl(): string | null {
  const aiEnv =
    process.env.EXPO_PUBLIC_AI_BACKEND_BASE_URL ??
    process.env.AI_BACKEND_BASE_URL ??
    Constants.expoConfig?.extra?.AI_BACKEND_BASE_URL;

  if (typeof aiEnv === 'string' && aiEnv.trim()) {
    return assertSecureUrl(sanitizeBaseUrl(aiEnv.trim()), 'AI_BACKEND_BASE_URL');
  }

  const apiFallback =
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    process.env.EXPO_PUBLIC_API_BASE ??
    process.env.API_BASE_URL ??
    process.env.API_BASE ??
    '';
  if (typeof apiFallback === 'string' && apiFallback.trim()) {
    return assertSecureUrl(`${sanitizeBaseUrl(apiFallback.trim())}/api`, 'AI_BACKEND_BASE_URL');
  }

  return null;
}

export const AI_BACKEND_BASE_URL: string | null = resolveAiBackendBaseUrl();
export const AI_BACKEND_ENABLED = Boolean(AI_BACKEND_BASE_URL);
export const AI_SBAR_ENABLED = Boolean(AI_BACKEND_BASE_URL);

export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? process.env.API_BASE ?? '';

export const ENV = {
  FHIR_BASE_URL,
  API_BASE,
  AI_BACKEND_BASE_URL,
  AI_BACKEND_ENABLED,
  AI_SBAR_ENABLED,
} as const;

/**
 * API base URL:
 * - En test: fallback estable para CI.
 * - En dev: si no esta definido por env, intenta derivar el host del bundler (LAN) para que funcione en movil.
 * - En web dev: cae a 127.0.0.1.
 * - En prod: exige definir API_BASE_URL y que sea HTTPS (via assertSecureUrl).
 */
function resolveApiBaseUrl(): string {
  const fromEnv =
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    process.env.EXPO_PUBLIC_API_BASE ??
    process.env.API_BASE_URL ??
    process.env.API_BASE ??
    '';

  const trimmed = (typeof fromEnv === 'string' ? fromEnv : '').trim();
  if (trimmed) return assertSecureUrl(sanitizeBaseUrl(trimmed), 'API_BASE_URL');

  if (process.env.NODE_ENV === 'test') {
    return assertSecureUrl('http://127.0.0.1:8000', 'API_BASE_URL');
  }

  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  if (isDev) {
    const hostUriFromExpoConfig = Constants.expoConfig?.hostUri;
    const legacyDebuggerHost = (Constants.expoConfig as any)?.debuggerHost as unknown;

    const hostUri =
      (typeof hostUriFromExpoConfig === 'string' && hostUriFromExpoConfig) ||
      (typeof legacyDebuggerHost === 'string' && legacyDebuggerHost) ||
      '';

    if (hostUri.includes(':')) {
      const host = hostUri.split(':')[0];
      if (host && host !== 'localhost' && host !== '127.0.0.1') {
        return assertSecureUrl(`http://${host}:8000`, 'API_BASE_URL');
      }
    }

    return assertSecureUrl('http://127.0.0.1:8000', 'API_BASE_URL');
  }

  throw new Error('Missing API_BASE_URL');
}

export const API_BASE_URL = resolveApiBaseUrl();
export const AI_TRANSCRIBE_ENDPOINT = `${API_BASE_URL}/api/ai/transcribe`;
