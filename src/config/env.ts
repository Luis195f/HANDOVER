import Constants from 'expo-constants';

function resolveBaseUrl(): string {
  const expoValue = Constants.expoConfig?.extra?.FHIR_BASE_URL;
  const envValue = process.env.EXPO_PUBLIC_FHIR_BASE_URL ?? process.env.FHIR_BASE_URL;
  const rawSource = typeof expoValue === 'string' ? expoValue : envValue ?? '';
  const raw = rawSource.trim();
  if (!raw) {
    throw new Error('Missing FHIR_BASE_URL');
  }
  return raw.replace(/\/+$/, '');
}

function resolveSttEndpoint(): string | null {
  const expoValue = Constants.expoConfig?.extra?.STT_ENDPOINT;
  const envValue = process.env.EXPO_PUBLIC_STT_ENDPOINT ?? process.env.STT_ENDPOINT;
  const rawSource = typeof expoValue === 'string' ? expoValue : envValue ?? '';
  const raw = rawSource.trim();
  return raw.length > 0 ? raw : null;
}

export const FHIR_BASE_URL: string = resolveBaseUrl();
export const STT_ENDPOINT: string | null = resolveSttEndpoint();

function sanitizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

function resolveAiBackendBaseUrl(): string | null {
  const aiEnv =
    process.env.EXPO_PUBLIC_AI_BACKEND_BASE_URL ??
    process.env.AI_BACKEND_BASE_URL ??
    Constants.expoConfig?.extra?.AI_BACKEND_BASE_URL;

  if (typeof aiEnv === 'string' && aiEnv.trim()) {
    return sanitizeBaseUrl(aiEnv.trim());
  }

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
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
    return sanitizeBaseUrl(aiSbarEnv.trim());
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
} as const;

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';
