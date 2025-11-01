const store: Record<string, string> = {};

export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY';

export async function getItemAsync(key: string): Promise<string | null> {
  return key in store ? store[key] : null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store[key] = value;
}

export async function deleteItemAsync(key: string): Promise<void> {
  delete store[key];
}

export function __reset(): void {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
}

export default {
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
};
