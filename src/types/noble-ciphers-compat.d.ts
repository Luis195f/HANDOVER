// src/types/noble-ciphers-compat.d.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Compat typings for @noble/ciphers subpath imports used in this repo.
 * Compile-time only. Runtime behavior is unchanged.
 *
 * This matches the API shape used by current @noble/ciphers versions:
 *   const cipher = gcm(key);
 *   const ct = cipher.encrypt(nonce, plaintext, aad?);
 *   const pt = cipher.decrypt(nonce, ciphertext, aad?);
 */

declare module '@noble/ciphers/aes.js' {
  export type AesGcmCipher = {
    encrypt(nonce: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array;
    decrypt(nonce: Uint8Array, ciphertext: Uint8Array, aad?: Uint8Array): Uint8Array;
  };

  export function gcm(key: Uint8Array): AesGcmCipher;
}

// Opcional: si en algún sitio importas sin ".js", puedes cubrirlo también.
// Si NO lo importas, lo puedes borrar.
declare module '@noble/ciphers/aes' {
  export type AesGcmCipher = {
    encrypt(nonce: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array;
    decrypt(nonce: Uint8Array, ciphertext: Uint8Array, aad?: Uint8Array): Uint8Array;
  };

  export function gcm(key: Uint8Array): AesGcmCipher;
}
