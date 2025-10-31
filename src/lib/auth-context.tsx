// @ts-nocheck
import * as SecureStore from "expo-secure-store";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type Role = "nurse" | "supervisor" | "admin";
export type Token = { sub: string; role: Role; unitIds: string[]; exp: number };

type Ctx = {
  token: Token | null;
  loginMock: (opts?: Partial<Token>) => Promise<void>;
  logout: () => Promise<void>;
  canAccessUnit: (unitId: string) => boolean;
};

const AuthCtx = createContext<Ctx | null>(null);
const KEY = "handover.auth.token";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<Token | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(KEY);
        if (raw) setToken(JSON.parse(raw));
      } catch {}
    })();
  }, []);

  const loginMock = async (opts?: Partial<Token>) => {
    const t: Token = {
      sub: "nurse-1",
      role: "nurse",
      unitIds: ["uci-adulto", "urgencias"],
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
      ...opts,
    };
    await SecureStore.setItemAsync(KEY, JSON.stringify(t));
    setToken(t);
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync(KEY);
    setToken(null);
  };

  const canAccessUnit = (unitId: string) => !!token?.unitIds?.includes(unitId);

  const value = useMemo<Ctx>(() => ({ token, loginMock, logout, canAccessUnit }), [token]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): Ctx {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
