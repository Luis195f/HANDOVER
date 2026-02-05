// FILE: src/lib/drafts.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  decryptOfflinePayload,
  decryptPayload,
  encryptOfflinePayload,
  isEncryptionDisabled,
  payloadIsEncrypted,
} from './crypto';

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
  listKeys?: () => Promise<string[]>;
};

// ----------------------------
// Stores
// ----------------------------
const mem = new Map<string, string>();
const memStore: Store = {
  async getItem(k) { return mem.has(k) ? (mem.get(k) as string) : null; },
  async setItem(k, v) { mem.set(k, v); },
  async removeItem(k) { mem.delete(k); },
  async listKeys() { return Array.from(mem.keys()); },
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
  async listKeys() {
    try { return typeof localStorage === 'undefined' ? [] : Object.keys(localStorage); }
    catch { return []; }
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
const INDEX_KEY = `${PREFIX}:__index__`;
const LEGACY_PREFIXES = [
  `${ns()}:draft:`,
  `${ns()}:draft`,
  'handover:draft:',
  'draft:',
  'handoverDraft',
];

// Acepta 'Patient/{id}' o '{id}'
function normalizePatientId(patientId: string): string {
  if (!patientId) return patientId;
  return patientId.startsWith('Patient/') ? patientId.split('/')[1] ?? patientId : patientId;
}

// Clave primaria (normalizada) y clave legacy (sin normalizar) para compat
const keyNorm = (patientId: string) => `${PREFIX}:${normalizePatientId(patientId)}`;
const keyLegacy = (patientId: string) => `${PREFIX}:${patientId}`;

async function loadIndex(): Promise<string[]> {
  try {
    const raw = await storage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function saveIndex(keys: string[]): Promise<void> {
  try {
    if (!keys.length) {
      await storage.removeItem(INDEX_KEY);
      return;
    }
    await storage.setItem(INDEX_KEY, JSON.stringify(keys));
  } catch {}
}

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

type ParsedDraft<T> = { value: T | null; shouldEncrypt: boolean };

const DRAFT_ENCRYPTION_WARNING = '[HNDV][WARN][DRAFT_ENCRYPTION_FAILED]';
const DRAFT_DECRYPTION_WARNING = '[HNDV][WARN][DRAFT_DECRYPTION_FAILED]';

async function parseStoredDraft<T>(raw: string | null): Promise<ParsedDraft<T>> {
  if (!raw) return { value: null, shouldEncrypt: false };

  if (payloadIsEncrypted(raw)) {
    try {
      const decrypted = await decryptPayload(raw);
      return { value: safeParse<T>(decrypted), shouldEncrypt: !isEncryptionDisabled() };
    } catch (error) {
      console.warn(DRAFT_DECRYPTION_WARNING, error);
      return { value: null, shouldEncrypt: false };
    }
  }

  try {
    const decrypted = await decryptOfflinePayload(raw);
    if (decrypted !== raw) {
      return { value: safeParse<T>(decrypted), shouldEncrypt: false };
    }
  } catch (error) {
    console.warn(DRAFT_DECRYPTION_WARNING, error);
    return { value: null, shouldEncrypt: false };
  }

  const parsed = safeParse<T>(raw);
  return { value: parsed, shouldEncrypt: parsed !== null && !isEncryptionDisabled() };
}

// ----------------------------
// API pública
// ----------------------------
/**
 * Lee un borrador (descifra si es necesario). Los borradores legacy sin prefijo
 * se migran automáticamente al formato cifrado al cargarse.
 */
export async function getDraft<T = any>(patientId: string): Promise<T | null> {
  const k1 = keyNorm(patientId);
  const raw1 = await storage.getItem(k1);
  const parsed1 = await parseStoredDraft<T>(raw1);

  if (parsed1.value != null) {
    if (parsed1.shouldEncrypt && !isEncryptionDisabled()) {
      try {
        const encrypted = await encryptOfflinePayload(safeStringify(parsed1.value));
        try { await storage.setItem(k1, encrypted); } catch {}
      } catch (error) {
        console.warn(DRAFT_ENCRYPTION_WARNING, error);
      }
    }
    return parsed1.value;
  }

  // Compat: intenta la clave legacy si difiere
  const k2 = keyLegacy(patientId);
  if (k2 !== k1) {
    const raw2 = await storage.getItem(k2);
    const parsed2 = await parseStoredDraft<T>(raw2);
    if (parsed2.value != null) {
      if (parsed2.shouldEncrypt && !isEncryptionDisabled()) {
        try {
          const encrypted = await encryptOfflinePayload(safeStringify(parsed2.value));
          try { await storage.setItem(k1, encrypted); } catch {}
        } catch (error) {
          console.warn(DRAFT_ENCRYPTION_WARNING, error);
        }
      }
      return parsed2.value;
    }
  }
  return null;
}

export async function setDraft<T = any>(patientId: string, data: T): Promise<void> {
  const k1 = keyNorm(patientId);
  const serialized = safeStringify(data ?? {});
  let payload = serialized;
  if (!isEncryptionDisabled()) {
    try {
      payload = await encryptOfflinePayload(serialized);
    } catch (error) {
      console.warn(DRAFT_ENCRYPTION_WARNING, error);
      return;
    }
  }
  await storage.setItem(k1, payload);
  const index = await loadIndex();
  if (!index.includes(k1)) {
    await saveIndex([...index, k1]);
  }
}

export async function clearDraft(patientId?: string): Promise<void> {
  if (!patientId) return;
  const k1 = keyNorm(patientId);
  const k2 = keyLegacy(patientId);
  // Borra ambas posibles claves para idempotencia/compat
  try { await storage.removeItem(k1); } catch {}
  if (k2 !== k1) { try { await storage.removeItem(k2); } catch {} }
  const index = await loadIndex();
  if (index.length) {
    await saveIndex(index.filter((item) => item !== k1 && item !== k2));
  }
}

export async function clearAllDrafts(): Promise<void> {
  const index = await loadIndex();
  const keysToRemove = new Set(index);
  const allKeys = await storage.listKeys?.();

  if (allKeys?.length) {
    for (const key of allKeys) {
      if (key.startsWith(PREFIX) || LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        keysToRemove.add(key);
      }
    }
  } else {
    const patientIds = index
      .map((key) => (key.startsWith(`${PREFIX}:`) ? key.slice(`${PREFIX}:`.length) : null))
      .filter((value): value is string => Boolean(value));
    for (const patientId of patientIds) {
      for (const prefix of LEGACY_PREFIXES) {
        keysToRemove.add(`${prefix}${patientId}`);
      }
    }
    for (const prefix of LEGACY_PREFIXES) {
      keysToRemove.add(prefix);
    }
  }

  await Promise.allSettled(Array.from(keysToRemove).map((key) => storage.removeItem(key)));
  await saveIndex([]);
}

// ----------------------------
// Exports para tests si los necesitas
// ----------------------------
export const __test__ = {
  normalizePatientId,
  keyNorm,
  keyLegacy,
  indexKey: INDEX_KEY,
  legacyPrefixes: LEGACY_PREFIXES,
  readRaw: (key: string) => storage.getItem(key),
  writeRaw: (key: string, value: string) => storage.setItem(key, value),
};
// Back-compat: algunos lugares llaman saveDraft
export async function saveDraft(patientId: string, data: any) {
  // reusa tu implementación real
  return setDraft(patientId, data);
}
