import { describe, expect, it } from 'vitest';

import { buildHandoverBundle } from '@/src/lib/fhir-map';

describe('FHIR transaction bundle', () => {
  it('builds Bundle.transaction entries with POST requests and ordered core resources', () => {
    const bundle = buildHandoverBundle(
      {
        patientId: 'pat-transaction-1',
        encounterId: 'enc-transaction-1',
        author: { id: 'nurse-1', display: 'Nurse One' },
        bedsideChecklist: { patientIdentityConfirmed: true },
        vitals: { hr: 75 },
      },
      { now: () => '2025-10-20T10:00:00Z' },
    );

    expect(bundle.type).toBe('transaction');
    expect(bundle.entry.length).toBeGreaterThan(3);

    const [patientEntry, practitionerEntry, encounterEntry, compositionEntry] = bundle.entry;
    expect(patientEntry.resource.resourceType).toBe('Patient');
    expect(practitionerEntry.resource.resourceType).toBe('Practitioner');
    expect(encounterEntry.resource.resourceType).toBe('Encounter');
    expect(compositionEntry.resource.resourceType).toBe('Composition');

    bundle.entry.forEach((entry) => {
      expect(entry.request.method).toBe('POST');
      expect(entry.request.url).toBe(entry.resource.resourceType);
    });
  });
});
