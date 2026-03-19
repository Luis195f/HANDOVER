import { beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

describe('MPAC v1', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON;
    delete process.env.HANDOVER_PROFILE_ACTIVATION_JSON;
  });

  it('emits a serializable explanation and applies manual override without hiding the base score', async () => {
    const { computeMPAC, resolveMPACInput } = await import('@/src/lib/mpac');

    const resolved = resolveMPACInput({
      patientId: 'pat-override',
      displayName: 'Paciente override',
      vitals: { rr: 21, spo2: 96, tempC: 37.5, sbp: 118, hr: 110 },
      devices: [],
      risks: {},
      pendingTasks: [{ id: 'reeval', title: 'Reevaluacion neurologica', priority: 'urgent', category: 'reevaluation' }],
      manualOverride: {
        level: 'critical',
        rationale: 'Escalar por criterio enfermero del turno',
        role: 'nurse',
      },
    });

    const result = computeMPAC(resolved);
    const serialized = JSON.parse(JSON.stringify(result.explanation));

    expect(result.baseLevel).toBe('high');
    expect(result.level).toBe('critical');
    expect(result.reasons).toContain('MANUAL_OVERRIDE');
    expect(result.reasonSummary).toContain('override manual');
    expect(serialized.override?.rationale).toBe('Escalar por criterio enfermero del turno');
    expect(serialized.pendingCritical[0]).toContain('Reevaluacion neurologica');
    expect(serialized.activeContext.labels).toEqual(['HANDOVER Core']);
  });

  it('keeps core only when catalog profiles are not activated', async () => {
    const { computeMPACFromInput } = await import('@/src/lib/mpac');

    const result = computeMPACFromInput({
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
    });

    expect(result.explanation.activeContext.usesCoreFallback).toBe(true);
    expect(result.explanation.activeContext.unitProfileId).toBeNull();
    expect(result.explanation.modifiers).toHaveLength(0);
    expect(result.reasons).not.toContain('PROFILE_CONTEXT');
  });

  it('allows activated unit and specialty overlays to inject explainable modifiers', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['specialized-critical-care'],
      specialtyOverlays: ['neuroicu'],
    });

    const { computeMPACFromInput } = await import('@/src/lib/mpac');

    const result = computeMPACFromInput({
      patientId: 'pat-neuro',
      displayName: 'Paciente Neuro',
      unitId: 'neuroicu-1',
      specialtyId: 'neuroicu',
      vitals: { rr: 24, spo2: 93, tempC: 38.1, sbp: 100, hr: 112, avpu: 'V' },
      devices: [{ id: 'vent', label: 'VM', category: 'invasive', critical: true }],
      risks: { isolation: true },
      pendingTasks: [{ id: 'gas', title: 'Gasometria', priority: 'critical', category: 'critical-task' }],
      recentIncidentFlag: true,
      referenceTime: '2024-02-01T00:00:00Z',
    });

    expect(result.explanation.activeContext.unitProfileId).toBe('specialized-critical-care');
    expect(result.explanation.activeContext.specialtyOverlayIds).toEqual(['neuroicu']);
    expect(result.explanation.modifiers.some((modifier) => modifier.source === 'unit-profile' && modifier.applied)).toBe(true);
    expect(result.explanation.modifiers.some((modifier) => modifier.source === 'specialty-overlay' && modifier.applied)).toBe(true);
    expect(result.reasons).toContain('PROFILE_CONTEXT');
    expect(result.reasonSummary).toContain('contexto');
  });
  it('explains ICU adulto modifiers with named wave-1 signals', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['critical-care'],
    });

    const { computeMPACFromInput } = await import('@/src/lib/mpac');

    const result = computeMPACFromInput({
      patientId: 'pat-icu',
      displayName: 'Paciente UCI',
      unitId: 'icu-a',
      specialtyId: 'icu',
      vitals: { rr: 28, spo2: 90, tempC: 38.2, sbp: 88, hr: 124, o2: true, avpu: 'V' },
      devices: [
        { id: 'vent', label: 'VM', category: 'invasive', critical: true },
        { id: 'cvl', label: 'CVC', category: 'invasive', critical: false },
      ],
      risks: { isolation: true },
      pendingTasks: [{ id: 'vaso', title: 'Titulacion de noradrenalina', priority: 'critical', category: 'critical-task' }],
      recentIncidentFlag: true,
      referenceTime: '2024-02-01T00:00:00Z',
    });

    expect(result.explanation.activeContext.unitProfileId).toBe('critical-care');
    expect(result.explanation.modifiers.some((modifier) => modifier.label === 'Ventilacion y microvigilancia respiratoria' && modifier.applied)).toBe(true);
    expect(result.explanation.modifiers.some((modifier) => modifier.note.includes('Vasoactivos y objetivos hemodinamicos'))).toBe(true);
    expect(result.reasons).toContain('PROFILE_CONTEXT');
  });

  it('adds explainable omission and continuity modifiers for hospitalizacion general', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['general-inpatient'],
    });
    process.env.UNITS_CONFIG = JSON.stringify({
      units: [{ id: 'ward-mi', name: 'Medicina Interna A', specialty: 'med', profileId: 'general-inpatient' }],
    });

    const { computeMPACFromInput } = await import('@/src/lib/mpac');

    const result = computeMPACFromInput({
      patientId: 'pat-ward',
      displayName: 'Paciente Planta',
      unitId: 'ward-mi',
      specialtyId: 'med',
      vitals: { rr: 20, spo2: 95, tempC: 37.3, sbp: 112, hr: 98 },
      devices: [],
      risks: { pressureUlcer: true },
      risksStructured: [{ type: 'delirium', present: true, actions: [], notes: undefined }],
      pendingTasks: [
        { id: 'med-rec', title: 'Conciliar medicacion basal', priority: 'urgent', category: 'other' },
        { id: 'discharge', title: 'Coordinar alta compleja', priority: 'urgent', category: 'other' },
      ],
      referenceTime: '2024-02-01T00:00:00Z',
    });

    expect(result.explanation.activeContext.unitProfileId).toBe('general-inpatient');
    expect(result.explanation.modifiers.some((modifier) => modifier.label === 'Conciliacion terapeutica' && modifier.applied)).toBe(true);
    expect(result.explanation.modifiers.some((modifier) => modifier.note.includes('Alta compleja'))).toBe(true);
    expect(result.reasons).toContain('PROFILE_CONTEXT');
  });

  it('keeps emergency modifiers additive and traceable around triage and reevaluation', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['emergency'],
    });

    const { computeMPACFromInput } = await import('@/src/lib/mpac');

    const result = computeMPACFromInput({
      patientId: 'pat-ed',
      displayName: 'Paciente Urgencias',
      unitId: 'ed-main',
      specialtyId: 'ed',
      vitals: { rr: 24, spo2: 94, tempC: 37.9, sbp: 102, hr: 116 },
      devices: [],
      risks: { isolation: true },
      pendingTasks: [{ id: 'reeval', title: 'Reevaluacion de box', priority: 'critical', category: 'reevaluation' }],
      referenceTime: '2024-02-01T00:00:00Z',
    });

    expect(result.explanation.activeContext.unitProfileId).toBe('emergency');
    expect(result.explanation.modifiers.some((modifier) => modifier.label === 'Reevaluacion obligatoria' && modifier.applied)).toBe(true);
    expect(result.explanation.modifiers.some((modifier) => modifier.note.includes('transmision'))).toBe(true);
    expect(result.reasons).toContain('PROFILE_CONTEXT');
  });
  it('applies explainable EOPROP-IA modifiers for oncology-hematology without changing the transport contracts', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['ambulatory'],
      specialtyOverlays: ['onc'],
    });

    const { computeMPACFromInput } = await import('@/src/lib/mpac');

    const result = computeMPACFromInput({
      patientId: 'pat-onc',
      displayName: 'Paciente Onco',
      unitId: 'onc-ward',
      specialtyId: 'onc',
      vitals: { rr: 23, spo2: 95, tempC: 38.4, sbp: 104, hr: 118 },
      devices: [{ id: 'cvc', label: 'CVC tunelizado', category: 'invasive', critical: false }],
      risks: {},
      pendingTasks: [
        { id: 'cultures', title: 'Tomar cultivos y avisar fiebre en neutropenia', priority: 'critical', category: 'reevaluation' },
        { id: 'pain', title: 'Reevaluar dolor y tolerancia oral', priority: 'urgent', category: 'other' },
      ],
      referenceTime: '2024-02-01T00:00:00Z',
    });

    expect(result.explanation.activeContext.unitProfileId).toBe('ambulatory');
    expect(result.explanation.activeContext.specialtyOverlayIds).toEqual(['onc']);
    expect(
      result.explanation.modifiers.some(
        (modifier) => modifier.label === 'Neutropenia febril y sepsis oculta' && modifier.applied,
      ),
    ).toBe(true);
    expect(
      result.explanation.modifiers.some(
        (modifier) =>
          modifier.label === 'Extravasacion y continuidad segura de terapia sistemica' && modifier.applied,
      ),
    ).toBe(true);
    expect(
      result.explanation.modifiers.some(
        (modifier) =>
          modifier.label === 'Complicaciones de tratamiento sistemico y soporte hematologico' &&
          modifier.note.includes('Quimioterapia, inmunoterapia, transfusion'),
      ),
    ).toBe(true);
    expect(result.reasons).toContain('PROFILE_CONTEXT');
    expect(result.reasonSummary).toContain('contexto');
  });
});

