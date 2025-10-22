import { describe, it, expect } from 'vitest';
import { buildHandoverBundle, __test__ } from '../fhir-map';

const findObsByLoinc = (bundle: any, code: string) =>
  (bundle?.entry ?? []).map((e: any) => e.resource)
    .find((r: any) =>
      r?.resourceType === 'Observation' &&
      r?.code?.coding?.some((c: any) => c.system === __test__.LOINC_SYSTEM && String(c.code) === String(code))
    );

describe('Panel 85353-1 — hasMember a individuales (opcional)', () => {
  const patientId = 'pat-001';
  const now = '2025-10-21T12:00:00Z';

  it('incluye hasMember a HR/RR/Temp/SpO2/SBP/DBP presentes cuando emitHasMember=true', () => {
    const vitals = { hr: 80, rr: 16, temp: 37.1, spo2: 97, sbp: 118, dbp: 76 };
    const bundle = buildHandoverBundle(
      { patientId, vitals },
      { now, emitHasMember: true }
    );

    const panel = findObsByLoinc(bundle, __test__.CODES.PANEL_VS.code); // 85353-1
    expect(panel).toBeTruthy();
    const refs = (panel?.hasMember ?? []).map((m: any) => m.reference);

    expect(refs).toContain(`urn:uuid:obs-${__test__.CODES.HR.code}-${patientId}`);
    expect(refs).toContain(`urn:uuid:obs-${__test__.CODES.RR.code}-${patientId}`);
    expect(refs).toContain(`urn:uuid:obs-${__test__.CODES.TEMP.code}-${patientId}`);
    expect(refs).toContain(`urn:uuid:obs-${__test__.CODES.SPO2.code}-${patientId}`);
    expect(refs).toContain(`urn:uuid:obs-${__test__.CODES.SBP.code}-${patientId}`);
    expect(refs).toContain(`urn:uuid:obs-${__test__.CODES.DBP.code}-${patientId}`);
  });

  it('sólo incluye los miembros disponibles (ej. sólo HR)', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { hr: 72 } },
      { now, emitHasMember: true }
    );

    const panel = findObsByLoinc(bundle, __test__.CODES.PANEL_VS.code);
    const refs = (panel?.hasMember ?? []).map((m: any) => m.reference);

    expect(refs).toEqual([`urn:uuid:obs-${__test__.CODES.HR.code}-${patientId}`]);
  });

  it('por defecto no agrega hasMember (emitHasMember=false)', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { hr: 65, rr: 14 } },
      { now } // sin toggle
    );
    const panel = findObsByLoinc(bundle, __test__.CODES.PANEL_VS.code);
    expect(panel?.hasMember).toBeUndefined();
  });
});
