export type AuthToken = {
  /** Access token (e.g. JWT) to authorize API calls. */
  accessToken: string;
  /** Optional refresh token to renew the access token when it expires. */
  refreshToken: string | null;
  /** Expiration timestamp in milliseconds since epoch. */
  expiresAt: number;
  /** Optional ID token issued by the identity provider. */
  idToken?: string;
  /** Optional scope attached to the token. */
  scope?: string | null;
  /** Optional token type (e.g. "Bearer"). */
  tokenType?: string;
};

export type AuthUser = {
  /** Unique identifier for the authenticated user. */
  id: string;
  /** Display name for UI purposes. */
  name: string;
  /** Primary email associated with the user. */
  email: string;
  /** Main role of the user within the app. */
  role: 'nurse' | 'admin' | 'viewer';
  /** Units/wards the user can access. */
  unitIds: string[];
};

export type AuthState = {
  /** Currently authenticated user (null if logged out). */
  user: AuthUser | null;
  /** Active auth token bundle (null if logged out). */
  token: AuthToken | null;
};

export type AuthCredentials = {
  username: string;
  password: string;
};

export interface AuthProvider {
  /** Perform login with the provided credentials. */
  login(credentials: AuthCredentials): Promise<AuthState>;
  /** Clear all auth state and revoke access. */
  logout(): Promise<void>;
  /** Retrieve the current authenticated user (after hydration). */
  getCurrentUser(): Promise<AuthUser | null>;
  /** Retrieve the active access token (after hydration). */
  getAccessToken(): Promise<string | null>;
  /** Snapshot the full auth state (after hydration). */
  getAuthState(): Promise<AuthState>;
}
