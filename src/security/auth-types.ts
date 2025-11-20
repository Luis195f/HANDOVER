// BEGIN HANDOVER_AUTH
export type UserRole = 'nurse' | 'supervisor';

export interface AuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;  // epoch seconds
  userId: string;
  fullName: string;
  roles: UserRole[];
  units: string[]; // unidades a las que tiene acceso
}
// END HANDOVER_AUTH
