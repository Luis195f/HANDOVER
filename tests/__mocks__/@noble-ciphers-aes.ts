import crypto from 'node:crypto';

export function gcm(key: Uint8Array, iv: Uint8Array) {
  return {
    encrypt(plaintext: Uint8Array) {
      const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(iv));
      const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
      const tag = cipher.getAuthTag();
      return new Uint8Array(Buffer.concat([ciphertext, tag]));
    },
    decrypt(ciphertext: Uint8Array) {
      const buffer = Buffer.from(ciphertext);
      const tag = buffer.slice(buffer.length - 16);
      const ct = buffer.slice(0, buffer.length - 16);
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(iv));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
      return new Uint8Array(plaintext);
    },
  };
}
