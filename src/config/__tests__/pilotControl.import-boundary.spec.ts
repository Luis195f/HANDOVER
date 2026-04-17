import { beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

describe('pilotControl import-time boundaries', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.EXPO_PUBLIC_FHIR_BASE_URL;
    delete process.env.FHIR_BASE_URL;
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    delete process.env.API_BASE_URL;
    delete process.env.EXPO_PUBLIC_API_BASE;
    delete process.env.API_BASE;
    delete process.env.EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE;
    delete process.env.EXPO_PUBLIC_SHOW_NIC_CODING;
    delete process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES;
    delete process.env.EXPO_PUBLIC_ENABLE_ICEA_BRIDGE;
    delete process.env.EXPO_PUBLIC_ENABLE_ICEA_PATIENT_RISK;
    delete process.env.EXPO_PUBLIC_ENABLE_ICEA_IMMEDIATE_SCORING;
    delete process.env.EXPO_PUBLIC_ENABLE_ICEA_ENRICHED_SCORING;
    delete process.env.EXPO_PUBLIC_AI_SUGGESTIONS_ENABLED;
    delete process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON;
    delete process.env.HANDOVER_PROFILE_ACTIVATION_JSON;
    delete process.env.EXPO_PUBLIC_HANDOVER_UNITS_JSON;
    delete process.env.HANDOVER_UNITS_JSON;
    delete process.env.UNITS_CONFIG;
  });

  it('imports and resolves profile runtime without FHIR_BASE_URL when no HTTP call runs', async () => {
    const { resolveHandoverProfileRuntime } = await import('@/src/lib/profile-runtime');

    expect(() =>
      resolveHandoverProfileRuntime({
        unitId: 'neuroicu-1',
        specialtyId: 'neuroicu',
      }),
    ).not.toThrow();
  });

  it('imports and resolves MPAC without FHIR_BASE_URL when no HTTP call runs', async () => {
    const { computeMPACFromInput } = await import('@/src/lib/mpac');

    expect(() =>
      computeMPACFromInput({
        patientId: 'pat-core',
        displayName: 'Paciente Core',
        unitId: 'neuroicu-1',
        specialtyId: 'neuroicu',
        vitals: { rr: 24, spo2: 93, tempC: 38.1, sbp: 100, hr: 112 },
        devices: [{ id: 'vent', label: 'VM', category: 'invasive', critical: true }],
        risks: { isolation: true },
        pendingTasks: [{ id: 'gas', title: 'Gasometria', priority: 'critical', category: 'critical-task' }],
        recentIncidentFlag: true,
        referenceTime: '2024-02-01T00:00:00Z',
      }),
    ).not.toThrow();
  });

  it('keeps governed NNN disabled until backend confirms state, even without FHIR_BASE_URL', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE = 'pilot';
    process.env.EXPO_PUBLIC_SHOW_NIC_CODING = 'true';
    process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES = 'true';

    const { resolvePilotFeatureState } = await import('../pilotControl');
    const state = resolvePilotFeatureState('governed_nnn', { unitId: 'ward-a', roles: ['nurse'] });

    expect(state.enabled).toBe(false);
    expect(state.denialReason).toBe('backend_unavailable');
    expect(state.source).toBe('fallback');
  });

  it('still fails explicitly when a real API client call is attempted without FHIR_BASE_URL', async () => {
    await expect(
      (async () => {
        const { apiGet } = await import('@/src/lib/api');
        return apiGet('/api/pilot-control/features');
      })(),
    ).rejects.toThrow('Missing FHIR_BASE_URL');
  });
});
