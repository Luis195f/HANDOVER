import * as SecureStore from 'expo-secure-store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store');

const secureStore = SecureStore as typeof SecureStore & { __reset?: () => void };

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
});
