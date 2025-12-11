// vitest.setup.ts
// -----------------------------------------------------------------------------
// Setup global para Vitest en HANDOVER-LIMPIO
// -----------------------------------------------------------------------------

/// <reference types="vitest" />

import { vi, beforeEach, afterEach } from 'vitest';
import * as SecureStoreMock from './tests/__mocks__/expo-secure-store';
import crypto from 'node:crypto';

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

// Polyfill de setImmediate / clearImmediate (por si la versión de Node no lo trae)
if (!g.setImmediate) {
  g.setImmediate = (cb: (...args: any[]) => void, ...args: any[]) =>
    setTimeout(cb, 0, ...args);
}
if (!g.clearImmediate) {
  g.clearImmediate = (id: any) => clearTimeout(id);
}

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

vi.mock('expo-secure-store', () => {
  const mod: any = SecureStoreMock;
  const defaultExport = mod.default ?? mod;

  return {
    __esModule: true,
    ...mod,
    default: defaultExport,
  };
});

// -----------------------------------------------------------------------------
// 🔐 Mock de expo-crypto
// -----------------------------------------------------------------------------

vi.mock('expo-crypto', () => {
  const digest = async (_algorithm: any, data: Uint8Array) => {
    const hash = crypto.createHash('sha256');
    hash.update(Buffer.from(data));
    return hash.digest('hex');
  };

  const getRandomBytesAsync = async (length: number) => {
    return new Uint8Array(crypto.randomBytes(length));
  };

  return {
    __esModule: true,
    CryptoDigestAlgorithm: {
      SHA256: 'SHA-256',
    },
    digest,
    getRandomBytesAsync,
    default: {
      CryptoDigestAlgorithm: {
        SHA256: 'SHA-256',
      },
      digest,
      getRandomBytesAsync,
    },
  };
});

// -----------------------------------------------------------------------------
// 🧪 @testing-library/react-native
// -----------------------------------------------------------------------------
// NO se mockea aquí. Se resuelve mediante alias en vitest.config.ts:
//
// {
//   find: '@testing-library/react-native',
//   replacement: './tests/__mocks__/@testing-library-react-native.ts'
// }
//
// Así evitamos paths relativos rotos desde este setup.

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
// 🧩 Mock de expo-modules-core (inline, sin require externo)
// -----------------------------------------------------------------------------

vi.mock('expo-modules-core', () => {
  // EventEmitter muy simple, suficiente para que los módulos de Expo no fallen
  class EventEmitter<T = any> {
    addListener(_eventName: string, _listener: (event: T) => void) {
      return { remove: () => {} };
    }
    removeAllListeners(_eventName?: string) {
      // no-op
    }
  }

  const NativeModulesProxy: Record<string, any> = {};

  // 🔴 Platform: utilizado por varios módulos (incluido expo-av)
  const Platform = {
    OS: 'web' as const,
    select<T>(spec: {
      ios?: T;
      android?: T;
      web?: T;
      native?: T;
      default?: T;
    }): T | undefined {
      return spec.web ?? spec.native ?? spec.default;
    },
  };

  const requireNativeViewManager = vi.fn((_viewName: string) => {
    const Dummy = () => null;
    return Dummy;
  });

  const registerRootComponent = <T,>(component: T): T => component;

  const requireNativeModule = vi.fn();
  const requireOptionalNativeModule = vi.fn(() => ({}));

  // 🔴 NUEVO: createPermissionHook – expo-av lo importa desde expo-modules-core
  type PermissionStatus = {
    granted: boolean;
    canAskAgain?: boolean;
    expires?: 'never' | number;
    status?: 'granted' | 'denied' | 'undetermined';
  };

  const createPermissionHook = <
    TPermission extends PermissionStatus = PermissionStatus
  >(
    _methods: {
      getAsync?: () => Promise<TPermission>;
      requestAsync?: () => Promise<TPermission>;
    },
    _permissionType?: string,
  ) => {
    // Hook que siempre devuelve permisos concedidos.
    const usePermission = (): [
      TPermission,
      () => Promise<TPermission>,
      Error | null,
    ] => {
      const defaultStatus = {
        granted: true,
        canAskAgain: false,
        expires: 'never',
        status: 'granted',
      } as TPermission;

      const requestAsync = async () => defaultStatus;

      return [defaultStatus, requestAsync, null];
    };

    return usePermission;
  };

  const mod = {
    EventEmitter,
    NativeModulesProxy,
    Platform,
    requireNativeViewManager,
    registerRootComponent,
    requireNativeModule,
    requireOptionalNativeModule,
    createPermissionHook,
  };

  return {
    __esModule: true,
    ...mod,
    default: mod,
  };
});

// -----------------------------------------------------------------------------
// 🌐 Mock de expo-constants
// -----------------------------------------------------------------------------
//
// La implementación real para tests está en __mocks__/expo-constants.ts
// y se resuelve vía alias en vitest.config.ts:
//
// {
//   find: 'expo-constants',
//   replacement: './__mocks__/expo-constants.ts'
// }
//
// No necesitamos mock adicional aquí, dejamos que el alias haga su trabajo.

// -----------------------------------------------------------------------------
// 🌐 Mock mínimo de 'expo' (winter/runtime / ImportMetaRegistry)
// -----------------------------------------------------------------------------

vi.mock('expo', () => ({
  __esModule: true,
  default: {},
}));

// -----------------------------------------------------------------------------
// 📁 Mock de expo-file-system (para export-pdf y otros)
// -----------------------------------------------------------------------------

vi.mock('expo-file-system', () => {
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

  const printAsync = vi.fn(async (_options?: any) => {
    return {};
  });

  const printToFileAsync = vi.fn(async (_options?: any) => {
    return {
      uri: 'file:///mock-output.pdf',
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
