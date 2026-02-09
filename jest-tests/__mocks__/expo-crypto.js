// jest-tests/__mocks__/expo-crypto.js

const Crypto = {
  // Expo Crypto suele exponer digestStringAsync
  digestStringAsync: jest.fn(async () => "mock-digest"),

  // Algoritmos (por si tu código los referencia)
  CryptoDigestAlgorithm: {
    SHA256: "SHA-256",
    SHA384: "SHA-384",
    SHA512: "SHA-512",
    MD5: "MD5",
  },

  // Random bytes (por si tu código usa getRandomBytesAsync)
  getRandomBytesAsync: jest.fn(async (size = 16) =>
    new Uint8Array(size).fill(1)
  ),
};

module.exports = Crypto;
