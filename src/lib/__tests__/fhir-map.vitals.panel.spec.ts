// src/lib/__tests__/fhir-map.vitals.panel.spec.ts
import { describe, it, expect } from 'vitest';
import { buildHandoverBundle } from '../fhir-map';
import { TEST_CATEGORY_CODES, TEST_SYSTEMS, TEST_VITAL_CODES } from './fhir-map.test-constants';

const LOINC = TEST_SYSTEMS.LOINC;
const UOM   = TEST_SYSTEMS.UCUM;

const findObsByLoinc = (bundle: any, code: string) =>
  (bundle?.entry ?? [])
    .map((e: any) => e.resource)
    .find(
      (r: any) =>
        r?.resourceType === 'Observation' &&
        r?.code?.coding?.some((c: any) => c.system === LOINC && String(c.code) === String(code))
    );

const getPanelComponent = (panel: any, loincCode: string) =>
  (panel?.component ?? []).find((comp: any) =>
    comp?.code?.coding?.some((c: any) => c.system === LOINC && c.code === loincCode)
  );

const hasCategory = (obs: any, code: string) =>
  obs?.category?.some((cat: any) =>
    cat?.coding?.some((c: any) => c.system === TEST_SYSTEMS.OBSERVATION_CATEGORY && c.code === code)
  );

describe('Panel de Vitales 85353-1 — componentes presentes y coherentes', () => {
  const patientId = 'pat-001';
  const now = '2025-10-21T10:30:00Z';

  it('no emite panel por defecto (emitPanel undefined)', () => {
    const bundle = buildHandoverBundle({ patientId, vitals: { hr: 72, rr: 16 } }, { now });
    const panel = findObsByLoinc(bundle, TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code);
    expect(panel).toBeFalsy();
  });

  it('emite panel 85353-1 con HR/RR/Temp/SpO2/SBP/DBP como componentes (valores iguales a los individuales)', () => {
    const vitals = { hr: 88, rr: 18, temp: 37.2, spo2: 96, sbp: 120, dbp: 75 };
    const bundle = buildHandoverBundle({ patientId, vitals }, { now, emitPanel: true });

    // Panel
    const panel = findObsByLoinc(bundle, TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code); // 85353-1
    expect(panel).toBeTruthy();
    expect(panel.status).toBe('final');
    expect(panel.subject?.reference).toBe(`Patient/${patientId}`);
    expect(panel.effectiveDateTime).toBe(now);
    expect(hasCategory(panel, TEST_CATEGORY_CODES.VITAL_SIGNS)).toBe(true);

    // Observations individuales (para comparar valores)
    const hr  = findObsByLoinc(bundle, TEST_VITAL_CODES.HEART_RATE.code);
    const rr  = findObsByLoinc(bundle, TEST_VITAL_CODES.RESP_RATE.code);
    const t   = findObsByLoinc(bundle, TEST_VITAL_CODES.TEMPERATURE.code);
    const s   = findObsByLoinc(bundle, TEST_VITAL_CODES.SPO2.code);
    const sb  = findObsByLoinc(bundle, TEST_VITAL_CODES.BP_SYSTOLIC.code);
    const db  = findObsByLoinc(bundle, TEST_VITAL_CODES.BP_DIASTOLIC.code);

    for (const r of [hr, rr, t, s, sb, db]) {
      expect(r).toBeTruthy(); // individuales existen
      expect(hasCategory(r, TEST_CATEGORY_CODES.VITAL_SIGNS)).toBe(true);
    }

    // Componentes del panel y coherencia de valores/UCUM
    const cmpHR  = getPanelComponent(panel, TEST_VITAL_CODES.HEART_RATE.code);
    const cmpRR  = getPanelComponent(panel, TEST_VITAL_CODES.RESP_RATE.code);
    const cmpT   = getPanelComponent(panel, TEST_VITAL_CODES.TEMPERATURE.code);
    const cmpS   = getPanelComponent(panel, TEST_VITAL_CODES.SPO2.code);
    const cmpSB  = getPanelComponent(panel, TEST_VITAL_CODES.BP_SYSTOLIC.code);
    const cmpDB  = getPanelComponent(panel, TEST_VITAL_CODES.BP_DIASTOLIC.code);

    expect(cmpHR?.valueQuantity).toMatchObject({ unit: '/min', code: '/min', system: UOM, value: vitals.hr });
    expect(cmpRR?.valueQuantity).toMatchObject({ unit: '/min', code: '/min', system: UOM, value: vitals.rr });
    expect(cmpT?.valueQuantity).toMatchObject({  unit: 'Cel',     code: 'Cel',     system: UOM, value: vitals.temp });
    expect(cmpS?.valueQuantity).toMatchObject({  unit: '%',     code: '%',     system: UOM, value: vitals.spo2 });
    expect(cmpSB?.valueQuantity).toMatchObject({ unit: 'mm[Hg]',   code: 'mm[Hg]',   system: UOM, value: vitals.sbp });
    expect(cmpDB?.valueQuantity).toMatchObject({ unit: 'mm[Hg]',   code: 'mm[Hg]',   system: UOM, value: vitals.dbp });
  });

  it('incluye sólo los componentes presentes (ej. solo HR)', () => {
    const vitals = { hr: 72 }; // sólo FC
    const bundle = buildHandoverBundle({ patientId, vitals }, { now, emitPanel: true });

    const panel = findObsByLoinc(bundle, TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code);
    expect(panel).toBeTruthy();

    const cmpHR  = getPanelComponent(panel, TEST_VITAL_CODES.HEART_RATE.code);
    const cmpRR  = getPanelComponent(panel, TEST_VITAL_CODES.RESP_RATE.code);
    const cmpT   = getPanelComponent(panel, TEST_VITAL_CODES.TEMPERATURE.code);
    const cmpS   = getPanelComponent(panel, TEST_VITAL_CODES.SPO2.code);
    const cmpSB  = getPanelComponent(panel, TEST_VITAL_CODES.BP_SYSTOLIC.code);
    const cmpDB  = getPanelComponent(panel, TEST_VITAL_CODES.BP_DIASTOLIC.code);

    expect(cmpHR).toBeTruthy();
    for (const none of [cmpRR, cmpT, cmpS, cmpSB, cmpDB]) expect(none).toBeFalsy();

    expect(cmpHR?.valueQuantity?.value).toBe(72);
    expect(cmpHR?.valueQuantity?.unit).toBe('/min');
  });

  it('no crea panel si no hay ningún vital', () => {
    const bundle = buildHandoverBundle({ patientId, vitals: {} }, { now, emitPanel: true });
    const panel = findObsByLoinc(bundle, TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code);
    expect(panel).toBeFalsy();
  });

  it('respeta emitPanel=false (no emite panel aunque haya vitales)', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { hr: 70, rr: 15 } },
      { now, emitPanel: false }
    );
    const panel = findObsByLoinc(bundle, TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code);
    expect(panel).toBeFalsy();
  });
});
