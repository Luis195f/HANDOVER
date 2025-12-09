// vitest.setup.ts
// -----------------------------------------------------------------------------
// Setup global para Vitest en HANDOVER-LIMPIO
// -----------------------------------------------------------------------------

import { vi, beforeEach, afterEach } from 'vitest';
import * as SecureStoreMock from './tests/__mocks__/expo-secure-store';

// -----------------------------------------------------------------------------
// 🌍 Fallbacks básicos de entorno
// -----------------------------------------------------------------------------

const g = globalThis as any;

// Globals típicos de RN/Expo
g.window = g.window ?? {};
const navigatorDescriptor = Object.getOwnPropertyDescriptor(g, 'navigator');
if (!navigatorDescriptor) {
  Object.defineProperty(g, 'navigator', {
    value: g.navigator ?? { userAgent: 'node' },
    configurable: true,
    writable: true,
  });
} else if (navigatorDescriptor.writable) {
  g.navigator = g.navigator ?? { userAgent: 'node' };
} else if (navigatorDescriptor.configurable) {
  Object.defineProperty(g, 'navigator', {
    value: g.navigator ?? { userAgent: 'node' },
    configurable: true,
  });
}
g.__DEV__ = false;
g.IS_REACT_ACT_ENVIRONMENT = true;
// Hacer que librerías que esperan `jest` funcionen en Vitest
g.jest = g.jest ?? vi;

// Stub muy básico de `fetch` si no existe
if (typeof g.fetch !== 'function') {
  g.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
  }));
}

// -----------------------------------------------------------------------------
// 🔒 Mock de expo-secure-store (fuente única: tests/__mocks__/expo-secure-store)
// -----------------------------------------------------------------------------

vi.mock('expo-secure-store', () => SecureStoreMock);

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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_target?: any) {}
    addListener = vi.fn();
    removeAllListeners = vi.fn();
  }

  return {
    EventEmitter,
    NativeModulesProxy: {},
    requireNativeModule: vi.fn(),
    // Necesario para expo-constants (ExponentConstants / requireOptionalNativeModule)
    requireOptionalNativeModule: (_name: string) => ({}),
  };
});

// -----------------------------------------------------------------------------
// 🌐 Mock de expo-constants
// -----------------------------------------------------------------------------

vi.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: {} },
    manifest: { extra: {} },
  },
}));

// -----------------------------------------------------------------------------
// 📁 Mock de expo-file-system (para export-pdf y otros)
// -----------------------------------------------------------------------------

vi.mock('expo-file-system', () => {
  // Tal como lo espera el test:
  // import * as FileSystem from 'expo-file-system'
  // FileSystem.moveAsync(...)
  // FileSystem.documentDirectory = 'file:///docs/';

  const documentDirectory = 'file:///mock-documents/';

  const writeAsStringAsync = vi.fn(
    async (_path: string, _data: string, _options?: any): Promise<void> => {
      return;
    },
  );

  const getInfoAsync = vi.fn(
    async (_path: string): Promise<{
      exists: boolean;
      isDirectory: boolean;
      uri: string;
    }> => {
      return {
        exists: true,
        isDirectory: false,
        uri: 'file:///mock-file.pdf',
      };
    },
  );

  const moveAsync = vi.fn(
    async (_options: { from: string; to: string }): Promise<void> => {
      // No hace nada, solo para que el spy no reviente
      return;
    },
  );

  const mod = {
    documentDirectory,
    writeAsStringAsync,
    getInfoAsync,
    moveAsync,
  };

  return {
    __esModule: true,
    ...mod,
    default: mod,
  };
});

// -----------------------------------------------------------------------------
// 🔊 Mock de expo-speech
// -----------------------------------------------------------------------------

vi.mock('expo-speech', () => {
  const ExponentSpeech = {
    maxSpeechInputLength: 10000,
  };

  async function speak(_text: string, _options?: any): Promise<void> {
    return;
  }

  async function stop(): Promise<void> {
    return;
  }

  return {
    defaultOptions: {},
    ExponentSpeech,
    speak,
    stop,
  };
});

// -----------------------------------------------------------------------------
// 🖨️ Mock de expo-print (para export-pdf)
// -----------------------------------------------------------------------------

vi.mock('expo-print', () => {
  const Orientation = {
    PORTRAIT: 'portrait',
    LANDSCAPE: 'landscape',
  } as const;

  // No lo usamos directamente en el test, pero así no revienta nada.
  const printAsync = vi.fn(async (_options?: any) => {
    return {};
  });

  // ESTA es la clave: definir printToFileAsync para que vi.spyOn(Print, 'printToFileAsync')
  // no reviente diciendo "does not exist".
  const printToFileAsync = vi.fn(async (_options?: any) => {
    return {
      uri: 'file:///mock-output.pdf',
      // expo-print puede devolver también base64, pero aquí no la necesitamos.
      base64: undefined,
    } as any;
  });

  const selectPrinterAsync = vi.fn(async () => {
    return { name: 'Mock Printer', url: 'mock://printer' };
  });

  const mod = {
    Orientation,
    printAsync,
    printToFileAsync,
    selectPrinterAsync,
  };

  return {
    __esModule: true,
    ...mod,
    default: mod,
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

    async makeAuthUrlAsync(): Promise<string> {
      return 'https://example.com/auth';
    }

    async promptAsync(
      _options?: any,
    ): Promise<{ type: string; params?: Record<string, string> }> {
      return {
        type: 'success',
        params: { code: 'mock-auth-code' },
      };
    }
  }

  const makeRedirectUri = vi.fn((_options?: any) => 'https://example.com/callback');

  const fetchDiscoveryAsync = vi.fn(async (_issuer: string) => ({
    authorizationEndpoint: 'https://example.com/authorize',
    tokenEndpoint: 'https://example.com/token',
    revocationEndpoint: 'https://example.com/revoke',
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
  // Si el mock de SecureStore implementa __reset, úsalo para empezar limpio
  (SecureStoreMock as any).__reset?.();
});

afterEach(() => {
  vi.clearAllMocks();
});
