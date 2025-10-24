import CryptoJS from 'crypto-js';

type SupportedAlgorithm = 'sha256';

type UpdateInput = string | CryptoJS.lib.WordArray | ArrayBufferView | ArrayBuffer;

const BYTES_PER_WORD = 4;

function toWordArray(bytes: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += BYTES_PER_WORD) {
    words.push(
      (bytes[i] << 24) |
        ((bytes[i + 1] ?? 0) << 16) |
        ((bytes[i + 2] ?? 0) << 8) |
        (bytes[i + 3] ?? 0)
    );
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

class Hash {
  private buffer = CryptoJS.lib.WordArray.create();

  constructor(private readonly algorithm: SupportedAlgorithm) {
    if (algorithm !== 'sha256') {
      throw new Error(`Unsupported algorithm: ${algorithm}`);
    }
  }

  update(input: UpdateInput): this {
    let chunk: CryptoJS.lib.WordArray;

    if (typeof input === 'string') {
      chunk = CryptoJS.enc.Utf8.parse(input);
    } else if (input instanceof ArrayBuffer) {
      chunk = toWordArray(new Uint8Array(input));
    } else if (ArrayBuffer.isView(input)) {
      chunk = toWordArray(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
    } else {
      chunk = input;
    }

    this.buffer = this.buffer.concat(chunk);
    return this;
  }

  digest(encoding: 'hex'): string {
    if (encoding !== 'hex') {
      throw new Error(`Unsupported encoding: ${encoding}`);
    }

    const result = CryptoJS.SHA256(this.buffer);
    return result.toString(CryptoJS.enc.Hex);
  }
}

export function createHash(algorithm: SupportedAlgorithm): Pick<Hash, 'update' | 'digest'> {
  return new Hash(algorithm);
}

export default createHash;
