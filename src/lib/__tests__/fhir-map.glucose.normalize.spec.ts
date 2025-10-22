// src/lib/__tests__/fhir-map.glucose.normalize.spec.ts
import { describe, it, expect } from 'vitest';
import { buildHandoverBundle, __test__ } from '../fhir-map';

type Ctx = { patientId: string };

const findObsByLoinc = (bundle: any, code: string) =>
  (bundle?.entry ?? []).map((e: any) => e.resource)
    .find((r: any) =>
      r?.resourceType === 'Observation' &&
      r?.code?.coding?.some((c: any) => c.system === __test__.LOINC_SYSTEM && String(c.code) === String(code))
    );

const hasCategory = (obs: any, code: string) =>
  obs?.category?.some((cat: any) =>
    cat?.coding?.some((c: any) => c.system === __test__.OBS_CAT_SYSTEM && c.code === code)
  );

describe('Glucemia capilar — normalización mmol/L → mg/dL y variantes', () => {
  const ctx: Ctx = { patientId: 'pat-001' };

  it('por defecto normaliza mmol/L → mg/dL y deja nota de conversión', () => {
    const mmoll = 5.6; // 5.6 * 18.0182 ≈ 100.90192 → 101 mg/dL (decimales=0)
    const bundle = buildHandoverBundle({
      patientId: ctx.patientId,
      vitals: { bgMmolL: mmoll }
    });

    const glu = findObsByLoinc(bundle, __test__.CODES.GLU_MASS_BLD.code); // 2339-0
    expect(glu).toBeTruthy();

    // UCUM y valor redondeado a 0 decimales por defecto
    expect(glu.valueQuantity.unit).toBe(__test__.UNITS.MG_DL);
    expect(glu.valueQuantity.code).toBe(__test__.UNITS.MG_DL);
    expect(glu.valueQuantity.system).toBe(__test__.UCUM_SYSTEM);
    expect(glu.valueQuantity.value).toBe(101);

    // Categoría laboratory
    expect(hasCategory(glu, __test__.OBS_CAT_LAB)).toBe(true);

    // Nota presente y con el factor
    const noteText = (glu.note?.[0]?.text ?? '') as string;
    expect(noteText).toContain('Convertido desde 5.6 mmol/L');
    expect(noteText).toContain('factor 18.0182');
  });

  it('normalización activada con decimales configurables (1 decimal)', () => {
    const mmoll = 7.3; // 7.3 * 18.0182 ≈ 131.53286 → 131.5 mg/dL (1 decimal)
    const bundle = buildHandoverBundle({
      patientId: ctx.patientId,
      vitals: { bgMmolL: mmoll }
    }, { normalizeGlucoseToMgDl: true, glucoseDecimals: 1 });

    const glu = findObsByLoinc(bundle, __test__.CODES.GLU_MASS_BLD.code); // 2339-0
    expect(glu).toBeTruthy();
    expect(glu.valueQuantity.unit).toBe(__test__.UNITS.MG_DL);
    expect(glu.valueQuantity.value).toBeCloseTo(131.5, 2);

    const noteText = (glu.note?.[0]?.text ?? '') as string;
    expect(noteText).toContain('factor 18.0182');
  });

  it('si se desactiva la normalización, emite mmol/L con LOINC de SCnc (14743-9) y sin nota', () => {
    const mmoll = 5.6;
    const bundle = buildHandoverBundle({
      patientId: ctx.patientId,
      vitals: { bgMmolL: mmoll }
    }, { normalizeGlucoseToMgDl: false });

    // Debe salir 14743-9 con unidad mmol/L
    const gluMol = findObsByLoinc(bundle, __test__.CODES.GLU_MOLES_BLDC_GLUCOMETER.code);
    expect(gluMol).toBeTruthy();
    expect(gluMol.valueQuantity.unit).toBe(__test__.UNITS.MMOL_L);
    expect(gluMol.valueQuantity.value).toBeCloseTo(mmoll, 6);
    expect(gluMol.note).toBeUndefined();
  });

  it('cuando llegan ambas unidades, prevalece el valor en mg/dL sin nota', () => {
    const bundle = buildHandoverBundle({
      patientId: ctx.patientId,
      vitals: { bgMgDl: 98, bgMmolL: 5.4 }
    });

    const glu = findObsByLoinc(bundle, __test__.CODES.GLU_MASS_BLD.code); // 2339-0
    expect(glu).toBeTruthy();
    expect(glu.valueQuantity.value).toBe(98);
    expect(glu.valueQuantity.unit).toBe(__test__.UNITS.MG_DL);
    expect(glu.note).toBeUndefined(); // no hay conversión
  });

  it('no emite glucemia si no hay valores válidos', () => {
    const bundle = buildHandoverBundle({
      patientId: ctx.patientId,
      vitals: { bgMgDl: undefined as any, bgMmolL: NaN as any }
    });

    const gluMass = findObsByLoinc(bundle, __test__.CODES.GLU_MASS_BLD.code);
    const gluMoles = findObsByLoinc(bundle, __test__.CODES.GLU_MOLES_BLDC_GLUCOMETER.code);
    expect(gluMass).toBeFalsy();
    expect(gluMoles).toBeFalsy();
  });
});
