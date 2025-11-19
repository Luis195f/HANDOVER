import { describe, it, expect } from 'vitest';
import { buildHandoverBundle } from '../fhir-map';
import { TEST_SYSTEMS, TEST_VITAL_CODES } from './fhir-map.test-constants';

const LOINC = TEST_SYSTEMS.LOINC;

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
      { now, emitPanel: true, emitHasMember: true }
    );

    const panel = findObsByLoinc(bundle, TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code);
    expect(panel).toBeTruthy();

    const glu = findObsByLoinc(bundle, TEST_VITAL_CODES.GLUCOSE_MASS_BLD.code); // 2339-0
    expect(glu).toBeTruthy();

    const refs = (panel?.hasMember ?? []).map((m: any) => m.reference);
    expect(refs).toContain(`urn:uuid:obs-${TEST_VITAL_CODES.GLUCOSE_MASS_BLD.code}-${patientId}`);
  });

  it('normaliza mmol/L→mg/dL por defecto: incluye 2339-0', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { rr: 16, bgMmolL: 5.6 } }, // 5.6 mmol/L ≈ 101 mg/dL
      { now, emitPanel: true, emitHasMember: true } // normaliza por defecto
    );

    const panel = findObsByLoinc(bundle, TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code);
    const glu = findObsByLoinc(bundle, TEST_VITAL_CODES.GLUCOSE_MASS_BLD.code);
    expect(panel && glu).toBeTruthy();

    const refs = (panel?.hasMember ?? []).map((m: any) => m.reference);
    expect(refs).toContain(`urn:uuid:obs-${TEST_VITAL_CODES.GLUCOSE_MASS_BLD.code}-${patientId}`);
  });

  it('si se desactiva la normalización, incluye 14743-9 (mmol/L)', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { spo2: 97, bgMmolL: 6.0 } },
      { now, emitPanel: true, emitHasMember: true, normalizeGlucoseToMgDl: false }
    );

    const panel = findObsByLoinc(bundle, TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code);
    const gluMol = findObsByLoinc(bundle, TEST_VITAL_CODES.GLUCOSE_MOLES_BLD.code); // 14743-9
    expect(panel && gluMol).toBeTruthy();

    const refs = (panel?.hasMember ?? []).map((m: any) => m.reference);
    expect(refs).toContain(`urn:uuid:obs-${TEST_VITAL_CODES.GLUCOSE_MOLES_BLD.code}-${patientId}`);
  });

  it('no incluye glucemia si no existe', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { hr: 70 } },
      { now, emitPanel: true, emitHasMember: true }
    );

    const panel = findObsByLoinc(bundle, TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code);
    const refs = (panel?.hasMember ?? []).map((m: any) => m.reference);
    // no debe contener ni 2339-0 ni 14743-9
    expect(refs).not.toContain(`urn:uuid:obs-${TEST_VITAL_CODES.GLUCOSE_MASS_BLD.code}-${patientId}`);
    expect(refs).not.toContain(`urn:uuid:obs-${TEST_VITAL_CODES.GLUCOSE_MOLES_BLD.code}-${patientId}`);
  });
});
