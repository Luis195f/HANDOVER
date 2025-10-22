// src/lib/__tests__/fhir-map.vitals.core.spec.ts
import { describe, it, expect } from 'vitest';
import { mapVitalsToObservations, __test__ } from '../fhir-map';

const UOM = __test__.UCUM_SYSTEM;
const LOINC = __test__.LOINC_SYSTEM;

const findByLoinc = (arr: any[], code: string) =>
  arr.find((r) => r?.code?.coding?.some((c: any) => c.system === LOINC && String(c.code) === String(code)));

const hasCategory = (r: any, code: string) =>
  r?.category?.some((cat: any) =>
    cat?.coding?.some((c: any) => c.system === __test__.OBS_CAT_SYSTEM && c.code === code)
  );

describe('Vitales LOINC núcleo — individuos + UCUM', () => {
  const patientId = 'pat-001';
  const now = '2025-10-21T09:00:00Z';

  it('mapea FC(8867-4), FR(9279-1), Temp(8310-5), SpO₂(59408-5), TAS(8480-6), TAD(8462-4)', () => {
    const out = mapVitalsToObservations(
      { patientId, vitals: { hr: 88, rr: 18, temp: 37.2, spo2: 96, sbp: 120, dbp: 75 } },
      { now }
    );

    const hr = findByLoinc(out, __test__.CODES.HR.code);
    const rr = findByLoinc(out, __test__.CODES.RR.code);
    const t  = findByLoinc(out, __test__.CODES.TEMP.code);
    const s  = findByLoinc(out, __test__.CODES.SPO2.code);
    const sb = findByLoinc(out, __test__.CODES.SBP.code);
    const db = findByLoinc(out, __test__.CODES.DBP.code);

    for (const r of [hr, rr, t, s, sb, db]) {
      expect(r).toBeTruthy();
      expect(r.status).toBe('final');
      expect(r.subject?.reference).toBe(`Patient/${patientId}`);
      expect(r.effectiveDateTime).toBe(now);
      expect(hasCategory(r, __test__.OBS_CAT_VITALS)).toBe(true);
    }

    expect(hr.valueQuantity).toMatchObject({ unit: __test__.UNITS.PER_MIN, code: __test__.UNITS.PER_MIN, system: UOM, value: 88 });
    expect(rr.valueQuantity).toMatchObject({ unit: __test__.UNITS.PER_MIN, code: __test__.UNITS.PER_MIN, system: UOM, value: 18 });
    expect(t.valueQuantity).toMatchObject({ unit: __test__.UNITS.CEL,     code: __test__.UNITS.CEL,     system: UOM, value: 37.2 });
    expect(s.valueQuantity).toMatchObject({ unit: __test__.UNITS.PCT,     code: __test__.UNITS.PCT,     system: UOM, value: 96 });
    expect(sb.valueQuantity).toMatchObject({ unit: __test__.UNITS.MM_HG,  code: __test__.UNITS.MM_HG,   system: UOM, value: 120 });
    expect(db.valueQuantity).toMatchObject({ unit: __test__.UNITS.MM_HG,  code: __test__.UNITS.MM_HG,   system: UOM, value: 75 });
  });

  it('no emite vitales con valores inválidos/NaN', () => {
    const out = mapVitalsToObservations(
      { patientId, vitals: { hr: undefined as any, rr: NaN as any } },
      { now }
    );
    expect(findByLoinc(out, __test__.CODES.HR.code)).toBeFalsy();
    expect(findByLoinc(out, __test__.CODES.RR.code)).toBeFalsy();
  });
});
