import { beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
const isOn = vi.fn<(name: string) => boolean>(() => true);

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

vi.mock('@/src/config/flags', () => ({
  isOn: (name: string) => isOn(name),
}));

describe('resolveHandoverProfileRuntime', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON;
    delete process.env.HANDOVER_PROFILE_ACTIVATION_JSON;
    delete process.env.EXPO_PUBLIC_HANDOVER_UNITS_JSON;
    delete process.env.HANDOVER_UNITS_JSON;
    delete process.env.UNITS_CONFIG;
    isOn.mockReset();
    isOn.mockReturnValue(true);
  });

  it('falls back to HANDOVER Core when no active UPP is resolved for a catalog-only unit', async () => {
    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'neuroicu-1', specialtyId: 'neuroicu' });

    expect(runtime.context.usesCoreFallback).toBe(true);
    expect(runtime.pack.id).toBe('handover-core');
    expect(runtime.sectionVisibility.turno).toBe(true);
    expect(runtime.sectionVisibility.nutrition).toBe(false);
    expect(runtime.medicationQuickPicks).toEqual([]);
  });

  it('uses the configured default unit runtime when the selected unit is unknown', async () => {
    process.env.UNITS_CONFIG = JSON.stringify({
      defaultUnit: 'uci-adulto',
      units: [
        { id: 'uci-adulto', name: 'UCI Adulto', specialty: 'icu', profileId: 'critical-care' },
        {
          id: 'pediatria',
          name: 'Pediatría',
          specialty: 'ped',
          profileId: 'general-inpatient',
          features: { enablePediatricScales: true },
        },
      ],
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'missing-unit', specialtyId: 'icu' });

    expect(runtime.context.usesCoreFallback).toBe(true);
    expect(runtime.pack.id).toBe('critical-care');
    expect(runtime.sectionVisibility.escalas).toBe(true);
    expect(runtime.suggestedScales).toEqual(expect.arrayContaining(['Glasgow', 'Braden']));
  });

  it('keeps pediatric runtime compatibility through the configured unit catalog', async () => {
    process.env.UNITS_CONFIG = JSON.stringify({
      defaultUnit: 'uci-adulto',
      units: [
        { id: 'uci-adulto', name: 'UCI Adulto', specialty: 'icu', profileId: 'critical-care' },
        {
          id: 'pediatria',
          name: 'Pediatría',
          specialty: 'ped',
          profileId: 'general-inpatient',
          specialtyOverlayIds: ['ped'],
          features: { enablePediatricScales: true },
        },
      ],
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'pediatria', specialtyId: 'icu' });

    expect(runtime.context.catalogUnitProfileId).toBe('general-inpatient');
    expect(runtime.context.usesCoreFallback).toBe(true);
    expect(runtime.pack.id).toBe('general-inpatient');
    expect(runtime.sectionVisibility.escalas).toBe(true);
    expect(runtime.notes).toContain('Escalas pediátricas próximamente.');
  });

  it('resolves an active critical-care UPP with profile-driven scales and quick-picks', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['critical-care'],
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'icu-a', specialtyId: 'icu' });

    expect(runtime.context.unitProfileId).toBe('critical-care');
    expect(runtime.pack.id).toBe('critical-care');
    expect(runtime.sectionVisibility.escalas).toBe(true);
    expect(runtime.sectionVisibility.fluidBalance).toBe(true);
    expect(runtime.suggestedScales).toEqual(expect.arrayContaining(['Glasgow', 'Braden']));
    expect(runtime.medicationQuickPicks.length).toBeGreaterThan(0);
    expect(runtime.visibleOutputs).toContain('Resumen de microvigilancia');
  });

  it('changes visible sections when the active unit switches between UPPs', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['critical-care', 'general-inpatient'],
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const criticalCare = resolveHandoverProfileRuntime({ unitId: 'icu-a', specialtyId: 'icu' });
    const inpatient = resolveHandoverProfileRuntime({ unitId: 'ped-ward', specialtyId: 'ped' });

    expect(criticalCare.sectionVisibility.fluidBalance).toBe(true);
    expect(criticalCare.sectionVisibility.nutrition).toBe(false);
    expect(inpatient.sectionVisibility.nutrition).toBe(true);
    expect(inpatient.sectionVisibility.mobilitySkin).toBe(true);
    expect(inpatient.sectionVisibility.fluidBalance).toBe(false);
    expect(inpatient.sectionVisibility.escalas).toBe(true);
  });

  it('covers every resolvable unit profile with a runtime pack', async () => {
    const { PROFILE_REGISTRY } = await import('@/src/config/profiles');
    const { UNIT_PROFILE_RUNTIME_PACKS } = await import('@/src/config/profiles/units');

    expect(Object.keys(UNIT_PROFILE_RUNTIME_PACKS).sort()).toEqual(
      Object.keys(PROFILE_REGISTRY.unitProfiles).sort(),
    );
  });
});
