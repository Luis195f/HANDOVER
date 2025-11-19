import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { Platform } from 'react-native';
import { createSttService } from '@/src/lib/stt';

const recordingInstances: Array<{
  prepareToRecordAsync: ReturnType<typeof vi.fn>;
  startAsync: ReturnType<typeof vi.fn>;
  stopAndUnloadAsync: ReturnType<typeof vi.fn>;
  getURI: ReturnType<typeof vi.fn>;
}> = [];

function mockRecordingFactory() {
  const instance = {
    prepareToRecordAsync: vi.fn(async () => undefined),
    startAsync: vi.fn(async () => undefined),
    stopAndUnloadAsync: vi.fn(async () => undefined),
    getURI: vi.fn(() => 'file://recording.m4a'),
  };
  recordingInstances.push(instance);
  return instance;
}

const mockAudioModule = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
  setAudioModeAsync: vi.fn(async () => undefined),
  Recording: vi.fn(() => mockRecordingFactory()),
  RecordingOptionsPresets: { HIGH_QUALITY: {} },
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { FHIR_BASE_URL: 'https://fhir.test', STT_ENDPOINT: 'https://stt.test' } } },
}));

vi.mock('expo-av', () => ({
  Audio: mockAudioModule,
}));

const fileSystemMocks = vi.hoisted(() => ({
  readAsStringAsync: vi.fn(async () => 'YmFzZTY0QXVkaW8='),
  deleteAsync: vi.fn(async () => undefined),
  EncodingType: { Base64: 'base64' },
}));

vi.mock('expo-file-system', () => fileSystemMocks);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface Global {
      fetch?: typeof fetch;
    }
  }
}

const mockFetch = vi.fn(async () => ({ ok: true, json: async () => ({ text: 'nota dictada' }) }));

beforeEach(() => {
  recordingInstances.splice(0, recordingInstances.length);
  mockAudioModule.getPermissionsAsync.mockClear();
  mockAudioModule.requestPermissionsAsync.mockClear();
  mockAudioModule.setAudioModeAsync.mockClear();
  mockAudioModule.Recording.mockClear();
  fileSystemMocks.readAsStringAsync.mockClear();
  fileSystemMocks.deleteAsync.mockClear();
  mockFetch.mockClear();
  (globalThis as any).fetch = mockFetch;
  Platform.OS = 'ios' as typeof Platform.OS;
});

afterEach(() => {
  delete (globalThis as any).fetch;
});

describe('createSttService', () => {
  it('records audio and returns transcription on stop', async () => {
    const service = createSttService();
    const handler = vi.fn();
    service.addListener(handler);

    await service.start({ locale: 'es-ES', maxSeconds: 5 });
    expect(mockAudioModule.Recording).toHaveBeenCalledTimes(1);

    await service.stop();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ text: 'nota dictada', isFinal: true });
    expect(service.getStatus()).toBe('idle');
  });

  it('auto stops when maxSeconds elapses', async () => {
    vi.useFakeTimers();
    try {
      const service = createSttService();
      const handler = vi.fn();
      service.addListener(handler);

      await service.start({ locale: 'es-ES', maxSeconds: 1 });
      await vi.advanceTimersByTimeAsync(1100);
      await Promise.resolve();

      expect(handler).toHaveBeenCalledWith({ text: 'nota dictada', isFinal: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks permission errors clearly', async () => {
    mockAudioModule.getPermissionsAsync.mockResolvedValueOnce({ granted: false });
    mockAudioModule.requestPermissionsAsync.mockResolvedValueOnce({ granted: false });
    const service = createSttService();
    await expect(service.start({ locale: 'es-ES' })).rejects.toThrow();
    expect(service.getLastError()).toBe('PERMISSION_DENIED');
    expect(service.getStatus()).toBe('error');
  });

  it('maps network failures to NETWORK errors', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('offline'));
    const service = createSttService();
    await service.start({ locale: 'es-ES' });
    await expect(service.stop()).rejects.toThrow();
    expect(service.getLastError()).toBe('NETWORK');
  });

  it('falls back to unsupported implementation when endpoint is missing', async () => {
    Platform.OS = 'web' as typeof Platform.OS;
    const service = createSttService();
    expect(service.getLastError()).toBe('UNSUPPORTED');
    await service.start({ locale: 'es-ES' });
    expect(service.getStatus()).toBe('error');
    Platform.OS = 'ios' as typeof Platform.OS;
  });
});
