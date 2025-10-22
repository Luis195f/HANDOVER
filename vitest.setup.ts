// vitest.setup.ts
import { vi } from 'vitest';

/**
 * Mock global de expo-secure-store (exports con nombre).
 * Usa un "almacén" en memoria que puedes resetear por test con:
 *   (globalThis as any).__secureStoreMem = {}
 */
(globalThis as any).__secureStoreMem ??= {} as Record<string, string | null>;
vi.mock('expo-secure-store', () => ({
  getItemAsync: (k: string) =>
    Promise.resolve(((globalThis as any).__secureStoreMem[k]) ?? null),
  setItemAsync: (k: string, v: string) => {
    (globalThis as any).__secureStoreMem[k] = v;
    return Promise.resolve();
  },
}));

/** Mock global de auth para evitar dependencias RN/Expo en tests */
vi.mock('@/src/security/auth', () => ({
  getSession: async () => ({ token: '' }),
}));

/** (Opcional) Polyfill de fetch si el entorno no lo trae */
if (!(globalThis as any).fetch) {
  (globalThis as any).fetch = async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        resourceType: 'Bundle',
        type: 'transaction-response',
        entry: [],
      }),
    } as any);
}

/** (Compat) vi.skip "no-op" si algún test antiguo lo llama */
(Object.assign(vi as any, { skip: () => {} }));
