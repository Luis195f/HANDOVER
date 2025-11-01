// vitest.setup.ts
import 'whatwg-fetch';
import '@testing-library/jest-native/extend-expect';
import { vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

process.env.OIDC_ISSUER ??= 'https://oidc.test';
process.env.OIDC_CLIENT_ID ??= 'test-client';
process.env.OIDC_SCOPE ??= 'openid profile email';

vi.mock('expo-barcode-scanner');
vi.mock('expo-audio');
vi.mock('expo-secure-store', () => import('./__mocks__/expo-secure-store'));
vi.mock('expo-auth-session', () => import('./__mocks__/expo-auth-session'));

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: { extra: {} },
  },
}));

vi.mock('js-sha256', async () => {
  const { createHash } = await import('node:crypto');
  return {
    sha256: (input: string) => createHash('sha256').update(input).digest('hex'),
  };
});

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

/** (Compat) vi.skip "no-op" si algún test antiguo lo llama */
Object.assign(vi as any, { skip: () => {} });

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
