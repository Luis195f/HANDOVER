export const FHIR_BASE_URL = 'https://example-hce/fhir';
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? process.env.API_BASE ?? '';
export const API_TOKEN = process.env.EXPO_PUBLIC_API_TOKEN ?? process.env.API_TOKEN ?? '';
export const ENV = {
  FHIR_BASE_URL,
  API_BASE,
  API_TOKEN,
} as const;
