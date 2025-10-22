// src/lib/__tests__/fhir-map.vitals.panel.spec.ts
import { describe, it, expect } from 'vitest';
import { buildHandoverBundle, __test__ } from '../fhir-map';

const LOINC = __test__.LOINC_SYSTEM;
const UOM   = __test__.UCUM_SYSTEM;

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
    cat?.coding?.some((c: any) => c.system === __test__.OBS_CAT_SYSTEM && c.code === code)
  );

describe('Panel de Vitales 85353-1 — componentes presentes y coherentes', () => {
  const patientId = 'pat-001';
  const now = '2025-10-21T10:30:00Z';

  it('emite panel 85353-1 con HR/RR/Temp/SpO2/SBP/DBP como componentes (valores iguales a los individuales)', () => {
    const vitals = { hr: 88, rr: 18, temp: 37.2, spo2: 96, sbp: 120, dbp: 75 };
    const bundle = buildHandoverBundle({ patientId, vitals }, { now });

    // Panel
    const panel = findObsByLoinc(bundle, __test__.CODES.PANEL_VS.code); // 85353-1
    expect(panel).toBeTruthy();
    expect(panel.status).toBe('final');
    expect(panel.subject?.reference).toBe(`Patient/${patientId}`);
    expect(panel.effectiveDateTime).toBe(now);
    expect(hasCategory(panel, __test__.OBS_CAT_VITALS)).toBe(true);

    // Observations individuales (para comparar valores)
    const hr  = findObsByLoinc(bundle, __test__.CODES.HR.code);
    const rr  = findObsByLoinc(bundle, __test__.CODES.RR.code);
    const t   = findObsByLoinc(bundle, __test__.CODES.TEMP.code);
    const s   = findObsByLoinc(bundle, __test__.CODES.SPO2.code);
    const sb  = findObsByLoinc(bundle, __test__.CODES.SBP.code);
    const db  = findObsByLoinc(bundle, __test__.CODES.DBP.code);

    for (const r of [hr, rr, t, s, sb, db]) {
      expect(r).toBeTruthy(); // individuales existen
      expect(hasCategory(r, __test__.OBS_CAT_VITALS)).toBe(true);
    }

    // Componentes del panel y coherencia de valores/UCUM
    const cmpHR  = getPanelComponent(panel, __test__.CODES.HR.code);
    const cmpRR  = getPanelComponent(panel, __test__.CODES.RR.code);
    const cmpT   = getPanelComponent(panel, __test__.CODES.TEMP.code);
    const cmpS   = getPanelComponent(panel, __test__.CODES.SPO2.code);
    const cmpSB  = getPanelComponent(panel, __test__.CODES.SBP.code);
    const cmpDB  = getPanelComponent(panel, __test__.CODES.DBP.code);

    expect(cmpHR?.valueQuantity).toMatchObject({ unit: __test__.UNITS.PER_MIN, code: __test__.UNITS.PER_MIN, system: UOM, value: vitals.hr });
    expect(cmpRR?.valueQuantity).toMatchObject({ unit: __test__.UNITS.PER_MIN, code: __test__.UNITS.PER_MIN, system: UOM, value: vitals.rr });
    expect(cmpT?.valueQuantity).toMatchObject({  unit: __test__.UNITS.CEL,     code: __test__.UNITS.CEL,     system: UOM, value: vitals.temp });
    expect(cmpS?.valueQuantity).toMatchObject({  unit: __test__.UNITS.PCT,     code: __test__.UNITS.PCT,     system: UOM, value: vitals.spo2 });
    expect(cmpSB?.valueQuantity).toMatchObject({ unit: __test__.UNITS.MM_HG,   code: __test__.UNITS.MM_HG,   system: UOM, value: vitals.sbp });
    expect(cmpDB?.valueQuantity).toMatchObject({ unit: __test__.UNITS.MM_HG,   code: __test__.UNITS.MM_HG,   system: UOM, value: vitals.dbp });
  });

  it('incluye sólo los componentes presentes (ej. solo HR)', () => {
    const vitals = { hr: 72 }; // sólo FC
    const bundle = buildHandoverBundle({ patientId, vitals }, { now });

    const panel = findObsByLoinc(bundle, __test__.CODES.PANEL_VS.code);
    expect(panel).toBeTruthy();

    const cmpHR  = getPanelComponent(panel, __test__.CODES.HR.code);
    const cmpRR  = getPanelComponent(panel, __test__.CODES.RR.code);
    const cmpT   = getPanelComponent(panel, __test__.CODES.TEMP.code);
    const cmpS   = getPanelComponent(panel, __test__.CODES.SPO2.code);
    const cmpSB  = getPanelComponent(panel, __test__.CODES.SBP.code);
    const cmpDB  = getPanelComponent(panel, __test__.CODES.DBP.code);

    expect(cmpHR).toBeTruthy();
    for (const none of [cmpRR, cmpT, cmpS, cmpSB, cmpDB]) expect(none).toBeFalsy();

    expect(cmpHR?.valueQuantity?.value).toBe(72);
    expect(cmpHR?.valueQuantity?.unit).toBe(__test__.UNITS.PER_MIN);
  });

  it('no crea panel si no hay ningún vital', () => {
    const bundle = buildHandoverBundle({ patientId, vitals: {} }, { now });
    const panel = findObsByLoinc(bundle, __test__.CODES.PANEL_VS.code);
    expect(panel).toBeFalsy();
  });

  it('respeta emitPanel=false (no emite panel aunque haya vitales)', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { hr: 70, rr: 15 } },
      { now, emitPanel: false }
    );
    const panel = findObsByLoinc(bundle, __test__.CODES.PANEL_VS.code);
    expect(panel).toBeFalsy();
  });
});
