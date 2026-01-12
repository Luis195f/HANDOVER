import { describe, it, expect } from 'vitest';
import { buildHandoverBundle, type HandoverValues } from './fhir-map';

const base: HandoverValues = {
  patientId: 'pat-001',
  notes: 'Paciente estable. Dx pendiente.',
  bedsideChecklist: {
    patientIdentityConfirmed: true,
    allergiesReviewed: true,
    linesAndDevicesChecked: false,
    medicationPlanReviewed: false,
    safetyMeasuresApplied: false,
    questionsAnswered: false,
  },
};

describe('fhir-map bundle', () => {
  it('crea un transaction bundle con Composition y vitals panel', () => {
    const b = buildHandoverBundle({
      ...base,
      vitals: { rr: 18, hr: 88, sbp: 120, temp: 36.8, spo2: 97, o2: false, acvpu: 'A' }
    });
    expect(b.resourceType).toBe('Bundle');
    expect(b.type).toBe('transaction');
    const types = b.entry.map((e: any) => e.resource.resourceType);
    expect(types).toContain('Composition');

    const panels = b.entry.filter((e: any) => e.resource.resourceType === 'Observation' &&
      e.resource.category?.some((c: any) => c.coding?.some((x: any) => x.code === 'vital-signs')));
    expect(panels.length).toBeGreaterThan(0);
  });

  it('incluye DocumentReference si hay audio', () => {
    const b = buildHandoverBundle({
      ...base,
      audioAttachment: {
        url: 'https://cdn/app/audio.m4a',
        contentType: 'audio/m4a',
      },
    });
    const types = b.entry.map((e: any) => e.resource.resourceType);
    expect(types).toContain('DocumentReference');
  });

  it('id de Composition es determinista', () => {
    const fixedNow = '2025-10-21T10:00:00Z';
    const b1 = buildHandoverBundle({ ...base }, { now: fixedNow });
    const b2 = buildHandoverBundle({ ...base }, { now: fixedNow });
    const comp1 = b1.entry.find((e: any) => e.resource.resourceType === 'Composition')!;
    const comp2 = b2.entry.find((e: any) => e.resource.resourceType === 'Composition')!;
    expect(comp1.resource.id).toBe(comp2.resource.id);
    expect(comp1.request?.method).toBe('POST');
    expect(comp1.request?.url).toBe('Composition');
  });
});
