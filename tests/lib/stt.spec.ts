import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envState = {
  AI_BACKEND_BASE_URL: 'https://ai.example',
  AI_BACKEND_ENABLED: true,
  STT_ENDPOINT: 'https://stt.example',
  FHIR_BASE_URL: 'http://fhir.example',
  API_BASE: '',
  API_TOKEN: '',
};

vi.mock('@/src/config/env', () => ({
  get AI_BACKEND_BASE_URL() {
    return envState.AI_BACKEND_BASE_URL;
  },
  get AI_BACKEND_ENABLED() {
    return envState.AI_BACKEND_ENABLED;
  },
  get STT_ENDPOINT() {
    return envState.STT_ENDPOINT;
  },
  get FHIR_BASE_URL() {
    return envState.FHIR_BASE_URL;
  },
  get API_BASE() {
    return envState.API_BASE;
  },
  get API_TOKEN() {
    return envState.API_TOKEN;
  },
  ENV: envState,
}));

const getInfoAsync = vi.fn();

vi.mock('expo-file-system', () => ({
  getInfoAsync,
  readAsStringAsync: vi.fn(async () => 'base64-audio'),
  EncodingType: { Base64: 'base64' },
}));

vi.mock('expo-av', () => ({
  Audio: {
    Recording: vi.fn().mockImplementation(() => ({
      prepareToRecordAsync: vi.fn(),
      startAsync: vi.fn(),
      stopAndUnloadAsync: vi.fn(),
      getURI: vi.fn(() => 'file://dummy.m4a'),
    })),
    RecordingOptionsPresets: { HIGH_QUALITY: {} },
    getPermissionsAsync: vi.fn(async () => ({ granted: true })),
    requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
    setAudioModeAsync: vi.fn(),
  },
}));

describe('transcribeAudioWithResult', () => {
  beforeEach(() => {
    vi.resetModules();
    envState.AI_BACKEND_BASE_URL = 'https://ai.example';
    getInfoAsync.mockResolvedValue({ exists: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('devuelve la transcripción cuando el backend responde OK', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ text: 'hola mundo' }) }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { transcribeAudioWithResult } = await import('@/src/lib/stt');

    const result = await transcribeAudioWithResult('file://nota.m4a');

    expect(fetchMock).toHaveBeenCalledWith('https://ai.example/ai/transcribe', expect.any(Object));
    expect(result).toEqual({ ok: true, text: 'hola mundo' });
  });

  it('captura errores HTTP y responde con ok:false sin lanzar', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { transcribeAudioWithResult } = await import('@/src/lib/stt');

    const result = await transcribeAudioWithResult('file://nota.m4a');

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('No se pudo transcribir') });
  });

  it('usa código de error UNAVAILABLE cuando no hay backend configurado', async () => {
    envState.AI_BACKEND_BASE_URL = null as unknown as string;
    const { transcribeAudioWithResult } = await import('@/src/lib/stt');

    const result = await transcribeAudioWithResult('file://nota.m4a');

    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNAVAILABLE');
  });

  it('mapea errores de red a código NETWORK', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Network down');
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { transcribeAudioWithResult } = await import('@/src/lib/stt');

    const result = await transcribeAudioWithResult('file://nota.m4a');

    expect(result.ok).toBe(false);
    expect(result.code).toBe('NETWORK');
  });

  it('marca TIMEOUT cuando la petición excede el tiempo máximo', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_, init: any) => {
      const signal: AbortSignal | undefined = init?.signal;
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { transcribeAudioWithResult } = await import('@/src/lib/stt');

    const promise = transcribeAudioWithResult('file://nota.m4a', { timeoutMs: 1000 });
    vi.runAllTimers();
    const result = await promise;
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TIMEOUT');
  });

  it('considera respuesta malformada como error de motor', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { transcribeAudioWithResult } = await import('@/src/lib/stt');

    const result = await transcribeAudioWithResult('file://nota.m4a');

    expect(result.ok).toBe(false);
    expect(result.code).toBe('ENGINE');
  });
});

describe('transcribeAudioWithFallback', () => {
  beforeEach(() => {
    vi.resetModules();
    envState.AI_BACKEND_BASE_URL = null as unknown as string;
    getInfoAsync.mockResolvedValue({ exists: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('devuelve texto de respaldo cuando el backend no está disponible', async () => {
    const { transcribeAudioWithFallback, STT_FALLBACK_TEXT } = await import('@/src/lib/stt');

    const result = await transcribeAudioWithFallback('file://nota.m4a');

    expect(result.fromFallback).toBe(true);
    expect(result.text).toBe(STT_FALLBACK_TEXT);
    expect(result.code).toBe('UNAVAILABLE');
  });

  it('permite sobrescribir el texto de respaldo', async () => {
    const { transcribeAudioWithFallback } = await import('@/src/lib/stt');

    const result = await transcribeAudioWithFallback('file://nota.m4a', {
      fallbackText: '[sin transcripción]',
    });

    expect(result.text).toBe('[sin transcripción]');
  });

  it('usa fallback ante errores de red devolviendo el código específico', async () => {
    envState.AI_BACKEND_BASE_URL = 'https://ai.example';
    getInfoAsync.mockResolvedValue({ exists: true });
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Network down');
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { transcribeAudioWithFallback, STT_FALLBACK_TEXT } = await import('@/src/lib/stt');

    const result = await transcribeAudioWithFallback('file://nota.m4a');

    expect(fetchMock).toHaveBeenCalled();
    expect(result.fromFallback).toBe(true);
    expect(result.code).toBe('NETWORK');
    expect(result.text).toBe(STT_FALLBACK_TEXT);
  });

  it('retorna fallback cuando el archivo no existe', async () => {
    envState.AI_BACKEND_BASE_URL = 'https://ai.example';
    getInfoAsync.mockResolvedValue({ exists: false });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { transcribeAudioWithFallback, STT_FALLBACK_TEXT } = await import('@/src/lib/stt');

    const result = await transcribeAudioWithFallback('file://nota.m4a');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.fromFallback).toBe(true);
    expect(result.code).toBe('ENGINE');
    expect(result.text).toBe(STT_FALLBACK_TEXT);
  });
});

describe('createSttService', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    envState.STT_ENDPOINT = 'https://stt.example';
  });

  it('devuelve servicio no soportado cuando no hay endpoint configurado', async () => {
    envState.STT_ENDPOINT = '' as unknown as string;
    const { createSttService } = await import('@/src/lib/stt');

    const service = createSttService();

    expect(service.getStatus()).toBe('error');
    expect(service.getLastError()).toBe('UNSUPPORTED');
  });

  it('degrada a servicio no soportado en plataformas web', async () => {
    const { Platform } = await import('react-native');
    const originalOs = Platform.OS;
    (Platform as any).OS = 'web';

    const { createSttService } = await import('@/src/lib/stt');
    const service = createSttService();

    expect(service.getStatus()).toBe('error');
    expect(service.getLastError()).toBe('UNSUPPORTED');

    (Platform as any).OS = originalOs;
  });
});
