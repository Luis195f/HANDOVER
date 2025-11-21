import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY_ID = 'handover_local_crypto_key';

beforeEach(async () => {
  const secureStore = await import('expo-secure-store');
  if (typeof (secureStore as Record<string, unknown>).__reset === 'function') {
    (secureStore as Record<string, unknown>).__reset?.();
  }
  vi.resetModules();
});

describe('secure payload crypto helpers', () => {
  it('encrypts and decrypts payloads preserving structure', async () => {
    const { encryptPayload, decryptPayload } = await import('@/src/security/crypto');
    const input = { foo: 'bar', count: 3, nested: { flag: true } };

    const cipher = await encryptPayload(input);
    const output = await decryptPayload(cipher);

    expect(cipher.startsWith('v')).toBe(true);
    expect(output).toEqual(input);
  });

  it('reuses stored key across module reloads', async () => {
    const { encryptPayload } = await import('@/src/security/crypto');
    await encryptPayload({ first: true });

    const secureStore = await import('expo-secure-store');
    const initialKey = await (secureStore as unknown as {
      getItemAsync?: (key: string) => Promise<string | null>;
    }).getItemAsync?.(KEY_ID);

    // Simula recarga de módulo reutilizando el mismo almacenamiento seguro.
    vi.resetModules();
    vi.doMock('expo-secure-store', () => secureStore);

    const { encryptPayload: encryptAfterReload } = await import('@/src/security/crypto');
    await encryptAfterReload({ second: true });

    const secureStoreAfter = await import('expo-secure-store');
    const persistedKey = await (secureStoreAfter as unknown as {
      getItemAsync?: (key: string) => Promise<string | null>;
    }).getItemAsync?.(KEY_ID);

    expect(initialKey).toBeTruthy();
    expect(persistedKey).toBe(initialKey);
  });
});
