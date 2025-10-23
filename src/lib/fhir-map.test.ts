import { describe, it, expect } from 'vitest';
import { buildHandoverBundle, type HandoverValues } from './fhir-map';

const base: HandoverValues = {
  patientId: 'pat-001',
  notes: 'Paciente estable. Dx pendiente.'
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
      close: { audioUri: 'https://cdn/app/audio.m4a' }
    });
    const types = b.entry.map((e: any) => e.resource.resourceType);
    expect(types).toContain('DocumentReference');
  });

  it('identifier de Composition es determinista y se usa en ifNoneExist', () => {
    const b1 = buildHandoverBundle({ ...base });
    const b2 = buildHandoverBundle({ ...base });
    const comp1 = b1.entry.find((e: any) => e.resource.resourceType === 'Composition')!;
    const comp2 = b2.entry.find((e: any) => e.resource.resourceType === 'Composition')!;
    expect(comp1.resource.identifier.value).toBe(comp2.resource.identifier.value);
    expect(comp1.request?.ifNoneExist).toContain('identifier=urn:uuid|');
  });
});
