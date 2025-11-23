import CryptoJS from 'crypto-js';
import { sha256 } from 'js-sha256';

import { secureGetItem, secureSetItem } from '../security/secure-storage';

export function hashHex(input: string, len = 64): string {
  const hex = sha256(input);
  const L = Math.max(1, Math.min(len, hex.length));
  return hex.slice(0, L);
}

export function fhirId(prefix: string, input: string, maxLen = 64): string {
  const base = `${prefix}${hashHex(input, maxLen)}`;
  return base.slice(0, maxLen).replace(/[^A-Za-z0-9\-.]/g, '-');
}

const QUEUE_KEY_SECURESTORE_KEY = 'handover_offline_queue_key';
export const ENCRYPTION_PREFIX = 'enc:v1:';
export const OFFLINE_ENCRYPTION_DISABLED = process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED === 'true';

let cachedQueueKey: string | null = null;

function generateQueueKey(): string {
  const randomBytes = CryptoJS.lib.WordArray.random(32);
  return CryptoJS.enc.Base64.stringify(randomBytes);
}

async function readStoredQueueKey(): Promise<string | null> {
  try {
    return await secureGetItem(QUEUE_KEY_SECURESTORE_KEY);
  } catch (error) {
    console.warn('No se pudo leer la clave de cifrado offline desde SecureStore', error);
    return null;
  }
}

async function persistQueueKey(key: string): Promise<void> {
  try {
    await secureSetItem(QUEUE_KEY_SECURESTORE_KEY, key);
  } catch (error) {
    console.warn('No se pudo persistir la clave de cifrado offline en SecureStore', error);
  }
}

async function getOrCreateQueueKey(): Promise<string> {
  if (cachedQueueKey) return cachedQueueKey;

  const stored = await readStoredQueueKey();
  if (stored) {
    cachedQueueKey = stored;
    return stored;
  }

  const key = generateQueueKey();
  await persistQueueKey(key);
  cachedQueueKey = key;
  return key;
}

export async function encryptPayload(plaintext: string): Promise<string> {
  if (OFFLINE_ENCRYPTION_DISABLED) {
    return plaintext;
  }

  const key = await getOrCreateQueueKey();
  const encrypted = CryptoJS.AES.encrypt(plaintext, key).toString();
  return `${ENCRYPTION_PREFIX}${encrypted}`;
}

export async function decryptPayload(ciphertext: string): Promise<string> {
  if (OFFLINE_ENCRYPTION_DISABLED) {
    return ciphertext;
  }

  if (!ciphertext.startsWith(ENCRYPTION_PREFIX)) {
    return ciphertext;
  }

  const key = await getOrCreateQueueKey();
  const raw = ciphertext.slice(ENCRYPTION_PREFIX.length);
  const bytes = CryptoJS.AES.decrypt(raw, key);
  const decrypted = bytes.toString(CryptoJS.enc.Utf8);

  if (!decrypted) {
    throw new Error('No se pudo descifrar el payload offline.');
  }

  return decrypted;
}

/**
 * Cifra borradores reutilizando la misma clave que la cola offline.
 */
export async function encryptDraft(plaintext: string): Promise<string> {
  return encryptPayload(plaintext);
}

/**
 * Descifra borradores reutilizando la misma clave que la cola offline. Si el
 * cifrado está desactivado pero el valor tiene prefijo, igualmente se intenta
 * descifrar para mantener compatibilidad.
 */
export async function decryptDraft(ciphertext: string): Promise<string> {
  const encryptionDisabledAndPlain = OFFLINE_ENCRYPTION_DISABLED && !ciphertext.startsWith(ENCRYPTION_PREFIX);
  if (encryptionDisabledAndPlain) {
    return ciphertext;
  }

  if (!ciphertext.startsWith(ENCRYPTION_PREFIX)) {
    return ciphertext;
  }

  const key = await getOrCreateQueueKey();
  const raw = ciphertext.slice(ENCRYPTION_PREFIX.length);
  const bytes = CryptoJS.AES.decrypt(raw, key);
  const decrypted = bytes.toString(CryptoJS.enc.Utf8);

  if (!decrypted) {
    throw new Error('No se pudo descifrar el payload offline.');
  }

  return decrypted;
}
