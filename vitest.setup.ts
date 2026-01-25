// vitest.setup.ts
// -----------------------------------------------------------------------------
// Setup global para Vitest en HANDOVER-LIMPIO
// -----------------------------------------------------------------------------

/// <reference types="vitest" />

import { vi, beforeEach, afterEach } from 'vitest';
import * as SecureStoreMock from './tests/__mocks__/expo-secure-store';
import crypto from 'node:crypto';

// React 18/19: evita warnings/errores de act() en algunos entornos
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// -----------------------------------------------------------------------------
// 🌍 Fallbacks básicos de entorno
// -----------------------------------------------------------------------------

const g = globalThis as any;

// Globals típicos de RN/Expo
g.window = g.window ?? {};

// navigator puede ser readonly en algunos entornos, lo definimos con cuidado
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

// Hacer que librerías que esperan `jest` funcionen en Vitest
g.jest = g.jest ?? vi;

// Polyfill de setImmediate / clearImmediate
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
  class EventEmitter<T = any> {
    addListener(_eventName: string, _listener: (event: T) => void) {
      return { remove: () => {} };
    }
    removeAllListeners(_eventName?: string) {
      // no-op
    }
  }

  class NativeModule {}

  const NativeModulesProxy: Record<string, any> = {};

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

  const createNativeModule = () => ({
    addListener: vi.fn(),
    removeListeners: vi.fn(),
  });

  const requireNativeModule = vi.fn(() => createNativeModule());
  const requireOptionalNativeModule = vi.fn(() => null);

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
    NativeModule,
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
// 🌐 Mock mínimo de 'expo'
// -----------------------------------------------------------------------------

vi.mock('expo', () => {
  const createNativeModule = () => ({
    addListener: vi.fn(),
    removeListeners: vi.fn(),
  });

  const mod = {
    requireNativeModule: vi.fn((_name: string) => createNativeModule()),
    requireOptionalNativeModule: vi.fn((_name: string) => null),
  };

  return {
    __esModule: true,
    ...mod,
    default: mod,
  };
});

// -----------------------------------------------------------------------------
// 🧱 Mock de expo-sqlite
// -----------------------------------------------------------------------------

vi.mock('expo-sqlite', async () => {
  const mod = await import('./tests/__mocks__/expo-sqlite');
  const defaultExport = (mod as any).default ?? mod;
  return { __esModule: true, ...(mod as any), default: defaultExport };
});
vi.mock('expo-sqlite/next', async () => {
  const mod = await import('./tests/__mocks__/expo-sqlite');
  const defaultExport = (mod as any).default ?? mod;
  return { __esModule: true, ...(mod as any), default: defaultExport };
});
vi.mock('expo-sqlite/legacy', async () => {
  const mod = await import('./tests/__mocks__/expo-sqlite');
  const defaultExport = (mod as any).default ?? mod;
  return { __esModule: true, ...(mod as any), default: defaultExport };
});

// -----------------------------------------------------------------------------
// 📁 Mock de expo-file-system
// -----------------------------------------------------------------------------

vi.mock('expo-file-system', () => {
  const documentDirectory = 'file:///mock-documents/';

  const readAsStringAsync = vi.fn(async () => 'ZGF0YQ==');

  const writeAsStringAsync = vi.fn(
    async (_path: string, _data: string, _options?: any): Promise<void> => {},
  );

  const getInfoAsync = vi.fn(
    async (_path: string): Promise<{
      exists: boolean;
      isDirectory: boolean;
      uri: string;
      size: number;
    }> => ({
      exists: true,
      isDirectory: false,
      uri: 'file:///mock-file.pdf',
      size: 1024,
    }),
  );

  const moveAsync = vi.fn(async (_options: { from: string; to: string }) => {});

  const mod = {
    documentDirectory,
    readAsStringAsync,
    writeAsStringAsync,
    getInfoAsync,
    moveAsync,
    EncodingType: { Base64: 'base64' },
  };

  return { __esModule: true, ...mod, default: mod };
});

