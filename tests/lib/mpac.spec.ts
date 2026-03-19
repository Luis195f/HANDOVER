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
});


