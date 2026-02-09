// src/types/noble-ciphers-compat.d.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

declare module '@noble/ciphers/aes.js' {
  export type AesGcmCipher = {
    encrypt(plaintext: Uint8Array, aad?: Uint8Array): Uint8Array;
    decrypt(ciphertext: Uint8Array, aad?: Uint8Array): Uint8Array;
  };

  // 👇 IMPORTANTE: 2 args, como tu mock: gcm(key, nonce/iv)
  export function gcm(key: Uint8Array, nonce: Uint8Array): AesGcmCipher;
}
