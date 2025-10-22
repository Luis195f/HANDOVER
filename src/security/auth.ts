/* FILE: src/security/auth.ts
   - Persistencia segura (expo-secure-store → localStorage → memoria)
   - API estable: login, logout, getSession, onAuthChange, withAuthHeaders
   - RBAC por unidades (compat): canAccessUnit/ensureUnit/scopeByUnits
   - RBAC por roles (nuevo y no intrusivo): Role, hasRole, ensureRole
   - Backward-compat: respeta tu shape { user?, units?, token? } y añade roles/allowedUnits opcionales
*/
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Role = "nurse" | "chief" | "viewer";

/** Sesión compatible hacia atrás + ampliada con roles/unidades por usuario */
export type Session = {
  user?: {
    id: string;
    name?: string;
    /** NUEVO: roles opcionales para RBAC por rol */
    roles?: Role[];
    /** Opcionales: unidades colgadas del usuario (algunos IdPs lo hacen) */
    units?: string[];
    allowedUnits?: string[];
  };
  /** Compat: unidades permitidas en raíz (tu shape original) */
  units?: string[];
  token?: string;
};

let _session: Session | null = null;
let _loaded = false;

/* ------------------------------------------------------------------ */
/* Storage seguro: SecureStore → localStorage → memoria                */
/* ------------------------------------------------------------------ */
type StoreAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const inMem = new Map<string, string>();

function makeInMemoryStore(): StoreAdapter {
  return {
    async getItem(key) { return inMem.has(key) ? (inMem.get(key) as string) : null; },
    async setItem(key, value) { inMem.set(key, value); },
    async removeItem(key) { inMem.delete(key); },
  };
}

function makeLocalStorageStore(): StoreAdapter {
  return {
    async getItem(key) {
      try { if (typeof localStorage === "undefined") return null; return localStorage.getItem(key); } catch { return null; }
    },
    async setItem(key, value) {
      try { if (typeof localStorage === "undefined") return; localStorage.setItem(key, value); } catch {}
    },
    async removeItem(key) {
      try { if (typeof localStorage === "undefined") return; localStorage.removeItem(key); } catch {}
    },
  };
}

function makeSecureStore(): StoreAdapter | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("expo-secure-store");
    const SecureStore = mod?.default ?? mod;
    if (!SecureStore?.getItemAsync) return null;
    return {
      async getItem(key) { try { return await SecureStore.getItemAsync(key); } catch { return null; } },
      async setItem(key, value) { try { await SecureStore.setItemAsync(key, value); } catch {} },
      async removeItem(key) { try { await SecureStore.deleteItemAsync(key); } catch {} },
    };
  } catch {
    return null;
  }
}

const storage: StoreAdapter =
  makeSecureStore() ??
  (typeof localStorage !== "undefined" ? makeLocalStorageStore() : makeInMemoryStore());

/* ------------------------------------------------------------------ */
/* Namespace y key de almacenamiento                                  */
/* ------------------------------------------------------------------ */
function resolveNamespace(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const env = require("@/src/config/env");
    return env?.STORAGE_NAMESPACE ?? env?.default?.STORAGE_NAMESPACE ?? "nurseos";
  } catch {
    return "nurseos";
  }
}
const NS = resolveNamespace();
const KEY = `${NS}:session`;

/* ------------------------------------------------------------------ */
/* Persistencia de sesión                                             */
/* ------------------------------------------------------------------ */
async function readPersistedSession(): Promise<Session | null> {
  const raw = await storage.getItem(KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as Session; } catch { return null; }
}

async function savePersistedSession(s: Session | null): Promise<void> {
  if (!s) { await storage.removeItem(KEY); return; }
  try { await storage.setItem(KEY, JSON.stringify(s)); } catch {}
}

/* ------------------------------------------------------------------ */
/* Eventos de sesión (login/logout → refrescar UI)                     */
/* ------------------------------------------------------------------ */
type AuthListener = (s: Session | null) => void;
const _authListeners: AuthListener[] = [];

function notify() { for (const l of _authListeners) { try { l(_session); } catch {} } }

export function onAuthChange(cb: AuthListener) {
  _authListeners.push(cb);
  return () => {
    const i = _authListeners.indexOf(cb);
    if (i >= 0) _authListeners.splice(i, 1);
  };
}

/* ------------------------------------------------------------------ */
/* API principal: login/logout/getSession/withAuthHeaders             */
/* ------------------------------------------------------------------ */

