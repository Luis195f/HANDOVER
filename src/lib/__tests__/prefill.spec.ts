import { describe, expect, it, vi } from 'vitest';

import { prefillFromFHIR } from '../prefill';

const BASE = 'http://fhir.test';

const response = (json: unknown) =>
  new Response(JSON.stringify(json), {
    status: 200,
    headers: { 'Content-Type': 'application/fhir+json' },
  });

describe('prefillFromFHIR diagnosis contract', () => {
  it('preserves the primary FHIR diagnosis display for canonical prefill', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ resourceType: 'Patient', id: 'pat-1' }))
      .mockResolvedValueOnce(
        response({
          resourceType: 'Bundle',
          entry: [
            {
              resource: {
                resourceType: 'Condition',
                code: {
                  coding: [
                    {
                      system: 'http://snomed.info/sct',
                      code: '61277005',
                      display: 'Asma',
                    },
                  ],
                },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(response({ resourceType: 'Bundle', entry: [] }))
      .mockResolvedValueOnce(response({ resourceType: 'Bundle', entry: [] }))
      .mockResolvedValueOnce(response({ resourceType: 'Bundle', entry: [] }));

    const result = await prefillFromFHIR('pat-1', {
      fhirBase: BASE,
      fetchImpl: fetchMock,
    });

    expect(result.dxText).toBe('Asma');
  });
});
