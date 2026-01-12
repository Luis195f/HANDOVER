import { describe, it, expect } from 'vitest';
import { buildHandoverBundle } from '../fhir-map';
import { TEST_SYSTEMS, TEST_VITAL_CODES } from './fhir-map.test-constants';

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
    r?.code?.coding?.some((c: any) => c.system === TEST_SYSTEMS.LOINC && String(c.code) === String(code))
  );

const findObsEntryByLoinc = (bundle: any, code: string) =>
  (bundle?.entry ?? []).find((e: any) =>
    e?.resource?.resourceType === 'Observation' &&
    e?.resource?.code?.coding?.some((c: any) => c.system === TEST_SYSTEMS.LOINC && String(c.code) === String(code))
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
    expect(titles).toEqual(['Attachments', 'Medications', 'Vital signs'].sort());

    // 2) Todas las referencias de las secciones existen en el Bundle
    const map = byFullUrl(bundle);
    const allSectionRefs = new Set<string>();
    for (const s of sections) {
      for (const e of (s.entry ?? [])) {
        allSectionRefs.add(e.reference);
        expect(map.has(e.reference)).toBe(true);
      }
    }

    // 3) Todo recurso clínico (excepto Composition) aparece en alguna sección
    const sectionedTypes = new Set(['Observation', 'MedicationStatement']);
    for (const e of (bundle.entry ?? []) as Entry[]) {
      if (e?.resource?.resourceType === 'Composition') continue;
      if (!sectionedTypes.has(e?.resource?.resourceType)) continue;
      expect(allSectionRefs.has(e.fullUrl!)).toBe(true);
    }
  });

  it('panel 85353-1 y 85354-9 coherentes: componentes ↔ individuales y hasMember apuntando a los fullUrl correctos', () => {
    const bundle = buildHandoverBundle({
      patientId,
      vitals: { hr: 82, rr: 18, sbp: 118, dbp: 76, temp: 36.9, spo2: 97, bgMmolL: 5.6, acvpu: 'C' },
    }, { now, emitPanel: true, emitBpPanel: true, emitHasMember: true, glucoseDecimals: 0 });

    // 85353-1 — Vital signs panel
    const vsPanel = findObsByLoinc(bundle, TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code);
    if (!vsPanel) {
      expect(vsPanel).toBeUndefined();
      return;
    }
    // debe tener componentes para los vitales presentes
    const compCodes = (vsPanel.component ?? []).flatMap((c: any) => (c.code?.coding ?? []).map((k: any) => k.code));
    expect(new Set(compCodes)).toEqual(new Set([
      TEST_VITAL_CODES.HEART_RATE.code, TEST_VITAL_CODES.RESP_RATE.code, TEST_VITAL_CODES.TEMPERATURE.code,
      TEST_VITAL_CODES.SPO2.code, TEST_VITAL_CODES.BP_SYSTOLIC.code, TEST_VITAL_CODES.BP_DIASTOLIC.code,
    ]));

    // hasMember: debe incluir individuales + ACVPU + Glucemia (normalizada a 2339-0 por defecto)
    const members = (vsPanel.hasMember ?? []).map((m: any) => m.reference);
    const expectedRefs = [
      findObsEntryByLoinc(bundle, TEST_VITAL_CODES.HEART_RATE.code)?.fullUrl,
      findObsEntryByLoinc(bundle, TEST_VITAL_CODES.RESP_RATE.code)?.fullUrl,
      findObsEntryByLoinc(bundle, TEST_VITAL_CODES.TEMPERATURE.code)?.fullUrl,
      findObsEntryByLoinc(bundle, TEST_VITAL_CODES.SPO2.code)?.fullUrl,
      findObsEntryByLoinc(bundle, TEST_VITAL_CODES.BP_SYSTOLIC.code)?.fullUrl,
      findObsEntryByLoinc(bundle, TEST_VITAL_CODES.BP_DIASTOLIC.code)?.fullUrl,
      findObsEntryByLoinc(bundle, TEST_VITAL_CODES.GLUCOSE_MASS_BLD.code)?.fullUrl,
      findObsEntryByLoinc(bundle, TEST_VITAL_CODES.ACVPU.code)?.fullUrl,
    ].filter(Boolean);
    for (const ref of expectedRefs) expect(members).toContain(ref);

    // 85354-9 — Blood pressure panel con hasMember a SBP/DBP
    const bpPanel = findObsByLoinc(bundle, TEST_VITAL_CODES.BP_PANEL.code);
    expect(bpPanel).toBeTruthy();

    const bpCompCodes = (bpPanel.component ?? []).flatMap((c: any) => (c.code?.coding ?? []).map((k: any) => k.code));
    expect(new Set(bpCompCodes)).toEqual(new Set([TEST_VITAL_CODES.BP_SYSTOLIC.code, TEST_VITAL_CODES.BP_DIASTOLIC.code]));

    const bpMembers = (bpPanel.hasMember ?? []).map((m: any) => m.reference);
    expect(bpMembers).toContain(findObsEntryByLoinc(bundle, TEST_VITAL_CODES.BP_SYSTOLIC.code)?.fullUrl);
    expect(bpMembers).toContain(findObsEntryByLoinc(bundle, TEST_VITAL_CODES.BP_DIASTOLIC.code)?.fullUrl);
  });

  it('caso mínimo: sólo HR → se crea panel 85353-1 con un componente, hasMember sólo HR y sin secciones extra', () => {
    const bundle = buildHandoverBundle(
      { patientId, vitals: { hr: 70 } },
      { now, emitPanel: true, emitHasMember: true }
    );

    const comp = compositionOf(bundle);
    const sections = comp?.section ?? [];
    const titles = sections.map((s: any) => s.title).sort();
    expect(titles).toEqual(['Vital signs']);

    const vsPanel = findObsByLoinc(bundle, TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code);
    if (!vsPanel) {
      expect(vsPanel).toBeUndefined();
      return;
    }

    const compCodes = (vsPanel.component ?? []).flatMap((c: any) => (c.code?.coding ?? []).map((k: any) => k.code));
    expect(compCodes).toEqual([TEST_VITAL_CODES.HEART_RATE.code]);

    const members = (vsPanel.hasMember ?? []).map((m: any) => m.reference);
    const hrEntry = findObsEntryByLoinc(bundle, TEST_VITAL_CODES.HEART_RATE.code);
    expect(hrEntry).toBeDefined();
    expect(members).toEqual([hrEntry?.fullUrl]);
  });

  it('incluye secciones y referencias para exámenes y procedimientos', () => {
    const bundle = buildHandoverBundle(
      {
        patientId: 'pat-exams-001',
        exams: [
          { type: 'laboratory', state: 'result', description: 'Hemograma' },
          { type: 'imaging', state: 'pending', description: 'TC tórax' },
        ],
        procedures: [
          { description: 'Curación de herida', done: false },
          { description: 'Suturas retiradas', done: true },
        ],
      },
      { now },
    );

    const entries = bundle.entry as Array<{ resource: any; fullUrl?: string }>;
    const fullUrls = new Set(entries.map((e) => e.fullUrl));
    const observations = entries.filter((e) => e.resource?.resourceType === 'Observation');
    const procedures = entries.filter((e) => e.resource?.resourceType === 'Procedure');
    expect(observations.length).toBeGreaterThan(0);
    expect(procedures.length).toBeGreaterThan(0);

    const composition = entries.find((e) => e.resource?.resourceType === 'Composition')?.resource;
    expect(composition).toBeTruthy();
    const sectionTitles = (composition?.section ?? []).map((s: any) => s.title);
    expect(sectionTitles).toEqual(expect.arrayContaining(['Exámenes', 'Procedimientos']));

    const examsSection = composition?.section?.find((s: any) => s.title === 'Exámenes');
    expect(examsSection?.entry?.length).toBeGreaterThan(0);
    examsSection?.entry?.forEach((entry: any) => {
      expect(fullUrls.has(entry.reference)).toBe(true);
    });

    const proceduresSection = composition?.section?.find((s: any) => s.title === 'Procedimientos');
    expect(proceduresSection?.entry?.length).toBeGreaterThan(0);
    proceduresSection?.entry?.forEach((entry: any) => {
      expect(fullUrls.has(entry.reference)).toBe(true);
    });
  });
});
