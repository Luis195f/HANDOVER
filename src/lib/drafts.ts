// FILE: src/lib/drafts.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  decryptOfflinePayload,
  decryptPayload,
  encryptOfflinePayload,
  isEncryptionDisabled,
  payloadIsEncrypted,
  hashHex,
} from './crypto';
import { assertLocalWriteAllowed } from '@/src/security/local-cleanup-state';
import * as SecureStore from 'expo-secure-store';

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
    if (typeof localStorage === 'undefined') throw new Error('DRAFT_STORAGE_UNAVAILABLE');
    return localStorage.getItem(k);
  },
  async setItem(k, v) {
    if (typeof localStorage === 'undefined') throw new Error('DRAFT_STORAGE_UNAVAILABLE');
    localStorage.setItem(k, v);
  },
  async removeItem(k) {
    if (typeof localStorage === 'undefined') throw new Error('DRAFT_STORAGE_UNAVAILABLE');
    localStorage.removeItem(k);
  },
  async listKeys() {
    if (typeof localStorage === 'undefined') throw new Error('DRAFT_STORAGE_UNAVAILABLE');
    return Object.keys(localStorage);
  },
};

function secureStore(): Store | null {
  if (typeof SecureStore.getItemAsync !== 'function') return null;
  const physicalKey = (key: string) => `handover.draft.${hashHex(key)}`;
  return {
    async getItem(k) { return SecureStore.getItemAsync(physicalKey(k)); },
    async setItem(k, v) { await SecureStore.setItemAsync(physicalKey(k), v); },
    async removeItem(k) { await SecureStore.deleteItemAsync(physicalKey(k)); },
  };
}

const secureDraftStore = secureStore();
const storage: Store =
  secureDraftStore ??
  (typeof localStorage !== 'undefined' ? localStore : memStore);
const draftDurability = storage === memStore ? 'memory' as const : 'persisted' as const;

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
  const raw = await storage.getItem(INDEX_KEY);
  if (raw == null) return [];
  const parsed: unknown = JSON.parse(await decryptOfflinePayload(raw));
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('DRAFT_INDEX_CORRUPT');
  }
  return parsed;
}

async function saveIndex(keys: string[]): Promise<void> {
  if (!keys.length) return storage.removeItem(INDEX_KEY);
  await storage.setItem(INDEX_KEY, await encryptOfflinePayload(JSON.stringify(keys)));
}

let pendingIndex = Promise.resolve();
function withIndexLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingIndex.then(operation);
  pendingIndex = result.then(() => {}, () => {});
  return result;
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

async function parseStoredDraft<T>(raw: string | null): Promise<ParsedDraft<T>> {
  if (raw == null) return { value: null, shouldEncrypt: false };

  if (payloadIsEncrypted(raw)) {
    const decrypted = await decryptPayload(raw);
    const value = safeParse<T>(decrypted);
    if (value === null) throw new Error('DRAFT_CORRUPT');
    return { value, shouldEncrypt: !isEncryptionDisabled() };
  }

  try {
    const decrypted = await decryptOfflinePayload(raw);
    if (decrypted !== raw) {
      return { value: safeParse<T>(decrypted), shouldEncrypt: false };
    }
  } catch { throw new Error('DRAFT_DECRYPTION_FAILED'); }

  const parsed = safeParse<T>(raw);
  if (parsed === null) throw new Error('DRAFT_CORRUPT');
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
      await setDraft(patientId, parsed1.value);
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
        const existing = await storage.getItem(k1);
        if (existing == null) await setDraft(patientId, parsed2.value);
      }
      return parsed2.value;
    }
  }
  return null;
}

export async function setDraft<T = any>(patientId: string, data: T): Promise<'persisted' | 'memory'> {
  assertLocalWriteAllowed();
  const k1 = keyNorm(patientId);
  const serialized = safeStringify(data ?? {});
  const payload = isEncryptionDisabled() ? serialized : await encryptOfflinePayload(serialized);
  await withIndexLock(async () => {
    const index = await loadIndex();
    if (!index.includes(k1)) await saveIndex([...index, k1]);
    await storage.setItem(k1, payload);
  });
  return draftDurability;
}

