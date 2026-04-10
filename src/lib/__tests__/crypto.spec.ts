import * as SecureStore from 'expo-secure-store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptPayload, encryptPayload } from '@/src/lib/crypto';

vi.mock('expo-secure-store');

const secureStore = SecureStore as typeof SecureStore & { __reset?: () => void };

describe('offline crypto helpers', () => {
  beforeEach(async () => {
    secureStore.__reset?.();
    await SecureStore.setItemAsync('handover_offline_queue_key', 'test-key-123');
    process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION = 'false';
  });

  it('debería cifrar y descifrar simétricamente', async () => {
    const plaintext = 'hola mundo';

    const cipher = await encryptPayload(plaintext);
    expect(cipher).not.toBe(plaintext);

    const decoded = await decryptPayload(cipher);
    expect(decoded).toBe(plaintext);
  });

  it('debería producir ciphertext diferente para mensajes distintos', async () => {
    const c1 = await encryptPayload('A');
    const c2 = await encryptPayload('B');

    expect(c1).not.toBe(c2);
  });

  it('debería devolver texto plano si el payload no tiene prefijo (legacy)', async () => {
    const legacy = '{"foo":"bar"}';

    const result = await decryptPayload(legacy);
    expect(result).toBe(legacy);
  });
});

