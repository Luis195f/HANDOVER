import { describe, it, expect } from 'vitest';
import { buildHandoverBundle } from '../fhir-map';
import { TEST_SYSTEMS, TEST_VITAL_CODES } from './fhir-map.test-constants';

const findObsByLoinc = (bundle: any, code: string) =>
  (bundle?.entry ?? []).map((e: any) => e.resource)
    .find((r: any) =>
      r?.resourceType === 'Observation' &&
      r?.code?.coding?.some((c: any) => c.system === TEST_SYSTEMS.LOINC && String(c.code) === String(code))
    );

describe('Panel 85353-1 — hasMember incluye ACVPU cuando existe', () => {
  const patientId = 'pat-001';
  const now = '2025-10-21T12:45:00Z';
  const acvpuRef = `urn:uuid:obs-acvpu-${patientId}-${now.slice(0,10)}`;

  it('incluye ACVPU en hasMember si emitHasMember=true y hay acvpu', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { hr: 80, acvpu: 'C' } },
      { now, emitPanel: true, emitHasMember: true }
    );

    const panel = findObsByLoinc(bundle, TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code);
    expect(panel).toBeTruthy();

    const refs = (panel?.hasMember ?? []).map((m: any) => m.reference);
    expect(refs).toContain(`urn:uuid:obs-${TEST_VITAL_CODES.HEART_RATE.code}-${patientId}`); // HR incluido
    expect(refs).toContain(acvpuRef); // ACVPU incluido
  });

  it('no incluye ACVPU si no está presente en vitals', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { hr: 75 } },
      { now, emitPanel: true, emitHasMember: true }
    );

    const panel = findObsByLoinc(bundle, TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code);
    const refs = (panel?.hasMember ?? []).map((m: any) => m.reference);
    expect(refs).toContain(`urn:uuid:obs-${TEST_VITAL_CODES.HEART_RATE.code}-${patientId}`);
    expect(refs).not.toContain(acvpuRef);
  });
});
