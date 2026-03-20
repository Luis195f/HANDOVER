import { describe, expect, it } from 'vitest';

import { normalizePatientListResponse } from '@/src/lib/patientListData';

describe('normalizePatientListResponse', () => {
  it('preserves numeric backend ids as string identifiers', () => {
    expect(
      normalizePatientListResponse([
        {
          id: 42,
          first_name: 'Ana',
          last_name: 'García',
          unit: 'icu-a',
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: '42',
        name: 'Ana García',
        unitId: 'icu-a',
      }),
    ]);
  });
});
