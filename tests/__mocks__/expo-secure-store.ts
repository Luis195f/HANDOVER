// tests/__mocks__/expo-secure-store.ts
// Mock en memoria para `expo-secure-store` pensado para Vitest/Jest.
// No escribe nada en el dispositivo real: solo vive en el proceso de tests.

type Store = Record<string, string>;

// Almacenamiento en memoria compartido por todos los tests
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
 * La usamos desde vitest.setup.ts en beforeEach.
 */
export function __reset(): void {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
}

/**
 * Export por defecto con la forma típica de `expo-secure-store`,
 * para soportar `import * as SecureStore` o `import SecureStore from ...`.
 */
const SecureStore = {
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
  isAvailableAsync,
  __reset,
};

export default SecureStore;
