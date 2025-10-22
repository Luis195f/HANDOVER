import { describe, it, expect } from 'vitest';
import { buildHandoverBundle, __test__ } from '../fhir-map';

const LOINC = __test__.LOINC_SYSTEM;
const UOM   = __test__.UCUM_SYSTEM;

const findObsByLoinc = (bundle: any, code: string) =>
  (bundle?.entry ?? []).map((e: any) => e.resource).find(
    (r: any) => r?.resourceType === 'Observation' &&
      r?.code?.coding?.some((c: any) => c.system === LOINC && String(c.code) === String(code))
  );

const getComponent = (panel: any, loincCode: string) =>
  (panel?.component ?? []).find((comp: any) =>
    comp?.code?.coding?.some((c: any) => c.system === LOINC && c.code === loincCode)
  );

const hasCategory = (obs: any, code: string) =>
  obs?.category?.some((cat: any) =>
    cat?.coding?.some((c: any) => c.system === __test__.OBS_CAT_SYSTEM && c.code === code)
  );

describe('Panel de Presión Arterial 85354-9 — componentes y coherencia', () => {
  const patientId = 'pat-001';
  const now = '2025-10-21T11:00:00Z';

  it('emite BP panel 85354-9 con TAS/TAD cuando ambos están presentes', () => {
    const vitals = { sbp: 118, dbp: 73 };
    const bundle = buildHandoverBundle({ patientId, vitals }, { now });

    // Panel BP
    const bpPanel = findObsByLoinc(bundle, __test__.CODES.PANEL_BP.code); // 85354-9
    expect(bpPanel).toBeTruthy();
    expect(bpPanel.status).toBe('final');
    expect(bpPanel.subject?.reference).toBe(`Patient/${patientId}`);
    expect(bpPanel.effectiveDateTime).toBe(now);
    expect(hasCategory(bpPanel, __test__.OBS_CAT_VITALS)).toBe(true);

    // Componentes
    const cmpSBP = getComponent(bpPanel, __test__.CODES.SBP.code);
    const cmpDBP = getComponent(bpPanel, __test__.CODES.DBP.code);
    expect(cmpSBP?.valueQuantity).toMatchObject({ value: 118, unit: __test__.UNITS.MM_HG, code: __test__.UNITS.MM_HG, system: UOM });
    expect(cmpDBP?.valueQuantity).toMatchObject({ value: 73,  unit: __test__.UNITS.MM_HG, code: __test__.UNITS.MM_HG, system: UOM });

    // Individuales existen y coinciden
    const sbpInd = findObsByLoinc(bundle, __test__.CODES.SBP.code);
    const dbpInd = findObsByLoinc(bundle, __test__.CODES.DBP.code);
    expect(sbpInd).toBeTruthy();
    expect(dbpInd).toBeTruthy();
  });

  it('incluye sólo el componente disponible (ej. sólo TAS)', () => {
    const vitals = { sbp: 130 }; // sin dbp
    const bundle = buildHandoverBundle({ patientId, vitals }, { now });

    const bpPanel = findObsByLoinc(bundle, __test__.CODES.PANEL_BP.code);
    expect(bpPanel).toBeTruthy();

    const cmpSBP = getComponent(bpPanel, __test__.CODES.SBP.code);
    const cmpDBP = getComponent(bpPanel, __test__.CODES.DBP.code);
    expect(cmpSBP).toBeTruthy();
    expect(cmpDBP).toBeFalsy();
    expect(cmpSBP?.valueQuantity?.value).toBe(130);
  });

  it('respeta emitBpPanel=false (no crea panel aunque haya TAS/TAD)', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { sbp: 120, dbp: 80 } },
      { now, emitBpPanel: false }
    );
    const bpPanel = findObsByLoinc(bundle, __test__.CODES.PANEL_BP.code);
    expect(bpPanel).toBeFalsy();
  });

  it('añade hasMember si emitHasMember=true', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { sbp: 122, dbp: 78 } },
      { now, emitHasMember: true }
    );
    const bpPanel = findObsByLoinc(bundle, __test__.CODES.PANEL_BP.code);
    expect(bpPanel).toBeTruthy();

    const refs = (bpPanel?.hasMember ?? []).map((m: any) => m.reference);
    expect(refs).toContain(`urn:uuid:obs-${__test__.CODES.SBP.code}-${patientId}`);
    expect(refs).toContain(`urn:uuid:obs-${__test__.CODES.DBP.code}-${patientId}`);
  });

  it('no crea panel si no hay TAS ni TAD', () => {
    const bundle = buildHandoverBundle({ patientId, vitals: {} }, { now });
    const bpPanel = findObsByLoinc(bundle, __test__.CODES.PANEL_BP.code);
    expect(bpPanel).toBeFalsy();
  });
});
