import { createHash } from "./node-crypto-shim";

export async function sha256Hex(input: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(input);
  return Promise.resolve(hash.digest("hex"));
}

// Hash no-criptográfico y determinístico (djb2) para IDs locales en RN.
export function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
  return (h >>> 0).toString(16); // uint32 → hex
}
