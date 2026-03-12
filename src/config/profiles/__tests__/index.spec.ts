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
    expect(context.catalogUnitProfileId).toBe('critical-care');
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

    expect(context.catalogUnitProfileId).toBe('critical-care');
    expect(context.unitProfileId).toBeNull();
    expect(context.catalogSpecialtyOverlayIds).toEqual(['neuroicu']);
    expect(context.specialtyOverlayIds).toEqual([]);
    expect(context.usesCoreFallback).toBe(true);
    expect(context.activeProfileIds).toEqual(['handover-core']);
  });

  it('ignores an active overlay when it is incompatible with the active unit profile', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['pediatrics'],
      specialtyOverlays: ['neuroicu'],
    });

    const { resolveProfileContext, isSpecialtyOverlayActive, isUnitProfileActive } = await import('../index');

    const context = resolveProfileContext({ unitId: 'pediatria', specialtyId: 'neuroicu' });

    expect(isUnitProfileActive('pediatrics')).toBe(true);
    expect(isSpecialtyOverlayActive('neuroicu')).toBe(true);
    expect(context.catalogUnitProfileId).toBe('pediatrics');
    expect(context.unitProfileId).toBe('pediatrics');
    expect(context.catalogSpecialtyOverlayIds).toEqual(['ped', 'neuroicu']);
    expect(context.specialtyOverlayIds).toEqual([]);
    expect(context.usesCoreFallback).toBe(false);
    expect(context.activeProfileIds).toEqual(['handover-core', 'pediatrics']);
  });

  it('activates a compatible overlay only when the base unit profile is also active', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['critical-care'],
      specialtyOverlays: ['neuroicu'],
    });

    const { resolveProfileContext, isSpecialtyOverlayActive, isUnitProfileActive } = await import('../index');

    const context = resolveProfileContext({ unitId: 'neuroicu-1', specialtyId: 'neuroicu' });

    expect(isUnitProfileActive('critical-care')).toBe(true);
    expect(isSpecialtyOverlayActive('neuroicu')).toBe(true);
    expect(context.unitProfileId).toBe('critical-care');
    expect(context.specialtyOverlayIds).toEqual(['neuroicu']);
    expect(context.usesCoreFallback).toBe(false);
    expect(context.activeProfileIds).toEqual(['handover-core', 'critical-care', 'neuroicu']);
    expect(context.prioritySignals.some((signal) => signal.profileId === 'critical-care')).toBe(true);
    expect(context.prioritySignals.some((signal) => signal.profileId === 'neuroicu')).toBe(true);
    expect(context.iceaContext.caseMixHints ?? []).toContain('critical-care');
    expect(context.iceaContext.caseMixHints ?? []).toContain('specialty-neurocritical');
  });

  it('filters unknown ids and keeps safe activation behavior', async () => {
    process.env.HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: {
        pediatrics: true,
        unknown: true,
      },
      specialtyOverlays: {
        ped: true,
        bogus: true,
      },
    });

    const { PROFILE_REGISTRY_ACTIVATION, resolveProfileContext } = await import('../index');

    expect(PROFILE_REGISTRY_ACTIVATION).toEqual({
      unitProfiles: ['pediatrics'],
      specialtyOverlays: ['ped'],
    });

    const context = resolveProfileContext({ unitId: 'pediatria' });
    expect(context.catalogUnitProfileId).toBe('pediatrics');
    expect(context.unitProfileId).toBe('pediatrics');
    expect(context.specialtyOverlayIds).toEqual(['ped']);
    expect(context.activeProfileIds).toEqual(['handover-core', 'pediatrics', 'ped']);
  });
});
