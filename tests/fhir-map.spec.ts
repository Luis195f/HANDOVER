import { describe, expect, it } from 'vitest';

import {
  buildHandoverBundle,
  mapObservationVitals,
  type HandoverValues,
} from '@/src/lib/fhir-map';

const NOW = '2025-01-05T10:30:00.000Z';

const baseValues: HandoverValues = {
  patientId: 'patient-001',
  encounterId: 'enc-777',
  author: { id: 'nurse-33', display: 'Nurse Test' },
  vitals: {
    recordedAt: '2025-01-05T09:45:00+00:00',
    issuedAt: '2025-01-05T09:50:00+00:00',
    hr: 78,
    rr: 16,
    tempC: 37.2,
    spo2: 96,
    sbp: 118,
    dbp: 75,
    glucoseMgDl: 110,
  },
  medications: [
    {
      status: 'active',
      code: {
        system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
        code: '161',
        display: 'Paracetamol 500mg tablet',
      },
      start: '2025-01-05T08:00:00+00:00',
      note: 'Given after breakfast',
    },
  ],
  oxygenTherapy: {
    status: 'in-progress',
    start: '2025-01-05T09:00:00+00:00',
    deviceDisplay: 'Nasal cannula',
  },
  audioAttachment: {
    url: 'https://example.org/audio/handover.m4a',
    contentType: 'audio/m4a',
    title: 'Shift wrap-up',
  },
  composition: {
    status: 'final',
    title: 'SBAR summary',
  },
};

describe('mapObservationVitals', () => {
  it('creates individual observations with correct codings and UTC timestamps', () => {
    const observations = mapObservationVitals(
      {
        patientId: baseValues.patientId,
        encounterId: baseValues.encounterId,
        ...baseValues.vitals!,
      },
      { now: () => NOW },
    );

    expect(observations).toHaveLength(6);
    const effectiveDates = new Set(observations.map((obs) => obs.effectiveDateTime));
    expect(effectiveDates).toEqual(new Set(['2025-01-05T09:45:00.000Z']));
    observations.forEach((obs) => {
      expect(obs.category[0]?.coding[0]?.code).toBe('vital-signs');
      expect(obs.issued).toBe('2025-01-05T09:50:00.000Z');
      expect(obs.subject.reference).toBe(`Patient/${baseValues.patientId}`);
      expect(obs.meta?.profile?.length).toBeGreaterThan(0);
    });
  });

  it('rejects out of range values', () => {
    expect(() =>
      mapObservationVitals(
        {
          patientId: 'patient-xyz',
          tempC: 55,
        },
        { now: () => NOW },
      ),
    ).toThrow();
  });
});

describe('buildHandoverBundle', () => {
  it('builds a transaction bundle with stable IDs and complete references', () => {
    const bundle = buildHandoverBundle(baseValues, { now: () => NOW });

    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('transaction');
    expect(bundle.entry.length).toBeGreaterThanOrEqual(5);

    const fullUrls = bundle.entry.map((entry) => entry.fullUrl);
    expect(new Set(fullUrls).size).toBe(fullUrls.length);

    const compositionEntry = bundle.entry.find(
      (entry) => entry.resource.resourceType === 'Composition',
    );
    expect(compositionEntry).toBeDefined();
    const composition = compositionEntry!.resource as any;
    expect(composition.date).toBe(NOW);
    expect(composition.status).toBe('final');
    const sectionRefs = (composition.section ?? []).flatMap((section: any) =>
      section.entry?.map((ref: any) => ref.reference) ?? [],
    );
    sectionRefs.forEach((ref: string) => expect(fullUrls).toContain(ref));

    const documentEntry = bundle.entry.find(
      (entry) => entry.resource.resourceType === 'DocumentReference',
    );
    expect(documentEntry).toBeDefined();
    const attachment = (documentEntry!.resource as any).content[0].attachment;
    expect(attachment.url).toBe('https://example.org/audio/handover.m4a');
    expect(attachment.contentType).toBe('audio/m4a');

    bundle.entry.forEach((entry) => {
      expect(entry.request).toEqual({ method: 'POST', url: entry.resource.resourceType });
    });
  });

  it('produces deterministic fullUrls for repeated builds', () => {
    const first = buildHandoverBundle(baseValues, { now: () => NOW });
    const second = buildHandoverBundle(baseValues, { now: () => NOW });

    const firstUrls = first.entry.map((entry) => entry.fullUrl);
    const secondUrls = second.entry.map((entry) => entry.fullUrl);
    expect(secondUrls).toEqual(firstUrls);
  });
});
