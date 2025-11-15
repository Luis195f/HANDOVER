import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import type { AuthCredentials, AuthState, AuthToken, AuthUser } from './types';
import { authService, useAuthState, useLogin, useLogout } from './AuthService';

type AuthContextValue = {
  user: AuthUser | null;
  token: AuthToken | null;
  state: AuthState;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: AuthCredentials) => Promise<AuthState>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthProviderProps = {
  children: React.ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const state = useAuthState();
  const login = useLogin();
  const logout = useLogout();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    authService
      .getAuthState()
      .catch(() => {
        // noop - state will remain unauthenticated if hydration fails
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user: state.user,
    token: state.token,
    state,
    isAuthenticated: Boolean(state.user && state.token),
    isLoading,
    login,
    logout,
  }), [state, isLoading, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
