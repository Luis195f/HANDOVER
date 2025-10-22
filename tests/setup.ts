// Vitest global setup: mocks ligeros y helpers comunes
import { vi, beforeEach } from 'vitest';

// Mock de fetch por defecto (se puede sobrescribir en cada test)
if (!(globalThis as any).fetch) {
  (globalThis as any).fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
}

// Mock mínimo de expo-secure-store (in-memory)
vi.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    default: {
      getItemAsync: vi.fn(async (k: string) => store[k] ?? null),
      setItemAsync: vi.fn(async (k: string, v: string) => { store[k] = v; }),
      deleteItemAsync: vi.fn(async (k: string) => { delete store[k]; }),
    },
  };
});

// Reset de mocks por test
beforeEach(() => {
  vi.clearAllMocks();
});