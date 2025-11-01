import type { User } from '@/src/lib/auth';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  idToken?: string;
  scope?: string;
};

export type AuthState = {
  user: User | null;
  tokens: AuthTokens | null;
};

type AuthListener = (state: AuthState) => void;

let currentState: AuthState = { user: null, tokens: null };
const listeners = new Set<AuthListener>();

function cloneState(state: AuthState): AuthState {
  return {
    user: state.user ? { ...state.user, unitIds: [...state.user.unitIds] } : null,
    tokens: state.tokens
      ? {
          accessToken: state.tokens.accessToken,
          refreshToken: state.tokens.refreshToken,
          expiresAt: state.tokens.expiresAt,
          idToken: state.tokens.idToken,
          scope: state.tokens.scope,
        }
      : null,
  };
}

export function getAuthState(): AuthState {
  return cloneState(currentState);
}

function emit(): void {
  const snapshot = getAuthState();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      // ignore listener errors to avoid breaking other subscribers
      console.error('auth-store listener error', error);
    }
  }
}

export function setAuthState(next: AuthState): void {
  currentState = cloneState(next);
  emit();
}

export function updateAuthState(partial: Partial<AuthState>): void {
  currentState = cloneState({
    user: partial.user ?? currentState.user,
    tokens: partial.tokens ?? currentState.tokens,
  });
  emit();
}

export function clearAuthState(): void {
  currentState = { user: null, tokens: null };
  emit();
}

export function subscribe(listener: AuthListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isTokenExpiringSoon(thresholdSeconds = 60): boolean {
  const { tokens } = currentState;
  if (!tokens) {
    return true;
  }
  const expiresIn = tokens.expiresAt - Math.floor(Date.now() / 1000);
  return expiresIn <= thresholdSeconds;
}
