import CryptoJS from 'crypto-js';
import * as Crypto from 'expo-crypto';
import { gcm } from '@noble/ciphers/aes.js';
import { sha256 } from 'js-sha256';
import { Buffer } from 'buffer';

import {
  decryptPayload as decryptNewPayload,
  encryptPayload as encryptNewPayload,
  getOrCreateEncryptionKey,
  isPayloadEncrypted,
} from '../security/crypto';
import { secureDeleteItem, secureGetItem, secureSetItem } from '../security/secure-storage';

const AES_GCM_ALGO = 'AES-256-GCM' as const;

export interface EncryptedEnvelopeV1 {
  v: 1;
  algo: typeof AES_GCM_ALGO;
  iv: string;
  tag: string;
  ct: string;
}

export class OfflineDecryptionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'OfflineDecryptionError';
    if (cause) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export function isEncryptionDisabled(): boolean {
  const flag = process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED;
  if (!flag) return false;
  return flag === '1' || flag.toLowerCase() === 'true';
}

const OFFLINE_KEY_STORAGE = 'handover_offline_encryption_key_v1';
const GCM_KEY_SIZE = 32;
const GCM_IV_SIZE = 12;
let cachedOfflineKey: Uint8Array | null = null;

async function sha256Bytes(input: Uint8Array | string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const data = typeof input === 'string' ? encoder.encode(input) : input;
  const hashed = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, toArrayBuffer(data));
  if (typeof hashed === 'string') {
    const fromHex = Buffer.from(hashed, 'hex');
    if (fromHex.length === GCM_KEY_SIZE) return new Uint8Array(fromHex);
    const asBase64 = Buffer.from(hashed, 'base64');
    if (asBase64.length > 0) return new Uint8Array(asBase64).slice(0, GCM_KEY_SIZE);
    return encoder.encode(hashed).slice(0, GCM_KEY_SIZE);
  }
  return hashed instanceof Uint8Array ? hashed : new Uint8Array(hashed);
}

function toBase64(buffer: ArrayBuffer | Uint8Array): string {
  return Buffer.from(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer).toString('base64');
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function fromBase64(base64: string): Uint8Array {
  try {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  } catch {
    return new Uint8Array();
  }
}

async function persistOfflineKey(bytes: Uint8Array): Promise<void> {
  const base64 = toBase64(bytes);
  try {
    await secureSetItem(OFFLINE_KEY_STORAGE, base64);
  } catch {
  }
}

async function deriveKeyBytes(): Promise<Uint8Array> {
  if (cachedOfflineKey?.length === GCM_KEY_SIZE) return cachedOfflineKey;

  try {
    const stored = await secureGetItem(OFFLINE_KEY_STORAGE);
    if (stored) {
      const decoded = fromBase64(stored);
      if (decoded.length === GCM_KEY_SIZE) {
        cachedOfflineKey = decoded;
        return decoded;
      }
    }
  } catch {
  }

  const rawKey = process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY;
  let keyBytes: Uint8Array;
  if (rawKey) {
    keyBytes = await sha256Bytes(rawKey);
  } else {
    keyBytes = await Crypto.getRandomBytesAsync(GCM_KEY_SIZE);
  }

  if (keyBytes.length !== GCM_KEY_SIZE) {
    keyBytes = (await sha256Bytes(keyBytes)).slice(0, GCM_KEY_SIZE);
  }

  if (keyBytes.length !== GCM_KEY_SIZE) {
    keyBytes = await Crypto.getRandomBytesAsync(GCM_KEY_SIZE);
  }

  await persistOfflineKey(keyBytes);
  cachedOfflineKey = keyBytes;
  return keyBytes;
}

function ensurePlaintext(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  return JSON.stringify(payload ?? null);
}

export async function encryptOfflinePayload(plaintext: unknown): Promise<string> {
  if (isEncryptionDisabled()) {
    return ensurePlaintext(plaintext);
  }

  const keyBytes = await deriveKeyBytes();
  const iv = await Crypto.getRandomBytesAsync(GCM_IV_SIZE);
  const encoder = new TextEncoder();
  const data = encoder.encode(ensurePlaintext(plaintext));
  const cipher = gcm(keyBytes, iv);
  const cipherBytes = cipher.encrypt(data);
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

function tryParseEncryptedEnvelope(stored: string): EncryptedEnvelopeV1 | null {
  try {
    const parsed = JSON.parse(stored);
    if (isEnvelopeV1(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

async function decryptEnvelope(envelope: EncryptedEnvelopeV1): Promise<string> {
  const keyBytes = await deriveKeyBytes();
  const iv = fromBase64(envelope.iv);
  const ctBytes = fromBase64(envelope.ct);
  const tagBytes = envelope.tag ? fromBase64(envelope.tag) : new Uint8Array();

  const combined = new Uint8Array(ctBytes.length + tagBytes.length);
  combined.set(ctBytes, 0);
  combined.set(tagBytes, ctBytes.length);

  try {
    const cipher = gcm(keyBytes, iv);
    const decryptedBytes = cipher.decrypt(combined);
    const decoder = new TextDecoder();
    return decoder.decode(decryptedBytes);
  } catch (error) {
    throw new OfflineDecryptionError('Failed to decrypt offline payload', error);
  }
}

export async function decryptOfflinePayload(stored: string): Promise<string> {
  const envelope = tryParseEncryptedEnvelope(stored);
  if (!envelope) {
    return stored;
  }

  return decryptEnvelope(envelope);
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

export async function clearOfflineEncryptionKeys(): Promise<void> {
  cachedOfflineKey = null;
  cachedLegacyKey = null;
  await Promise.allSettled([
    secureDeleteItem(OFFLINE_KEY_STORAGE),
    secureDeleteItem(LEGACY_QUEUE_KEY),
  ]);
}

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
  } catch {
  }
  return null;
}

async function persistLegacyKey(key: string): Promise<void> {
  try {
    await secureSetItem(LEGACY_QUEUE_KEY, key);
  } catch {
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
  if (isEncryptionDisabled()) {
    return plaintext;
  }
  if (payloadIsEncrypted(plaintext)) return plaintext;
  return encryptNewPayload(plaintext);
}

export async function decryptPayload(ciphertext: string): Promise<string> {
  const encryptionDisabled = isEncryptionDisabled();
  if (encryptionDisabled && !payloadIsEncrypted(ciphertext)) {
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

  const decrypted = await decryptNewPayload(ciphertext);
  return typeof decrypted === 'string' ? decrypted : JSON.stringify(decrypted);
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
  const encryptionDisabledAndPlain = isEncryptionDisabled() && !payloadIsEncrypted(ciphertext);
  if (encryptionDisabledAndPlain) {
    return ciphertext;
  }
  return decryptPayload(ciphertext);
}

export { getOrCreateEncryptionKey };
