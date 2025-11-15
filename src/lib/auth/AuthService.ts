import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { secure } from '../secure-store';
import type {
  AuthCredentials,
  AuthProvider,
  AuthState,
  AuthToken,
  AuthUser,
} from './types';

export type SecureStoreAdapter = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
};

const AUTH_TOKEN_KEY = 'auth/token';
const AUTH_USER_KEY = 'auth/user';

export const MOCK_CREDENTIALS: AuthCredentials = {
  username: 'nurse@example.com',
  password: 'password123',
};

export const MOCK_USER: AuthUser = {
  id: 'nurse-1',
  name: 'Jane Doe',
  email: 'nurse@example.com',
  role: 'nurse',
  unitIds: ['icu-adulto', 'urgencias'],
};

export const MOCK_TOKEN: AuthToken = {
  accessToken: 'mock-access-token',
  refreshToken: 'mock-refresh-token',
  expiresAt: Date.now() + 60 * 60 * 1000,
  tokenType: 'Bearer',
  scope: 'openid profile offline_access',
};

type Listener = (state: AuthState) => void;

function createDefaultSecureStoreAdapter(): SecureStoreAdapter {
  return {
    get: (key) => secure.get(key),
    set: (key, value) => secure.set(key, value),
    del: (key) => secure.del(key),
  };
}

function cloneState(state: AuthState): AuthState {
  return {
    user: state.user
      ? {
          ...state.user,
          unitIds: [...state.user.unitIds],
        }
      : null,
    token: state.token
      ? {
          ...state.token,
        }
      : null,
  };
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn('AuthService: failed to parse stored value', error);
    return null;
  }
}

export class AuthService implements AuthProvider {
  private state: AuthState = { user: null, token: null };
  private readonly listeners = new Set<Listener>();
  private hydrated = false;
  private hydrationPromise: Promise<void> | null = null;

  constructor(private readonly storage: SecureStoreAdapter = createDefaultSecureStoreAdapter()) {}

  private emit(): void {
    if (!this.listeners.size) return;
    const snapshot = cloneState(this.state);
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error('AuthService listener error', error);
      }
    }
  }

  private async persistState(): Promise<void> {
    const tasks: Promise<void>[] = [];
    if (this.state.token) {
      tasks.push(this.storage.set(AUTH_TOKEN_KEY, JSON.stringify(this.state.token)));
    } else {
      tasks.push(this.storage.del(AUTH_TOKEN_KEY));
    }

    if (this.state.user) {
      tasks.push(this.storage.set(AUTH_USER_KEY, JSON.stringify(this.state.user)));
    } else {
      tasks.push(this.storage.del(AUTH_USER_KEY));
    }

    await Promise.all(tasks);
  }

  private async ensureHydrated(): Promise<void> {
    if (this.hydrated) return;
    if (!this.hydrationPromise) {
      this.hydrationPromise = (async () => {
        try {
          const [tokenRaw, userRaw] = await Promise.all([
            this.storage.get(AUTH_TOKEN_KEY),
            this.storage.get(AUTH_USER_KEY),
          ]);
          const token = safeParse<AuthToken>(tokenRaw);
          const user = safeParse<AuthUser>(userRaw);
          this.state = { token, user };
        } catch (error) {
          console.warn('AuthService hydration failed', error);
          this.state = { token: null, user: null };
        } finally {
          this.hydrated = true;
          this.emit();
        }
      })().finally(() => {
        this.hydrationPromise = null;
      });
    }
    await this.hydrationPromise;
  }

  private updateState(next: AuthState): AuthState {
    this.state = cloneState(next);
    this.emit();
    return cloneState(this.state);
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(cloneState(this.state));
    void this.ensureHydrated();
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getSnapshot(): AuthState {
    return cloneState(this.state);
  }

  async login(credentials: AuthCredentials): Promise<AuthState> {
    await this.ensureHydrated();
    if (
      credentials.username !== MOCK_CREDENTIALS.username ||
      credentials.password !== MOCK_CREDENTIALS.password
    ) {
      throw new Error('INVALID_CREDENTIALS');
    }

    const token: AuthToken = {
      ...MOCK_TOKEN,
      expiresAt: Date.now() + 60 * 60 * 1000,
    };
    const state: AuthState = { user: { ...MOCK_USER }, token };
    this.updateState(state);
    await this.persistState();
    return cloneState(this.state);
  }

  async logout(): Promise<void> {
    await this.ensureHydrated();
    this.updateState({ user: null, token: null });
    await this.persistState();
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    await this.ensureHydrated();
    return cloneState(this.state).user;
  }

  async getAccessToken(): Promise<string | null> {
    await this.ensureHydrated();
    return this.state.token?.accessToken ?? null;
  }

  async getAuthState(): Promise<AuthState> {
    await this.ensureHydrated();
    return cloneState(this.state);
  }
}

export const authService = new AuthService();

export async function login(credentials: AuthCredentials): Promise<AuthState> {
  return authService.login(credentials);
}

export async function logout(): Promise<void> {
  return authService.logout();
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  return authService.getCurrentUser();
}

export async function getAccessToken(): Promise<string | null> {
  return authService.getAccessToken();
}

export function useAuthState(): AuthState {
  useEffect(() => {
    void authService.getAuthState();
  }, []);

  return useSyncExternalStore(
    (listener) => authService.subscribe(listener),
    () => authService.getSnapshot(),
    () => authService.getSnapshot()
  );
}

export function useLogin() {
  return useCallback((credentials: AuthCredentials) => authService.login(credentials), []);
}

export function useLogout() {
  return useCallback(() => authService.logout(), []);
}

export function useCurrentUser() {
  const state = useAuthState();
  return state.user;
}

export function useAccessToken() {
  const state = useAuthState();
  return state.token?.accessToken ?? null;
}
