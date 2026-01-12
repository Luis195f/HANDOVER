import { describe, it, expect } from 'vitest';
import { buildHandoverBundle } from '../fhir-map';
import { TEST_SYSTEMS, TEST_VITAL_CODES } from './fhir-map.test-constants';

const findObsByLoinc = (bundle: any, code: string) =>
  (bundle?.entry ?? []).map((e: any) => e.resource)
    .find((r: any) =>
      r?.resourceType === 'Observation' &&
      r?.code?.coding?.some((c: any) => c.system === TEST_SYSTEMS.LOINC && String(c.code) === String(code))
    );

const findEntryByLoinc = (bundle: any, code: string) =>
  (bundle?.entry ?? []).find((e: any) =>
    e?.resource?.resourceType === 'Observation' &&
    e?.resource?.code?.coding?.some((c: any) => c.system === TEST_SYSTEMS.LOINC && String(c.code) === String(code))
  );

describe('Panel 85353-1 — hasMember a individuales (opcional)', () => {
  const patientId = 'pat-001';
  const now = '2025-10-21T12:00:00Z';

  it('incluye hasMember a HR/RR/Temp/SpO2/SBP/DBP presentes cuando emitHasMember=true', () => {
    const vitals = { hr: 80, rr: 16, temp: 37.1, spo2: 97, sbp: 118, dbp: 76 };
    const bundle = buildHandoverBundle(
      { patientId, vitals },
      { now, emitPanel: true, emitHasMember: true }
    );

    const panel = findObsByLoinc(bundle, TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code); // 85353-1
    expect(panel).toBeTruthy();
    const refs = (panel?.hasMember ?? []).map((m: any) => m.reference);

    const hrEntry = findEntryByLoinc(bundle, TEST_VITAL_CODES.HEART_RATE.code);
    const rrEntry = findEntryByLoinc(bundle, TEST_VITAL_CODES.RESP_RATE.code);
    const tempEntry = findEntryByLoinc(bundle, TEST_VITAL_CODES.TEMPERATURE.code);
    const spo2Entry = findEntryByLoinc(bundle, TEST_VITAL_CODES.SPO2.code);
    const sbpEntry = findEntryByLoinc(bundle, TEST_VITAL_CODES.BP_SYSTOLIC.code);
    const dbpEntry = findEntryByLoinc(bundle, TEST_VITAL_CODES.BP_DIASTOLIC.code);

    expect(hrEntry).toBeDefined();
    expect(rrEntry).toBeDefined();
    expect(tempEntry).toBeDefined();
    expect(spo2Entry).toBeDefined();
    expect(sbpEntry).toBeDefined();
    expect(dbpEntry).toBeDefined();

    expect(refs).toContain(hrEntry?.fullUrl);
    expect(refs).toContain(rrEntry?.fullUrl);
    expect(refs).toContain(tempEntry?.fullUrl);
    expect(refs).toContain(spo2Entry?.fullUrl);
    expect(refs).toContain(sbpEntry?.fullUrl);
    expect(refs).toContain(dbpEntry?.fullUrl);
  });

  it('sólo incluye los miembros disponibles (ej. sólo HR)', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { hr: 72 } },
      { now, emitPanel: true, emitHasMember: true }
    );

    const panel = findObsByLoinc(bundle, TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code);
    const refs = (panel?.hasMember ?? []).map((m: any) => m.reference);
    const hrEntry = findEntryByLoinc(bundle, TEST_VITAL_CODES.HEART_RATE.code);

    expect(hrEntry).toBeDefined();
    expect(refs).toEqual([hrEntry?.fullUrl]);
  });

  it('por defecto no agrega hasMember (emitHasMember=false)', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { hr: 65, rr: 14 } },
      { now, emitPanel: true } // sin toggle emitHasMember
    );
    const panel = findObsByLoinc(bundle, TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code);
    expect(panel?.hasMember).toBeUndefined();
  });
});
