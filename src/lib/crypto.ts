import { sha256 } from 'js-sha256';
export function hashHex(input: string, len = 64): string {
  const hex = sha256(input);
  const L = Math.max(1, Math.min(len, hex.length));
  return hex.slice(0, L);
}
export function fhirId(prefix: string, input: string, maxLen = 64): string {
  const base = `${prefix}${hashHex(input, maxLen)}`;
  return base.slice(0, maxLen).replace(/[^A-Za-z0-9\-.]/g, '-');
}
