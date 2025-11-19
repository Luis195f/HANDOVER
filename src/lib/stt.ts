// Fase 3 – Bloque A (STT) implementado: servicio de transcripción de voz con adaptador y fallback.
import { Platform } from 'react-native';
import { Audio, type PermissionResponse } from 'expo-av';
import * as FileSystem from 'expo-file-system';

import { STT_ENDPOINT } from '@/src/config/env';

export type SttStatus = 'idle' | 'listening' | 'processing' | 'error';

export type SttErrorCode =
  | 'PERMISSION_DENIED'
  | 'NETWORK'
  | 'ENGINE'
  | 'UNSUPPORTED'
  | 'UNKNOWN';

export interface SttResult {
  text: string;
  isFinal: boolean;
}

export interface SttConfig {
  locale: 'es-ES' | 'en-US';
  interimResults?: boolean;
  maxSeconds?: number;
}

export interface SttService {
  start(config: SttConfig): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  addListener(handler: (result: SttResult) => void): () => void;
  getStatus(): SttStatus;
  getLastError(): SttErrorCode | null;
}

type Listener = (result: SttResult) => void;

type TranscriptionPayload = {
  locale: SttConfig['locale'];
  audioBase64: string;
  mimeType: string;
};

const SUPPORTED_PLATFORMS = new Set(['ios', 'android']);

class NativeSttService implements SttService {
  private status: SttStatus = 'idle';
  private lastError: SttErrorCode | null = null;
  private readonly listeners = new Set<Listener>();
  private recording: Audio.Recording | null = null;
  private recordingUri: string | null = null;
  private readonly endpoint: string;
  private activeLocale: SttConfig['locale'] = 'es-ES';
  private autoStopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  async start(config: SttConfig): Promise<void> {
    if (this.status === 'listening' || this.status === 'processing') {
      await this.cancel();
    }

    this.clearAutoStopTimer();
    this.lastError = null;
    this.activeLocale = config.locale;

    const permission = await this.ensurePermission();
    if (!permission) {
      this.setErrorState('PERMISSION_DENIED');
      throw new Error('Microphone permission denied');
    }

    await this.prepareRecorder();
    this.status = 'listening';
    this.scheduleAutoStop(config.maxSeconds);
  }

  async stop(): Promise<void> {
    if (!this.recording) {
      this.status = 'idle';
      return;
    }

    this.status = 'processing';
    this.clearAutoStopTimer();

    try {
      await this.recording.stopAndUnloadAsync();
      this.recordingUri = this.recording.getURI();
    } catch (error) {
      this.setErrorState('ENGINE');
      console.warn('[stt] stop error', error);
      throw error instanceof Error ? error : new Error('Failed to stop recording');
    } finally {
      this.recording = null;
    }

    if (!this.recordingUri) {
      this.setErrorState('ENGINE');
      throw new Error('Recording URI unavailable');
    }

    try {
      const text = await this.sendForTranscription(this.recordingUri, this.activeLocale);
      this.status = 'idle';
      this.notifyListeners({ text, isFinal: true });
    } catch (error) {
      this.setErrorState(error === NETWORK_ERROR ? 'NETWORK' : 'ENGINE');
      throw error instanceof Error ? error : new Error('Transcription failed');
    } finally {
      await this.cleanupRecordingFile();
    }
  }

  async cancel(): Promise<void> {
    this.clearAutoStopTimer();
    if (this.recording) {
      try {
        await this.recording.stopAndUnloadAsync();
      } catch (error) {
        console.warn('[stt] cancel stop error', error);
      }
      this.recording = null;
    }
    await this.cleanupRecordingFile();
    this.status = 'idle';
  }

  addListener(handler: Listener): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  getStatus(): SttStatus {
    return this.status;
  }

  getLastError(): SttErrorCode | null {
    return this.lastError;
  }

  private async ensurePermission(): Promise<boolean> {
    const current: PermissionResponse | undefined =
      typeof Audio.getPermissionsAsync === 'function' ? await Audio.getPermissionsAsync() : undefined;
    if (current?.granted) {
      return true;
    }
    const response = await Audio.requestPermissionsAsync();
    return response.granted;
  }

  private async prepareRecorder(): Promise<void> {
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const recorder = new Audio.Recording();
    await recorder.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await recorder.startAsync();
    this.recording = recorder;
    this.recordingUri = null;
  }

  private scheduleAutoStop(maxSeconds?: number): void {
    this.clearAutoStopTimer();
    if (!maxSeconds || maxSeconds <= 0) {
      return;
    }
    this.autoStopTimer = setTimeout(() => {
      void this.stop().catch((error) => {
        console.warn('[stt] auto stop error', error);
      });
    }, maxSeconds * 1000);
  }

  private clearAutoStopTimer(): void {
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
  }

  private async cleanupRecordingFile(): Promise<void> {
    if (this.recordingUri) {
      try {
        await FileSystem.deleteAsync(this.recordingUri, { idempotent: true });
      } catch (error) {
        console.warn('[stt] cleanup error', error);
      }
      this.recordingUri = null;
    }
  }

  private notifyListeners(result: SttResult): void {
    for (const listener of this.listeners) {
      listener(result);
    }
  }

  private setErrorState(code: SttErrorCode): void {
    this.status = 'error';
    this.lastError = code;
  }

  private async sendForTranscription(uri: string, locale: SttConfig['locale']): Promise<string> {
    try {
      const audioBase64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const payload: TranscriptionPayload = { locale, audioBase64, mimeType: 'audio/m4a' };
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw ENGINE_ERROR;
      }
      const data = (await response.json()) as { text?: string; segments?: Array<{ text?: string }> };
      if (typeof data.text === 'string') {
        return data.text.trim();
      }
      if (Array.isArray(data.segments)) {
        return data.segments.map((segment) => (segment?.text ?? '').trim()).filter(Boolean).join(' ');
      }
      return '';
    } catch (error) {
      if (error === ENGINE_ERROR) {
        throw ENGINE_ERROR;
      }
      if (error instanceof TypeError) {
        throw NETWORK_ERROR;
      }
      throw ENGINE_ERROR;
    }
  }
}

class UnsupportedSttService implements SttService {
  private status: SttStatus = 'error';
  private lastError: SttErrorCode | null = 'UNSUPPORTED';

  async start(): Promise<void> {
    this.status = 'error';
    this.lastError = 'UNSUPPORTED';
  }

  async stop(): Promise<void> {
    this.status = 'idle';
  }

  async cancel(): Promise<void> {
    this.status = 'idle';
  }

  addListener(): () => void {
    return () => undefined;
  }

  getStatus(): SttStatus {
    return this.status;
  }

  getLastError(): SttErrorCode | null {
    return this.lastError;
  }
}

const NETWORK_ERROR = Symbol('NETWORK_ERROR');
const ENGINE_ERROR = Symbol('ENGINE_ERROR');

export function createSttService(): SttService {
  const endpoint = STT_ENDPOINT?.trim();
  if (!endpoint || !SUPPORTED_PLATFORMS.has(Platform.OS)) {
    return new UnsupportedSttService();
  }
  return new NativeSttService(endpoint);
}
