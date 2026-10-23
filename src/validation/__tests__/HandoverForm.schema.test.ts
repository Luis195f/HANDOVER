import { describe, expect, it } from 'vitest';

import values from '../../../tests/fixtures/handover-values.json';
import { zVitals } from '../schemas';

describe('zVitals with the legacy handover fixture', () => {
  it('valida las constantes presentes en el fixture', () => {
    expect(zVitals.safeParse(values.vitals).success).toBe(true);
  });

  it('rechaza AVPU inválido', () => {
    const bad = { ...values.vitals, avpu: 'X' };
    expect(zVitals.safeParse(bad).success).toBe(false);
  });

  it('rechaza una frecuencia respiratoria fuera del rango admitido', () => {
    const bad = { ...values.vitals, rr: 0 };
    expect(zVitals.safeParse(bad).success).toBe(false);
  });
});
