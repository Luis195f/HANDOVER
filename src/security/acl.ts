// src/security/acl.ts
export type Role = 'nurse' | 'supervisor' | 'admin';
export type AuthUser = { id: string; role: Role; allowedUnits?: string[] };

/**
 * Mientras no tengamos login real, deja esto en true para no ver el modal.
 * En prod: ponlo en false y usa allowedUnits reales del usuario autenticado.
 */
const DEV_ALLOW_ALL = true;

export const currentUser = (): AuthUser => ({
  id: 'nurse-dev',
  role: 'supervisor',
  allowedUnits: ['icu-a', 'onc-ward', 'ed', 'cardio-icu', 'onc-day', 'neuro-icu'],
});

export function hasUnitAccess(unitId?: string, user?: AuthUser): boolean {
  if (!unitId) return true;
  if (DEV_ALLOW_ALL) return true;
  const u = user ?? currentUser();
  if (u.role === 'admin' || u.role === 'supervisor') return true;
  return !!u.allowedUnits?.includes(unitId);
}
