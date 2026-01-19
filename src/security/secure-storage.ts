import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

async function canUseSecureStore(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (typeof SecureStore.getItemAsync !== 'function') return false;
  if (typeof SecureStore.setItemAsync !== 'function') return false;
  if (typeof SecureStore.deleteItemAsync !== 'function') return false;

  try {
    return (await SecureStore.isAvailableAsync?.()) ?? true;
  } catch {
    return false;
  }
}

export async function secureSetItem(key: string, value: string): Promise<void> {
  if (await canUseSecureStore()) {
    await SecureStore.setItemAsync(key, value, { keychainService: 'handover-secure' });
    return;
  }
  await AsyncStorage.setItem(key, value);
}

export async function secureGetItem(key: string): Promise<string | null> {
  if (await canUseSecureStore()) {
    return SecureStore.getItemAsync(key);
  }
  return AsyncStorage.getItem(key);
}

export async function secureDeleteItem(key: string): Promise<void> {
  if (await canUseSecureStore()) {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  await AsyncStorage.removeItem(key);
}
