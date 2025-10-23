declare module 'expo-crypto' {
  export enum CryptoDigestAlgorithm {
    SHA1 = 'SHA-1',
    SHA256 = 'SHA-256',
    SHA384 = 'SHA-384',
    SHA512 = 'SHA-512'
  }
  export function digestStringAsync(
    algorithm: CryptoDigestAlgorithm,
    data: string,
    options?: { encoding?: 'HEX' | 'BASE64' }
  ): Promise<string>;
}
