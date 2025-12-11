// __mocks__/react-native-async-storage.ts
// Mock minimal y seguro para AsyncStorage en entorno Node/Vitest.
// Evita errores como “Cannot read properties of undefined (reading 'setItem')”.

const mockStorage: Record<string, string> = {};

const AsyncStorage = {
  setItem: async (key: string, value: string): Promise<void> => {
    mockStorage[key] = value;
  },
  getItem: async (key: string): Promise<string | null> => {
    return mockStorage[key] ?? null;
  },
  removeItem: async (key: string): Promise<void> => {
    delete mockStorage[key];
  },
  clear: async (): Promise<void> => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  },
  getAllKeys: async (): Promise<string[]> => {
    return Object.keys(mockStorage);
  },
  multiSet: async (entries: [string, string][]): Promise<void> => {
    for (const [key, value] of entries) {
      mockStorage[key] = value;
    }
  },
  multiGet: async (keys: string[]): Promise<[string, string | null][]> => {
    return keys.map((k) => [k, mockStorage[k] ?? null]);
  },
  multiRemove: async (keys: string[]): Promise<void> => {
    for (const key of keys) delete mockStorage[key];
  },
};

export default AsyncStorage;
