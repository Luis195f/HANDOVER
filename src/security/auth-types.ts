// BEGIN HANDOVER_AUTH
export type UserRole = 'nurse' | 'supervisor' | 'admin' | 'viewer';
export type SessionMode = 'normal' | 'demo';

export interface HandoverUser {
  id?: string;
  userId?: string;
  name?: string;
  fullName?: string;
  displayName?: string;
  roles?: string[];
  role?: string;
  units?: string[];
  activeUnitId?: string;
}

export interface HandoverSession {
  userId: string;
  displayName?: string;
  email?: string;
  picture?: string;
  roles: string[];
  units: string[]; // unidades a las que tiene acceso
  user?: HandoverUser | null;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: string; // ISO
  mode?: SessionMode;
}

export interface AuthSession extends HandoverSession {
  fullName?: string;
  expiresAt?: string; // ISO
  roles: UserRole[] | string[];
}
// END HANDOVER_AUTH
