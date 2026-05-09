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

const readBehavioralHealthPackSurfaces = (
  runtime: Pick<
    Awaited<ReturnType<(typeof import('../profile-runtime'))['resolveHandoverProfileRuntime']>>,
    'requiredExtraFields' | 'optionalExtraFields' | 'focusAreas' | 'visibleOutputs' | 'treatmentQuickPicks'
  >,
) => [
  ...runtime.requiredExtraFields,
  ...runtime.optionalExtraFields,
  ...runtime.focusAreas,
  ...runtime.visibleOutputs,
  ...runtime.treatmentQuickPicks.map((quickPick) => quickPick.description),
].join(' | ');

const expectNoUdccSpecificPackCopy = (
  runtime: Pick<
    Awaited<ReturnType<(typeof import('../profile-runtime'))['resolveHandoverProfileRuntime']>>,
    'requiredExtraFields' | 'optionalExtraFields' | 'focusAreas' | 'visibleOutputs' | 'treatmentQuickPicks'
  >,
) => {
  const surfaces = readBehavioralHealthPackSurfaces(runtime);

  expect(surfaces).not.toContain('basal cognitivo-funcional');
  expect(surfaces).not.toContain('deambulacion supervisada');
  expect(surfaces).not.toContain('continencia');
  expect(surfaces).not.toContain('piel');
};

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
    expect(runtime.context.catalogUnitProfileId).toBe('specialized-critical-care');
    expect(runtime.pack.id).toBe('specialized-critical-care');
    expect(runtime.basePack.id).toBe('specialized-critical-care');
    expect(runtime.sectionVisibility.turno).toBe(true);
    expect(runtime.sectionVisibility.nutrition).toBe(false);
    expect(runtime.requiredExtraFields).toEqual([]);
    expect(runtime.checklistItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'patientIdentityConfirmed' }),
      ]),
    );
    expect(runtime.medicationQuickPicks).toEqual([]);
    expect(runtime.activeOverlays).toEqual([]);
  });

  it('keeps pilot-critical continuity sections wired in HANDOVER Core', async () => {
    const { HANDOVER_CORE_RUNTIME_PACK } = await import('@/src/config/profiles/units');

    expect(HANDOVER_CORE_RUNTIME_PACK.enabledSections).toEqual(
      expect.arrayContaining(['oxigenoterapia', 'escalas', 'examenes']),
    );
  });

  it('exposes pilot-critical continuity sections only in the pure HANDOVER Core fallback', async () => {
    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'unknown-unit', specialtyId: 'unknown-specialty' });

    expect(runtime.context.usesCoreFallback).toBe(true);
    expect(runtime.pack.id).toBe('handover-core');
    expect(runtime.basePack.id).toBe('handover-core');
    expect(runtime.sectionVisibility.oxigenoterapia).toBe(true);
    expect(runtime.sectionVisibility.escalas).toBe(true);
    expect(runtime.sectionVisibility.examenes).toBe(true);
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
    expect(runtime.suggestedScales).toEqual([]);
    expect(runtime.requiredExtraFields).toEqual([]);
    expect(runtime.focusAreas).toEqual([]);
    expect(runtime.mergeTrace.map((entry) => entry.label)).toEqual(['HANDOVER Core', 'UCI adulto']);
  });

  it('keeps pediatric runtime catalog traceability without auto-activating the registry-only overlay', async () => {
    process.env.UNITS_CONFIG = JSON.stringify({
      defaultUnit: 'uci-adulto',
      units: [
        { id: 'uci-adulto', name: 'UCI Adulto', specialty: 'icu', profileId: 'critical-care' },
        {
          id: 'pediatria',
          name: 'Pediatría',
          specialty: 'ped',
          profileId: 'general-inpatient',
          specialtyOverlayIds: ['pedsSubspecialties'],
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
    expect(runtime.notes).toEqual([]);
    expect(runtime.context.overlaySelections.map((selection) => selection.overlayId)).toEqual(['pedsSubspecialties']);
    expect(runtime.context.specialtyOverlayIds).toEqual([]);
  });

  it('resolves a compatible base pack from canonical specialtyId without borrowing the default unit', async () => {
    process.env.UNITS_CONFIG = JSON.stringify({
      defaultUnit: 'uci-adulto',
      units: [
        { id: 'uci-adulto', name: 'UCI Adulto', specialty: 'icu', profileId: 'critical-care' },
      ],
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ specialtyId: 'ped' });

    expect(runtime.context.unitId).toBeUndefined();
    expect(runtime.context.specialtyId).toBe('ped');
    expect(runtime.context.catalogUnitProfileId).toBe('general-inpatient');
    expect(runtime.pack.id).toBe('general-inpatient');
    expect(runtime.basePack.id).toBe('general-inpatient');
  });

  it('activates the pediatric overlay on a general pediatric floor when both base and overlay are active', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['general-inpatient'],
      specialtyOverlays: ['pedsSubspecialties'],
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'pediatria' });

    expect(runtime.context.catalogUnitProfileId).toBe('general-inpatient');
    expect(runtime.context.unitProfileId).toBe('general-inpatient');
    expect(runtime.context.specialtyOverlayIds).toEqual(['pedsSubspecialties']);
    expect(runtime.pack.id).toBe('general-inpatient');
    expect(runtime.basePack.id).toBe('general-inpatient');
    expect(runtime.activeOverlays.map((overlay) => overlay.id)).toEqual(['pedsSubspecialties']);
    expect(runtime.suggestedScales).toEqual(expect.arrayContaining(['Barthel / Katz', 'CAM', 'PEWS local']));
    expect(runtime.requiredExtraFields).toEqual(
      expect.arrayContaining(['Dependencia funcional y fragilidad', 'Peso y edad', 'Comunicacion con familia']),
    );
  });

  it('does not leak fallback-only continuity sections into known maternal-perinatal runtime packs', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['maternal-perinatal'],
    });
    process.env.UNITS_CONFIG = JSON.stringify({
      units: [
        { id: 'ob-floor', name: 'Obstetricia', specialty: 'obs', profileId: 'maternal-perinatal' },
      ],
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');
    const { UNIT_PROFILE_RUNTIME_PACKS } = await import('@/src/config/profiles/units');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'ob-floor', specialtyId: 'obs' });

    expect(UNIT_PROFILE_RUNTIME_PACKS['maternal-perinatal'].enabledSections).not.toEqual(
      expect.arrayContaining(['oxigenoterapia', 'escalas', 'examenes']),
    );
    expect(runtime.context.unitProfileId).toBe('maternal-perinatal');
    expect(runtime.pack.id).toBe('maternal-perinatal');
    expect(runtime.sectionVisibility.psychosocial).toBe(true);
    expect(runtime.sectionVisibility.oxigenoterapia).toBe(false);
    expect(runtime.sectionVisibility.escalas).toBe(false);
    expect(runtime.sectionVisibility.examenes).toBe(false);
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

  it('projects the first wave operational packs into runtime focus, outputs and checklist labels', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['critical-care', 'general-inpatient', 'emergency'],
    });
    process.env.UNITS_CONFIG = JSON.stringify({
      units: [
        { id: 'ward-mi', name: 'Medicina Interna A', specialty: 'med', profileId: 'general-inpatient' },
      ],
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const criticalCare = resolveHandoverProfileRuntime({ unitId: 'icu-a', specialtyId: 'icu' });
    expect(criticalCare.focusAreas).toEqual(
      expect.arrayContaining(['Ventilacion, sedacion y perfusion minuto a minuto']),
    );
    expect(criticalCare.explanations).toContain(
      'Prioriza soporte ventilatorio, sedacion, vasoactivos y checklist de vigilancia critica dentro del formulario unico.',
    );
    expect(criticalCare.visibleOutputs).toContain('Checklist de vigilancia critica');
    expect(criticalCare.checklistItems[0]?.label).toBe('Paciente, cama y objetivos criticos confirmados');
    expect(criticalCare.checklistItems[0]?.helper).toContain('metas ventilatorias');
    expect(criticalCare.checklistItems.at(-1)?.label).toBe('Preguntas del equipo entrante resueltas');

    const generalInpatient = resolveHandoverProfileRuntime({ unitId: 'ward-mi', specialtyId: 'med' });
    expect(generalInpatient.focusAreas).toEqual(
      expect.arrayContaining(['Fragilidad, dependencia y delirium']),
    );
    expect(generalInpatient.suggestedScales).toEqual(expect.arrayContaining(['Barthel / Katz', 'CAM']));
    expect(generalInpatient.visibleOutputs).toContain('Riesgos de omision y alta compleja');
    expect(generalInpatient.checklistItems[1]?.label).toContain('conciliacion terapeutica');
    expect(generalInpatient.checklistItems.at(-1)?.label).toBe('Preguntas del equipo entrante resueltas');

    const emergency = resolveHandoverProfileRuntime({ unitId: 'ed-main', specialtyId: 'ed' });
    expect(emergency.focusAreas).toEqual(
      expect.arrayContaining(['Triage, motivo sindromico y ventana desde la llegada']),
    );
    expect(emergency.explanations).toContain(
      'Prioriza triage, hora de llegada, reevaluacion y destino sin abrir un formulario paralelo.',
    );
    expect(emergency.visibleOutputs).toContain('Destino probable explicitado');
    expect(emergency.checklistItems[0]?.label).toContain('triage y motivo sindromico');
    expect(emergency.checklistItems.at(-1)?.label).toBe('Preguntas del equipo entrante resueltas');
  });

  it('resolves SJD psychiatry units onto the shared behavioral-health runtime without opening a parallel form', async () => {
    process.env.UNITS_CONFIG = JSON.stringify({
      units: [
        {
          id: 'sjd-a',
          name: 'Psiquiatria adulto · SJD A',
          specialty: 'psych',
          profileId: 'behavioral-health',
          features: { enablePsychosocialExtra: true },
        },
      ],
    });
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['behavioral-health'],
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'sjd-a', specialtyId: 'psych' });

    expect(runtime.context.catalogUnitProfileId).toBe('behavioral-health');
    expect(runtime.context.unitProfileId).toBe('behavioral-health');
    expect(runtime.context.specialtyId).toBe('psych');
    expect(runtime.context.specialtyOverlayIds).toEqual([]);
    expect(runtime.pack.id).toBe('behavioral-health');
    expect(runtime.basePack.id).toBe('behavioral-health');
    expect(runtime.sectionVisibility.psychosocial).toBe(true);
    expect(runtime.sectionVisibility.nutrition).toBe(true);
    expect(runtime.sectionVisibility.examenes).toBe(true);
    expect(runtime.requiredExtraFields).toEqual(
      expect.arrayContaining([
        'Estado basal y cambio observado',
        'Observacion especial, acompanamiento o nivel de supervision requerido',
        'Riesgo de seguridad fisica y apoyo para movilidad o traslados cuando aplique',
        'Riesgo de fuga o no retorno',
        'Entorno seguro y elementos que deban resguardarse',
        'Coordinacion interna pendiente y reevaluacion del siguiente turno',
      ]),
    );
    expect(runtime.optionalExtraFields).toContain(
      'Evento de contencion trazable: autorizacion, revision, vigencia y reevaluacion',
    );
    expect(runtime.explanations).toContain(
      'MPAC para salud mental se proyecta aqui como prioridades explicables de continuidad y seguridad; no sustituye juicio clinico ni activa scoring autonomo.',
    );
    expect(runtime.explanations).toContain(
      'No presenta ranking individual ni validacion clinica; ordena de forma prudente lo que el relevo no debe omitir.',
    );
    expect(runtime.visibleOutputs).toContain('Continuidad del relevo explicitada para el siguiente turno');
    expect(runtime.visibleOutputs).toContain('Riesgo de omision en medicacion, tratamiento, vigilancia o coordinacion visible');
    expect(runtime.visibleOutputs).toContain('Cambio respecto al basal resumido sin etiquetas estigmatizantes');
    expect(runtime.visibleOutputs).toContain('Necesidad de reevaluacion y siguiente ventana del turno visibles');
    expect(runtime.visibleOutputs).toContain('Coordinacion interna pendiente y referente del relevo explicitados');
    expect(runtime.visibleOutputs).toContain('Seguridad del entorno y resguardo de elementos retirables visibles');
    expect(runtime.visibleOutputs).toContain('Adherencia o rechazo terapeutico con continuidad del plan');
    expect(runtime.visibleOutputs).toContain('Fuga o no retorno y supervision requerida visibles');
    expect(runtime.visibleOutputs).toContain('Seguridad fisica y apoyo para movilidad explicitados cuando apliquen');
    expect(runtime.visibleOutputs).toContain('Dispositivos o tratamientos retirables con trazabilidad para el relevo');
    expect(runtime.visibleOutputs).toContain('Observacion especial o acompanamiento explicitados');
    expect(runtime.visibleOutputs).toContain('Evento de contencion trazable sin instrucciones operativas');
    expectNoUdccSpecificPackCopy(runtime);
    expect(runtime.checklistItems[0]?.label).toContain('ubicacion funcional');
    expect(runtime.checklistItems[1]?.label).toContain('caidas');
    expect(runtime.checklistItems[2]?.label).toContain('elementos retirables');
    expect(runtime.checklistItems[4]?.label).toContain('contencion');
    expect(runtime.checklistItems.some((item) => item.label.includes('basal cognitivo-funcional'))).toBe(false);
    expect(runtime.checklistItems.some((item) => item.label.includes('deambulacion supervisada'))).toBe(false);
  });

  it('keeps child-adolescent psychiatry on the shared behavioral-health core while projecting a unit-specific checklist', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['behavioral-health'],
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'sjd-infanto', specialtyId: 'psych' });

    expect(runtime.context.catalogUnitProfileId).toBe('behavioral-health');
    expect(runtime.context.unitProfileId).toBe('behavioral-health');
    expect(runtime.context.specialtyOverlayIds).toEqual([]);
    expect(runtime.pack.id).toBe('behavioral-health');
    expect(runtime.basePack.id).toBe('behavioral-health');
    expect(runtime.activeOverlays).toEqual([]);
    expect(runtime.optionalExtraFields).toEqual(
      expect.arrayContaining([
        'Evento de contencion trazable: autorizacion, revision, vigencia y reevaluacion',
        'Responsable o referente de comunicacion interna y relacion terapeutica relevante',
        'Coordinacion con familia, tutor o cuidadores cuando aplique',
      ]),
    );
    expectNoUdccSpecificPackCopy(runtime);
    expect(runtime.checklistItems[0]?.label).toBe('Paciente, ubicacion funcional y referente interno confirmados');
    expect(runtime.checklistItems[2]?.label).toContain('fuga/no retorno');
    expect(runtime.checklistItems[4]?.label).toContain('familia o tutor');
    expect(runtime.checklistItems.some((item) => item.label.includes('basal cognitivo-funcional'))).toBe(false);
    expect(runtime.checklistItems.some((item) => item.label.includes('deambulacion supervisada'))).toBe(false);
  });

  it('keeps psychogeriatrics on the shared behavioral-health core while projecting a unit-specific checklist', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['behavioral-health'],
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'udcc-psychogeriatrics', specialtyId: 'psych' });

    expect(runtime.context.catalogUnitProfileId).toBe('behavioral-health');
    expect(runtime.context.unitProfileId).toBe('behavioral-health');
    expect(runtime.context.specialtyOverlayIds).toEqual([]);
    expect(runtime.pack.id).toBe('behavioral-health');
    expect(runtime.basePack.id).toBe('behavioral-health');
    expect(runtime.activeOverlays).toEqual([]);
    expect(runtime.requiredExtraFields).toEqual(
      expect.arrayContaining([
        'Observacion especial, acompanamiento o nivel de supervision requerido',
        'Riesgo de seguridad fisica y apoyo para movilidad o traslados cuando aplique',
      ]),
    );
    expect(runtime.optionalExtraFields).toEqual(
      expect.arrayContaining([
        'Necesidades fisicas o de autocuidado que condicionen la continuidad del turno',
        'Cambios cognitivo-conductuales o funcionales que condicionen la continuidad del turno',
        'Dispositivos o tratamientos que el paciente pueda retirarse',
      ]),
    );
    expect(runtime.focusAreas).toEqual(
      expect.arrayContaining([
        'Seguridad fisica, fuga/no retorno y elementos retirables que requieren continuidad',
        'Ingesta, hidratacion, sueno, acompanamiento requerido y coordinacion interna pendiente',
      ]),
    );
    expect(runtime.visibleOutputs).toContain('Coordinacion interna pendiente y referente del relevo explicitados');
    expect(runtime.visibleOutputs).toContain('Seguridad fisica y apoyo para movilidad explicitados cuando apliquen');
    expectNoUdccSpecificPackCopy(runtime);
    expect(runtime.checklistItems[0]?.label).toBe(
      'Paciente, ubicacion funcional, basal cognitivo-funcional y supervision requerida confirmados',
    );
    expect(runtime.checklistItems[1]?.label).toContain('deambulacion supervisada');
    expect(runtime.checklistItems[2]?.label).toContain('continencia');
    expect(runtime.checklistItems[3]?.label).toContain('adherencia terapeutica');
    expect(runtime.checklistItems[4]?.label).toContain('reevaluacion');
    expect(runtime.treatmentQuickPicks.map((quickPick) => quickPick.id)).toEqual(
      expect.arrayContaining(['psych-intake-sleep', 'psych-continuity']),
    );
    expect(runtime.checklistItems.some((item) => item.label.includes('familia o tutor'))).toBe(false);
  });

  it('keeps hidden sections monotonic across compatible overlay merges while preserving trace order', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['emergency'],
      specialtyOverlays: ['infecto', 'criticalEmergency'],
    });
    process.env.UNITS_CONFIG = JSON.stringify({
      units: [
        {
          id: 'infect-ed',
          name: 'Urgencias Infecto',
          specialty: 'infect',
          profileId: 'emergency',
          specialtyOverlayIds: ['infecto'],
        },
      ],
    });

    vi.doMock('@/src/config/profiles/overlays', async () => {
      const actual = await vi.importActual<typeof import('@/src/config/profiles/overlays')>('@/src/config/profiles/overlays');

      return {
        ...actual,
        SPECIALTY_OVERLAY_RUNTIME_PACKS: {
          ...actual.SPECIALTY_OVERLAY_RUNTIME_PACKS,
          infecto: {
            ...actual.SPECIALTY_OVERLAY_RUNTIME_PACKS.infecto,
            hiddenSections: ['psychosocial'],
          },
          criticalEmergency: {
            ...actual.SPECIALTY_OVERLAY_RUNTIME_PACKS.criticalEmergency,
            hiddenSections: ['outcomes'],
            visibility: {
              'legacy-nursing-diagnosis-text': false,
            },
          },
        },
      };
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'infect-ed', specialtyId: 'ed' });

    expect(runtime.context.unitProfileId).toBe('emergency');
    expect(runtime.context.specialtyOverlayIds).toEqual(['infecto', 'criticalEmergency']);
    expect(runtime.activeOverlays.map((overlay) => overlay.label)).toEqual([
      'Infectologia',
      'Medicina critica y emergencias',
    ]);
    expect(runtime.focusAreas).toEqual(
      expect.arrayContaining(['Foco infeccioso, sepsis y adherencia a aislamiento', 'ABCDE, soporte avanzado y respuesta inmediata']),
    );
    expect(runtime.pack.hiddenSections).toEqual(['psychosocial', 'outcomes']);
    expect(runtime.sectionVisibility.psychosocial).toBe(false);
    expect(runtime.sectionVisibility.outcomes).toBe(false);
    expect(runtime.fieldVisibility['legacy-nursing-diagnosis-text']).toBe(false);
    expect(runtime.mergeTrace.map((entry) => entry.profileId)).toEqual([
      'handover-core',
      'emergency',
      'infecto',
      'criticalEmergency',
    ]);
  });

  it('blocks overlays from reactivating fields hidden by earlier layers and records the guardrail', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['emergency'],
      specialtyOverlays: ['infecto', 'criticalEmergency'],
    });
    process.env.UNITS_CONFIG = JSON.stringify({
      units: [
        {
          id: 'infect-ed',
          name: 'Urgencias Infecto',
          specialty: 'infect',
          profileId: 'emergency',
          specialtyOverlayIds: ['infecto'],
        },
      ],
    });

    vi.doMock('@/src/config/profiles/overlays', async () => {
      const actual = await vi.importActual<typeof import('@/src/config/profiles/overlays')>('@/src/config/profiles/overlays');

      return {
        ...actual,
        SPECIALTY_OVERLAY_RUNTIME_PACKS: {
          ...actual.SPECIALTY_OVERLAY_RUNTIME_PACKS,
          infecto: {
            ...actual.SPECIALTY_OVERLAY_RUNTIME_PACKS.infecto,
            visibility: {
              'legacy-nursing-diagnosis-text': false,
            },
          },
          criticalEmergency: {
            ...actual.SPECIALTY_OVERLAY_RUNTIME_PACKS.criticalEmergency,
            visibility: {
              'legacy-nursing-diagnosis-text': true,
            },
          },
        },
      };
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'infect-ed', specialtyId: 'ed' });
    const criticalEmergencyTrace = runtime.mergeTrace.find((entry) => entry.profileId === 'criticalEmergency');

    expect(runtime.fieldVisibility['legacy-nursing-diagnosis-text']).toBe(false);
    expect(runtime.pack.visibility?.['legacy-nursing-diagnosis-text']).toBe(false);
    expect(criticalEmergencyTrace?.ignoredKeys).toEqual(['visibility']);
    expect(criticalEmergencyTrace?.guardrailNotes).toEqual([
      'Overlay visibility cannot reactivate fields already hidden: legacy-nursing-diagnosis-text',
    ]);
  });

  it('tracks explicit specialty override alongside unit-config overlays for downstream traceability', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['general-inpatient'],
      specialtyOverlays: ['infecto', 'onc'],
    });
    process.env.UNITS_CONFIG = JSON.stringify({
      units: [
        {
          id: 'ward-a',
          name: 'Sala A',
          specialty: 'infect',
          profileId: 'general-inpatient',
          specialtyOverlayIds: ['infecto'],
        },
      ],
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'ward-a', specialtyId: 'onc' });

    expect(runtime.context.specialtySource).toBe('explicit');
    expect(runtime.context.hasHumanSpecialtyOverride).toBe(true);
    expect(runtime.context.overlaySelections).toEqual([
      {
        overlayId: 'infecto',
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
    expect(runtime.context.specialtyOverlayIds).toEqual(['infecto', 'onc']);
    expect(runtime.activeOverlays[1]?.isHumanOverride).toBe(true);
    expect(runtime.mergeTrace.map((entry) => entry.profileId)).toEqual([
      'handover-core',
      'general-inpatient',
      'infecto',
      'onc',
    ]);
  });

  it('projects EOPROP-IA as an operational oncology-hematology overlay without opening a parallel form', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['ambulatory'],
      specialtyOverlays: ['onc'],
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'onc-ward', specialtyId: 'onc' });

    expect(runtime.context.unitProfileId).toBe('ambulatory');
    expect(runtime.context.specialtyOverlayIds).toEqual(['onc']);
    expect(runtime.activeOverlays.map((overlay) => overlay.label)).toEqual(['Oncologia y hematologia']);
    expect(runtime.requiredExtraFields).toEqual(
      expect.arrayContaining(['Fase terapeutica', 'Inmunosupresion', 'CVC', 'Sintoma toxico dominante']),
    );
    expect(runtime.optionalExtraFields).toEqual(
      expect.arrayContaining(['Transfusion cuando aplique', 'Paliacion / objetivos de cuidado cuando aplique']),
    );
    expect(runtime.sentinelEvents).toEqual(
      expect.arrayContaining([
        'Neutropenia febril',
        'Sepsis',
        'Extravasacion',
        'Dolor no controlado',
        'Deshidratacion',
        'Complicaciones de tratamiento sistemico',
      ]),
    );
    expect(runtime.visibleOutputs).toEqual(
      expect.arrayContaining([
        'Quien primero: fiebre, sepsis, extravasacion o dolor no controlado',
        'Por que: inmunosupresion, CVC y toxicidad sistemica aumentan deterioro',
        'No omitir: transfusion, acceso vascular, analgesia y vigilancia infecciosa',
        'Cuando reevaluar: este turno ante fiebre, dolor refractario o hidratacion comprometida',
      ]),
    );
    expect(runtime.treatmentQuickPicks.map((quickPick) => quickPick.id)).toEqual(
      expect.arrayContaining([
        'onc-neutropenia-reeval',
        'onc-extravasation-check',
        'onc-transfusion-safety',
        'onc-symptom-reeval',
      ]),
    );
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

  it('stays deterministic when runtime context is incomplete and falls back to the configured default unit', async () => {
    process.env.UNITS_CONFIG = JSON.stringify({
      defaultUnit: 'uci-adulto',
      units: [
        { id: 'uci-adulto', name: 'UCI Adulto', specialty: 'icu', profileId: 'critical-care' },
        { id: 'pediatria', name: 'Pediatría', specialty: 'ped', profileId: 'general-inpatient' },
      ],
    });

    const { resolveHandoverProfileRuntime } = await import('../profile-runtime');

    const runtime = resolveHandoverProfileRuntime({ unitId: '   ', specialtyId: '   ' });

    expect(runtime.context.unitId).toBe('uci-adulto');
    expect(runtime.context.specialtyId).toBe('icu');
    expect(runtime.context.specialtySource).toBe('unit-config');
    expect(runtime.context.usesCoreFallback).toBe(true);
    expect(runtime.pack.id).toBe('critical-care');
    expect(runtime.activeOverlays).toEqual([]);
    expect(runtime.mergeTrace.map((entry) => entry.profileId)).toEqual(['handover-core', 'critical-care']);
  });

  it('covers every resolvable profile pack and keeps runtime extension points explicit', async () => {
    const { PROFILE_REGISTRY } = await import('@/src/config/profiles');
    const { UNIT_PROFILE_RUNTIME_PACKS } = await import('@/src/config/profiles/units');
    const { SPECIALTY_OVERLAY_RUNTIME_PACKS } = await import('@/src/config/profiles/overlays');
    const {
      SPECIALTY_OVERLAY_RUNTIME_EXTENSION_KEYS,
      UNIT_PROFILE_RUNTIME_EXTENSION_KEYS,
    } = await import('@/src/types/profile');

    expect(Object.keys(UNIT_PROFILE_RUNTIME_PACKS).sort()).toEqual(
      Object.keys(PROFILE_REGISTRY.unitProfiles).sort(),
    );
    expect(Object.keys(SPECIALTY_OVERLAY_RUNTIME_PACKS).sort()).toEqual(
      Object.keys(PROFILE_REGISTRY.specialtyOverlays).sort(),
    );

    const unitExtensionKeys = new Set<string>(UNIT_PROFILE_RUNTIME_EXTENSION_KEYS);
    const overlayExtensionKeys = new Set<string>(SPECIALTY_OVERLAY_RUNTIME_EXTENSION_KEYS);

    expect(unitExtensionKeys.has('focusAreas')).toBe(true);
    expect(unitExtensionKeys.has('explanations')).toBe(true);
    expect(unitExtensionKeys.has('visibility')).toBe(true);
    expect(overlayExtensionKeys.has('focusAreas')).toBe(true);
    expect(overlayExtensionKeys.has('hiddenSections')).toBe(true);

    for (const pack of Object.values(UNIT_PROFILE_RUNTIME_PACKS)) {
      expect(
        Object.keys(pack)
          .filter((key) => key !== 'id' && key !== 'label')
          .every((key) => unitExtensionKeys.has(key)),
      ).toBe(true);
    }

    for (const pack of Object.values(SPECIALTY_OVERLAY_RUNTIME_PACKS)) {
      expect(
        Object.keys(pack)
          .filter((key) => key !== 'id' && key !== 'label')
          .every((key) => overlayExtensionKeys.has(key)),
      ).toBe(true);
    }
  });
});
