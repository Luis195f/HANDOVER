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
    expect(context.catalogSpecialtyOverlayIds).toEqual(['neuroicu']);
    expect(context.specialtyOverlayIds).toEqual([]);
    expect(context.usesCoreFallback).toBe(true);
    expect(context.activeProfileIds).toEqual(['handover-core']);
  });

  it('does not activate an overlay when its base unit profile is not active', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      specialtyOverlays: ['neuroicu'],
    });

    const { resolveProfileContext } = await import('../index');

    const context = resolveProfileContext({ unitId: 'neuroicu-1', specialtyId: 'neuroicu' });

    expect(context.catalogUnitProfileId).toBe('specialized-critical-care');
    expect(context.unitProfileId).toBeNull();
    expect(context.catalogSpecialtyOverlayIds).toEqual(['neuroicu']);
    expect(context.specialtyOverlayIds).toEqual([]);
    expect(context.usesCoreFallback).toBe(true);
    expect(context.activeProfileIds).toEqual(['handover-core']);
  });

  it('ignores an active overlay when it is incompatible with the active unit profile', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['general-inpatient'],
      specialtyOverlays: ['critical-emergency'],
    });

    const { resolveProfileContext, isSpecialtyOverlayActive, isUnitProfileActive } = await import('../index');

    const context = resolveProfileContext({ unitId: 'pediatria', specialtyId: 'ed' });

    expect(isUnitProfileActive('general-inpatient')).toBe(true);
    expect(isSpecialtyOverlayActive('critical-emergency')).toBe(true);
    expect(context.catalogUnitProfileId).toBe('general-inpatient');
    expect(context.unitProfileId).toBe('general-inpatient');
    expect(context.catalogSpecialtyOverlayIds).toEqual(['ped', 'critical-emergency']);
    expect(context.specialtyOverlayIds).toEqual([]);
    expect(context.usesCoreFallback).toBe(false);
    expect(context.activeProfileIds).toEqual(['handover-core', 'general-inpatient']);
  });

  it('activates a compatible overlay only when the base unit profile is also active', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['specialized-critical-care'],
      specialtyOverlays: ['neuroicu'],
    });

    const { resolveProfileContext, isSpecialtyOverlayActive, isUnitProfileActive } = await import('../index');

    const context = resolveProfileContext({ unitId: 'neuroicu-1', specialtyId: 'neuroicu' });

    expect(isUnitProfileActive('specialized-critical-care')).toBe(true);
    expect(isSpecialtyOverlayActive('neuroicu')).toBe(true);
    expect(context.unitProfileId).toBe('specialized-critical-care');
    expect(context.specialtyOverlayIds).toEqual(['neuroicu']);
    expect(context.usesCoreFallback).toBe(false);
    expect(context.activeProfileIds).toEqual(['handover-core', 'specialized-critical-care', 'neuroicu']);
    expect(context.prioritySignals.some((signal) => signal.profileId === 'specialized-critical-care')).toBe(true);
    expect(context.prioritySignals.some((signal) => signal.profileId === 'neuroicu')).toBe(true);
    expect(context.iceaContext.caseMixHints ?? []).toContain('specialized-critical-care');
    expect(context.iceaContext.caseMixHints ?? []).toContain('specialty-neurocritical');
  });

  it('expands legacy oncology activation ids without collapsing them blindly to ambulatory', async () => {
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
      specialtyOverlays: ['ped', 'ob', 'onc'],
    });

    const pediatricContext = resolveProfileContext({ unitId: 'pediatria' });
    expect(pediatricContext.catalogUnitProfileId).toBe('general-inpatient');
    expect(pediatricContext.unitProfileId).toBe('general-inpatient');
    expect(pediatricContext.specialtyOverlayIds).toEqual(['ped']);

    const oncologyDefaultContext = resolveProfileContext({ specialtyId: 'onc' });
    expect(oncologyDefaultContext.catalogUnitProfileId).toBe('general-inpatient');
    expect(oncologyDefaultContext.unitProfileId).toBe('general-inpatient');
    expect(oncologyDefaultContext.specialtyOverlayIds).toEqual(['onc']);

    const oncologyDayHospitalContext = resolveProfileContext({ unitId: 'onc-ward', specialtyId: 'onc' });
    expect(oncologyDayHospitalContext.catalogUnitProfileId).toBe('ambulatory');
    expect(oncologyDayHospitalContext.unitProfileId).toBe('ambulatory');
    expect(oncologyDayHospitalContext.specialtyOverlayIds).toEqual(['onc']);

    const obstetricContext = resolveProfileContext({ specialtyId: 'ob' });
    expect(obstetricContext.catalogSpecialtyOverlayIds).toEqual(['ob']);
  });
});
