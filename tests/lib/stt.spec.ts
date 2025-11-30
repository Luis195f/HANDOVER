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
});
