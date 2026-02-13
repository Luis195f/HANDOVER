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

function resolveSttEndpoint(): string | null {
  const expoValue = Constants.expoConfig?.extra?.STT_ENDPOINT;
  const envValue = process.env.EXPO_PUBLIC_STT_ENDPOINT ?? process.env.STT_ENDPOINT;
  const rawSource = typeof expoValue === 'string' ? expoValue : envValue ?? '';
  const raw = rawSource.trim();
  return raw.length > 0 ? assertSecureUrl(raw, 'STT_ENDPOINT') : null;
}

export const FHIR_BASE_URL: string = resolveBaseUrl();
export const STT_ENDPOINT: string | null = resolveSttEndpoint();

function resolveAiBackendBaseUrl(): string | null {
  const aiEnv =
    process.env.EXPO_PUBLIC_AI_BACKEND_BASE_URL ??
    process.env.AI_BACKEND_BASE_URL ??
    Constants.expoConfig?.extra?.AI_BACKEND_BASE_URL;

  if (typeof aiEnv === 'string' && aiEnv.trim()) {
    return assertSecureUrl(sanitizeBaseUrl(aiEnv.trim()), 'AI_BACKEND_BASE_URL');
  }

  // Backend unificado: por defecto reutiliza API_BASE_URL (Django/DRF).
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

function resolveAiSbarBaseUrl(): string | null {
  const aiSbarEnv =
    process.env.EXPO_PUBLIC_AI_SBAR_URL ??
    process.env.AI_SBAR_URL ??
    Constants.expoConfig?.extra?.AI_SBAR_URL ??
    null;

  if (typeof aiSbarEnv === 'string' && aiSbarEnv.trim()) {
    return assertSecureUrl(sanitizeBaseUrl(aiSbarEnv.trim()), 'AI_SBAR_URL');
  }

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info('[env] AI SBAR backend is not configured; IA features will be disabled');
  }

  return null;
}

function resolveAiSbarApiKey(): string | undefined {
  const raw =
    process.env.EXPO_PUBLIC_AI_SBAR_API_KEY ??
    process.env.AI_SBAR_API_KEY ??
    Constants.expoConfig?.extra?.AI_SBAR_API_KEY ??
    '';
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed || undefined;
}

export const AI_SBAR_BASE_URL: string | null = resolveAiSbarBaseUrl();
export const AI_SBAR_API_KEY: string | undefined = resolveAiSbarApiKey();
export const AI_SBAR_ENABLED = Boolean(AI_SBAR_BASE_URL);

function resolveOpenAiBaseUrl(): string | null {
  const openAiEnv =
    process.env.EXPO_PUBLIC_OPENAI_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    Constants.expoConfig?.extra?.OPENAI_BASE_URL ??
    null;

  if (typeof openAiEnv === 'string' && openAiEnv.trim()) {
    return assertSecureUrl(sanitizeBaseUrl(openAiEnv.trim()), 'OPENAI_BASE_URL');
  }

  return null;
}

function resolveOpenAiApiKey(): string | undefined {
  const raw =
    process.env.EXPO_PUBLIC_OPENAI_API_KEY ??
    process.env.OPENAI_API_KEY ??
    Constants.expoConfig?.extra?.OPENAI_API_KEY ??
    '';
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed || undefined;
}

function resolveOpenAiModel(): string {
  const raw =
    process.env.EXPO_PUBLIC_OPENAI_MODEL ??
    process.env.OPENAI_MODEL ??
    Constants.expoConfig?.extra?.OPENAI_MODEL ??
    '';
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed || 'gpt-4o-mini';
}

export const OPENAI_BASE_URL: string | null = resolveOpenAiBaseUrl();
export const OPENAI_API_KEY: string | undefined = resolveOpenAiApiKey();
export const OPENAI_MODEL: string = resolveOpenAiModel();
export const OPENAI_ENABLED = Boolean(OPENAI_API_KEY || OPENAI_BASE_URL);

export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? process.env.API_BASE ?? '';
export const API_TOKEN = process.env.EXPO_PUBLIC_API_TOKEN ?? process.env.API_TOKEN ?? '';

export const ENV = {
  FHIR_BASE_URL,
  API_BASE,
  API_TOKEN,
  STT_ENDPOINT,
  AI_BACKEND_BASE_URL,
  AI_BACKEND_ENABLED,
  AI_SBAR_BASE_URL,
  AI_SBAR_API_KEY,
  AI_SBAR_ENABLED,
  OPENAI_BASE_URL,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  OPENAI_ENABLED,
} as const;

/**
 * API base URL:
 * - En test: fallback estable para CI.
 * - En dev: si no está definido por env, intenta derivar el host del bundler (LAN) para que funcione en móvil.
 * - En web dev: cae a 127.0.0.1.
 * - En prod: exige definir API_BASE_URL y que sea HTTPS (vía assertSecureUrl).
 */
function resolveApiBaseUrl(): string {
  const fromEnv =
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    process.env.EXPO_PUBLIC_API_BASE ?? // compat con variable vieja
    process.env.API_BASE_URL ??
    process.env.API_BASE ??
    '';

  const trimmed = (typeof fromEnv === 'string' ? fromEnv : '').trim();
  if (trimmed) return assertSecureUrl(sanitizeBaseUrl(trimmed), 'API_BASE_URL');

  // ✅ CI / tests: no dependas de Expo runtime ni de env vars
  if (process.env.NODE_ENV === 'test') {
    return assertSecureUrl('http://127.0.0.1:8000', 'API_BASE_URL');
  }

  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  if (isDev) {
    // hostUri suele ser "192.168.0.16:8081" en LAN (cuando corres Expo/Metro)
    const hostUriFromExpoConfig = Constants.expoConfig?.hostUri;

    // Fallback legacy: algunos runtimes exponen debuggerHost aunque el tipo no lo tenga.
    // Usamos `as any` para evitar romper typecheck en CI.
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

    // fallback para web/local
    return assertSecureUrl('http://127.0.0.1:8000', 'API_BASE_URL');
  }

  // ✅ En “prod real” (no dev/test), sí exigimos definirlo
  throw new Error('Missing API_BASE_URL');
}

export const API_BASE_URL = resolveApiBaseUrl();
