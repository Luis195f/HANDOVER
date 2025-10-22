// FILE: src/lib/drafts.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Almacenamiento de borradores por paciente, con prioridad:
 * SecureStore (Expo) → localStorage (web/tests) → memoria.
 * - Namespacing: respeta STORAGE_NAMESPACE de '@/src/config/env'
 * - Compat: acepta 'Patient/{id}' o '{id}' y limpia ambas claves en clearDraft()
 * - API estable: getDraft, setDraft, clearDraft
 */

type Store = {
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
  removeItem: (k: string) => Promise<void>;
};

// ----------------------------
// Stores
// ----------------------------
const mem = new Map<string, string>();
const memStore: Store = {
  async getItem(k) { return mem.has(k) ? (mem.get(k) as string) : null; },
  async setItem(k, v) { mem.set(k, v); },
  async removeItem(k) { mem.delete(k); },
};

const localStore: Store = {
  async getItem(k) {
    try { return typeof localStorage === 'undefined' ? null : localStorage.getItem(k); }
    catch { return null; }
  },
  async setItem(k, v) {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); }
    catch {}
  },
  async removeItem(k) {
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(k); }
    catch {}
  },
};

function secureStore(): Store | null {
  try {
    // expo-secure-store puede exportar default o named
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-secure-store');
    const SS = mod?.default ?? mod;
    if (!SS?.getItemAsync) return null;
    return {
      async getItem(k) { try { return await SS.getItemAsync(k); } catch { return null; } },
      async setItem(k, v) { try { await SS.setItemAsync(k, v); } catch {} },
      async removeItem(k) { try { await SS.deleteItemAsync(k); } catch {} },
    };
  } catch { return null; }
}

const storage: Store =
  secureStore() ??
  (typeof localStorage !== 'undefined' ? localStore : memStore);

// ----------------------------
// Namespace + keys
// ----------------------------
function ns(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const env = require('@/src/config/env');
    return env?.STORAGE_NAMESPACE ?? env?.default?.STORAGE_NAMESPACE ?? 'nurseos';
  } catch { return 'nurseos'; }
}
const PREFIX = `${ns()}:drafts`;

// Acepta 'Patient/{id}' o '{id}'
function normalizePatientId(patientId: string): string {
  if (!patientId) return patientId;
  return patientId.startsWith('Patient/') ? patientId.split('/')[1] ?? patientId : patientId;
}

// Clave primaria (normalizada) y clave legacy (sin normalizar) para compat
const keyNorm = (patientId: string) => `${PREFIX}:${normalizePatientId(patientId)}`;
const keyLegacy = (patientId: string) => `${PREFIX}:${patientId}`;

// ----------------------------
// JSON helpers
// ----------------------------
function safeParse<T = any>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}
function safeStringify(v: unknown): string {
  // Elimina undefined y funciones
  return JSON.stringify(v, (_k, value) => (typeof value === 'function' ? undefined : value));
}

// ----------------------------
// API pública
// ----------------------------
export async function getDraft<T = any>(patientId: string): Promise<T | null> {
  const k1 = keyNorm(patientId);
  const raw1 = await storage.getItem(k1);
  if (raw1) return safeParse<T>(raw1);

  // Compat: intenta la clave legacy si difiere
  const k2 = keyLegacy(patientId);
  if (k2 !== k1) {
    const raw2 = await storage.getItem(k2);
    if (raw2) return safeParse<T>(raw2);
  }
  return null;
}

export async function setDraft<T = any>(patientId: string, data: T): Promise<void> {
  const k1 = keyNorm(patientId);
  await storage.setItem(k1, safeStringify(data ?? {}));
}

export async function clearDraft(patientId?: string): Promise<void> {
  if (!patientId) return;
  const k1 = keyNorm(patientId);
  const k2 = keyLegacy(patientId);
  // Borra ambas posibles claves para idempotencia/compat
  try { await storage.removeItem(k1); } catch {}
  if (k2 !== k1) { try { await storage.removeItem(k2); } catch {} }
}

// ----------------------------
// Exports para tests si los necesitas
// ----------------------------
export const __test__ = {
  normalizePatientId,
  keyNorm,
  keyLegacy,
};
// Back-compat: algunos lugares llaman saveDraft
export async function saveDraft(patientId: string, data: any) {
  // reusa tu implementación real
  return setDraft(patientId, data);
}
