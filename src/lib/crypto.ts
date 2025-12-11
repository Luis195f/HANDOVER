import CryptoJS from 'crypto-js';
import * as ExpoCrypto from 'expo-crypto';
import { sha256 } from 'js-sha256';

import {
  decryptPayload as decryptNewPayload,
  encryptPayload as encryptNewPayload,
  getOrCreateEncryptionKey,
  isPayloadEncrypted,
} from '../security/crypto';
import { secureGetItem, secureSetItem } from '../security/secure-storage';

const AES_GCM_ALGO = 'AES-256-GCM' as const;

export interface EncryptedEnvelopeV1 {
  v: 1;
  algo: typeof AES_GCM_ALGO;
  iv: string;
  tag: string;
  ct: string;
}

export class OfflineDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfflineDecryptionError';
  }
}

export function isEncryptionDisabled(): boolean {
  const flag = process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED;
  if (!flag) return false;
  return flag === '1' || flag.toLowerCase() === 'true';
}

async function deriveKey(): Promise<CryptoKey> {
  const rawKey = process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error('Missing EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY for offline encryption');
  }

  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(rawKey);
  const hashed = await ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, keyBytes);
  const hashedBytes = Uint8Array.from(Buffer.from(hashed, 'hex'));
  const crypto = getCrypto();
  return crypto.subtle.importKey('raw', hashedBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function toBase64(buffer: ArrayBuffer | Uint8Array): string {
  return Buffer.from(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer).toString('base64');
}

function fromBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

function getCrypto(): Crypto {
  const crypto = globalThis.crypto;
  if (!crypto || !crypto.subtle) {
    throw new Error('WebCrypto API is not available for offline encryption');
  }
  return crypto;
}

export async function encryptOfflinePayload(plaintextJson: string): Promise<string> {
  if (isEncryptionDisabled()) {
    return plaintextJson;
  }

  const crypto = getCrypto();
  const key = await deriveKey();
  const iv = await ExpoCrypto.getRandomBytesAsync(12);
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintextJson);
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const cipherBytes = new Uint8Array(cipherBuffer);
  const tagBytes = cipherBytes.slice(cipherBytes.length - 16);
  const ctBytes = cipherBytes.slice(0, cipherBytes.length - 16);

  const envelope: EncryptedEnvelopeV1 = {
    v: 1,
    algo: AES_GCM_ALGO,
    iv: toBase64(iv),
    tag: toBase64(tagBytes),
    ct: toBase64(ctBytes),
  };

  return JSON.stringify(envelope);
}

function isEnvelopeV1(input: unknown): input is EncryptedEnvelopeV1 {
  if (!input || typeof input !== 'object') return false;
  const candidate = input as Partial<EncryptedEnvelopeV1>;
  return (
    candidate.v === 1 &&
    candidate.algo === AES_GCM_ALGO &&
    typeof candidate.iv === 'string' &&
    typeof candidate.tag === 'string' &&
    typeof candidate.ct === 'string'
  );
}

export async function decryptOfflinePayload(stored: string): Promise<string> {
  if (isEncryptionDisabled()) {
    return stored;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (error) {
    return stored;
  }

  if (!isEnvelopeV1(parsed)) {
    return stored;
  }

  const crypto = getCrypto();
  const key = await deriveKey();

  const iv = fromBase64(parsed.iv);
  const tag = fromBase64(parsed.tag);
  const ct = fromBase64(parsed.ct);
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct, 0);
  combined.set(tag, ct.length);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);
    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (error) {
    throw new OfflineDecryptionError('Failed to decrypt offline payload');
  }
}

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
