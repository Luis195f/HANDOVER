jest.mock('expo-secure-store', () => require('../__mocks__/expo-secure-store'), { virtual: true });
jest.mock('expo-auth-session', () => require('../__mocks__/expo-auth-session'), { virtual: true });
jest.mock('expo-camera', () => require('../__mocks__/expo-camera'), { virtual: true });
jest.mock('expo-av', () => require('../__mocks__/expo-av'), { virtual: true });
jest.mock('expo-constants', () => require('../__mocks__/expo-constants'), { virtual: true });

beforeEach(() => {
  (globalThis as any).fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
});

afterEach(() => {
  jest.clearAllMocks();
});
