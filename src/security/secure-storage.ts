// BEGIN HANDOVER_SECURE_STORAGE
import * as SecureStore from 'expo-secure-store';

export async function secureSetItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, {
    keychainService: 'handover-secure',
  });
}

export async function secureGetItem(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function secureDeleteItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}
// END HANDOVER_SECURE_STORAGE
