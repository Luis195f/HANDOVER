// vitest.setup.ts
// -----------------------------------------------------------------------------
// Setup global para Vitest en HANDOVER-LIMPIO
// -----------------------------------------------------------------------------

import { vi, beforeEach, afterEach } from 'vitest';

// -----------------------------------------------------------------------------
// 🌍 Fallbacks básicos de entorno
// -----------------------------------------------------------------------------

const g = globalThis as any;

g.window = g.window ?? {};
g.navigator = g.navigator ?? { userAgent: 'node' };

if (typeof g.fetch !== 'function') {
  g.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
  }));
}

// -----------------------------------------------------------------------------
// 🔒 Mock de expo-secure-store
// -----------------------------------------------------------------------------

type SecureStoreData = Record<string, string | null>;
const secureStoreState: SecureStoreData = {};

vi.mock('expo-secure-store', () => {
  const api = {
    async getItemAsync(key: string): Promise<string | null> {
      return key in secureStoreState ? secureStoreState[key] ?? null : null;
    },
    async setItemAsync(key: string, value: string): Promise<void> {
      secureStoreState[key] = value;
    },
    async deleteItemAsync(key: string): Promise<void> {
      delete secureStoreState[key];
    },
    __reset() {
      for (const k of Object.keys(secureStoreState)) {
        delete secureStoreState[k];
      }
    },
  };

  return api;
});

// -----------------------------------------------------------------------------
// 🌐 Mock de expo-linking
// -----------------------------------------------------------------------------

vi.mock('expo-linking', () => {
  return {
    createURL: (path: string) => `https://example.com/${path}`,
    parse: (url: string) => ({ path: url }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    openURL: vi.fn(),
  };
});

// -----------------------------------------------------------------------------
// 🌐 Mock de expo-web-browser
// -----------------------------------------------------------------------------

vi.mock('expo-web-browser', () => {
  const openAuthSessionAsync = vi.fn(async () => ({
    type: 'success',
    url: 'https://example.com/callback?code=mock-auth-code',
  }));

  return {
    openAuthSessionAsync,
    dismissBrowser: vi.fn(),
    WebBrowserResultType: {
      SUCCESS: 'success',
      CANCEL: 'cancel',
      DISMISS: 'dismiss',
    },
    default: {
      openAuthSessionAsync,
    },
  };
});

// -----------------------------------------------------------------------------
// 🧩 Mock de expo-modules-core
// -----------------------------------------------------------------------------

vi.mock('expo-modules-core', () => {
  class EventEmitter {
    constructor(_target?: any) {}
    addListener = vi.fn();
    removeAllListeners = vi.fn();
  }

  return {
    EventEmitter,
    NativeModulesProxy: {},
    requireNativeModule: vi.fn(),
  };
});

// -----------------------------------------------------------------------------
// 🔐 Mock de expo-auth-session
// -----------------------------------------------------------------------------

vi.mock('expo-auth-session', () => {
  const ResponseType = {
    Code: 'code',
    Token: 'token',
    IdToken: 'id_token',
  } as const;

  class AuthRequest {
    config: any;

    constructor(config: any) {
      this.config = config;
    }

    async promptAsync(_discovery: any, _options: any) {
      return {
        type: 'success',
        params: {
          code: 'mock-auth-code',
        },
      };
    }
  }

  const makeRedirectUri = vi.fn((_options?: any) => 'https://mock.redirect');

  // ⚠️ IMPORTANTE: ahora incluye userinfoEndpoint
  const fetchDiscoveryAsync = vi.fn(async (issuer: string) => ({
    authorizationEndpoint: `${issuer}/authorize`,
    tokenEndpoint: `${issuer}/token`,
    revocationEndpoint: `${issuer}/revoke`,
    userinfoEndpoint: `${issuer}/userinfo`,
  }));

  const exchangeCodeAsync = vi.fn(async (_params: any, _config: any) => ({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    idToken: 'mock-id-token',
    tokenType: 'Bearer',
    issuedAt: Math.floor(Date.now() / 1000),
    expiresIn: 3600,
  }));

  const revokeAsync = vi.fn(async (_options: any, _config: any) => ({}));

  const refreshAsync = vi.fn(async (_input: any, _config: any) => ({
    accessToken: 'refreshed-access-token',
    refreshToken: 'refreshed-refresh-token',
    idToken: 'refreshed-id-token',
    tokenType: 'Bearer',
    issuedAt: Math.floor(Date.now() / 1000),
    expiresIn: 3600,
  }));

  const exported = {
    ResponseType,
    AuthRequest,
    makeRedirectUri,
    fetchDiscoveryAsync,
    exchangeCodeAsync,
    revokeAsync,
    refreshAsync,
  };

  return {
    ...exported,
    default: exported,
  };
});

// -----------------------------------------------------------------------------
// 🧭 Mock de @react-navigation/native (con CommonActions)
// -----------------------------------------------------------------------------

vi.mock('@react-navigation/native', () => {
  const NavigationContainer = ({ children }: any) => children;

  const createNavigationContainerRef = vi.fn(() => {
    return {
      isReady: () => true,
      navigate: vi.fn(),
      reset: vi.fn(),
      goBack: vi.fn(),
      getRootState: vi.fn(),
      dispatch: vi.fn(),
    } as any;
  });

  const CommonActions = {
    reset: vi.fn((config: any) => ({
      type: 'RESET',
      ...config,
    })),
  };

  const api = {
    NavigationContainer,
    createNavigationContainerRef,
    CommonActions,
    useNavigation: () => ({
      navigate: vi.fn(),
      goBack: vi.fn(),
    }),
    useRoute: () => ({ params: {} }),
    useFocusEffect: () => {},
    useIsFocused: () => false,
  };

  return {
    ...api,
    default: NavigationContainer,
  };
});

// -----------------------------------------------------------------------------
// 🧹 Limpiar mocks entre tests
// -----------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});
