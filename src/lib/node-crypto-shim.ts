import CryptoJS from 'crypto-js';

type SupportedAlgorithm = 'sha256';

type InputChunk = string | ArrayBuffer | Uint8Array;

function toWordArray(chunk: InputChunk) {
  if (typeof chunk === 'string') {
    return CryptoJS.enc.Utf8.parse(chunk);
  }

  if (chunk instanceof Uint8Array) {
    return CryptoJS.lib.WordArray.create(chunk);
  }

  if (chunk instanceof ArrayBuffer) {
    return CryptoJS.lib.WordArray.create(new Uint8Array(chunk));
  }

  throw new TypeError('Unsupported data type for hash update');
}

export function createHash(algorithm: SupportedAlgorithm) {
  if (algorithm !== 'sha256') {
    throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  }

  const hash = CryptoJS.algo.SHA256.create();

  return {
    update(chunk: InputChunk) {
      hash.update(toWordArray(chunk));
      return this;
    },
    digest(encoding?: 'hex') {
      const result = hash.finalize();
      if (!encoding || encoding === 'hex') {
        return result.toString(CryptoJS.enc.Hex);
      }
      throw new Error(`Unsupported digest encoding: ${encoding}`);
    },
  };
}
