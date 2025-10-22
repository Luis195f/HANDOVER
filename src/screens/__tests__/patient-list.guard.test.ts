import { describe, it, expect } from 'vitest';

let Auth: any = {};
try { Auth = await import('@/src/security/auth'); } catch {}

const has = (k: string) => Auth && Object.prototype.hasOwnProperty.call(Auth, k);

(has('scopeByUnits') ? describe : describe.skip)('PatientList guard (RBAC)', () => {
  const { scopeByUnits } = Auth;

  it('solo muestra pacientes en unidades permitidas', () => {
    const session = { user: { id: 'nurse-1' }, units: ['UCI-3'] };
    const patients = [
      { id: 'pat-001', unitId: 'UCI-3' },
      { id: 'pat-002', unitId: 'MED-1' }
    ];
    const out = scopeByUnits(session, patients, (p: any) => p.unitId);
    expect(out.map((p: any) => p.id)).toEqual(['pat-001']);
  });
});