// src/lib/__tests__/fhir-map.acvpu.spec.ts
import { describe, it, expect } from 'vitest';
import { buildHandoverBundle, __test__ } from '../fhir-map';

const findObsByLoinc = (bundle: any, loincCode: string) =>
  (bundle?.entry ?? [])
    .map((e: any) => e.resource)
    .find(
      (r: any) =>
        r?.resourceType === 'Observation' &&
        r?.code?.coding?.some(
          (c: any) =>
            c.system === __test__.LOINC_SYSTEM && String(c.code) === String(loincCode)
        )
    );

const hasCoding = (cc: any, system: string, code: string) =>
  (cc?.coding ?? []).some((c: any) => c.system === system && c.code === code);

const hasCategory = (obs: any, code: string) =>
  obs?.category?.some((cat: any) =>
    cat?.coding?.some((c: any) => c.system === __test__.OBS_CAT_SYSTEM && c.code === code)
  );

describe('ACVPU — mapeo LOINC+SNOMED y no afecta otros vitales', () => {
  const patientId = 'pat-001';

  const casos: Array<{
    avpu: 'A' | 'C' | 'V' | 'P' | 'U';
    loincLA: string;
    snomed: string;
  }> = [
    { avpu: 'A', loincLA: __test__.ACVPU_LOINC.A.code, snomed: __test__.ACVPU_SNOMED.A.code },
    { avpu: 'C', loincLA: __test__.ACVPU_LOINC.C.code, snomed: __test__.ACVPU_SNOMED.C.code },
    { avpu: 'V', loincLA: __test__.ACVPU_LOINC.V.code, snomed: __test__.ACVPU_SNOMED.V.code },
    { avpu: 'P', loincLA: __test__.ACVPU_LOINC.P.code, snomed: __test__.ACVPU_SNOMED.P.code },
    { avpu: 'U', loincLA: __test__.ACVPU_LOINC.U.code, snomed: __test__.ACVPU_SNOMED.U.code },
  ];

  it('emite ACVPU (67775-7) con SNOMED + LOINC-LA y mantiene FC (8867-4)', () => {
    for (const c of casos) {
      // Incluimos HR=80 para comprobar que el resto de vitales siguen OK
      const bundle = buildHandoverBundle({
        patientId,
        vitals: { acvpu: c.avpu, hr: 80 },
      });

      // ACVPU
      const acvpu = findObsByLoinc(bundle, __test__.CODES.ACVPU.code); // 67775-7
      expect(acvpu).toBeTruthy();
      expect(hasCategory(acvpu, __test__.OBS_CAT_VITALS)).toBe(true);
      expect(acvpu.subject?.reference).toBe(`Patient/${patientId}`);

      const vcc = acvpu.valueCodeableConcept;
      expect(vcc).toBeTruthy();
      // SNOMED + LOINC LA presentes
      expect(hasCoding(vcc, __test__.SNOMED_SYSTEM, c.snomed)).toBe(true);
      expect(hasCoding(vcc, __test__.LOINC_SYSTEM, c.loincLA)).toBe(true);

      // HR no afectado
      const hr = findObsByLoinc(bundle, __test__.CODES.HR.code); // 8867-4
      expect(hr).toBeTruthy();
      expect(hasCategory(hr, __test__.OBS_CAT_VITALS)).toBe(true);
      expect(hr.valueQuantity?.unit).toBe(__test__.UNITS.PER_MIN);
      expect(hr.valueQuantity?.code).toBe(__test__.UNITS.PER_MIN);
      expect(hr.valueQuantity?.value).toBe(80);
    }
  });
});
