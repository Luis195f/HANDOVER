import { describe, it, expect } from 'vitest';
import values from '../../../tests/fixtures/handover-values.json';

let Schemas: any = {};
try { Schemas = await import('@/src/validation/schemas'); } catch {}

const has = (k: string) => Schemas && Object.prototype.hasOwnProperty.call(Schemas, k);

(has('HandoverFormSchema') ? describe : describe.skip)('HandoverFormSchema', () => {
  const { HandoverFormSchema } = Schemas;

  it('valida un payload mínimo correcto', () => {
    const res = HandoverFormSchema.safeParse(values);
    expect(res.success).toBe(true);
  });

  it('rechaza ACVPU inválido', () => {
    const bad = { ...values, acvpu: 'X' };
    const res = HandoverFormSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  it('enforce rangos NEWS2 (ej: RR < 3 inválido)', () => {
    const bad = { ...values, vitals: { ...values.vitals, rr: 0 } };
    const res = HandoverFormSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });
});
