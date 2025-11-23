import { describe, expect, it } from 'vitest';

import { zMedicationItem } from '../schemas';

describe('zMedicationItem', () => {
  it('produce error si falta el nombre', () => {
    const result = zMedicationItem.safeParse({ id: 'med-1' });
    expect(result.success).toBe(false);
  });

  it('acepta un registro mínimo con id y nombre', () => {
    const result = zMedicationItem.safeParse({ id: 'med-2', name: 'Heparina' });
    expect(result.success).toBe(true);
  });

  it('permite horarios cuando es infusión continua', () => {
    const result = zMedicationItem.safeParse({
      id: 'med-3',
      name: 'Dobutamina',
      isContinuous: true,
      startTime: '08:00',
      endTime: '12:00',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isContinuousInfusion).toBe(true);
      expect(result.data.isContinuous).toBe(true);
    }
  });
});
