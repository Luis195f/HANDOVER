import { describe, it, expect } from 'vitest';
import { buildHandoverBundle, __test__ } from '../fhir-map';

const findObsByLoinc = (bundle: any, code: string) =>
  (bundle?.entry ?? []).map((e: any) => e.resource)
    .find((r: any) =>
      r?.resourceType === 'Observation' &&
      r?.code?.coding?.some((c: any) => c.system === __test__.LOINC_SYSTEM && String(c.code) === String(code))
    );

describe('Panel 85353-1 — hasMember incluye ACVPU cuando existe', () => {
  const patientId = 'pat-001';
  const now = '2025-10-21T12:45:00Z';
  const acvpuRef = `urn:uuid:obs-acvpu-${patientId}-${now.slice(0,10)}`;

  it('incluye ACVPU en hasMember si emitHasMember=true y hay acvpu', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { hr: 80, acvpu: 'C' } },
      { now, emitHasMember: true }
    );

    const panel = findObsByLoinc(bundle, __test__.CODES.PANEL_VS.code);
    expect(panel).toBeTruthy();

    const refs = (panel?.hasMember ?? []).map((m: any) => m.reference);
    expect(refs).toContain(`urn:uuid:obs-${__test__.CODES.HR.code}-${patientId}`); // HR incluido
    expect(refs).toContain(acvpuRef); // ACVPU incluido
  });

  it('no incluye ACVPU si no está presente en vitals', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { hr: 75 } },
      { now, emitHasMember: true }
    );

    const panel = findObsByLoinc(bundle, __test__.CODES.PANEL_VS.code);
    const refs = (panel?.hasMember ?? []).map((m: any) => m.reference);
    expect(refs).toContain(`urn:uuid:obs-${__test__.CODES.HR.code}-${patientId}`);
    expect(refs).not.toContain(acvpuRef);
  });
});
