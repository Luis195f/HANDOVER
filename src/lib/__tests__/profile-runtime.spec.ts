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
    vi.doUnmock('@/src/config/profiles/overlays');
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
    expect(runtime.activeOverlays).toEqual([]);
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
    expect(runtime.basePack.id).toBe('critical-care');
    expect(runtime.sectionVisibility.escalas).toBe(true);
    expect(runtime.suggestedScales).toEqual(expect.arrayContaining(['Glasgow', 'Braden']));
    expect(runtime.mergeTrace.map((entry) => entry.label)).toEqual(['HANDOVER Core', 'UCI adulto']);
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
    expect(runtime.context.overlaySelections.map((selection) => selection.overlayId)).toEqual(['ped']);
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

  it('lets the last SOP win collisions for hiddenSections and visibility while preserving merge order', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['emergency'],
      specialtyOverlays: ['ped', 'critical-emergency'],
    });
    process.env.UNITS_CONFIG = JSON.stringify({
      units: [
        {
          id: 'peds-ed',
          name: 'Urgencias Pediátricas',
          specialty: 'ped',
          profileId: 'emergency',
          specialtyOverlayIds: ['ped'],
        },
      ],
    });

    vi.doMock('@/src/config/profiles/overlays', async () => {
      const actual = await vi.importActual<typeof import('@/src/config/profiles/overlays')>('@/src/config/profiles/overlays');

      return {
        ...actual,
        SPECIALTY_OVERLAY_RUNTIME_PACKS: {
          ...actual.SPECIALTY_OVERLAY_RUNTIME_PACKS,
          ped: {
            ...actual.SPECIALTY_OVERLAY_RUNTIME_PACKS.ped,
            hiddenSections: ['psychosocial'],
            visibility: {
              'legacy-nursing-diagnosis-text': true,
            },
          },
          'critical-emergency': {
            ...actual.SPECIALTY_OVERLAY_RUNTIME_PACKS['critical-emergency'],
            hiddenSections: ['outcomes'],
            visibility: {
              'legacy-nursing-diagnosis-text': false,
            },
          },
        },
      };
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'peds-ed', specialtyId: 'ed' });

    expect(runtime.context.unitProfileId).toBe('emergency');
    expect(runtime.context.specialtyOverlayIds).toEqual(['ped', 'critical-emergency']);
    expect(runtime.activeOverlays.map((overlay) => overlay.label)).toEqual([
      'Pediatria y subespecialidades',
      'Medicina critica y emergencias',
    ]);
    expect(runtime.focusAreas).toEqual(
      expect.arrayContaining(['Edad, peso y seguridad de dosis', 'ABCDE y soporte avanzado']),
    );
    expect(runtime.pack.hiddenSections).toEqual(['outcomes']);
    expect(runtime.sectionVisibility.psychosocial).toBe(true);
    expect(runtime.sectionVisibility.outcomes).toBe(false);
    expect(runtime.fieldVisibility['legacy-nursing-diagnosis-text']).toBe(false);
    expect(runtime.mergeTrace.map((entry) => entry.profileId)).toEqual([
      'handover-core',
      'emergency',
      'ped',
      'critical-emergency',
    ]);
  });

  it('tracks explicit specialty override alongside unit-config overlays for downstream traceability', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['general-inpatient'],
      specialtyOverlays: ['infect', 'onc'],
    });
    process.env.UNITS_CONFIG = JSON.stringify({
      units: [
        {
          id: 'ward-a',
          name: 'Sala A',
          specialty: 'infect',
          profileId: 'general-inpatient',
          specialtyOverlayIds: ['infect'],
        },
      ],
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'ward-a', specialtyId: 'onc' });

    expect(runtime.context.specialtySource).toBe('explicit');
    expect(runtime.context.hasHumanSpecialtyOverride).toBe(true);
    expect(runtime.context.overlaySelections).toEqual([
      {
        overlayId: 'infect',
        source: 'unit-config',
        specialtyId: undefined,
        isHumanOverride: false,
      },
      {
        overlayId: 'onc',
        source: 'specialty',
        specialtyId: 'onc',
        isHumanOverride: true,
      },
    ]);
    expect(runtime.context.specialtyOverlayIds).toEqual(['infect', 'onc']);
    expect(runtime.activeOverlays[1]?.isHumanOverride).toBe(true);
    expect(runtime.mergeTrace.map((entry) => entry.profileId)).toEqual([
      'handover-core',
      'general-inpatient',
      'infect',
      'onc',
    ]);
  });

  it('keeps legacy narrative fields visible when hideLegacyFields is disabled and the runtime pack enables them', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['critical-care'],
    });
    isOn.mockImplementation((name) => name !== 'HIDE_LEGACY_FIELDS');

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'icu-a', specialtyId: 'icu' });

    expect(runtime.pack.id).toBe('critical-care');
    expect(runtime.pack.visibility?.['legacy-sbar-narrative']).toBe(true);
    expect(runtime.pack.visibility?.['legacy-medication-text']).toBe(true);
    expect(runtime.fieldVisibility['legacy-sbar-narrative']).toBe(true);
    expect(runtime.fieldVisibility['legacy-medication-text']).toBe(true);
  });

  it('keeps hideLegacyFields as a final guardrail for legacy narrative fields after resolving the runtime pack', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['critical-care'],
    });
    isOn.mockReturnValue(true);

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'icu-a', specialtyId: 'icu' });

    expect(runtime.pack.id).toBe('critical-care');
    expect(runtime.pack.visibility?.['legacy-sbar-narrative']).toBe(true);
    expect(runtime.pack.visibility?.['legacy-medication-text']).toBe(true);
    expect(runtime.fieldVisibility['legacy-sbar-narrative']).toBe(false);
    expect(runtime.fieldVisibility['legacy-medication-text']).toBe(false);
  });
  it('covers every resolvable profile and overlay runtime pack', async () => {
    const { PROFILE_REGISTRY } = await import('@/src/config/profiles');
    const { UNIT_PROFILE_RUNTIME_PACKS } = await import('@/src/config/profiles/units');
    const { SPECIALTY_OVERLAY_RUNTIME_PACKS } = await import('@/src/config/profiles/overlays');

    expect(Object.keys(UNIT_PROFILE_RUNTIME_PACKS).sort()).toEqual(
      Object.keys(PROFILE_REGISTRY.unitProfiles).sort(),
    );
    expect(Object.keys(SPECIALTY_OVERLAY_RUNTIME_PACKS).sort()).toEqual(
      Object.keys(PROFILE_REGISTRY.specialtyOverlays).sort(),
    );
  });
});



