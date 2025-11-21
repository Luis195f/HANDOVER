// BEGIN HANDOVER_SECURE_STORAGE
import { sha256 } from 'js-sha256';

import { secureGetItem, secureSetItem } from './secure-storage';

const KEY_ID = 'handover_local_crypto_key';
const VERSION_AES_GCM = 'v1';
const VERSION_FALLBACK = 'v0';
const UTF8_ENCODER = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const UTF8_DECODER = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

let cachedKey: string | null = null;

function getCrypto(): Crypto | null {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    return globalThis.crypto as Crypto;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { webcrypto } = require('node:crypto');
    return (webcrypto ?? null) as Crypto | null;
  } catch {
    return null;
  }
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  const binary = Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join('');
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  throw new Error('Base64 encoding is not supported in this environment');
}

function decodeBase64(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(base64, 'base64'));
  }
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  throw new Error('Base64 decoding is not supported in this environment');
}

function getRandomBytes(length: number): Uint8Array {
  const crypto = getCrypto();
  const buffer = new Uint8Array(length);
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(buffer);
    return buffer;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { randomBytes } = require('node:crypto');
    return randomBytes(length) as Uint8Array;
  } catch {
    for (let i = 0; i < length; i += 1) {
      buffer[i] = Math.floor(Math.random() * 256);
    }
    return buffer;
  }
}

function toUtf8Bytes(text: string): Uint8Array {
  if (UTF8_ENCODER) return UTF8_ENCODER.encode(text);
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8');
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i);
  }
  return bytes;
}

function fromUtf8Bytes(bytes: Uint8Array): string {
  if (UTF8_DECODER) return UTF8_DECODER.decode(bytes);
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('utf8');
  let text = '';
  for (let i = 0; i < bytes.length; i += 1) {
    text += String.fromCharCode(bytes[i]);
  }
  return text;
}

async function getOrCreateKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const existing = await secureGetItem(KEY_ID);
  if (existing) {
    cachedKey = existing;
    return existing;
  }
  const keyBytes = getRandomBytes(32);
  const keyBase64 = encodeBase64(keyBytes);
  await secureSetItem(KEY_ID, keyBase64);
  cachedKey = keyBase64;
  return keyBase64;
}

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey | null> {
  const crypto = getCrypto();
  if (!crypto?.subtle) return null;
  try {
    return await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
  } catch {
    return null;
  }
}

function deriveFallbackStream(key: Uint8Array, iv: Uint8Array, length: number): Uint8Array {
  const digestInput = new Uint8Array(key.length + iv.length);
  digestInput.set(key);
  digestInput.set(iv, key.length);
  const hash = sha256.arrayBuffer(digestInput) as ArrayBuffer;
  const seed = new Uint8Array(hash);
  const stream = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    stream[i] = seed[i % seed.length] ^ key[i % key.length] ^ iv[i % iv.length];
  }
  return stream;
}

function xorBytes(data: Uint8Array, keyStream: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    result[i] = data[i] ^ keyStream[i % keyStream.length];
  }
  return result;
}

export async function encryptPayload(json: unknown): Promise<string> {
  const serialized = JSON.stringify(json ?? null);
  const keyBase64 = await getOrCreateKey();
  const keyBytes = decodeBase64(keyBase64);
  const crypto = getCrypto();
  const iv = getRandomBytes(12);

  const aesKey = await importAesKey(keyBytes);
  if (aesKey && crypto?.subtle) {
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, toUtf8Bytes(serialized));
    return `${VERSION_AES_GCM}:${encodeBase64(iv)}:${encodeBase64(new Uint8Array(encrypted))}`;
  }

  const stream = deriveFallbackStream(keyBytes, iv, serialized.length);
  const cipher = xorBytes(toUtf8Bytes(serialized), stream);
  return `${VERSION_FALLBACK}:${encodeBase64(iv)}:${encodeBase64(cipher)}`;
}

function parseCipher(cipher: string): { version: string; iv: Uint8Array; data: Uint8Array } | null {
  const parts = cipher.split(':');
  if (parts.length !== 3) return null;
  const [version, ivPart, dataPart] = parts;
  if (!version || !ivPart || !dataPart) return null;
  return { version, iv: decodeBase64(ivPart), data: decodeBase64(dataPart) };
}

export async function decryptPayload(cipher: string): Promise<unknown> {
  if (!cipher) throw new Error('EMPTY_CIPHER');
  const parsed = parseCipher(cipher);
  if (!parsed) {
    return JSON.parse(cipher);
  }

  const keyBase64 = await getOrCreateKey();
  const keyBytes = decodeBase64(keyBase64);

  if (parsed.version === VERSION_AES_GCM) {
    const crypto = getCrypto();
    const aesKey = await importAesKey(keyBytes);
    if (!aesKey || !crypto?.subtle) throw new Error('DECRYPT_UNAVAILABLE');
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: parsed.iv }, aesKey, parsed.data);
    return JSON.parse(fromUtf8Bytes(new Uint8Array(decrypted)));
  }

  if (parsed.version === VERSION_FALLBACK) {
    const stream = deriveFallbackStream(keyBytes, parsed.iv, parsed.data.length);
    const plainBytes = xorBytes(parsed.data, stream);
    return JSON.parse(fromUtf8Bytes(plainBytes));
  }

  throw new Error('UNSUPPORTED_CIPHER_VERSION');
}
// END HANDOVER_SECURE_STORAGE
