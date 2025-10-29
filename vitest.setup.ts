// vitest.setup.ts
import { vi } from 'vitest';

/**
 * Mock global de expo-secure-store (exports con nombre).
 * Usa un "almacén" en memoria que puedes resetear por test con:
 *   (globalThis as any).__secureStoreMem = {}
 */
(globalThis as any).__secureStoreMem ??= {} as Record<string, string | null>;
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: (k: string) =>
    Promise.resolve(((globalThis as any).__secureStoreMem[k]) ?? null),
  setItemAsync: (k: string, v: string) => {
    (globalThis as any).__secureStoreMem[k] = v;
    return Promise.resolve();
  },
  deleteItemAsync: (k: string) => {
    delete (globalThis as any).__secureStoreMem[k];
    return Promise.resolve();
  },
}));

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: { extra: {} },
  },
}));

/** Mock global de auth para evitar dependencias RN/Expo en tests */
vi.mock('@/src/security/auth', async () => {
  const actual = await vi.importActual<typeof import('@/src/security/auth')>(
    '@/src/security/auth'
  );
  return {
    ...actual,
    getSession: async () => ({ token: '' }),
  };
});

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

/**
 * Compatibilidad mínima para suites migradas a Jest. Mapea `jest.*` → `vi.*`.
 */
if (!(globalThis as any).jest) {
  const jestCompat = {
    ...vi,
    fn: vi.fn,
    spyOn: vi.spyOn,
    mock: vi.mock,
    clearAllMocks: vi.clearAllMocks,
    resetAllMocks: vi.resetAllMocks,
    restoreAllMocks: vi.restoreAllMocks,
    useFakeTimers: vi.useFakeTimers.bind(vi),
    useRealTimers: vi.useRealTimers.bind(vi),
    advanceTimersByTime: vi.advanceTimersByTime.bind(vi),
  } as typeof vi & Record<string, unknown>;
  (globalThis as any).jest = jestCompat;
}

/** Mock ligero de expo-crypto para entorno Node. */
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: {
    SHA1: 'SHA-1',
    SHA256: 'SHA-256',
    SHA384: 'SHA-384',
    SHA512: 'SHA-512',
  },
  digestStringAsync: vi.fn(async (_alg: string, input: string) => {
    // usa hash simple determinista para tests (no criptográfico)
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
  }),
}));
