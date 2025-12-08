// __mocks__/expo-secure-store.ts
// Mock simple en memoria para SecureStore de Expo.

type Store = Record<string, string>;

const store: Store = {};

/**
 * Devuelve el valor guardado o null si no existe.
 */
export async function getItemAsync(key: string): Promise<string | null> {
  return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
}

/**
 * Guarda un valor string bajo una clave.
 */
export async function setItemAsync(key: string, value: string): Promise<void> {
  store[key] = value;
}

/**
 * Elimina una clave del "secure store".
 */
export async function deleteItemAsync(key: string): Promise<void> {
  delete store[key];
}

/**
 * En móviles reales esto existe; aquí devolvemos siempre true.
 */
export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

/**
 * Utilidad SOLO PARA TESTS: vacía todo el store.
 */
export function __reset(): void {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
}
