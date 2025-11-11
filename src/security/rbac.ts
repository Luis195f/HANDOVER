export type Role = 'nurse' | 'head_nurse' | 'viewer';

export const can = (role: Role, action: string): boolean =>
  role === 'head_nurse' || action !== 'admin:manage';