export async function clearDraft(patientId?: string): Promise<void> {
  if (!patientId) return;
  const k1 = keyNorm(patientId);
  const k2 = keyLegacy(patientId);
  // Borra ambas posibles claves para idempotencia/compat
  await withIndexLock(async () => {
    const index = await loadIndex();
    await storage.removeItem(k1);
    if (k2 !== k1) await storage.removeItem(k2);
    await saveIndex(index.filter((item) => item !== k1 && item !== k2));
  });
}

export async function clearAllDrafts(): Promise<void> {
  await withIndexLock(async () => {
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
    const patientIdsFromIndex = index
      .map((key) => (key.startsWith(`${PREFIX}:`) ? key.slice(`${PREFIX}:`.length) : null))
      .filter((value): value is string => Boolean(value));
    const patientIdsFromLegacyMaps = new Set<string>();
    for (const legacyPrefix of LEGACY_PREFIXES) {
      try {
        // Mitigación RGPD/MDR: si no hay listKeys, intentamos extraer ids de
        // mapas legacy para evitar PHI persistente tras logout.
        const legacyRaw = await storage.getItem(legacyPrefix);
        const legacyParsed = safeParse<unknown>(legacyRaw);
        if (Array.isArray(legacyParsed)) {
          for (const entry of legacyParsed) {
            if (typeof entry === 'string') patientIdsFromLegacyMaps.add(entry);
          }
        } else if (legacyParsed && typeof legacyParsed === 'object') {
          for (const entry of Object.keys(legacyParsed)) {
            patientIdsFromLegacyMaps.add(entry);
          }
        }
      } catch (error) { throw error; }
    }
    const patientIds = new Set([...patientIdsFromIndex, ...patientIdsFromLegacyMaps]);
    for (const patientId of patientIds) {
      const normalized = normalizePatientId(patientId);
      for (const prefix of LEGACY_PREFIXES) {
        keysToRemove.add(`${prefix}${patientId}`);
        if (normalized !== patientId) {
          keysToRemove.add(`${prefix}${normalized}`);
        }
      }
    }
    for (const prefix of LEGACY_PREFIXES) {
      keysToRemove.add(prefix);
    }
  }

    await saveIndex(Array.from(keysToRemove));
    const failures: string[] = [];
    for (const key of keysToRemove) {
      try { await storage.removeItem(key); }
      catch { failures.push(key); }
    }
    await saveIndex(failures);
    if (failures.length) throw new Error('DRAFT_PURGE_INCOMPLETE');
  });
}

function handoverDraftIdentity(patientId: string, unitId: string): string {
  return `form:${encodeURIComponent(patientId)}:${encodeURIComponent(unitId)}`;
}

export async function getHandoverDraft<T>(patientId: string, unitId: string): Promise<T | null> {
  const identity = handoverDraftIdentity(patientId, unitId);
  const legacyKey = `handoverDraft:${patientId}:${unitId}`;
  const raw = await storage.getItem(legacyKey);
  if (raw != null) {
    await withIndexLock(async () => {
      assertLocalWriteAllowed();
      const index = await loadIndex();
      if (!index.includes(legacyKey)) await saveIndex([...index, legacyKey]);
    });
  }
  const managed = await getDraft<T>(identity);
  if (raw == null) return managed;
  const legacy = (await parseStoredDraft<T>(raw)).value;
  if (legacy === null) throw new Error('DRAFT_CORRUPT');
  if (managed !== null && JSON.stringify(managed) !== JSON.stringify(legacy)) throw new Error('DRAFT_CONFLICT');
  if (managed === null) {
    await setDraft(identity, legacy);
    if (JSON.stringify(await getDraft<T>(identity)) !== JSON.stringify(legacy)) throw new Error('DRAFT_MIGRATION_FAILED');
  }
  await storage.removeItem(legacyKey);
  await withIndexLock(async () => {
    const index = await loadIndex();
    await saveIndex(index.filter((key) => key !== legacyKey));
  });
  return managed ?? legacy;
}

export async function setHandoverDraft<T>(patientId: string, unitId: string, draft: T): Promise<'persisted' | 'memory'> {
  return setDraft(handoverDraftIdentity(patientId, unitId), draft);
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
  storage,
};
// Back-compat: algunos lugares llaman saveDraft
export async function saveDraft(patientId: string, data: any) {
  // reusa tu implementación real
  return setDraft(patientId, data);
}
