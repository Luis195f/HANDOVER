// BEGIN HANDOVER_SECURE_STORAGE
import CryptoJS from 'crypto-js';
import { Buffer } from 'buffer';

import { secureGetItem, secureSetItem } from './secure-storage';
import { warn } from "@/src/lib/otel";

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
    } catch {
      // ignore and try next slot
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

// ---------------------------------------------------------------------------
// Cliente: firma opcional de Bundles FHIR (ECDSA P-256 + SHA-256)
// ---------------------------------------------------------------------------

type SigningWarningMeta = Partial<{
  queueId: string;
  attempt: number;
  platform: string;
  appVersion: string;
  runtimeHasWebCrypto: boolean;
  errorName: string;
}>;

const CLIENT_SIGNING_KEY_STORAGE = 'handover_client_signing_keypair_v1';

const SIGNING_ENABLED_FLAG = process.env.EXPO_PUBLIC_CLIENT_SIGNING_ENABLED;

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function hasWebCrypto(): boolean {
  return typeof globalThis !== 'undefined' && !!globalThis.crypto?.subtle;
}

// ✅ FIX: antes estaba vacía. Ahora emite OTEL warn + fallback a console.warn (para tests / visibilidad).
function logSigningWarning(
  code: 'HNDR_SIGN_110' | 'HNDR_SIGN_120' | 'HNDR_SIGN_130',
  message: string,
  meta: SigningWarningMeta = {}
): void {
  try {
    warn(code, message, meta);
  } catch {
    // ignore (no queremos romper flujo clínico por logging)
  }

  try {
    // El test espera: 1er arg string que contenga HNDR_SIGN_110, 2do arg objeto meta
    console.warn(`${code} ${message}`, meta);
  } catch {
    // ignore
  }
}

export function isClientSigningEnabled(): boolean {
  return isTruthyFlag(SIGNING_ENABLED_FLAG);
}

function parseStoredKeypair(raw: string | null): { privateJwk: JsonWebKey; publicJwk: JsonWebKey } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { privateJwk?: JsonWebKey; publicJwk?: JsonWebKey };
    if (parsed && parsed.privateJwk && parsed.publicJwk) {
      return { privateJwk: parsed.privateJwk, publicJwk: parsed.publicJwk };
    }
  } catch {
    return null;
  }
  return null;
}

async function persistSigningKeypair(keypair: { privateJwk: JsonWebKey; publicJwk: JsonWebKey }): Promise<void> {
  const serialized = JSON.stringify({ privateJwk: keypair.privateJwk, publicJwk: keypair.publicJwk });
  await secureSetItem(CLIENT_SIGNING_KEY_STORAGE, serialized);
}

export async function getOrCreateClientSigningKeypair(): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey } | null> {
  if (!hasWebCrypto()) return null;

  const stored = await secureGetItem(CLIENT_SIGNING_KEY_STORAGE);
  const parsed = parseStoredKeypair(stored);
  if (parsed?.privateJwk && parsed?.publicJwk) {
    return parsed;
  }

  try {
    const generated = await globalThis.crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const [privateJwk, publicJwk] = await Promise.all([
      globalThis.crypto.subtle.exportKey('jwk', generated.privateKey),
      globalThis.crypto.subtle.exportKey('jwk', generated.publicKey),
    ]);
    const keypair = { privateJwk, publicJwk };
    await persistSigningKeypair(keypair);
    return keypair;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cloneWithoutSignature<T extends Record<string, unknown>>(value: T): T {
  const copy = JSON.parse(JSON.stringify(value)) as T;
  if ('signature' in copy) {
    delete (copy as Record<string, unknown>).signature;
  }
  return copy;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        sorted[key] = canonicalize(value[key]);
      });
    return sorted;
  }
  return value;
}

function base64FromBuffer(buffer: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(buffer)).toString('base64');
}

type SignBundleMeta = SigningWarningMeta & { signerId?: string };

export async function signBundleIfEnabled<T extends Record<string, unknown>>(
  bundle: T,
  meta: SignBundleMeta = {}
): Promise<{ bundle: T; signed: boolean }> {
  if (!isClientSigningEnabled()) {
    return { bundle, signed: false };
  }

  if (!hasWebCrypto()) {
    logSigningWarning('HNDR_SIGN_110', 'WebCrypto unavailable; skipping signature.', {
      ...meta,
      runtimeHasWebCrypto: false,
    });
    return { bundle, signed: false };
  }

  if (!isRecord(bundle) || bundle.resourceType !== 'Bundle') {
    return { bundle, signed: false };
  }

  if ('signature' in bundle) {
    return { bundle, signed: false };
  }

  const keypair = await getOrCreateClientSigningKeypair();
  if (!keypair?.privateJwk) {
    logSigningWarning('HNDR_SIGN_120', 'Failed to generate client signing keypair; sending unsigned bundle.', {
      ...meta,
      runtimeHasWebCrypto: true,
      errorName: undefined,
    });
    return { bundle, signed: false };
  }

  try {
    const unsigned = cloneWithoutSignature(bundle);
    const canonical = canonicalize(unsigned);
    const canonicalJson = JSON.stringify(canonical);
    const encoder = new TextEncoder();
    const payload = encoder.encode(canonicalJson);

    const privateKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      keypair.privateJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await globalThis.crypto.subtle.sign(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      privateKey,
      payload
    );

    const signatureB64 = base64FromBuffer(signatureBuffer);

    const signature = {
      type: [
        {
          system: 'urn:iso-astm:E1762-95:2013',
          code: '1.2.840.10065.1.12.1.1',
          display: "Author's Signature",
        },
      ],
      when: new Date().toISOString(),
      who: meta.signerId ? { identifier: { value: meta.signerId } } : { identifier: { value: 'client' } },
      sigFormat: 'application/pkcs7-signature',
      data: signatureB64,
    };

    const signedBundle = { ...unsigned, signature } as T;
    return { bundle: signedBundle, signed: true };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : undefined;
    logSigningWarning('HNDR_SIGN_130', 'Failed to sign bundle on client; sending unsigned bundle.', {
      ...meta,
      runtimeHasWebCrypto: true,
      errorName,
    });
    return { bundle, signed: false };
  }
}

