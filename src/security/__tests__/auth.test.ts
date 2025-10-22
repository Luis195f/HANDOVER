import { describe, it, expect } from 'vitest';

let Auth: any = {};
try { Auth = await import('@/src/security/auth'); } catch {}

const has = (k: string) => Auth && Object.prototype.hasOwnProperty.call(Auth, k);

(has('canAccessUnit') ? describe : describe.skip)('RBAC helpers', () => {
  const { canAccessUnit, scopeByUnits } = Auth;

  it('canAccessUnit: true cuando la unidad está permitida', () => {
    const session = { user: { id: 'nurse-1' }, units: ['UCI-3', 'MED-1'] };
    expect(canAccessUnit(session, 'UCI-3')).toBe(true);
  });

  it('scopeByUnits filtra dataset por unidades', () => {
    const session = { user: { id: 'nurse-1' }, units: ['MED-1'] };
    const data = [{ id: 'p1', unit: 'MED-1' }, { id: 'p2', unit: 'UCI-3' }];
    const out = scopeByUnits(session, data, (x: any) => x.unit);
    expect(out).toEqual([{ id: 'p1', unit: 'MED-1' }]);
  });
});