// -----------------------------------------------------------------------------
// 🖼️ Mock de expo-image-picker
// -----------------------------------------------------------------------------

vi.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestCameraPermissionsAsync: vi.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: vi.fn(async () => ({ canceled: true })),
  launchCameraAsync: vi.fn(async () => ({ canceled: true })),
}));

// -----------------------------------------------------------------------------
// 📄 Mock de expo-document-picker
// -----------------------------------------------------------------------------

vi.mock('expo-document-picker', () => ({
  getDocumentAsync: vi.fn(async () => ({ canceled: true })),
}));

// -----------------------------------------------------------------------------
// 🔊 Mock de expo-speech
// -----------------------------------------------------------------------------

vi.mock('expo-speech', () => {
  const ExponentSpeech = { maxSpeechInputLength: 10000 };

  async function speak(_text: string, _options?: any): Promise<void> {}
  async function stop(): Promise<void> {}

  return {
    defaultOptions: {},
    ExponentSpeech,
    speak,
    stop,
  };
});

// -----------------------------------------------------------------------------
// 🖨️ Mock de expo-print
// -----------------------------------------------------------------------------

vi.mock('expo-print', () => {
  const Orientation = {
    PORTRAIT: 'portrait',
    LANDSCAPE: 'landscape',
  } as const;

  const printAsync = vi.fn(async (_options?: any) => ({}));
  const printToFileAsync = vi.fn(async (_options?: any) => ({
    uri: 'file:///mock-output.pdf',
    base64: undefined,
  }) as any);
  const selectPrinterAsync = vi.fn(async () => ({
    name: 'Mock Printer',
    url: 'mock://printer',
  }));

  const mod = { Orientation, printAsync, printToFileAsync, selectPrinterAsync };
  return { __esModule: true, ...mod, default: mod };
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
    async promptAsync(): Promise<{ type: string; params?: Record<string, string> }> {
      return { type: 'success', params: { code: 'mock-auth-code' } };
    }
  }

  const makeRedirectUri = vi.fn(() => 'https://example.com/callback');
  const fetchDiscoveryAsync = vi.fn(async () => ({
    authorizationEndpoint: 'https://example.com/authorize',
    tokenEndpoint: 'https://example.com/token',
    revocationEndpoint: 'https://example.com/revoke',
  }));
  const exchangeCodeAsync = vi.fn(async () => ({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    idToken: 'mock-id-token',
    tokenType: 'Bearer',
    issuedAt: Math.floor(Date.now() / 1000),
    expiresIn: 3600,
  }));
  const revokeAsync = vi.fn(async () => ({}));
  const refreshAsync = vi.fn(async () => ({
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

  return { ...exported, default: exported };
});

// -----------------------------------------------------------------------------
// 🧭 Mock de @react-navigation/native
// -----------------------------------------------------------------------------

vi.mock('@react-navigation/native', () => {
  const NavigationContainer = ({ children }: any) => children;

  const createNavigationContainerRef = vi.fn(() => ({
    isReady: () => true,
    navigate: vi.fn(),
    reset: vi.fn(),
    goBack: vi.fn(),
    getRootState: vi.fn(),
    dispatch: vi.fn(),
  }));

  const CommonActions = {
    reset: vi.fn((config: any) => ({ type: 'RESET', ...config })),
  };

  const api = {
    NavigationContainer,
    createNavigationContainerRef,
    CommonActions,
    useNavigation: () => ({ navigate: vi.fn(), goBack: vi.fn() }),
    useRoute: () => ({ params: {} }),
    useFocusEffect: () => {},
    useIsFocused: () => false,
  };

  return { ...api, default: NavigationContainer };
});

// -----------------------------------------------------------------------------
// 🧹 Limpiar mocks entre tests
// -----------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  (SecureStoreMock as any).__reset?.();
});

afterEach(() => {
  vi.clearAllMocks();
});
