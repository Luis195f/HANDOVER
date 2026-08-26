import { beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
const mockState = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));
vi.mock('@/src/lib/api', () => ({
  apiGet: mockState.apiGet,
}));

describe('unitsConfig advanced flags by unit', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.EXPO_PUBLIC_SHOW_NIC_CODING;
    delete process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES;
    delete process.env.EXPO_PUBLIC_SHOW_HANDOVER_TIMING_METRICS;
    delete process.env.EXPO_PUBLIC_HIDE_LEGACY_FIELDS;
    delete process.env.EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE;
    delete process.env.EXPO_PUBLIC_HANDOVER_UNITS_JSON;
    delete process.env.HANDOVER_UNITS_JSON;
    delete process.env.UNITS_CONFIG;
  });

  it('applies global defaults from env flags', async () => {
    process.env.EXPO_PUBLIC_SHOW_NIC_CODING = 'true';
    process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES = 'true';
    process.env.EXPO_PUBLIC_SHOW_HANDOVER_TIMING_METRICS = 'false';
    process.env.EXPO_PUBLIC_HIDE_LEGACY_FIELDS = '1';

    const { resolveUnitFeatureFlags } = await import('../unitsConfig');

    expect(resolveUnitFeatureFlags('icu-adulto')).toMatchObject({
      showNicCoding: true,
      showNocOutcomes: true,
      showHandoverTimingMetrics: false,
      hideLegacyFields: true,
    });
  });

  it('merges per-unit overrides from HANDOVER_UNITS_JSON', async () => {
    process.env.EXPO_PUBLIC_SHOW_NIC_CODING = 'false';
    process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES = 'false';
    process.env.EXPO_PUBLIC_SHOW_HANDOVER_TIMING_METRICS = 'false';
    process.env.EXPO_PUBLIC_HIDE_LEGACY_FIELDS = 'false';
    process.env.EXPO_PUBLIC_HANDOVER_UNITS_JSON = JSON.stringify([
      {
        id: 'nnn-unit',
        name: 'Unidad NNN',
        specialty: 'icu',
        features: {
          showNicCoding: true,
          showNocOutcomes: true,
          showHandoverTimingMetrics: true,
          hideLegacyFields: true,
        },
      },
    ]);

    const { resolveUnitFeatureFlags } = await import('../unitsConfig');

    expect(resolveUnitFeatureFlags('nnn-unit')).toMatchObject({
      showNicCoding: true,
      showNocOutcomes: true,
      showHandoverTimingMetrics: true,
      hideLegacyFields: true,
    });
    expect(resolveUnitFeatureFlags('missing-unit')).toMatchObject({
      showNicCoding: true,
      showNocOutcomes: true,
      showHandoverTimingMetrics: true,
      hideLegacyFields: true,
    });
  });

  it('uses default unit config when unitId is empty or whitespace', async () => {
    process.env.EXPO_PUBLIC_SHOW_NIC_CODING = 'false';
    process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES = 'false';
    process.env.EXPO_PUBLIC_SHOW_HANDOVER_TIMING_METRICS = 'false';
    process.env.EXPO_PUBLIC_HIDE_LEGACY_FIELDS = 'false';
    process.env.EXPO_PUBLIC_HANDOVER_UNITS_JSON = JSON.stringify([
      {
        id: 'uci-default',
        name: 'UCI Default',
        specialty: 'icu',
        default: true,
        features: {
          showNicCoding: true,
          showNocOutcomes: true,
          showHandoverTimingMetrics: true,
          hideLegacyFields: true,
        },
      },
    ]);

    const { resolveUnitFeatureFlags } = await import('../unitsConfig');

    expect(resolveUnitFeatureFlags(undefined)).toMatchObject({
      showNicCoding: true,
      showNocOutcomes: true,
      showHandoverTimingMetrics: true,
      hideLegacyFields: true,
    });
    expect(resolveUnitFeatureFlags('')).toMatchObject({
      showNicCoding: true,
      showNocOutcomes: true,
      showHandoverTimingMetrics: true,
      hideLegacyFields: true,
    });
    expect(resolveUnitFeatureFlags('   ')).toMatchObject({
      showNicCoding: true,
      showNocOutcomes: true,
      showHandoverTimingMetrics: true,
      hideLegacyFields: true,
    });
  });

  it('coerces boolean-like values from unit JSON and falls back on invalid values', async () => {
    process.env.EXPO_PUBLIC_SHOW_NIC_CODING = 'true';
    process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES = 'false';
    process.env.EXPO_PUBLIC_SHOW_HANDOVER_TIMING_METRICS = 'true';
    process.env.EXPO_PUBLIC_HIDE_LEGACY_FIELDS = 'false';
    process.env.EXPO_PUBLIC_HANDOVER_UNITS_JSON = JSON.stringify([
      {
        id: 'nnn-unit-coerce',
        name: 'Unidad NNN Coerce',
        specialty: 'icu',
        features: {
          showNicCoding: '0',
          showNocOutcomes: '1',
          showHandoverTimingMetrics: 'off',
          hideLegacyFields: 'unexpected',
        },
      },
    ]);

    const { resolveUnitFeatureFlags } = await import('../unitsConfig');

    expect(resolveUnitFeatureFlags('nnn-unit-coerce')).toMatchObject({
      showNicCoding: false,
      showNocOutcomes: true,
      showHandoverTimingMetrics: false,
      hideLegacyFields: false,
    });
  });

  it('falls back to static defaults when HANDOVER_UNITS_JSON is invalid', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_UNITS_JSON = '{invalid-json';

    const { UNITS_CONFIG, resolveUnitFeatureFlags } = await import('../unitsConfig');

    expect(Array.isArray(UNITS_CONFIG)).toBe(true);
    expect(UNITS_CONFIG.length).toBeGreaterThan(0);
    expect(resolveUnitFeatureFlags('icu-adulto')).toMatchObject({
      showNicCoding: false,
      showNocOutcomes: false,
      showHandoverTimingMetrics: false,
      hideLegacyFields: false,
    });
  });

  it('keeps generic behavioral-health units on the shared profile with contextual checklists', async () => {
    const { UNITS_CONFIG } = await import('../unitsConfig');

    expect(UNITS_CONFIG).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'psych-adult-a',
          name: 'Psiquiatria adulto · Unidad A',
          specialty: 'psych',
          profileId: 'behavioral-health',
        }),
        expect.objectContaining({
          id: 'psych-adult-b',
          name: 'Psiquiatria adulto · Unidad B',
          specialty: 'psych',
          profileId: 'behavioral-health',
        }),
        expect.objectContaining({
          id: 'psych-child-adolescent',
          name: 'Psiquiatria infanto-adolescente',
          specialty: 'psych',
          profileId: 'behavioral-health',
        }),
        expect.objectContaining({
          id: 'psychogeriatrics',
          name: 'Psicogeriatria',
          specialty: 'psych',
          profileId: 'behavioral-health',
        }),
      ]),
    );

    const childChecklist = UNITS_CONFIG.find((entry) => entry.id === 'psych-child-adolescent')?.features
      ?.checklistItems;
    const psychogeriatricChecklist = UNITS_CONFIG.find((entry) => entry.id === 'psychogeriatrics')?.features
      ?.checklistItems;

    expect(childChecklist?.some((item) => item.label.includes('familia o tutor'))).toBe(true);
    expect(psychogeriatricChecklist?.some((item) => item.label.includes('basal cognitivo-funcional'))).toBe(true);
  });

  it('normalizes legacy oncology profile ids contextually across compatible base units', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_UNITS_JSON = JSON.stringify([
      {
        id: 'onc-day',
        name: 'Hospital de Dia Oncologico',
        specialty: 'onc',
        profileId: 'oncology',
        specialtyOverlayIds: ['onc'],
      },
      {
        id: 'onc-floor',
        name: 'Oncologia Piso',
        specialty: 'onc',
        profileId: 'oncology',
        specialtyOverlayIds: ['onc'],
      },
      {
        id: 'onc-ed',
        name: 'Urgencias Oncologicas',
        specialty: 'onc',
        profileId: 'oncology',
        specialtyOverlayIds: ['onc'],
      },
      {
        id: 'onc-home',
        name: 'Paliativos Domicilio',
        specialty: 'onc',
        profileId: 'oncology',
        specialtyOverlayIds: ['onc'],
      },
    ]);

    const { UNITS_CONFIG } = await import('../unitsConfig');

    expect(UNITS_CONFIG.find((entry) => entry.id === 'onc-day')).toMatchObject({
      profileId: 'ambulatory',
      specialtyOverlayIds: ['onc'],
    });
    expect(UNITS_CONFIG.find((entry) => entry.id === 'onc-floor')).toMatchObject({
      profileId: 'general-inpatient',
      specialtyOverlayIds: ['onc'],
    });
    expect(UNITS_CONFIG.find((entry) => entry.id === 'onc-ed')).toMatchObject({
      profileId: 'emergency',
      specialtyOverlayIds: ['onc'],
    });
    expect(UNITS_CONFIG.find((entry) => entry.id === 'onc-home')).toMatchObject({
      profileId: 'home-care',
      specialtyOverlayIds: ['onc'],
    });
  });

  it('normalizes legacy pediatric and gyn ids without breaking feature flags fallback', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_UNITS_JSON = JSON.stringify([
      {
        id: 'profiled-unit',
        name: 'Profiled Unit',
        specialty: 'ped',
        profileId: 'pediatrics',
        specialtyOverlayIds: ['ped', 'gyn', 'unknown-overlay'],
        features: {
          showNicCoding: true,
        },
      },
    ]);

    const { UNITS_CONFIG, resolveUnitFeatureFlags } = await import('../unitsConfig');

    expect(UNITS_CONFIG[0]).toMatchObject({
      profileId: 'general-inpatient',
      specialtyOverlayIds: ['pedsSubspecialties', 'gynObs'],
    });
    expect(resolveUnitFeatureFlags('profiled-unit')).toMatchObject({
      showNicCoding: true,
    });
  });

  it('accepts the legacy UNITS_CONFIG object shape and restores default-unit compatibility', async () => {
    process.env.UNITS_CONFIG = JSON.stringify({
      defaultUnit: 'uci-adulto',
      units: [
        { id: 'uci-adulto', name: 'UCI Adulto', isPediatric: false },
        { id: 'pediatria', name: 'Pediatría', isPediatric: true },
      ],
    });

    const { UNITS_CONFIG, getDefaultUnitConfig, getUnitConfig, resolveUnitFeatureFlags } = await import('../unitsConfig');

    expect(UNITS_CONFIG.find((entry) => entry.id === 'uci-adulto')).toMatchObject({
      specialty: 'icu',
      profileId: 'critical-care',
      default: true,
    });
    expect(getDefaultUnitConfig()).toMatchObject({ id: 'uci-adulto' });
    expect(getUnitConfig('pediatria')).toMatchObject({
      specialty: 'ped',
      profileId: 'general-inpatient',
    });
    expect(resolveUnitFeatureFlags('pediatria')).toMatchObject({
      enablePediatricScales: true,
    });
  });

  it('applies the backend-governed NNN gate on top of unit feature flags', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE = 'pilot';
    process.env.EXPO_PUBLIC_SHOW_NIC_CODING = 'true';
    process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES = 'true';
    process.env.EXPO_PUBLIC_HANDOVER_UNITS_JSON = JSON.stringify([
      {
        id: 'nnn-unit',
        name: 'Unidad NNN',
        specialty: 'icu',
        features: {
          showNicCoding: true,
          showNocOutcomes: true,
        },
      },
      {
        id: 'other-unit',
        name: 'Otra unidad',
        specialty: 'icu',
        features: {
          showNicCoding: true,
          showNocOutcomes: true,
        },
      },
    ]);
    mockState.apiGet.mockResolvedValue({
      generatedAt: '2026-03-27T10:00:00Z',
      requestedContext: {
        unitId: 'nnn-unit',
        roles: ['nurse'],
      },
      features: {
        icea_bridge: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
        icea_immediate_scoring: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
        icea_enriched_scoring: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
        icea_patient_risk: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'pilot', denialReason: 'rollout_paused' },
        governed_nnn: { enabled: true, shadow: false, pilotMode: 'pilot', mode: 'pilot', denialReason: null },
        admin_analytics: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: 'role_out_of_scope' },
        ai_suggestions: { enabled: false, shadow: false, pilotMode: 'pilot', mode: 'disabled', denialReason: 'pilot_control_disabled' },
      },
    });

    const { refreshPilotControlContext } = await import('../pilotControl');
    await refreshPilotControlContext({ unitId: 'nnn-unit', roles: ['nurse'] });
    const { resolveUnitFeatureFlags } = await import('../unitsConfig');

    expect(resolveUnitFeatureFlags('nnn-unit', { roles: ['nurse'] })).toMatchObject({
      showNicCoding: true,
      showNocOutcomes: true,
    });
    expect(resolveUnitFeatureFlags('other-unit', { roles: ['nurse'] })).toMatchObject({
      showNicCoding: false,
      showNocOutcomes: false,
    });
  });
});
