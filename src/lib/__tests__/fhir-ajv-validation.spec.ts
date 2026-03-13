import { describe, expect, it } from 'vitest';

import { validateBundleWithAjv, validateResourceWithAjv } from '../fhir-validation/index';

describe('FHIR AJV validation helpers', () => {
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

  it('validates a resource with AJV using the shared result shape', () => {
    const result = validateResourceWithAjv(observation, 'Observation');

    expect(result).toEqual({ isValid: true, errors: [] });
  });

  it('validates a bundle with AJV and surfaces structured errors', () => {
    const validBundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          fullUrl: 'urn:uuid:1',
          resource: observation,
          request: { method: 'POST', url: 'Observation' },
        },
      ],
    };

    expect(validateBundleWithAjv(validBundle)).toEqual({ isValid: true, errors: [] });

    const invalidBundle = {
      resourceType: 'Bundle',
      entry: [],
    };

    const invalidResult = validateBundleWithAjv(invalidBundle);
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'type' }),
      ]),
    );
  });
});
