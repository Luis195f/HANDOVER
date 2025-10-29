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

export const FHIR_BASE_URL: string = resolveBaseUrl();

export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? process.env.API_BASE ?? '';
export const API_TOKEN = process.env.EXPO_PUBLIC_API_TOKEN ?? process.env.API_TOKEN ?? '';

export const ENV = {
  FHIR_BASE_URL,
  API_BASE,
  API_TOKEN,
} as const;

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';
