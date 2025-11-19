// src/lib/__tests__/fhir-map.vitals.core.spec.ts
import { describe, it, expect } from 'vitest';
import { mapVitalsToObservations } from '../fhir-map';
import { TEST_CATEGORY_CODES, TEST_SYSTEMS, TEST_VITAL_CODES } from './fhir-map.test-constants';

const UOM = TEST_SYSTEMS.UCUM;
const LOINC = TEST_SYSTEMS.LOINC;

const findByLoinc = (arr: any[], code: string) =>
  arr.find((r) => r?.code?.coding?.some((c: any) => c.system === LOINC && String(c.code) === String(code)));

const hasCategory = (r: any, code: string) =>
  r?.category?.some((cat: any) =>
    cat?.coding?.some((c: any) => c.system === TEST_SYSTEMS.OBSERVATION_CATEGORY && c.code === code)
  );

describe('Vitales LOINC núcleo — individuos + UCUM', () => {
  const patientId = 'pat-001';
  const now = '2025-10-21T09:00:00Z';

  it('mapea FC(8867-4), FR(9279-1), Temp(8310-5), SpO₂(59408-5), TAS(8480-6), TAD(8462-4)', () => {
    const out = mapVitalsToObservations(
      { patientId, vitals: { hr: 88, rr: 18, temp: 37.2, spo2: 96, sbp: 120, dbp: 75 } },
      { now }
    );

    const hr = findByLoinc(out, TEST_VITAL_CODES.HEART_RATE.code);
    const rr = findByLoinc(out, TEST_VITAL_CODES.RESP_RATE.code);
    const t  = findByLoinc(out, TEST_VITAL_CODES.TEMPERATURE.code);
    const s  = findByLoinc(out, TEST_VITAL_CODES.SPO2.code);
    const sb = findByLoinc(out, TEST_VITAL_CODES.BP_SYSTOLIC.code);
    const db = findByLoinc(out, TEST_VITAL_CODES.BP_DIASTOLIC.code);

    for (const r of [hr, rr, t, s, sb, db]) {
      expect(r).toBeTruthy();
      expect(r.status).toBe('final');
      expect(r.subject?.reference).toBe(`Patient/${patientId}`);
      expect(r.effectiveDateTime).toBe(now);
      expect(hasCategory(r, TEST_CATEGORY_CODES.VITAL_SIGNS)).toBe(true);
    }

    expect(hr.valueQuantity).toMatchObject({ unit: '/min',   code: '/min',   system: UOM, value: 88 });
    expect(rr.valueQuantity).toMatchObject({ unit: '/min',   code: '/min',   system: UOM, value: 18 });
    expect(t.valueQuantity).toMatchObject({ unit: 'Cel',     code: 'Cel',    system: UOM, value: 37.2 });
    expect(s.valueQuantity).toMatchObject({ unit: '%',       code: '%',      system: UOM, value: 96 });
    expect(sb.valueQuantity).toMatchObject({ unit: 'mm[Hg]', code: 'mm[Hg]', system: UOM, value: 120 });
    expect(db.valueQuantity).toMatchObject({ unit: 'mm[Hg]', code: 'mm[Hg]', system: UOM, value: 75 });
  });

  it('no emite vitales con valores inválidos/NaN', () => {
    const out = mapVitalsToObservations(
      { patientId, vitals: { hr: undefined as any, rr: NaN as any } },
      { now }
    );
    expect(findByLoinc(out, TEST_VITAL_CODES.HEART_RATE.code)).toBeFalsy();
    expect(findByLoinc(out, TEST_VITAL_CODES.RESP_RATE.code)).toBeFalsy();
  });
});
