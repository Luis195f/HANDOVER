// BEGIN HANDOVER_SECURE_STORAGE
import CryptoJS from 'crypto-js';

import { secureGetItem, secureSetItem } from './secure-storage';

const STORAGE_KEY = 'handover_encryption_key_v1';
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

export async function getOrCreateEncryptionKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  try {
    const stored = await secureGetItem(STORAGE_KEY);
    if (stored) {
      cachedKey = stored;
      return stored;
    }
    const nextKey = getRandomKeyBase64();
    await secureSetItem(STORAGE_KEY, nextKey);
    cachedKey = nextKey;
    return nextKey;
  } catch (error) {
    console.error('No se pudo acceder a SecureStore para la clave de cifrado.', error);
    throw new Error('No se pudo obtener la clave de cifrado.');
  }
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

export async function encryptPayload(plainText: string): Promise<string> {
  if (isPayloadEncrypted(plainText)) return plainText;
  const keyBase64 = await getOrCreateEncryptionKey();
  const key = CryptoJS.enc.Base64.parse(keyBase64);
  const iv = getIvWordArray();
  const encrypted = CryptoJS.AES.encrypt(plainText, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const ivBase64 = CryptoJS.enc.Base64.stringify(iv);
  const cipherBase64 = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  return `${PREFIX}${ivBase64}:${cipherBase64}`;
}

export async function decryptPayload(cipherText: string): Promise<string> {
  if (!isPayloadEncrypted(cipherText)) return cipherText;

  if (cipherText.startsWith(LEGACY_PREFIX)) {
    // Compatibilidad: devolvemos tal cual; el descifrado legacy ocurre en lib/crypto.
    return cipherText;
  }

  const parsed = parseNewFormat(cipherText);
  if (!parsed) {
    return cipherText;
  }

  const keyBase64 = await getOrCreateEncryptionKey();
  const key = CryptoJS.enc.Base64.parse(keyBase64);
  const decrypted = CryptoJS.AES.decrypt(parsed.cipher, key, {
    iv: parsed.iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const plain = decrypted.toString(CryptoJS.enc.Utf8);

  if (!plain && cipherText.startsWith(PREFIX)) {
    throw new Error('No se pudo descifrar el payload cifrado local.');
  }

  return plain;
}

export { isPayloadEncrypted };
// END HANDOVER_SECURE_STORAGE
