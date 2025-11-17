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
