import { describe, expect, it } from 'vitest';

import { validateResource, type FhirValidationResult } from './index';

describe('AJV FHIR validation', () => {
  const observation = {
    resourceType: 'Observation',
    status: 'final',
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '1234-5',
          display: 'Test code',
        },
      ],
    },
    subject: { reference: 'Patient/123' },
    effectiveDateTime: '2023-09-01T00:00:00Z',
    valueQuantity: { value: 98, unit: 'bpm' },
  } as const;

  const bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      {
        fullUrl: 'urn:uuid:1',
        resource: observation,
        request: { method: 'POST', url: 'Observation' },
      },
    ],
  } satisfies Record<string, unknown>;

  it('returns ok=true for a valid Bundle', () => {
    const result: FhirValidationResult = validateResource(bundle, 'Bundle');

    expect(result).toEqual({ ok: true });
  });

  it('flags missing required fields inside the Bundle', () => {
    const invalidBundle = {
      ...bundle,
      entry: [
        {
          ...bundle.entry[0],
          resource: {
            resourceType: 'Observation',
            status: 'final',
            code: {},
            subject: { reference: 'Patient/123' },
          },
        },
      ],
    };

    const result = validateResource(invalidBundle, 'Bundle');

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('/entry/0/resource/code')]),
    );
  });
});
