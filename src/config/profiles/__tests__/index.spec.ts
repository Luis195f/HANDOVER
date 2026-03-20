import { beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

describe('profile registry activation and fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON;
    delete process.env.HANDOVER_PROFILE_ACTIVATION_JSON;
  });

  it('falls back to HANDOVER Core when a catalog profile exists but is not activated', async () => {
    const { resolveProfileContext, PROFILE_REGISTRY_ACTIVATION } = await import('../index');

    const context = resolveProfileContext({ unitId: 'neuroicu-1', specialtyId: 'neuroicu' });

    expect(PROFILE_REGISTRY_ACTIVATION).toEqual({
      unitProfiles: [],
      specialtyOverlays: [],
    });
    expect(context.catalogUnitProfileId).toBe('specialized-critical-care');
    expect(context.unitProfileId).toBeNull();
    expect(context.catalogSpecialtyOverlayIds).toEqual(['neuro']);
    expect(context.specialtyOverlayIds).toEqual([]);
    expect(context.usesCoreFallback).toBe(true);
    expect(context.activeProfileIds).toEqual(['handover-core']);
  });

  it('does not activate an overlay when its base unit profile is not active even if the legacy id is enabled', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      specialtyOverlays: ['neuroicu'],
    });

    const { resolveProfileContext, PROFILE_REGISTRY_ACTIVATION } = await import('../index');

    const context = resolveProfileContext({ unitId: 'neuroicu-1', specialtyId: 'neuroicu' });

    expect(PROFILE_REGISTRY_ACTIVATION.specialtyOverlays).toEqual(['neuro']);
    expect(context.catalogUnitProfileId).toBe('specialized-critical-care');
    expect(context.unitProfileId).toBeNull();
    expect(context.catalogSpecialtyOverlayIds).toEqual(['neuro']);
    expect(context.specialtyOverlayIds).toEqual([]);
    expect(context.usesCoreFallback).toBe(true);
    expect(context.activeProfileIds).toEqual(['handover-core']);
  });

  it('ignores incompatible overlays while keeping canonical catalog selections visible', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['general-inpatient'],
      specialtyOverlays: ['criticalEmergency', 'pedsSubspecialties'],
    });

    const { resolveProfileContext, isSpecialtyOverlayActive, isUnitProfileActive } = await import('../index');

    const context = resolveProfileContext({ unitId: 'pediatria', specialtyId: 'ed' });

    expect(isUnitProfileActive('general-inpatient')).toBe(true);
    expect(isSpecialtyOverlayActive('criticalEmergency')).toBe(true);
    expect(isSpecialtyOverlayActive('pedsSubspecialties')).toBe(true);
    expect(context.catalogUnitProfileId).toBe('general-inpatient');
    expect(context.unitProfileId).toBe('general-inpatient');
    expect(context.catalogSpecialtyOverlayIds).toEqual(['pedsSubspecialties', 'criticalEmergency']);
    expect(context.specialtyOverlayIds).toEqual(['pedsSubspecialties']);
    expect(context.usesCoreFallback).toBe(false);
    expect(context.activeProfileIds).toEqual(['handover-core', 'general-inpatient', 'pedsSubspecialties']);
  });

  it('activates a compatible overlay and accepts canonical explicit overlay ids without a specialty catalog entry', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['critical-care', 'specialized-critical-care'],
      specialtyOverlays: ['cardio', 'neuro'],
    });

    const { resolveProfileContext, isSpecialtyOverlayActive, isUnitProfileActive } = await import('../index');

    const neuroContext = resolveProfileContext({ unitId: 'neuroicu-1', specialtyId: 'neuroicu' });
    expect(isUnitProfileActive('specialized-critical-care')).toBe(true);
    expect(isSpecialtyOverlayActive('neuro')).toBe(true);
    expect(neuroContext.unitProfileId).toBe('specialized-critical-care');
    expect(neuroContext.specialtyOverlayIds).toEqual(['neuro']);
    expect(neuroContext.activeProfileIds).toEqual(['handover-core', 'specialized-critical-care', 'neuro']);
    expect(neuroContext.prioritySignals.some((signal) => signal.profileId === 'neuro')).toBe(true);
    expect(neuroContext.iceaContext.caseMixHints ?? []).toContain('specialty-neuro');

    const cardioContext = resolveProfileContext({ unitId: 'icu-a', specialtyId: 'cardio' });
    expect(isUnitProfileActive('critical-care')).toBe(true);
    expect(isSpecialtyOverlayActive('cardio')).toBe(true);
    expect(cardioContext.catalogSpecialtyOverlayIds).toEqual(['cardio']);
    expect(cardioContext.specialtyOverlayIds).toEqual(['cardio']);
    expect(cardioContext.activeProfileIds).toEqual(['handover-core', 'critical-care', 'cardio']);
  });

  it('expands legacy oncology and gyne/peds activation ids without collapsing them blindly', async () => {
    process.env.HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: {
        pediatrics: true,
        oncology: true,
        unknown: true,
      },
      specialtyOverlays: {
        ped: true,
        gyn: true,
        onc: true,
        bogus: true,
      },
    });

    const { PROFILE_REGISTRY_ACTIVATION, resolveProfileContext } = await import('../index');

    expect(PROFILE_REGISTRY_ACTIVATION).toEqual({
      unitProfiles: ['general-inpatient', 'ambulatory', 'emergency', 'home-care'],
      specialtyOverlays: ['pedsSubspecialties', 'gynObs', 'onc'],
    });

    const pediatricContext = resolveProfileContext({ unitId: 'pediatria' });
    expect(pediatricContext.catalogUnitProfileId).toBe('general-inpatient');
    expect(pediatricContext.unitProfileId).toBe('general-inpatient');
    expect(pediatricContext.catalogSpecialtyOverlayIds).toEqual(['pedsSubspecialties']);
    expect(pediatricContext.specialtyOverlayIds).toEqual(['pedsSubspecialties']);

    const oncologyDefaultContext = resolveProfileContext({ specialtyId: 'onc' });
    expect(oncologyDefaultContext.catalogUnitProfileId).toBe('general-inpatient');
    expect(oncologyDefaultContext.unitProfileId).toBe('general-inpatient');
    expect(oncologyDefaultContext.specialtyOverlayIds).toEqual(['onc']);

    const oncologyDayHospitalContext = resolveProfileContext({ unitId: 'onc-ward', specialtyId: 'onc' });
    expect(oncologyDayHospitalContext.catalogUnitProfileId).toBe('ambulatory');
    expect(oncologyDayHospitalContext.unitProfileId).toBe('ambulatory');
    expect(oncologyDayHospitalContext.specialtyOverlayIds).toEqual(['onc']);

    const obstetricContext = resolveProfileContext({ specialtyId: 'ob' });
    expect(obstetricContext.catalogSpecialtyOverlayIds).toEqual(['gynObs']);
  });
});
