import { describe, expect, it } from 'vitest';

import { buildHandoverBundle } from '@/src/lib/fhir-map';

const entryReference = (entry: { fullUrl?: string; resource: { resourceType: string; id?: string } }) =>
  entry.fullUrl ?? `${entry.resource.resourceType}/${entry.resource.id ?? ''}`;

describe('FHIR Composition', () => {
  it('includes required sections with resolvable references', () => {
    const bundle = buildHandoverBundle(
      {
        patientId: 'pat-comp-1',
        encounterId: 'enc-comp-1',
        author: { id: 'nurse-7', display: 'Nurse Seven' },
        bedsideChecklist: {
          patientIdentityConfirmed: true,
          allergiesReviewed: true,
          bedsideNotes: 'Checklist completed.',
        },
        administrativeData: {
          unit: 'UCI',
          census: 12,
          staffIn: ['Nurse A'],
          staffOut: ['Nurse B'],
          shiftStart: '2025-10-20T08:00:00Z',
          shiftEnd: '2025-10-20T16:00:00Z',
          shiftType: 'Mañana',
          incidents: ['Sin incidentes'],
        },
        vitals: { hr: 88, rr: 18 },
        nutrition: { dietType: 'oral', intakeMl: 250 },
        treatments: [{ id: 'treat-1', type: 'mobilization', description: 'Mobilization', done: false }],
        sbar: {
          situation: 'Stable',
          background: 'Post-op',
          assessment: 'Pain controlled',
          recommendation: 'Continue monitoring',
        },
        closingSummary: 'Summary text',
      },
      { now: () => '2025-10-20T16:05:00Z' },
    );

    const compositionEntry = bundle.entry.find(
      (entry) => entry.resource.resourceType === 'Composition',
    );
    expect(compositionEntry).toBeDefined();

    const composition = compositionEntry!.resource as any;
    const sectionTitles = (composition.section ?? []).map((section: any) => section.title);
    const requiredTitles = [
      'Administrative',
      'Vital signs',
      'Care / Treatments',
      'SBAR',
      'Bedside checklist',
      'Notes / Summary',
    ];
    requiredTitles.forEach((title) => expect(sectionTitles).toContain(title));

    const entryReferenceSet = new Set(bundle.entry.map((entry) => entryReference(entry)));
    (composition.section ?? []).forEach((section: any) => {
      expect(section.code).toBeDefined();
      (section.entry ?? []).forEach((entry: any) => {
        expect(entry.reference).toMatch(/^urn:uuid:[0-9a-f]{32}$/);
        expect(entryReferenceSet.has(entry.reference)).toBe(true);
      });
    });
  });
});
