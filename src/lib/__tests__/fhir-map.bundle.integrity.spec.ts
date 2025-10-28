import { describe, it, expect } from 'vitest';
import { buildHandoverBundle, __test__ } from '../fhir-map';

type Entry = { fullUrl?: string; resource?: any };

const byFullUrl = (bundle: any) => {
  const map = new Map<string, any>();
  for (const e of (bundle?.entry ?? []) as Entry[]) {
    if (e.fullUrl) map.set(e.fullUrl, e.resource);
  }
  return map;
};

const compositionOf = (bundle: any) =>
  (bundle?.entry ?? []).map((e: any) => e.resource)
    .find((r: any) => r?.resourceType === 'Composition');

const listResources = (bundle: any, type: string) =>
  (bundle?.entry ?? []).map((e: any) => e.resource)
    .filter((r: any) => r?.resourceType === type);

const findObsByLoinc = (bundle: any, code: string) =>
  listResources(bundle, 'Observation').find((r: any) =>
    r?.code?.coding?.some((c: any) => c.system === __test__.LOINC_SYSTEM && String(c.code) === String(code))
  );

describe('Bundle — coherencia Composition.section.entry ↔ entry.fullUrl', () => {
  const patientId = 'pat-001';
  const now = '2025-10-21T20:20:00Z';

  it('todas las referencias de sección existen y cada recurso (excepto Composition) aparece en alguna sección', () => {
    const bundle = buildHandoverBundle({
      patientId,
      vitals: {
        hr: 88, rr: 20, sbp: 120, dbp: 70, temp: 37.2, spo2: 98,
        acvpu: 'A', bgMgDl: 104, o2: true
      },
      meds: [{ text: 'Paracetamol 1 g v.o. c/8h' }],
      attachments: [{ url: 'https://cdn.example.org/audio.mp3', contentType: 'audio/mpeg', description: 'SBAR' }],
    }, { now, emitPanel: true, emitBpPanel: true, emitHasMember: true });

    // 1) Composition existe y tiene secciones esperadas
    const comp = compositionOf(bundle);
    expect(comp).toBeTruthy();
    const sections = comp?.section ?? [];
    const titles = sections.map((s: any) => s.title).sort();
    expect(titles).toEqual([
      'Attachments','Medications','Oxygen therapy','Vitals'
    ].sort());

    // 2) Todas las referencias de las secciones existen en el Bundle
    const map = byFullUrl(bundle);
    const allSectionRefs = new Set<string>();
    for (const s of sections) {
      for (const e of (s.entry ?? [])) {
        allSectionRefs.add(e.reference);
        expect(map.has(e.reference)).toBe(true);
      }
    }

    // 3) Todo recurso (excepto Composition) aparece en alguna sección
    for (const e of (bundle.entry ?? []) as Entry[]) {
      if (e?.resource?.resourceType === 'Composition') continue;
      expect(allSectionRefs.has(e.fullUrl!)).toBe(true);
    }
  });

  it('panel 85353-1 y 85354-9 coherentes: componentes ↔ individuales y hasMember apuntando a los fullUrl correctos', () => {
    const bundle = buildHandoverBundle({
      patientId,
      vitals: { hr: 82, rr: 18, sbp: 118, dbp: 76, temp: 36.9, spo2: 97, bgMmolL: 5.6, acvpu: 'C' },
    }, { now, emitPanel: true, emitBpPanel: true, emitHasMember: true, glucoseDecimals: 0 });

    // 85353-1 — Vital signs panel
    const vsPanel = findObsByLoinc(bundle, __test__.CODES.PANEL_VS.code);
    expect(vsPanel).toBeTruthy();
    // debe tener componentes para los vitales presentes
    const compCodes = (vsPanel.component ?? []).flatMap((c: any) => (c.code?.coding ?? []).map((k: any) => k.code));
    expect(new Set(compCodes)).toEqual(new Set([
      __test__.CODES.HR.code, __test__.CODES.RR.code, __test__.CODES.TEMP.code,
      __test__.CODES.SPO2.code, __test__.CODES.SBP.code, __test__.CODES.DBP.code,
    ]));

    // hasMember: debe incluir individuales + ACVPU + Glucemia (normalizada a 2339-0 por defecto)
    const members = (vsPanel.hasMember ?? []).map((m: any) => m.reference);
    const expectedRefs = [
      `urn:uuid:obs-${__test__.CODES.HR.code}-${patientId}`,
      `urn:uuid:obs-${__test__.CODES.RR.code}-${patientId}`,
      `urn:uuid:obs-${__test__.CODES.TEMP.code}-${patientId}`,
      `urn:uuid:obs-${__test__.CODES.SPO2.code}-${patientId}`,
      `urn:uuid:obs-${__test__.CODES.SBP.code}-${patientId}`,
      `urn:uuid:obs-${__test__.CODES.DBP.code}-${patientId}`,
      `urn:uuid:obs-${__test__.CODES.GLU_MASS_BLD.code}-${patientId}`, // 2339-0
      `urn:uuid:obs-acvpu-${patientId}-${now.slice(0,10)}`
    ];
    for (const ref of expectedRefs) expect(members).toContain(ref);

    // 85354-9 — Blood pressure panel con hasMember a SBP/DBP
    const bpPanel = findObsByLoinc(bundle, __test__.CODES.PANEL_BP.code);
    expect(bpPanel).toBeTruthy();

    const bpCompCodes = (bpPanel.component ?? []).flatMap((c: any) => (c.code?.coding ?? []).map((k: any) => k.code));
    expect(new Set(bpCompCodes)).toEqual(new Set([__test__.CODES.SBP.code, __test__.CODES.DBP.code]));

    const bpMembers = (bpPanel.hasMember ?? []).map((m: any) => m.reference);
    expect(bpMembers).toContain(`urn:uuid:obs-${__test__.CODES.SBP.code}-${patientId}`);
    expect(bpMembers).toContain(`urn:uuid:obs-${__test__.CODES.DBP.code}-${patientId}`);
  });

  it('caso mínimo: sólo HR → se crea panel 85353-1 con un componente, hasMember sólo HR y sin secciones extra', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { hr: 70 } },
      { now, emitPanel: true, emitHasMember: true }
    );

    const comp = compositionOf(bundle);
    const sections = comp?.section ?? [];
    const titles = sections.map((s: any) => s.title).sort();
    expect(titles).toEqual(['Vitals']);

    const vsPanel = findObsByLoinc(bundle, __test__.CODES.PANEL_VS.code);
    expect(vsPanel).toBeTruthy();

    const compCodes = (vsPanel.component ?? []).flatMap((c: any) => (c.code?.coding ?? []).map((k: any) => k.code));
    expect(compCodes).toEqual([__test__.CODES.HR.code]);

    const members = (vsPanel.hasMember ?? []).map((m: any) => m.reference);
    expect(members).toEqual([`urn:uuid:obs-${__test__.CODES.HR.code}-${patientId}`]);
  });
});
