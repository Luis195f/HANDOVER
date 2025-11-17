import { zHandover } from '@/src/validation/schemas';

describe('HandoverFormSchema', () => {
  const baseValues = {
    administrativeData: {
      unit: 'icu-1',
      census: 12,
      staffIn: ['Alice'],
      staffOut: ['Bob'],
      shiftStart: '2024-01-01T07:00:00Z',
      shiftEnd: '2024-01-01T15:00:00Z',
    },
    patientId: 'patient-1',
    vitals: { rr: 18, hr: 80, spo2: 98 },
  } as const;

  test('accepts valid payload', () => {
    const result = zHandover.safeParse(baseValues);
    expect(result.success).toBe(true);
  });

  test('fails when administrative unit is missing', () => {
    const result = zHandover.safeParse({
      ...baseValues,
      administrativeData: { ...baseValues.administrativeData, unit: '' },
    });
    expect(result.success).toBe(false);
  });

  test('fails when census is negative', () => {
    const result = zHandover.safeParse({
      ...baseValues,
      administrativeData: { ...baseValues.administrativeData, census: -1 },
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid ACVPU values', () => {
    const invalid = { ...baseValues, vitals: { ...baseValues.vitals, avpu: 'X' } };
    const result = zHandover.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects NEWS2 respiratory rate below range', () => {
    const invalid = { ...baseValues, vitals: { ...baseValues.vitals, rr: 0 } };
    const result = zHandover.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
