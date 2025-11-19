// src/lib/__tests__/fhir-map.acvpu.spec.ts
import { describe, it, expect } from 'vitest';
import { buildHandoverBundle } from '../fhir-map';
import {
  TEST_CATEGORY_CODES,
  TEST_SNOMED_CODES,
  TEST_SYSTEMS,
  TEST_VITAL_CODES,
} from './fhir-map.test-constants';

const findObsByLoinc = (bundle: any, loincCode: string) =>
  (bundle?.entry ?? [])
    .map((e: any) => e.resource)
    .find(
      (r: any) =>
        r?.resourceType === 'Observation' &&
        r?.code?.coding?.some(
          (c: any) => c.system === TEST_SYSTEMS.LOINC && String(c.code) === String(loincCode)
        )
    );

const hasCoding = (cc: any, system: string, code: string) =>
  (cc?.coding ?? []).some((c: any) => c.system === system && c.code === code);

const hasCategory = (obs: any, code: string) =>
  obs?.category?.some((cat: any) =>
    cat?.coding?.some((c: any) => c.system === TEST_SYSTEMS.OBSERVATION_CATEGORY && c.code === code)
  );

describe('ACVPU — mapeo LOINC+SNOMED y no afecta otros vitales', () => {
  const patientId = 'pat-001';

  const casos: Array<{ avpu: 'A' | 'C' | 'V' | 'P' | 'U'; snomed: string }> = [
    { avpu: 'A', snomed: TEST_SNOMED_CODES.avpuAlert },
    { avpu: 'C', snomed: TEST_SNOMED_CODES.avpuConfusion },
    { avpu: 'V', snomed: TEST_SNOMED_CODES.avpuVoice },
    { avpu: 'P', snomed: TEST_SNOMED_CODES.avpuPain },
    { avpu: 'U', snomed: TEST_SNOMED_CODES.avpuUnresponsive },
  ];

  it('emite ACVPU (67775-7) con SNOMED y mantiene FC (8867-4)', () => {
    for (const c of casos) {
      // Incluimos HR=80 para comprobar que el resto de vitales siguen OK
      const bundle = buildHandoverBundle({
        patientId,
        vitals: { acvpu: c.avpu, hr: 80 },
      });

      // ACVPU
      const acvpu = findObsByLoinc(bundle, TEST_VITAL_CODES.ACVPU.code); // 67775-7
      expect(acvpu).toBeTruthy();
      expect(hasCategory(acvpu, TEST_CATEGORY_CODES.VITAL_SIGNS)).toBe(true);
      expect(acvpu.subject?.reference).toBe(`Patient/${patientId}`);

      const vcc = acvpu.valueCodeableConcept;
      expect(vcc).toBeTruthy();
      // SNOMED presente
      expect(hasCoding(vcc, TEST_SYSTEMS.SNOMED, c.snomed)).toBe(true);

      // HR no afectado
      const hr = findObsByLoinc(bundle, TEST_VITAL_CODES.HEART_RATE.code); // 8867-4
      expect(hr).toBeTruthy();
      expect(hasCategory(hr, TEST_CATEGORY_CODES.VITAL_SIGNS)).toBe(true);
      expect(hr.valueQuantity?.unit).toBe('/min');
      expect(hr.valueQuantity?.code).toBe('/min');
      expect(hr.valueQuantity?.value).toBe(80);
    }
  });
});
