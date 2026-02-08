/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Compat typings for @noble/ciphers AES-GCM.
 * Only for TypeScript – runtime comes from the real package.
 *
 * This project uses the "factory with nonce" call style:
 *   const cipher = gcm(key, nonce)
 *   cipher.encrypt(plaintext[, aad])
 *   cipher.decrypt(ciphertext[, aad])
 */

type Uint8 = Uint8Array;

declare module '@noble/ciphers/aes' {
  export type AesGcmCipher = {
    encrypt(plaintext: Uint8, aad?: Uint8): Uint8;
    decrypt(ciphertext: Uint8, aad?: Uint8): Uint8;
  };

  // Common runtime shape used in this repo: gcm(key, nonce) => cipher
  export function gcm(key: Uint8, nonce: Uint8): AesGcmCipher;

  // Some bundlers/envs may also allow gcm(key) returning a builder.
  // Keep a permissive overload so TS doesn't block alternate usage.
  export function gcm(key: Uint8): {
    (nonce: Uint8): AesGcmCipher;
    encrypt(nonce: Uint8, plaintext: Uint8, aad?: Uint8): Uint8;
    decrypt(nonce: Uint8, ciphertext: Uint8, aad?: Uint8): Uint8;
  };
}

declare module '@noble/ciphers/aes.js' {
  export * from '@noble/ciphers/aes';
}
