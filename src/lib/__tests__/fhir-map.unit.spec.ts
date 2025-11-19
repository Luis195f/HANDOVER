import { describe, it, expect } from 'vitest';
import { mapVitalsToObservations } from '@/src/lib/fhir-map';
import { TEST_SYSTEMS, TEST_VITAL_CODES } from './fhir-map.test-constants';

const NOW = '2025-10-19T12:00:00Z';

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

    expect(obs.map(o => o.code?.coding?.[0]?.code)).toEqual([TEST_VITAL_CODES.HEART_RATE.code, TEST_VITAL_CODES.RESP_RATE.code].sort());

    for (const o of obs) {
      expect(o.resourceType).toBe('Observation');
      expect(o.valueQuantity?.system).toBe(TEST_SYSTEMS.UCUM);
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
    expect(codes).toEqual([TEST_VITAL_CODES.RESP_RATE.code, TEST_VITAL_CODES.HEART_RATE.code, TEST_VITAL_CODES.BP_SYSTOLIC.code, TEST_VITAL_CODES.TEMPERATURE.code, TEST_VITAL_CODES.SPO2.code].sort());

    const get = (code: string) => obs.find(o => o.code?.coding?.[0]?.code === code)!;

    expect(get(TEST_VITAL_CODES.RESP_RATE.code).valueQuantity?.code).toBe('/min');
    expect(get(TEST_VITAL_CODES.HEART_RATE.code).valueQuantity?.code).toBe('/min');
    expect(get(TEST_VITAL_CODES.BP_SYSTOLIC.code).valueQuantity?.code).toBe('mm[Hg]');
    expect(get(TEST_VITAL_CODES.TEMPERATURE.code).valueQuantity?.code).toBe('Cel');
    expect(get(TEST_VITAL_CODES.SPO2.code).valueQuantity?.code).toBe('%');
  });

  it('idempotencia (estructura estable)', () => {
    const input = { patientId: 'pat-XYZ', vitals: { hr: 74, rr: 16 } };
    const a = mapVitalsToObservations(input, { now: NOW }).sort(byCode);
    const b = mapVitalsToObservations(input, { now: NOW }).sort(byCode);

    expect(a.length).toBe(b.length);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
