import * as Crypto from 'expo-crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearOfflineEncryptionKeys,
  decryptPayload,
  decryptOfflinePayload,
  encryptOfflinePayload,
  encryptPayload,
  isEncryptionDisabled,
  OfflineDecryptionError,
  TEST_ONLY_OFFLINE_ENCRYPTION_DISABLE_ENV,
} from '../../src/lib/crypto';

function setEnv(disabled: string | undefined): void {
  if (disabled === undefined) {
    delete process.env[TEST_ONLY_OFFLINE_ENCRYPTION_DISABLE_ENV];
    return;
  }

  process.env[TEST_ONLY_OFFLINE_ENCRYPTION_DISABLE_ENV] = disabled;
}

describe('offline encryption feature flag', () => {
  const originalFlag = process.env[TEST_ONLY_OFFLINE_ENCRYPTION_DISABLE_ENV];
  const originalPublicFlag = process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED;

  afterEach(() => {
    setEnv(originalFlag);
    if (originalPublicFlag === undefined) {
      delete process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED;
    } else {
      process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = originalPublicFlag;
    }
  });

  it('returns false by default', () => {
    setEnv(undefined);
    expect(isEncryptionDisabled()).toBe(false);
  });

  it('ignores deprecated public bundle flags', () => {
    setEnv(undefined);
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'true';

    expect(isEncryptionDisabled()).toBe(false);
  });

  it('detects truthy values', () => {
    setEnv('TRUE');
    expect(isEncryptionDisabled()).toBe(true);
    setEnv('1');
    expect(isEncryptionDisabled()).toBe(true);
  });
});

describe('encryptOfflinePayload / decryptOfflinePayload', () => {
  const originalFlag = process.env[TEST_ONLY_OFFLINE_ENCRYPTION_DISABLE_ENV];

  beforeEach(async () => {
    await clearOfflineEncryptionKeys();
    setEnv('false');
  });

  afterEach(() => {
    setEnv(originalFlag);
    delete process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY;
    vi.restoreAllMocks();
  });

  it('encrypts and decrypts payload when enabled', async () => {
    const plaintext = JSON.stringify({ foo: 'bar' });

    const encrypted = await encryptOfflinePayload(plaintext);
    const parsed = JSON.parse(encrypted);

    expect(parsed.v).toBe(1);
    expect(parsed.algo).toBe('AES-256-GCM');
    expect(typeof parsed.iv).toBe('string');
    expect(typeof parsed.tag).toBe('string');
    expect(typeof parsed.ct).toBe('string');
    expect(encrypted).not.toContain('foo');

    const decrypted = await decryptOfflinePayload(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('rejects a tampered AES-GCM envelope', async () => {
    const encrypted = await encryptOfflinePayload(JSON.stringify({ marker: 'authenticated' }));
    const envelope = JSON.parse(encrypted) as { tag: string };
    envelope.tag = `${envelope.tag.startsWith('A') ? 'B' : 'A'}${envelope.tag.slice(1)}`;

    await expect(decryptOfflinePayload(JSON.stringify(envelope))).rejects.toBeInstanceOf(OfflineDecryptionError);
  });

  it('returns plaintext unchanged when encryption is disabled', async () => {
    setEnv('true');
    const plaintext = JSON.stringify({ hello: 'world' });

    const encrypted = await encryptOfflinePayload(plaintext);
    expect(encrypted).toBe(plaintext);

    const decrypted = await decryptOfflinePayload(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('ignores EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY and still generates a runtime key', async () => {
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY = 'public-should-be-ignored';
    const randomKeyBytes = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
    vi.spyOn(Crypto, 'getRandomBytesAsync').mockImplementation(async (length: number) => randomKeyBytes.slice(0, length));

    await encryptOfflinePayload(JSON.stringify({ secure: true }));

    expect(Crypto.getRandomBytesAsync).toHaveBeenCalledWith(32);
  });

  it('keeps compatibility with payload encryption helpers', async () => {
    const plaintext = 'hola mundo';

    const cipher = await encryptPayload(plaintext);
    expect(cipher).not.toBe(plaintext);

    const decoded = await decryptPayload(cipher);
    expect(decoded).toBe(plaintext);
  });
});

