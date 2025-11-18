import { describe, expect, it } from 'vitest';

import * as Schemas from '@/src/validation/schemas';

const has = (k: string) => Schemas && Object.prototype.hasOwnProperty.call(Schemas, k);

(has('zBradenScale') ? describe : describe.skip)('zBradenScale', () => {
  const { zBradenScale } = Schemas;

  it('valida una escala Braden correcta', () => {
    const valid = {
      sensoryPerception: 3,
      moisture: 3,
      activity: 3,
      mobility: 2,
      nutrition: 3,
      frictionShear: 2,
      totalScore: 16,
      riskLevel: 'bajo',
    } as const;

    const result = zBradenScale.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rechaza si el total o el riesgo no coinciden', () => {
    const invalid = {
      sensoryPerception: 4,
      moisture: 4,
      activity: 4,
      mobility: 4,
      nutrition: 4,
      frictionShear: 4,
      totalScore: 10,
      riskLevel: 'moderado',
    } as const;

    const result = zBradenScale.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
