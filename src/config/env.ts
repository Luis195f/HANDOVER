export const CONFIG = {
  FHIR_BASE_URL: process.env.FHIR_BASE_URL ?? "https://example.org/fhir",
  OAUTH_TOKEN: process.env.OAUTH_TOKEN ?? "",
  APP_NAME: "handover-pro"
} as const;

export type AppConfig = typeof CONFIG;
