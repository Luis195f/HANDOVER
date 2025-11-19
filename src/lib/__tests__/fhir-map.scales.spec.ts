import { describe, expect, it } from 'vitest';

import { buildHandoverBundle } from '../fhir-map';
import { TEST_SCALE_CODES } from './fhir-map.test-constants';

const NOW = '2025-03-05T08:00:00.000Z';

const findObservation = (
  entries: Array<{ resource: any; fullUrl: string }>,
  target: typeof TEST_SCALE_CODES[keyof typeof TEST_SCALE_CODES],
) =>
  entries.find(
    (entry) =>
      entry.resource?.resourceType === 'Observation' &&
      entry.resource.code?.coding?.some(
        (coding: any) => coding.code === target.code && coding.system === target.system,
      ),
  );

describe('clinical scales mapping', () => {
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

    expect(glasgowEntry?.resource.valueInteger).toBe(12);
    expect(glasgowEntry?.resource.component).toHaveLength(3);
    expect(glasgowEntry?.resource.note?.[0]?.text).toContain('moderado');
    expect(glasgowEntry?.resource.effectiveDateTime).toBe(NOW);

    const composition = entries.find((entry) => entry.resource?.resourceType === 'Composition')?.resource;
    const sectionByTitle = (title: string) => composition?.section?.find((s: any) => s.title === title);

    expect(sectionByTitle('Pain assessment')?.entry?.map((ref: any) => ref.reference)).toContain(
      evaEntry?.fullUrl,
    );
    expect(sectionByTitle('Braden scale')?.entry?.map((ref: any) => ref.reference)).toContain(
      bradenEntry?.fullUrl,
    );
    expect(sectionByTitle('Glasgow scale')?.entry?.map((ref: any) => ref.reference)).toContain(
      glasgowEntry?.fullUrl,
    );
  });
});
