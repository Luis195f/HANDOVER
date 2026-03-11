import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envState = {
  API_BASE_URL: 'https://api.example',
  AI_TRANSCRIBE_ENDPOINT: 'https://api.example/api/ai/transcribe',
  FHIR_BASE_URL: 'http://fhir.example',
  API_BASE: '',
};

vi.mock('@/src/config/env', () => ({
  get API_BASE_URL() {
    return envState.API_BASE_URL;
  },
  get AI_TRANSCRIBE_ENDPOINT() {
    return envState.AI_TRANSCRIBE_ENDPOINT;
  },
  get FHIR_BASE_URL() {
    return envState.FHIR_BASE_URL;
  },
  get API_BASE() {
    return envState.API_BASE;
  },
  ENV: envState,
}));

const getInfoAsync = vi.fn();


vi.mock('@/src/security/auth', () => ({
  ensureFreshAccessToken: vi.fn(async () => 'tok_test_123'),
}));
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
    envState.API_BASE_URL = 'https://api.example';
    envState.AI_TRANSCRIBE_ENDPOINT = 'https://api.example/api/ai/transcribe';
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

    expect(fetchMock).toHaveBeenCalledWith('https://api.example/api/ai/transcribe', expect.any(Object));
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
    await Promise.resolve();
    vi.runAllTimers();
    const result = await promise;
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TIMEOUT');
  });


  it('mapea 413, 415, 401 y 500 a códigos de error consistentes', async () => {
    const { transcribeAudioWithResult } = await import('@/src/lib/stt');

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 413, json: async () => ({}) })) as unknown as typeof fetch);
    const tooLarge = await transcribeAudioWithResult('file://nota.m4a');
    expect(tooLarge).toMatchObject({ ok: false, code: 'ENGINE', error: 'Payload Too Large' });

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 415, json: async () => ({}) })) as unknown as typeof fetch);
    const unsupported = await transcribeAudioWithResult('file://nota.m4a');
    expect(unsupported).toMatchObject({ ok: false, code: 'ENGINE', error: 'Unsupported Media Type' });

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch);
    const unauthorized = await transcribeAudioWithResult('file://nota.m4a');
    expect(unauthorized).toMatchObject({ ok: false, code: 'UNAVAILABLE' });

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch);
    const server = await transcribeAudioWithResult('file://nota.m4a');
    expect(server).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
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
    getInfoAsync.mockResolvedValue({ exists: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('devuelve texto de respaldo cuando falla la red', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Network down');
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { transcribeAudioWithFallback, STT_FALLBACK_TEXT } = await import('@/src/lib/stt');

    const result = await transcribeAudioWithFallback('file://nota.m4a');

    expect(result.fromFallback).toBe(true);
    expect(result.text).toBe(STT_FALLBACK_TEXT);
    expect(result.code).toBe('NETWORK');
  });

  it('permite sobrescribir el texto de respaldo', async () => {
    const { transcribeAudioWithFallback } = await import('@/src/lib/stt');

    const result = await transcribeAudioWithFallback('file://nota.m4a', {
      fallbackText: '[sin transcripción]',
    });

    expect(result.text).toBe('[sin transcripción]');
  });

  it('usa fallback ante errores de red devolviendo el código específico', async () => {
    envState.API_BASE_URL = 'https://api.example';
    envState.AI_TRANSCRIBE_ENDPOINT = 'https://api.example/api/ai/transcribe';
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
    envState.API_BASE_URL = 'https://api.example';
    envState.AI_TRANSCRIBE_ENDPOINT = 'https://api.example/api/ai/transcribe';
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
    envState.API_BASE_URL = 'https://api.example';
    envState.AI_TRANSCRIBE_ENDPOINT = 'https://api.example/api/ai/transcribe';
  });

  it('devuelve servicio no soportado cuando no hay API base configurada', async () => {
    envState.API_BASE_URL = '' as unknown as string;
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
