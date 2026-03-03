import { beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

describe('unitsConfig advanced flags by unit', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.EXPO_PUBLIC_SHOW_NIC_CODING;
    delete process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES;
    delete process.env.EXPO_PUBLIC_SHOW_HANDOVER_TIMING_METRICS;
    delete process.env.EXPO_PUBLIC_HIDE_LEGACY_FIELDS;
    delete process.env.EXPO_PUBLIC_HANDOVER_UNITS_JSON;
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
      showNicCoding: false,
      showNocOutcomes: false,
      showHandoverTimingMetrics: false,
      hideLegacyFields: false,
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
});
