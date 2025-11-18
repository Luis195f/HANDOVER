import { describe, expect, it } from 'vitest';

import { zPainAssessment } from '../schemas';

describe('zPainAssessment', () => {
  it('valida cuando hay dolor y EVA dentro de rango', () => {
    const result = zPainAssessment.safeParse({
      hasPain: true,
      evaScore: 7,
      location: 'abdomen',
      actionsTaken: 'Paracetamol 1g IV',
    });

    expect(result.success).toBe(true);
  });

  it('requiere EVA cuando hasPain es verdadero', () => {
    const result = zPainAssessment.safeParse({
      hasPain: true,
      evaScore: null,
    });

    expect(result.success).toBe(false);
  });
});
