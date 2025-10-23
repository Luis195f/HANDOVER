// src/lib/__tests__/fhir-map.loinc-extra.spec.ts
import { describe, it, expect } from 'vitest';
import { mapVitalsToObservations, __test__ } from '../fhir-map';

type Ctx = {
  patientId: string;
  effectiveDateTime: string;
};

const findByLoinc = (arr: any[], code: string) =>
  arr.find((r) =>
    r?.code?.coding?.some(
      (c: any) =>
        c.system === __test__.LOINC_SYSTEM && String(c.code) === String(code)
    )
  );

const hasVitalCategory = (r: any) =>
  r?.category?.some((cat: any) =>
    cat?.coding?.some(
      (c: any) =>
        c.system === __test__.OBS_CAT_SYSTEM && c.code === __test__.OBS_CAT_VITALS
    )
  );

describe('FHIR map — Glucemia capilar y ACVPU (LOINC)', () => {
  const ctx: Ctx = {
    patientId: 'pat-001',
    effectiveDateTime: '2025-10-21T13:15:00Z',
  };

  // Adaptador: simula el viejo mapObservationVitals(input, ctx)
  const run = (input: any, c: Ctx) =>
    mapVitalsToObservations(
      { patientId: c.patientId, vitals: input },
      { now: c.effectiveDateTime }
    );

  it('mapea Glucemia capilar con LOINC 2339-0 y UCUM mg/dL', () => {
    const out = run({ bgMgDl: 104 }, ctx);
    const glu = findByLoinc(out, __test__.CODES.GLU_MASS_BLD.code); // 2339-0
    expect(glu).toBeTruthy();

    expect(glu.status).toBe('final');
    expect(glu.subject?.reference).toBe('Patient/pat-001');
    expect(glu.effectiveDateTime).toBe(ctx.effectiveDateTime);

    expect(glu.valueQuantity).toMatchObject({
      value: 104,
      unit: __test__.UNITS.MGDL,
      system: __test__.UCUM_SYSTEM,
      code: __test__.UNITS.MGDL,
    });
  });

  it('mapea ACVPU con LOINC 67775-7 y respuestas LOINC (LA codes)', () => {
    const map = (avpu: 'A' | 'C' | 'V' | 'P' | 'U') => {
      const out = run({ avpu }, ctx);
      const obs = findByLoinc(out, __test__.CODES.ACVPU.code);
      expect(obs).toBeTruthy();
      expect(obs.status).toBe('final');
      expect(obs.subject?.reference).toBe('Patient/pat-001');
      expect(hasVitalCategory(obs)).toBe(true);

      const acvpuCodings = obs.code?.coding ?? [];
      expect(
        acvpuCodings.some(
          (c: any) => c.system === __test__.CODES.ACVPU.system && c.code === __test__.CODES.ACVPU.code
        )
      ).toBe(true);

      const coding = obs.valueCodeableConcept?.coding ?? [];
      const hasCoding = (system: string, code: string) =>
        coding.some((c: any) => c.system === system && c.code === code);

      const loincAnswer = __test__.ACVPU_LOINC[avpu];
      const snomedAnswer = __test__.ACVPU_SNOMED[avpu];
      expect(hasCoding(__test__.LOINC_SYSTEM, loincAnswer.code)).toBe(true);
      expect(hasCoding(__test__.SNOMED_SYSTEM, snomedAnswer.code)).toBe(true);

      expect(obs.valueCodeableConcept?.text).toBeTruthy();
    };

    map('A'); map('C'); map('V'); map('P'); map('U');
  });

  it('no crea Observations para valores inválidos o faltantes', () => {
    const out = run({ bgMgDl: undefined, avpu: 'X' as any }, ctx);
    expect(findByLoinc(out, __test__.CODES.GLU_MASS_BLD.code)).toBeFalsy();
    expect(findByLoinc(out, __test__.CODES.ACVPU.code)).toBeFalsy();
  });
});
