import * as SecureStore from 'expo-secure-store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type SecureStoreMock = typeof SecureStore & {
  __reset?: () => void;
  __setSetItemFailure?: (handler: ((key: string, value: string) => unknown) | Error | null) => void;
};

const secureStore = SecureStore as SecureStoreMock;

describe('security/crypto', () => {
  beforeEach(() => {
    secureStore.__reset?.();
    vi.resetModules();
  });

  async function loadModule() {
    return import('@/src/security/crypto');
  }

  it('genera y reutiliza la misma clave simétrica', async () => {
    const { getOrCreateEncryptionKey } = await loadModule();

    const first = await getOrCreateEncryptionKey();
    const second = await getOrCreateEncryptionKey();

    expect(first).toBe(second);
    const stored = await (await import('expo-secure-store')).getItemAsync('handover_encryption_key_v1');
    expect(stored).toBe(first);
  });

  it('cifra y descifra un payload manteniendo el formato v1', async () => {
    const { encryptPayload, decryptPayload } = await loadModule();
    const plain = JSON.stringify({ foo: 'bar', nested: { v: 1 } });

    const cipher = await encryptPayload(plain);
    expect(cipher.startsWith('v1:')).toBe(true);

    const restored = await decryptPayload(cipher);
    expect(restored).toBe(plain);
  });

  it('devuelve tal cual los valores legacy sin prefijo', async () => {
    const { decryptPayload } = await loadModule();

    const plain = 'plain-text-value';
    const decrypted = await decryptPayload(plain);

    expect(decrypted).toBe(plain);
  });

  it('lanza si no puede persistir la clave de cifrado en ningún slot', async () => {
    secureStore.__setSetItemFailure?.(() => new Error('persist-fail'));
    const { getOrCreateEncryptionKey } = await loadModule();

    await expect(getOrCreateEncryptionKey()).rejects.toThrow('ENCRYPTION_KEY_PERSIST_FAILED');
  });

  it('permite continuar si al menos un slot persiste la clave', async () => {
    let attempts = 0;
    secureStore.__setSetItemFailure?.(() => {
      attempts += 1;
      return attempts === 1 ? new Error('fail-first-slot') : null;
    });
    const { getOrCreateEncryptionKey } = await loadModule();

    const key = await getOrCreateEncryptionKey();

    const storedPrimary = await SecureStore.getItemAsync('handover_local_crypto_key');
    const storedSecondary = await SecureStore.getItemAsync('handover_encryption_key_v1');
    expect([storedPrimary, storedSecondary]).toContain(key);
    expect(storedPrimary).toBeNull();
    expect(storedSecondary).toBe(key);
  });
});
