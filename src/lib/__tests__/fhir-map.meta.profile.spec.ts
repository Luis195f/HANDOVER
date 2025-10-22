import { describe, it, expect } from 'vitest';
import { buildHandoverBundle, __test__ } from '../fhir-map';

const listObs = (bundle: any) =>
  (bundle.entry ?? []).map((e: any) => e.resource).filter((r: any) => r?.resourceType === 'Observation');

const findBy = (bundle: any, code: string) =>
  listObs(bundle).find((r: any) =>
    r?.code?.coding?.some((c: any) => c.system === __test__.LOINC_SYSTEM && String(c.code) === String(code))
  );

describe('meta.profile — vitales, bp y laboratorio', () => {
  const patientId = 'pat-001';
  const now = '2025-10-21T18:22:00Z';

  it('vitales individuales incluyen vitalsigns; panel BP incluye bp+vitalsigns; glucemia no tiene vitalsigns', () => {
    const b = buildHandoverBundle(
      { patientId, vitals: { hr: 80, rr: 16, sbp: 120, dbp: 75, bgMgDl: 104 } },
      { now, emitHasMember: true }
    );
    const hr = findBy(b, __test__.CODES.HR.code);
    const bpPanel = findBy(b, __test__.CODES.PANEL_BP.code);
    const glu = findBy(b, __test__.CODES.GLU_MASS_BLD.code);

    expect(hr?.meta?.profile).toContain('http://hl7.org/fhir/StructureDefinition/vitalsigns');
    expect(bpPanel?.meta?.profile).toContain('http://hl7.org/fhir/StructureDefinition/bp');
    expect(bpPanel?.meta?.profile).toContain('http://hl7.org/fhir/StructureDefinition/vitalsigns');
    expect(glu?.meta?.profile ?? []).not.toContain('http://hl7.org/fhir/StructureDefinition/vitalsigns');
  });

  it('permite añadir perfiles personalizados vía opts.profileUrls.Observation (se fusiona, no reemplaza)', () => {
    const CUSTOM = 'https://example.org/fhir/StructureDefinition/Observation-HandoverApp';
    const b = buildHandoverBundle(
      { patientId, vitals: { spo2: 97 } },
      { now, profileUrls: { Observation: [CUSTOM] } }
    );
    const spo = findBy(b, __test__.CODES.SPO2.code);
    expect(spo?.meta?.profile).toContain('http://hl7.org/fhir/StructureDefinition/vitalsigns');
    expect(spo?.meta?.profile).toContain(CUSTOM);
  });
});
