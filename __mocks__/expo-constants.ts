const expoConfig = {
  extra: {
    FHIR_BASE_URL: 'https://fhir.test',
    STORAGE_NAMESPACE: 'handover',
    OIDC_ISSUER: 'https://auth.example.com',
    OIDC_CLIENT_ID: 'client-id',
    OIDC_SCOPE: 'openid profile email offline_access',
    OIDC_REDIRECT_SCHEME: 'handoverpro',
  },
};

export default { expoConfig };
