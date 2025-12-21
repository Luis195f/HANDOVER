// tests/__mocks__/expo-secure-store.ts
// Mock en memoria para `expo-secure-store` pensado para Vitest/Jest.
// No escribe nada en el dispositivo real: solo vive en el proceso de tests.

type Store = Record<string, string>;

// Almacenamiento en memoria compartido por todos los tests
const store: Store = {};

type SetItemFailureHandler = (key: string, value: string) => unknown | Promise<unknown>;
let setItemFailure: SetItemFailureHandler | Error | null = null;

export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY';
export const SecureStoreAccessibility = {
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/**
 * Devuelve el valor guardado o null si no existe.
 */
export async function getItemAsync(key: string): Promise<string | null> {
  return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
}

/**
 * Guarda un valor string bajo una clave.
 */
export async function setItemAsync(key: string, value: string, _options?: unknown): Promise<void> {
  const failure = typeof setItemFailure === 'function' ? await setItemFailure(key, value) : setItemFailure;
  if (failure) {
    throw failure instanceof Error ? failure : new Error(String(failure));
  }
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

export function __setSetItemFailure(handler: SetItemFailureHandler | Error | null): void {
  setItemFailure = handler;
}

/**
 * Utilidad SOLO PARA TESTS: vacía todo el store.
 * La usamos desde vitest.setup.ts en beforeEach.
 */
export function __reset(): void {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  setItemFailure = null;
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
  __setSetItemFailure,
  SecureStoreAccessibility,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export default SecureStore;
