const store = new Map<string, string>();

export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY';

export async function getItemAsync(k: string) {
  return store.get(k) ?? null;
}

export async function setItemAsync(k: string, v: string) {
  store.set(k, v);
}

export async function deleteItemAsync(k: string) {
  store.delete(k);
}

export default {
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
};
