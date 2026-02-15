type TokenSupplier = (service?: string) => Promise<string | null>;

let supplier: TokenSupplier | null = null;

export function registerTokenSupplier(nextSupplier: TokenSupplier | null): void {
  supplier = nextSupplier;
}

export async function getToken(service?: string): Promise<string | null> {
  if (!supplier) return null;
  try {
    return await supplier(service);
  } catch {
    return null;
  }
}
