import { describe, expect, it } from 'vitest';

import {
  buildHandoverBundle,
  type Bundle,
  type Composition,
  type Observation,
} from '../fhir-map';
import { validateBundle } from '../fhir-validation';
import type { PainAssessment } from '../../types/handover';
import { TEST_SCALE_CODES } from './fhir-map.test-constants';

const NOW = '2025-03-05T08:00:00.000Z';

type ObservationEntry = Bundle['entry'][number] & { resource: Observation };

const entryReference = (entry?: Bundle['entry'][number]) =>
  entry?.fullUrl ??
  (entry?.resource.resourceType && entry.resource.id
    ? `${entry.resource.resourceType}/${entry.resource.id}`
    : undefined);

const findObservation = (
  entries: Bundle['entry'],
  target: typeof TEST_SCALE_CODES[keyof typeof TEST_SCALE_CODES],
) =>
  entries.find(
    (entry): entry is ObservationEntry =>
      entry.resource.resourceType === 'Observation' &&
      entry.resource.code?.coding?.some(
        (coding) => coding.code === target.code && coding.system === target.system,
      ),
  );

const buildBundleWithPain = (painAssessment: PainAssessment) =>
  buildHandoverBundle(
    {
      patientId: 'patient-scale-pain',
      painAssessment,
    },
    { now: () => NOW },
  );

const painWithRuntimeScore = (hasPain: boolean, evaScore: unknown): PainAssessment => {
  const painAssessment: PainAssessment = { hasPain };
  Object.defineProperty(painAssessment, 'evaScore', {
    value: evaScore,
    enumerable: true,
  });
  return painAssessment;
};

