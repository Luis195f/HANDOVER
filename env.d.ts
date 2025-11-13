// BEGIN HANDOVER: ENV_TYPES
declare namespace NodeJS {
  interface ProcessEnv {
    API_BASE_URL: string;
    FHIR_CLIENT_ID: string;
    SENTRY_DSN?: string;
  }
}
// END HANDOVER: ENV_TYPES
