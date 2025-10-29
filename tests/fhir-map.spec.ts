import { describe, expect, it } from 'vitest';
import { z } from 'zod';

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

const isoUtcString = () =>
  z.string().refine((value) => value.endsWith('Z'), {
    message: 'timestamp must be normalized to UTC (ending with Z)',
  });

const referenceSchema = z.object({
  reference: z.string().min(1),
  type: z.string().optional(),
  display: z.string().optional(),
});

const quantitySchema = z.object({
  value: z.number(),
  system: z.string().optional(),
  unit: z.string().optional(),
  code: z.string().optional(),
});

const observationSchema = z.object({
  resourceType: z.literal('Observation'),
  status: z.literal('final'),
  meta: z.object({ profile: z.array(z.string()).min(1) }),
  category: z
    .array(
      z.object({
        coding: z.array(z.object({ system: z.string(), code: z.string() })).min(1),
      }),
    )
    .min(1),
  code: z.object({ coding: z.array(z.object({ system: z.string(), code: z.string() })).min(1) }),
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  effectiveDateTime: isoUtcString(),
  issued: isoUtcString(),
  valueQuantity: quantitySchema.optional(),
  component: z
    .array(
      z.object({
        code: z.object({ coding: z.array(z.object({ system: z.string(), code: z.string() })).min(1) }),
        valueQuantity: quantitySchema.optional(),
      }),
    )
    .optional(),
});

const medicationStatementSchema = z.object({
  resourceType: z.literal('MedicationStatement'),
  status: z.enum(['active', 'completed', 'intended']),
  medicationCodeableConcept: z.object({
    coding: z.array(z.object({ system: z.string().optional(), code: z.string().optional(), display: z.string().optional() })),
    text: z.string().optional(),
  }),
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  effectivePeriod: z
    .object({
      start: isoUtcString(),
      end: isoUtcString().optional(),
    })
    .optional(),
  dateAsserted: isoUtcString(),
  note: z.array(z.object({ text: z.string() })).optional(),
});

const procedureSchema = z.object({
  resourceType: z.literal('Procedure'),
  status: z.enum(['in-progress', 'completed']),
  code: z.object({ coding: z.array(z.object({ system: z.string(), code: z.string() })).min(1) }),
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  performedDateTime: isoUtcString().optional(),
  performedPeriod: z
    .object({
      start: isoUtcString(),
      end: isoUtcString().optional(),
    })
    .optional(),
});

const deviceUseStatementSchema = z.object({
  resourceType: z.literal('DeviceUseStatement'),
  status: z.enum(['active', 'completed']),
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  device: referenceSchema,
  timingPeriod: z
    .object({
      start: isoUtcString(),
      end: isoUtcString().optional(),
    })
    .optional(),
});

const documentReferenceSchema = z.object({
  resourceType: z.literal('DocumentReference'),
  status: z.literal('current'),
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  author: z.array(referenceSchema).min(1),
  date: isoUtcString(),
  content: z
    .array(
      z.object({
        attachment: z.object({
          contentType: z.string().min(1),
          url: z.string().optional(),
          data: z.string().optional(),
          size: z.number().int().positive().optional(),
          hash: z.string().optional(),
          title: z.string().optional(),
        }),
      }),
    )
    .min(1),
});

const compositionSchema = z.object({
  resourceType: z.literal('Composition'),
  status: z.enum(['final', 'amended']),
  type: z.object({ coding: z.array(z.object({ system: z.string(), code: z.string() })).min(1) }),
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  date: isoUtcString(),
  author: z.array(referenceSchema).min(1),
  title: z.string().min(1),
  section: z
    .array(
      z.object({
        title: z.string().optional(),
        entry: z.array(referenceSchema).optional(),
      }),
    )
    .optional(),
});

const resourceValidators = {
  Observation: observationSchema,
  MedicationStatement: medicationStatementSchema,
  Procedure: procedureSchema,
  DeviceUseStatement: deviceUseStatementSchema,
  DocumentReference: documentReferenceSchema,
  Composition: compositionSchema,
} as const;

function collectReferenceStrings(resource: unknown): string[] {
  const refs: string[] = [];
  const stack = [resource];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    if (current && typeof current === 'object') {
      if ('reference' in current && typeof (current as any).reference === 'string') {
        refs.push((current as any).reference);
      }
      for (const value of Object.values(current)) {
        stack.push(value);
      }
    }
  }
  return refs;
}

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

  it('validates every generated resource against simplified FHIR schemas', () => {
    const bundle = buildHandoverBundle(baseValues, { now: () => NOW });

    const typeCounts = new Map<string, number>();
    bundle.entry.forEach((entry) => {
      typeCounts.set(entry.resource.resourceType, (typeCounts.get(entry.resource.resourceType) ?? 0) + 1);
      const validator = resourceValidators[
        entry.resource.resourceType as keyof typeof resourceValidators
      ];
      expect(validator, `missing validator for ${entry.resource.resourceType}`).toBeDefined();
      validator.parse(entry.resource as never);
      expect(entry.fullUrl).toMatch(/^urn:uuid:[0-9a-f]{32}$/);
      expect(entry.request).toEqual({ method: 'POST', url: entry.resource.resourceType });
    });

    expect(typeCounts.get('Observation')).toBeGreaterThanOrEqual(1);
    expect(typeCounts.get('MedicationStatement')).toBeGreaterThanOrEqual(1);
    expect(typeCounts.get('Procedure')).toBeGreaterThanOrEqual(1);
    expect(typeCounts.get('DeviceUseStatement')).toBeGreaterThanOrEqual(1);
    expect(typeCounts.get('DocumentReference')).toBe(1);
    expect(typeCounts.get('Composition')).toBe(1);
  });

  it('resolves all internal references to bundle entries', () => {
    const bundle = buildHandoverBundle(baseValues, { now: () => NOW });
    const fullUrlSet = new Set(bundle.entry.map((entry) => entry.fullUrl));

    bundle.entry.forEach((entry) => {
      const references = collectReferenceStrings(entry.resource);
      references
        .filter((reference) => reference.startsWith('urn:uuid:'))
        .forEach((reference) => {
          expect(fullUrlSet.has(reference)).toBe(true);
        });
    });
  });

  it('produces deterministic fullUrls for repeated builds', () => {
    const first = buildHandoverBundle(baseValues, { now: () => NOW });
    const second = buildHandoverBundle(baseValues, { now: () => NOW });

    const firstUrls = first.entry.map((entry) => entry.fullUrl);
    const secondUrls = second.entry.map((entry) => entry.fullUrl);
    expect(secondUrls).toEqual(firstUrls);

    const combinedUrls = [...first.entry, ...second.entry].map((entry) => entry.fullUrl);
    expect(new Set(combinedUrls).size).toBe(first.entry.length);
  });
});