describe('clinical scales mapping', () => {
  it.each([
    ['pain absent and EVA not measured', { hasPain: false, evaScore: null }],
    ['pain present and EVA not measured', { hasPain: true, evaScore: null }],
    ['EVA undefined', { hasPain: false, evaScore: undefined }],
  ] satisfies Array<[string, PainAssessment]>)('omits EVA Observation when %s', (_case, painAssessment) => {
    const bundle = buildBundleWithPain(painAssessment);

    expect(findObservation(bundle.entry, TEST_SCALE_CODES.EVA)).toBeUndefined();
  });

  it.each([
    ['an empty string', ''],
    ['a numeric string', '7'],
    ['NaN', Number.NaN],
    ['negative', -1],
    ['above ten', 11],
    ['infinite', Number.POSITIVE_INFINITY],
    ['decimal 0.5', 0.5],
    ['decimal 7.5', 7.5],
    ['decimal 9.9', 9.9],
  ])('omits EVA Observation for %s', (_case, evaScore) => {
    const bundle = buildBundleWithPain(painWithRuntimeScore(true, evaScore));
    const hasNonIntegerValue = bundle.entry.some(
      (entry) =>
        entry.resource.resourceType === 'Observation' &&
        entry.resource.valueInteger !== undefined &&
        !Number.isInteger(entry.resource.valueInteger),
    );

    expect(findObservation(bundle.entry, TEST_SCALE_CODES.EVA)).toBeUndefined();
    expect(hasNonIntegerValue).toBe(false);
  });

  it.each([0, 7, 10])('preserves valid EVA score %i', (evaScore) => {
    const bundle = buildBundleWithPain({ hasPain: true, evaScore });
    const evaEntry = findObservation(bundle.entry, TEST_SCALE_CODES.EVA);

    expect(evaEntry?.resource.valueInteger).toBe(evaScore);
  });

  it.each([
    ['pain was not measured', null],
    ['EVA is decimal', 7.5],
  ] satisfies Array<[string, number | null]>)('builds a valid Bundle without EVA when %s and preserves other scales', (_case, evaScore) => {
    const bundle = buildHandoverBundle(
      {
        patientId: 'patient-scale-no-eva',
        painAssessment: { hasPain: evaScore !== null, evaScore },
        braden: {
          sensoryPerception: 3,
          moisture: 3,
          activity: 2,
          mobility: 3,
          nutrition: 3,
          frictionShear: 2,
          totalScore: 16,
          riskLevel: 'bajo',
        },
        glasgow: {
          eye: 3,
          verbal: 4,
          motor: 5,
          total: 12,
          severity: 'moderado',
        },
      },
      { now: () => NOW },
    );

    const evaEntry = findObservation(bundle.entry, TEST_SCALE_CODES.EVA);
    const bradenEntry = findObservation(bundle.entry, TEST_SCALE_CODES.BRADEN);
    const glasgowEntry = findObservation(bundle.entry, TEST_SCALE_CODES.GLASGOW);
    const composition = bundle.entry
      .map((entry) => entry.resource)
      .find((resource): resource is Composition => resource.resourceType === 'Composition');
    const compositionReferences = composition?.section?.flatMap(
      (section) => section.entry?.map((entry) => entry.reference) ?? [],
    );

    expect(evaEntry).toBeUndefined();
    expect(bradenEntry?.resource.valueInteger).toBe(16);
    expect(glasgowEntry?.resource.valueQuantity?.value).toBe(12);
    expect(compositionReferences).toContain(entryReference(bradenEntry));
    expect(compositionReferences).toContain(entryReference(glasgowEntry));
    expect(validateBundle(bundle)).toEqual({ isValid: true, errors: [] });
  });

  it('maps EVA, Braden and Glasgow scales to Observations and Composition sections', () => {
    const bundle = buildHandoverBundle(
      {
        patientId: 'patient-scale-001',
        painAssessment: {
          hasPain: true,
          evaScore: 7,
          location: 'Abdomen',
          actionsTaken: 'Analgesia IV',
        },
        braden: {
          sensoryPerception: 3,
          moisture: 3,
          activity: 2,
          mobility: 3,
          nutrition: 3,
          frictionShear: 2,
          totalScore: 16,
          riskLevel: 'bajo',
        },
        glasgow: {
          eye: 3,
          verbal: 4,
          motor: 5,
          total: 12,
          severity: 'moderado',
        },
      },
      { now: () => NOW },
    );

    const entries = bundle.entry as Array<{ resource: any; fullUrl: string }>;
    const evaEntry = findObservation(entries, TEST_SCALE_CODES.EVA);
    const bradenEntry = findObservation(entries, TEST_SCALE_CODES.BRADEN);
    const glasgowEntry = findObservation(entries, TEST_SCALE_CODES.GLASGOW);

    expect(evaEntry?.resource.valueInteger).toBe(7);
    expect(
      evaEntry?.resource.component?.find((c: any) => c.code?.coding?.[0]?.code === 'pain-location')
        ?.valueString,
    ).toBe('Abdomen');
    expect(
      evaEntry?.resource.component?.find((c: any) => c.code?.coding?.[0]?.code === 'pain-actions')
        ?.valueString,
    ).toBe('Analgesia IV');
    expect(evaEntry?.resource.note?.[0]?.text).toContain('Dolor reportado: Sí');
    expect(evaEntry?.resource.effectiveDateTime).toBe(NOW);

    expect(bradenEntry?.resource.valueInteger).toBe(16);
    expect(bradenEntry?.resource.component).toHaveLength(6);
    expect(bradenEntry?.resource.note?.[0]?.text).toContain('bajo');

    expect(glasgowEntry?.resource.valueQuantity?.value).toBe(12);
    expect(glasgowEntry?.resource.component).toHaveLength(3);
    expect(glasgowEntry?.resource.note?.[0]?.text).toContain('moderado');
    expect(glasgowEntry?.resource.effectiveDateTime).toBe(NOW);

    const composition = entries.find((entry) => entry.resource?.resourceType === 'Composition')?.resource;
    const sectionByTitle = (title: string) => composition?.section?.find((s: any) => s.title === title);

    expect(sectionByTitle('Pain assessment')?.entry?.map((ref: any) => ref.reference)).toContain(
      entryReference(evaEntry as { resource: any }),
    );
    expect(sectionByTitle('Braden scale')?.entry?.map((ref: any) => ref.reference)).toContain(
      entryReference(bradenEntry as { resource: any }),
    );
    expect(sectionByTitle('Glasgow scale')?.entry?.map((ref: any) => ref.reference)).toContain(
      entryReference(glasgowEntry as { resource: any }),
    );
  });
});
