// src/security/crypto.ts
import * as SecureStore from "expo-secure-store";
import { warn } from "@/src/lib/otel";

type SignOptions = {
  queueId?: string;
  signerId?: string;
};

type SignResult<T> = {
  signed: boolean;
  bundle: T;
};

const KEY_PRIMARY = "handover_local_crypto_key";
const KEY_V1 = "handover_encryption_key_v1";

// cache en memoria por ejecución
let cachedKey: string | null = null;

function isTruthyEnv(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

function getWebCrypto(): Crypto | undefined {
  try {
    const c = (globalThis as any).crypto as Crypto | undefined;
    if (!c || !(c as any).subtle) return undefined;
    return c;
  } catch {
    return undefined;
  }
}

function hasWebCrypto(): boolean {
  return !!getWebCrypto();
}

function toUint8(input: ArrayBuffer): Uint8Array {
  return new Uint8Array(input);
}

function b64encode(bytes: Uint8Array): string {
  // Node / Jest/Vitest
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B: any = (globalThis as any).Buffer;
  if (typeof B !== "undefined") {
    return B.from(bytes).toString("base64");
  }
  // Browser/RN (si existe btoa)
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const btoaFn: any = (globalThis as any).btoa;
  if (typeof btoaFn !== "function") {
    throw new Error("BASE64_NOT_AVAILABLE");
  }
  return btoaFn(bin);
}

function b64decode(s: string): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B: any = (globalThis as any).Buffer;
  if (typeof B !== "undefined") {
    return new Uint8Array(B.from(s, "base64"));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const atobFn: any = (globalThis as any).atob;
  if (typeof atobFn !== "function") {
    throw new Error("BASE64_NOT_AVAILABLE");
  }
  const bin = atobFn(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(len: number): Uint8Array {
  const wc = getWebCrypto();
  if (!wc?.getRandomValues) {
    // En el repo real puede haber otra fuente de random; para este test/CI basta con WebCrypto.
    throw new Error("WEBCRYPTO_RANDOM_UNAVAILABLE");
  }
  const out = new Uint8Array(len);
  wc.getRandomValues(out);
  return out;
}

export async function getOrCreateEncryptionKey(): Promise<string> {
  if (cachedKey) return cachedKey;

  const existingPrimary = await SecureStore.getItemAsync(KEY_PRIMARY);
  if (typeof existingPrimary === "string" && existingPrimary.length > 0) {
    cachedKey = existingPrimary;
    return existingPrimary;
  }

  const existingV1 = await SecureStore.getItemAsync(KEY_V1);
  if (typeof existingV1 === "string" && existingV1.length > 0) {
    cachedKey = existingV1;
    return existingV1;
  }

  // Genera clave (32 bytes) y guárdala como base64
  const key = b64encode(randomBytes(32));

  let persisted = false;

  // Intento 1: slot “primary” (best-effort)
  try {
    await SecureStore.setItemAsync(KEY_PRIMARY, key);
    persisted = true;
  } catch {
    // ignore: probamos fallback
  }

  // Intento 2: slot v1 (fallback / compat)
  try {
    await SecureStore.setItemAsync(KEY_V1, key);
    persisted = true;
  } catch {
    // ignore
  }

  if (!persisted) {
    throw new Error("ENCRYPTION_KEY_PERSIST_FAILED");
  }

  cachedKey = key;
  return key;
}

async function importAesKey(rawKeyB64: string): Promise<CryptoKey> {
  const wc = getWebCrypto();
  if (!wc?.subtle) throw new Error("WEBCRYPTO_UNAVAILABLE");
  const raw = b64decode(rawKeyB64);
  return wc.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptPayload(plain: string): Promise<string> {
  const wc = getWebCrypto();
  if (!wc?.subtle) throw new Error("WEBCRYPTO_UNAVAILABLE");

  const keyB64 = await getOrCreateEncryptionKey();
  const key = await importAesKey(keyB64);

  const iv = randomBytes(12);
  const encoded = new TextEncoder().encode(plain);

  const cipherBuf = await wc.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  const payload = {
    iv: b64encode(iv),
    ct: b64encode(toUint8(cipherBuf)),
  };

  // Formato v1 esperado por tests
  return `v1:${b64encode(new TextEncoder().encode(JSON.stringify(payload)))}`;
}

export async function decryptPayload(input: string): Promise<string> {
  // legacy sin prefijo
  if (!input.startsWith("v1:")) return input;

  const wc = getWebCrypto();
  if (!wc?.subtle) throw new Error("WEBCRYPTO_UNAVAILABLE");

  const b64 = input.slice(3);
  const decodedJson = new TextDecoder().decode(b64decode(b64));
  const parsed = JSON.parse(decodedJson) as { iv: string; ct: string };

  const iv = b64decode(parsed.iv);
  const ct = b64decode(parsed.ct);

  const keyB64 = await getOrCreateEncryptionKey();
  const key = await importAesKey(keyB64);

  const plainBuf = await wc.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(new Uint8Array(plainBuf));
}

export async function signBundleIfEnabled<T extends Record<string, any>>(
  bundle: T,
  opts: SignOptions = {}
): Promise<SignResult<T>> {
  const enabled = isTruthyEnv(process.env.EXPO_PUBLIC_CLIENT_SIGNING_ENABLED);
  if (!enabled) return { signed: false, bundle };

  const runtimeHasWebCrypto = hasWebCrypto();

  // ESTE es el fix que tu test exige
  if (!runtimeHasWebCrypto) {
    warn(
      "HNDR_SIGN_110",
      "WebCrypto unavailable; skipping signature.",
      { queueId: opts.queueId, runtimeHasWebCrypto: false }
    );
    return { signed: false, bundle };
  }

  const wc = getWebCrypto()!;
  const signerId = opts.signerId ?? "unknown";

  // Firma simple (ECDSA P-256) del JSON del bundle
  const data = new TextEncoder().encode(JSON.stringify(bundle));

  const keyPair = await wc.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const sigBuf = await wc.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    data
  );

  const signature = {
    when: new Date().toISOString(),
    who: { identifier: { value: signerId } },
    data: b64encode(new Uint8Array(sigBuf)),
  };

  // NO mutar el bundle original
  const next = { ...bundle, signature } as T;

  return { signed: true, bundle: next };
}
