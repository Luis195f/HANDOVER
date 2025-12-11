import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  decryptOfflinePayload,
  encryptOfflinePayload,
  isEncryptionDisabled,
} from '../../src/lib/crypto';

function setEnv(disabled: string | undefined, key?: string): void {
  process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = disabled;
  if (key !== undefined) {
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY = key;
  }
}

describe('offline encryption feature flag', () => {
  const originalFlag = process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED;
  const originalKey = process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY;

  afterEach(() => {
    setEnv(originalFlag, originalKey);
  });

  it('returns false by default', () => {
    setEnv(undefined);
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
  const originalFlag = process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED;
  const originalKey = process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY;

  beforeEach(() => {
    setEnv('false', 'test-secret-key');
  });

  afterEach(() => {
    setEnv(originalFlag, originalKey);
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

  it('returns plaintext unchanged when encryption is disabled', async () => {
    setEnv('true', 'test-secret-key');
    const plaintext = JSON.stringify({ hello: 'world' });

    const encrypted = await encryptOfflinePayload(plaintext);
    expect(encrypted).toBe(plaintext);

    const decrypted = await decryptOfflinePayload(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('keeps compatibility with plain JSON payloads when enabled', async () => {
    const plaintext = JSON.stringify({ legacy: true });

    const decrypted = await decryptOfflinePayload(plaintext);
    expect(decrypted).toBe(plaintext);
  });
});
