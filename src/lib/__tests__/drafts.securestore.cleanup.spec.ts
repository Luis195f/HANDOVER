import { describe, expect, it, vi } from 'vitest';

const secureStoreData = new Map<string, string>();
const nativeKey = (key: string) => {
  if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error('Invalid SecureStore key');
};

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => { nativeKey(key); return secureStoreData.get(key) ?? null; }),
  setItemAsync: vi.fn(async (key: string, value: string) => { nativeKey(key); secureStoreData.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { nativeKey(key); secureStoreData.delete(key); }),
  isAvailableAsync: vi.fn(async () => true),
  __store: secureStoreData,
}));

async function loadDraftModule() {
  vi.resetModules();
  secureStoreData.clear();
  const drafts = await import('@/src/lib/drafts');
  return drafts;
}

describe('clearAllDrafts without listKeys (SecureStore)', () => {
  it('persists separate patient/unit drafts and the index using native-valid keys across reload and cleanup', async () => {
    const drafts = await loadDraftModule();
    await drafts.setHandoverDraft('Patient/a:b', 'unit/one', { note: 'first' });
    await drafts.setHandoverDraft('Patient/a_b', 'unit/one', { note: 'second' });
    expect([...secureStoreData.keys()].every((key) => /^[A-Za-z0-9._-]+$/.test(key))).toBe(true);
    vi.resetModules();
    const reloaded = await import('@/src/lib/drafts');
    expect(await reloaded.getHandoverDraft('Patient/a:b', 'unit/one')).toEqual({ note: 'first' });
    expect(await reloaded.getHandoverDraft('Patient/a_b', 'unit/one')).toEqual({ note: 'second' });
    await reloaded.clearAllDrafts();
    expect([...secureStoreData.keys()].filter((key) => key.startsWith('handover.draft.'))).toEqual([]);
  });
  it('does not overwrite a corrupt native index or create a draft payload', async () => {
    const drafts = await loadDraftModule();
    await drafts.__test__.writeRaw(drafts.__test__.indexKey, '{broken');
    await expect(drafts.setHandoverDraft('Patient/a:b', 'unit/one', { note: 'synthetic' })).rejects.toThrow();
    expect([...secureStoreData.keys()].filter((key) => key.startsWith('handover.draft.'))).toHaveLength(1);
    expect(await drafts.__test__.readRaw(drafts.__test__.indexKey)).toBe('{broken');
  });
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
