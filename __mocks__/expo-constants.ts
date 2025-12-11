// __mocks__/expo-constants.ts
// Stub de expo-constants para tests en Node/Vitest.

const extra = {
  FHIR_BASE_URL: 'https://fhir.test',
  STORAGE_NAMESPACE: 'handover',
  OIDC_ISSUER: 'https://auth.example.com',
  OIDC_CLIENT_ID: 'client-id',
  OIDC_SCOPE: 'openid profile email offline_access',
  OIDC_REDIRECT_SCHEME: 'handoverpro',
};

const Constants = {
  expoConfig: {
    extra,
  },
  manifest: {
    extra,
  },

  // Campos adicionales seguros para evitar reventar en otras partes
  manifest2: null,
  executionEnvironment: 'standalone' as const,
  platform: {
    android: null,
    ios: null,
    web: null,
  },
};

export default Constants;
export { Constants };
