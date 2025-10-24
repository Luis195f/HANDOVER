import SHA256 from 'crypto-js/sha256';
import encHex from 'crypto-js/enc-hex';

class HashShim {
  private data = '';

  update(chunk: string): this {
    this.data += String(chunk);
    return this;
  }

  digest(encoding: 'hex' | 'utf8' = 'hex'): string {
    const hash = SHA256(this.data);
    return encoding === 'hex' ? hash.toString(encHex) : hash.toString();
  }
}

export function createHash(algorithm: 'sha256') {
  if (algorithm !== 'sha256') {
    throw new Error('Only sha256');
  }
  return new HashShim();
}
