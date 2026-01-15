// jest-tests/setup.ts
// Centraliza mocks de módulos Expo para evitar que Jest cargue ESM desde node_modules
// (p.ej. expo-audio/build/*) y para controlar permisos desde los tests.

jest.mock('expo-secure-store', () => require('../__mocks__/expo-secure-store'), { virtual: true });
jest.mock('expo-auth-session', () => require('../__mocks__/expo-auth-session'), { virtual: true });
jest.mock('expo-camera', () => require('../__mocks__/expo-camera'), { virtual: true });
jest.mock('expo-audio', () => require('../__mocks__/expo-audio'), { virtual: true });
jest.mock('expo-av', () => require('../__mocks__/expo-av'), { virtual: true });
jest.mock('expo-constants', () => require('../__mocks__/expo-constants'), { virtual: true });

beforeEach(() => {
  // Fetch por defecto (si un test necesita otra cosa, lo sobreescribe).
  (globalThis as any).fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: jest.fn() },
    json: async () => ({}),
    text: async () => '',
  }));
});

afterEach(() => {
  jest.clearAllMocks();
});
