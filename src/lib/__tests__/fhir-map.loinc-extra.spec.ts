// src/lib/__tests__/fhir-map.loinc-extra.spec.ts
import { describe, it, expect } from 'vitest';
import { mapVitalsToObservations } from '../fhir-map';

type Ctx = {
  patientId: string;
  effectiveDateTime: string;
};

const UOM = 'http://unitsofmeasure.org';

const findByLoinc = (arr: any[], code: string) =>
  arr.find((r) =>
    r?.code?.coding?.some(
      (c: any) => c.system === 'http://loinc.org' && String(c.code) === String(code)
    )
  );

const hasVitalCategory = (r: any) =>
  r?.category?.some((cat: any) =>
    cat?.coding?.some(
      (c: any) =>
        c.system === 'http://terminology.hl7.org/CodeSystem/observation-category' &&
        c.code === 'vital-signs'
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
    const glu = findByLoinc(out, '2339-0'); // Glucose [Mass/volume] in Blood
    expect(glu).toBeTruthy();

    expect(glu.status).toBe('final');
    expect(glu.subject?.reference).toBe('Patient/pat-001');
    expect(glu.effectiveDateTime).toBe(ctx.effectiveDateTime);

    expect(glu.valueQuantity).toMatchObject({
      value: 104,
      unit: 'mg/dL',
      system: UOM,
      code: 'mg/dL',
    });
  });

  it('mapea ACVPU con LOINC 67775-7 y respuestas LOINC (LA codes)', () => {
    const map = (avpu: 'A' | 'C' | 'V' | 'P' | 'U') => {
      const out = run({ avpu }, ctx);
      const obs = findByLoinc(out, '67775-7');
      expect(obs).toBeTruthy();
      expect(obs.status).toBe('final');
      expect(obs.subject?.reference).toBe('Patient/pat-001');
      expect(hasVitalCategory(obs)).toBe(true);

      const coding = obs.valueCodeableConcept?.coding ?? [];
      const has = (code: string) =>
        coding.some(
          (c: any) => c.system === 'http://loinc.org' && c.code === code
        );

      // A -> Alert, C -> Confused, V -> Verbal, P -> Painful, U -> Unresponsive
      if (avpu === 'A') expect(has('LA9340-6')).toBe(true);
      if (avpu === 'C') expect(has('LA6560-2')).toBe(true);
      if (avpu === 'V') expect(has('LA17108-4')).toBe(true);
      if (avpu === 'P') expect(has('LA17107-6')).toBe(true);
      if (avpu === 'U') expect(has('LA9343-0')).toBe(true);

      expect(obs.valueCodeableConcept?.text)?.toBeTruthy();
    };

    map('A'); map('C'); map('V'); map('P'); map('U');
  });

  it('no crea Observations para valores inválidos o faltantes', () => {
    const out = run({ bgMgDl: undefined, avpu: 'X' as any }, ctx);
    expect(findByLoinc(out, '2339-0')).toBeFalsy();
    expect(findByLoinc(out, '67775-7')).toBeFalsy();
  });
});
