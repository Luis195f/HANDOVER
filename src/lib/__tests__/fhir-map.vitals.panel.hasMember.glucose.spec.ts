import { describe, it, expect } from 'vitest';
import { buildHandoverBundle, __test__ } from '../fhir-map';

const LOINC = __test__.LOINC_SYSTEM;

const findObsByLoinc = (bundle: any, code: string) =>
  (bundle?.entry ?? []).map((e: any) => e.resource)
    .find((r: any) =>
      r?.resourceType === 'Observation' &&
      r?.code?.coding?.some((c: any) => c.system === LOINC && String(c.code) === String(code))
    );

describe('Panel 85353-1 — hasMember incluye Glucemia cuando existe', () => {
  const patientId = 'pat-001';
  const now = '2025-10-21T13:10:00Z';

  it('incluye Glucemia (2339-0) cuando llega en mg/dL', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { hr: 80, bgMgDl: 104 } },
      { now, emitHasMember: true }
    );

    const panel = findObsByLoinc(bundle, __test__.CODES.PANEL_VS.code);
    expect(panel).toBeTruthy();

    const glu = findObsByLoinc(bundle, __test__.CODES.GLU_MASS_BLD.code); // 2339-0
    expect(glu).toBeTruthy();

    const refs = (panel?.hasMember ?? []).map((m: any) => m.reference);
    expect(refs).toContain(`urn:uuid:obs-${__test__.CODES.GLU_MASS_BLD.code}-${patientId}`);
  });

  it('normaliza mmol/L→mg/dL por defecto: incluye 2339-0', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { rr: 16, bgMmolL: 5.6 } }, // 5.6 mmol/L ≈ 101 mg/dL
      { now, emitHasMember: true } // normaliza por defecto
    );

    const panel = findObsByLoinc(bundle, __test__.CODES.PANEL_VS.code);
    const glu = findObsByLoinc(bundle, __test__.CODES.GLU_MASS_BLD.code);
    expect(panel && glu).toBeTruthy();

    const refs = (panel?.hasMember ?? []).map((m: any) => m.reference);
    expect(refs).toContain(`urn:uuid:obs-${__test__.CODES.GLU_MASS_BLD.code}-${patientId}`);
  });

  it('si se desactiva la normalización, incluye 14743-9 (mmol/L)', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { spo2: 97, bgMmolL: 6.0 } },
      { now, emitHasMember: true, normalizeGlucoseToMgDl: false }
    );

    const panel = findObsByLoinc(bundle, __test__.CODES.PANEL_VS.code);
    const gluMol = findObsByLoinc(bundle, __test__.CODES.GLU_MOLES_BLDC_GLUCOMETER.code); // 14743-9
    expect(panel && gluMol).toBeTruthy();

    const refs = (panel?.hasMember ?? []).map((m: any) => m.reference);
    expect(refs).toContain(`urn:uuid:obs-${__test__.CODES.GLU_MOLES_BLDC_GLUCOMETER.code}-${patientId}`);
  });

  it('no incluye glucemia si no existe', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { hr: 70 } },
      { now, emitHasMember: true }
    );

    const panel = findObsByLoinc(bundle, __test__.CODES.PANEL_VS.code);
    const refs = (panel?.hasMember ?? []).map((m: any) => m.reference);
    // no debe contener ni 2339-0 ni 14743-9
    expect(refs).not.toContain(`urn:uuid:obs-${__test__.CODES.GLU_MASS_BLD.code}-${patientId}`);
    expect(refs).not.toContain(`urn:uuid:obs-${__test__.CODES.GLU_MOLES_BLDC_GLUCOMETER.code}-${patientId}`);
  });
});