/** Login simulado/real: acepta roles y allowedUnits opcionales sin romper compat */
export async function login(params: {
  user: { id: string; name?: string; roles?: Role[]; units?: string[]; allowedUnits?: string[] };
  /** Compat raíz */
  units?: string[];
  /** Alternativa raíz nueva */
  allowedUnits?: string[];
  token?: string;
}) {
  const { user, token } = params;
  const mergedUnits = dedupe([
    ...(params.units ?? []),
    ...(params.allowedUnits ?? []),
    ...(user?.units ?? []),
    ...(user?.allowedUnits ?? []),
  ]);
  _session = {
    user: { id: user.id, name: user.name, roles: user.roles, units: user.units, allowedUnits: user.allowedUnits },
    units: mergedUnits,
    token,
  };
  _loaded = true;
  await savePersistedSession(_session);
  notify();
  return _session;
}

export async function logout() {
  _session = null;
  _loaded = true;
  await savePersistedSession(null);
  notify();
}

/** Devuelve la sesión actual; primera llamada hidrata desde storage. */
export async function getSession(): Promise<Session | null> {
  if (_loaded) return _session;
  _session = await readPersistedSession();
  _loaded = true;
  return _session;
}

/** Inyecta Authorization si hay token; no muta el objeto recibido. */
export function withAuthHeaders(init: { headers?: Record<string, string> } = {}) {
  const token = _session?.token; // si necesitas token tras cold start, llama getSession() antes
  const headers: Record<string, string> = { ...init.headers };
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/* ------------------------------------------------------------------ */
/* RBAC por UNIDADES (compat)                                         */
/* ------------------------------------------------------------------ */

/** Unifica todas las fuentes de unidades permitidas (raíz y dentro de user). */
function allowedUnitsFrom(session: Partial<Session> | null | undefined): Set<string> {
  const rootUnits = session?.units ?? [];
  const userUnits = (session as any)?.user?.units ?? [];
  const allowed = (session as any)?.user?.allowedUnits ?? [];
  return new Set(dedupe([...(rootUnits as string[]), ...(userUnits as string[]), ...(allowed as string[])]));
}

/** true si el usuario puede acceder a la unidad dada. */
export function hasUnitAccess(session: Partial<Session> | null | undefined, unitId?: string): boolean {
  if (!unitId) return false;
  return allowedUnitsFrom(session).has(unitId);
}

/** Alias compat (tu nombre original) */
export const canAccessUnit = hasUnitAccess;

/** Lanza si el usuario NO puede acceder a la unidad. */
export function ensureUnit(session: Partial<Session> | null | undefined, unitId?: string) {
  if (!hasUnitAccess(session, unitId)) {
    const who = session?.user?.id ?? "unknown";
    throw new Error(`RBAC: user ${who} cannot access unit ${unitId ?? "(undefined)"}`);
  }
}

/** Filtra un dataset reteniendo solo ítems cuya unidad esté permitida. */
export function scopeByUnits<T>(
  session: Partial<Session> | null | undefined,
  data: T[],
  getUnit: (x: T) => string | undefined
): T[] {
  const allowed = allowedUnitsFrom(session);
  if (allowed.size === 0) return [];
  return data.filter((x) => {
    const u = getUnit(x);
    return u ? allowed.has(u) : false;
  });
}

/* ------------------------------------------------------------------ */
/* RBAC por ROLES (nuevo, no intrusivo)                               */
/* ------------------------------------------------------------------ */

function rolesFrom(session: Session | null | undefined): Role[] {
  const r = session?.user?.roles;
  // Si no hay roles, por defecto "viewer" (comportamiento seguro)
  return Array.isArray(r) && r.length ? (r as Role[]) : ["viewer"];
}

/** Devuelve true si el usuario cumple el rol requerido. `all=true` exige todos. */
export function hasRole(session: Session | null | undefined, required: Role | Role[], all = false): boolean {
  const req = Array.isArray(required) ? required : [required];
  const userRoles = new Set(rolesFrom(session));
  return all ? req.every((r) => userRoles.has(r)) : req.some((r) => userRoles.has(r));
}

/** Lanza si el usuario no cumple el/los rol(es) requeridos. */
export function ensureRole(session: Session | null | undefined, required: Role | Role[], all = false): true {
  if (!session) throw new Error("NO_SESSION");
  if (!hasRole(session, required, all)) throw new Error("FORBIDDEN_ROLE");
  return true;
}

/* ------------------------------------------------------------------ */
/* Helpers internos                                                    */
/* ------------------------------------------------------------------ */
function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}


