// BEGIN HANDOVER_AUTH
export type UserRole = 'nurse' | 'supervisor';

export interface HandoverSession {
  userId: string;
  displayName?: string;
  roles: string[];
  units: string[]; // unidades a las que tiene acceso
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string; // ISO
}

export interface AuthSession extends HandoverSession {
  fullName?: string;
  expiresAt?: string | number; // epoch seconds (legacy) o ISO
  roles: UserRole[] | string[];
}
// END HANDOVER_AUTH
