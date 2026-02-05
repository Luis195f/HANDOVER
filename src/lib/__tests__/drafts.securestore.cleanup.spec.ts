import { describe, expect, it, vi } from 'vitest';

const secureStoreData = new Map<string, string>();

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => secureStoreData.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { secureStoreData.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { secureStoreData.delete(key); }),
  __store: secureStoreData,
}));

async function loadDraftModule() {
  vi.resetModules();
  secureStoreData.clear();
  const drafts = await import('@/src/lib/drafts');
  return drafts;
}

describe('clearAllDrafts without listKeys (SecureStore)', () => {
  it('elimina drafts legacy aunque no exista INDEX_KEY', async () => {
    const { clearAllDrafts, __test__ } = await loadDraftModule();
    const patientId = 'Patient/999';
    const normalizedId = __test__.normalizePatientId(patientId);
    const legacyPrefixWithId = __test__.legacyPrefixes[0];
    const legacyMapKey = __test__.legacyPrefixes[__test__.legacyPrefixes.length - 1];
    const legacyKey = `${legacyPrefixWithId}${normalizedId}`;

    await __test__.writeRaw(legacyKey, JSON.stringify({ note: 'legacy' }));
    await __test__.writeRaw(legacyMapKey, JSON.stringify({ [patientId]: true }));

    await clearAllDrafts();

    await expect(__test__.readRaw(legacyKey)).resolves.toBeNull();
    await expect(__test__.readRaw(legacyMapKey)).resolves.toBeNull();
  });

  it('usa INDEX_KEY para construir claves legacy cuando listKeys no existe', async () => {
    const { clearAllDrafts, __test__ } = await loadDraftModule();
    const patientId = 'Patient/123';
    const normalizedId = __test__.normalizePatientId(patientId);
    const draftKey = __test__.keyNorm(patientId);
    const legacyPrefix = __test__.legacyPrefixes[0];
    const legacyKey = `${legacyPrefix}${normalizedId}`;

    await __test__.writeRaw(draftKey, JSON.stringify({ note: 'draft' }));
    await __test__.writeRaw(__test__.indexKey, JSON.stringify([draftKey]));
    await __test__.writeRaw(legacyKey, JSON.stringify({ note: 'legacy' }));

    await clearAllDrafts();

    await expect(__test__.readRaw(draftKey)).resolves.toBeNull();
    await expect(__test__.readRaw(legacyKey)).resolves.toBeNull();
    await expect(__test__.readRaw(__test__.indexKey)).resolves.toBeNull();
  });
});
