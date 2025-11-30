import CryptoJS from 'crypto-js';
import { sha256 } from 'js-sha256';

import { decryptPayload as decryptNewPayload, encryptPayload as encryptNewPayload, getOrCreateEncryptionKey, isPayloadEncrypted } from '../security/crypto';
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

const LEGACY_QUEUE_KEY = 'handover_offline_queue_key';
export const ENCRYPTION_PREFIX = 'v1:';
export const LEGACY_ENCRYPTION_PREFIX = 'enc:v1:';
export const OFFLINE_ENCRYPTION_DISABLED = process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED === 'true';

let cachedLegacyKey: string | null = null;

function generateLegacyKey(): string {
  const randomBytes = CryptoJS.lib.WordArray.random(32);
  return CryptoJS.enc.Base64.stringify(randomBytes);
}

async function readLegacyKey(): Promise<string | null> {
  if (cachedLegacyKey) return cachedLegacyKey;
  try {
    const stored = await secureGetItem(LEGACY_QUEUE_KEY);
    if (stored) {
      cachedLegacyKey = stored;
      return stored;
    }
  } catch (error) {
    console.warn('No se pudo leer la clave de cifrado offline legacy', error);
  }
  return null;
}

async function persistLegacyKey(key: string): Promise<void> {
  try {
    await secureSetItem(LEGACY_QUEUE_KEY, key);
  } catch (error) {
    console.warn('No se pudo persistir la clave de cifrado offline legacy', error);
  }
}

async function getOrCreateLegacyKey(): Promise<string> {
  const existing = await readLegacyKey();
  if (existing) return existing;
  const key = generateLegacyKey();
  await persistLegacyKey(key);
  cachedLegacyKey = key;
  return key;
}

function decryptLegacyPayload(ciphertext: string): string {
  const raw = ciphertext.slice(LEGACY_ENCRYPTION_PREFIX.length);
  const key = cachedLegacyKey;
  if (!key) {
    throw new Error('No se encontró la clave legacy para descifrar.');
  }
  const bytes = CryptoJS.AES.decrypt(raw, key);
  const decrypted = bytes.toString(CryptoJS.enc.Utf8);
  if (!decrypted) {
    throw new Error('No se pudo descifrar el payload offline legacy.');
  }
  return decrypted;
}

export function payloadIsEncrypted(payload: unknown): payload is string {
  return typeof payload === 'string' && (payload.startsWith(ENCRYPTION_PREFIX) || payload.startsWith(LEGACY_ENCRYPTION_PREFIX));
}

export async function encryptPayload(plaintext: string): Promise<string> {
  if (OFFLINE_ENCRYPTION_DISABLED) {
    return plaintext;
  }
  if (payloadIsEncrypted(plaintext)) return plaintext;
  return encryptNewPayload(plaintext);
}

export async function decryptPayload(ciphertext: string): Promise<string> {
  if (OFFLINE_ENCRYPTION_DISABLED && !payloadIsEncrypted(ciphertext)) {
    return ciphertext;
  }

  if (ciphertext.startsWith(LEGACY_ENCRYPTION_PREFIX)) {
    if (!cachedLegacyKey) {
      await getOrCreateLegacyKey();
    }
    return decryptLegacyPayload(ciphertext);
  }

  if (!ciphertext.startsWith(ENCRYPTION_PREFIX)) {
    return ciphertext;
  }

  return decryptNewPayload(ciphertext);
}

/**
 * Cifra borradores reutilizando la misma clave que la cola offline.
 * Si fallase el cifrado, el caller NO debería persistir datos sensibles en claro.
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
  const encryptionDisabledAndPlain = OFFLINE_ENCRYPTION_DISABLED && !payloadIsEncrypted(ciphertext);
  if (encryptionDisabledAndPlain) {
    return ciphertext;
  }
  return decryptPayload(ciphertext);
}

export { getOrCreateEncryptionKey };
