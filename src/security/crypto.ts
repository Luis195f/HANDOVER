// BEGIN HANDOVER_SECURE_STORAGE
import CryptoJS from 'crypto-js';

import { secureGetItem, secureSetItem } from './secure-storage';

const STORAGE_KEYS = ['handover_local_crypto_key', 'handover_encryption_key_v1'] as const;
const VERSION_TAG = 'v1';
const PREFIX = `${VERSION_TAG}:`;
const LEGACY_PREFIX = 'enc:v1:'; // compatibilidad con versiones previas

let cachedKey: string | null = null;

function getRandomKeyBase64(): string {
  const randomBytes = CryptoJS.lib.WordArray.random(32);
  return CryptoJS.enc.Base64.stringify(randomBytes);
}

function getIvWordArray(): CryptoJS.lib.WordArray {
  return CryptoJS.lib.WordArray.random(16);
}

function isPayloadEncrypted(payload: string): boolean {
  return typeof payload === 'string' && (payload.startsWith(PREFIX) || payload.startsWith(LEGACY_PREFIX));
}

function normalizeKey(keyBase64: string | null): CryptoJS.lib.WordArray | null {
  if (!keyBase64) return null;
  try {
    const parsed = CryptoJS.enc.Base64.parse(keyBase64);
    const bytes = parsed.sigBytes;
    if (bytes === 16 || bytes === 24 || bytes === 32) return parsed;
  } catch {
    // swallow to regenerate
  }
  return null;
}

async function persistKey(base64: string): Promise<void> {
  let persisted = 0;
  let lastError: unknown;
  for (const storageKey of STORAGE_KEYS) {
    try {
      await secureSetItem(storageKey, base64);
      persisted += 1;
    } catch (error) {
      lastError = error;
      console.warn(`No se pudo persistir la clave de cifrado (${storageKey}).`, error);
    }
  }

  if (persisted === 0) {
    const error = new Error('ENCRYPTION_KEY_PERSIST_FAILED');
    if (lastError !== undefined) {
      (error as Error & { cause?: unknown }).cause = lastError;
    }
    throw error;
  }

  cachedKey = base64;
}

async function readStoredKey(): Promise<string | null> {
  for (const storageKey of STORAGE_KEYS) {
    try {
      const stored = await secureGetItem(storageKey);
      if (stored) return stored;
    } catch (error) {
      console.warn(`No se pudo leer la clave de cifrado (${storageKey}).`, error);
    }
  }
  return null;
}

export async function getOrCreateEncryptionKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const stored = await readStoredKey();
  const normalizedStored = normalizeKey(stored);
  if (normalizedStored) {
    const key = CryptoJS.enc.Base64.stringify(normalizedStored);
    cachedKey = key;
    return key;
  }

  if (stored) {
    console.warn('Clave de cifrado inválida, regenerando un nuevo valor.');
  }

  const nextKey = getRandomKeyBase64();
  await persistKey(nextKey);
  cachedKey = nextKey;
  return nextKey;
}

function parseNewFormat(cipherText: string): { iv: CryptoJS.lib.WordArray; cipher: CryptoJS.lib.CipherParams } | null {
  if (!cipherText.startsWith(PREFIX)) return null;
  const [, ivPart, cipherPart] = cipherText.split(':');
  if (!ivPart || !cipherPart) return null;
  return {
    iv: CryptoJS.enc.Base64.parse(ivPart),
    cipher: CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(cipherPart) }),
  };
}

const WRAPPER_FLAG = '__handover_payload__';

function wrapPayload(input: unknown): string {
  if (typeof input === 'string') return input;
  return JSON.stringify({ [WRAPPER_FLAG]: true, value: input });
}

function unwrapPayload(input: string): unknown {
  try {
    const parsed = JSON.parse(input) as { [WRAPPER_FLAG]?: unknown; value?: unknown };
    if (parsed && typeof parsed === 'object' && parsed[WRAPPER_FLAG]) {
      return 'value' in parsed ? parsed.value : null;
    }
  } catch {
    return input;
  }
  return input;
}

export async function encryptPayload(plainText: unknown): Promise<string> {
  const serialized = wrapPayload(plainText);
  if (isPayloadEncrypted(serialized)) return serialized;

  const keyBase64 = await getOrCreateEncryptionKey();
  const key = normalizeKey(keyBase64) ?? CryptoJS.enc.Base64.parse(getRandomKeyBase64());
  const iv = getIvWordArray();
  const encrypted = CryptoJS.AES.encrypt(serialized, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const ivBase64 = CryptoJS.enc.Base64.stringify(iv);
  const cipherBase64 = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  return `${PREFIX}${ivBase64}:${cipherBase64}`;
}

export async function decryptPayload(cipherText: string): Promise<unknown> {
  if (!isPayloadEncrypted(cipherText)) return unwrapPayload(cipherText);

  if (cipherText.startsWith(LEGACY_PREFIX)) {
    // Compatibilidad: devolvemos tal cual; el descifrado legacy ocurre en lib/crypto.
    return cipherText;
  }

  const parsed = parseNewFormat(cipherText);
  if (!parsed) {
    return cipherText;
  }

  const keyBase64 = await getOrCreateEncryptionKey();
  const key = normalizeKey(keyBase64) ?? CryptoJS.enc.Base64.parse(getRandomKeyBase64());
  const decrypted = CryptoJS.AES.decrypt(parsed.cipher, key, {
    iv: parsed.iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const plain = decrypted.toString(CryptoJS.enc.Utf8);

  if (!plain && cipherText.startsWith(PREFIX)) {
    throw new Error('No se pudo descifrar el payload cifrado local.');
  }

  return unwrapPayload(plain);
}

export { isPayloadEncrypted };
// END HANDOVER_SECURE_STORAGE
