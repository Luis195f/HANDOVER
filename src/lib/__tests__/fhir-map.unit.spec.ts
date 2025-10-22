import { describe, it, expect } from 'vitest';
import { mapVitalsToObservations } from '@/src/lib/fhir-map';

const NOW = '2025-10-19T12:00:00Z';

const loinc = {
  RR: '9279-1',
  HR: '8867-4',
  SBP: '8480-6',
  TEMP: '8310-5',
  SPO2: '59408-5',
};

function byCode(a: any, b: any) {
  const ca = a?.code?.coding?.[0]?.code ?? '';
  const cb = b?.code?.coding?.[0]?.code ?? '';
  return ca.localeCompare(cb);
}

describe('mapVitalsToObservations (helper puro)', () => {
  it('solo HR/RR → LOINC correctos y UCUM /min', () => {
    const obs = mapVitalsToObservations(
      { patientId: 'pat-001', vitals: { hr: 80, rr: 18 } },
      { now: NOW }
    ).sort(byCode);

    expect(obs.map(o => o.code?.coding?.[0]?.code)).toEqual([loinc.HR, loinc.RR].sort());

    for (const o of obs) {
      expect(o.resourceType).toBe('Observation');
      expect(o.valueQuantity?.system).toBe('http://unitsofmeasure.org');
      expect(o.valueQuantity?.code).toBe('/min');
      expect(o.effectiveDateTime).toBe(NOW);
      expect(o.subject).toBeDefined();
    }
  });

  it('todos los vitales (RR, HR, SBP, Temp, SpO2) → LOINC + UCUM correctos', () => {
    const obs = mapVitalsToObservations(
      { patientId: 'pat-001', vitals: { rr: 18, hr: 80, sbp: 120, temp: 37.1, spo2: 96 } },
      { now: NOW }
    ).sort(byCode);

    const codes = obs.map(o => o.code?.coding?.[0]?.code).sort();
    expect(codes).toEqual([loinc.RR, loinc.HR, loinc.SBP, loinc.TEMP, loinc.SPO2].sort());

    const get = (code: string) => obs.find(o => o.code?.coding?.[0]?.code === code)!;

    expect(get(loinc.RR).valueQuantity?.code).toBe('/min');
    expect(get(loinc.HR).valueQuantity?.code).toBe('/min');
    expect(get(loinc.SBP).valueQuantity?.code).toBe('mm[Hg]');
    expect(get(loinc.TEMP).valueQuantity?.code).toBe('Cel');
    expect(get(loinc.SPO2).valueQuantity?.code).toBe('%');
  });

  it('idempotencia (estructura estable)', () => {
    const input = { patientId: 'pat-XYZ', vitals: { hr: 74, rr: 16 } };
    const a = mapVitalsToObservations(input, { now: NOW }).sort(byCode);
    const b = mapVitalsToObservations(input, { now: NOW }).sort(byCode);

    expect(a.length).toBe(b.length);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
