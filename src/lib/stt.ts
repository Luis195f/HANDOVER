// Fase 3 – Bloque A (STT) implementado: servicio de transcripción de voz con adaptador y fallback.
import { Platform } from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
  type PermissionResponse,
  type RecordingOptions,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system';

import { AI_TRANSCRIBE_ENDPOINT, API_BASE_URL } from '@/src/config/env';
import { ensureFreshAccessToken } from '@/src/security/auth';

export type SttStatus = 'idle' | 'listening' | 'processing' | 'error';

export type SttErrorCode =
  | 'PERMISSION_DENIED'
  | 'NETWORK'
  | 'ENGINE'
  | 'UNSUPPORTED'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface SttResult {
  text: string;
  isFinal: boolean;
}

export interface SttTranscriptionResult {
  text: string;
  fromFallback: boolean;
  code?: SttErrorCode;
}

export class STTError extends Error {
  code: SttErrorCode;
  status?: number;

  constructor(code: SttErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'STTError';
    this.code = code;
    this.status = status;
  }
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
const BACKEND_FALLBACK_PLATFORMS = new Set(['ios', 'android']);

const STT_RECORDING_OPTIONS =
  RecordingPresets.HIGH_QUALITY ??
  RecordingPresets.LOW_QUALITY ??
  Object.values(RecordingPresets)[0] ??
  null;

if (!STT_RECORDING_OPTIONS) {
  throw new Error('Expo Audio recording presets unavailable');
}

const STT_PRESET = STT_RECORDING_OPTIONS as RecordingOptions;

class NativeSttService implements SttService {
  private status: SttStatus = 'idle';
  private lastError: SttErrorCode | null = null;
  private readonly listeners = new Set<Listener>();
  private recording: AudioRecorder | null = null;
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
      await this.recording.stop();
      this.recordingUri = this.recording.uri ?? null;
    } catch (error) {
      this.setErrorState('ENGINE');
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
        await this.recording.stop();
      } catch {
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
    const current: PermissionResponse | null = await getRecordingPermissionsAsync();
    if (current?.granted) {
      return true;
    }
    const response = await requestRecordingPermissionsAsync();
    return response.granted;
  }

  private async prepareRecorder(): Promise<void> {
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    const recorder = new AudioModule.AudioRecorder(STT_PRESET);
    await recorder.prepareToRecordAsync(STT_PRESET);
    recorder.record();
    this.recording = recorder;
    this.recordingUri = null;
  }

  private scheduleAutoStop(maxSeconds?: number): void {
    this.clearAutoStopTimer();
    if (!maxSeconds || maxSeconds <= 0) {
      return;
    }
    this.autoStopTimer = setTimeout(() => {
      void this.stop().catch(() => {});
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
      } catch {
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

const TRANSCRIPTION_ERROR_MESSAGE = 'No se pudo transcribir el audio con IA';
export const STT_FALLBACK_TEXT = '[Transcripción no disponible]';

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/m4a',
  'audio/x-m4a',
  'audio/mp3',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
]);

const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
  m4a: 'audio/m4a',
  mp3: 'audio/mp3',
  wav: 'audio/wav',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
};

export function createSttService(): SttService {
  if (API_BASE_URL && BACKEND_FALLBACK_PLATFORMS.has(Platform.OS)) {
    return new BackendFallbackSttService();
  }
  return new UnsupportedSttService();
}

const defaultTranscriptionMock = async (): Promise<string> => '';

function resolveMimeType(fileUri: string): string {
  const [, extension = ''] = /\.([a-z0-9]+)$/i.exec(fileUri) ?? [];
  const normalized = extension.toLowerCase();
  return AUDIO_MIME_BY_EXTENSION[normalized] ?? 'audio/m4a';
}

function normalizeAllowedMimeType(mimeType: string): string {
  if (mimeType === 'audio/mp4') return 'audio/m4a';
  return mimeType;
}

const isAbortError = (error: unknown): error is Error =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

const normalizeSttError = (error: unknown): STTError => {
  if (error instanceof STTError) return error;
  if (isAbortError(error)) {
    return new STTError('TIMEOUT', 'Request timed out');
  }
  if (error instanceof TypeError || (error instanceof Error && /network|fetch/i.test(error.message))) {
    return new STTError('NETWORK', 'Network error');
  }
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') {
      return new STTError('ENGINE', `Engine error (${status})`, status);
    }
  }
  return new STTError('ENGINE', TRANSCRIPTION_ERROR_MESSAGE);
};

const parseJsonSafe = async (response: Response): Promise<any | undefined> => {
  const anyResponse = response as unknown as { json?: () => Promise<any>; clone?: () => Response };
  if (typeof anyResponse?.json === 'function') {
    try {
      return await anyResponse.json();
    } catch {
      // ignore
    }
  }
  if (typeof anyResponse?.clone === 'function') {
    try {
      return await anyResponse.clone().json();
    } catch {
      // ignore
    }
  }
  return undefined;
};

export type TranscriptionOptions = { language?: string; timeoutMs?: number };
export type STTProvider = (fileUri: string, options?: TranscriptionOptions) => Promise<SttTranscriptionResult>;

export async function transcribeAudioViaBackend(
  fileUri: string,
  options?: TranscriptionOptions,
): Promise<string> {
  const token = await ensureFreshAccessToken();
  const headers = new Headers();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const name = fileUri.split('/').pop() ?? 'audio.m4a';
  const resolvedMime = normalizeAllowedMimeType(resolveMimeType(name));
  if (!ALLOWED_AUDIO_MIME_TYPES.has(resolvedMime)) {
    throw new STTError('ENGINE', 'Audio inválido o formato no soportado');
  }
  const formData = new FormData();
  formData.append('file', { uri: fileUri, name, type: resolvedMime } as unknown as Blob);
  if (options?.language) {
    formData.append('language', options.language);
  }

  const timeoutMs = options?.timeoutMs ?? 20_000;
  const controller = new AbortController();
  let timeoutReject: (() => void) | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutReject = () => reject(new STTError('TIMEOUT', TRANSCRIPTION_ERROR_MESSAGE));
  });
  const timer = setTimeout(() => {
    controller.abort();
    timeoutReject?.();
  }, timeoutMs);

  const info =
    typeof FileSystem.getInfoAsync === 'function'
      ? await FileSystem.getInfoAsync(fileUri)
      : { exists: true as const };
  if (!info?.exists) {
    throw new STTError('ENGINE', TRANSCRIPTION_ERROR_MESSAGE);
  }

  try {
    const response = await Promise.race([
      fetch(AI_TRANSCRIBE_ENDPOINT, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);

    if (!response.ok) {
      const data = await parseJsonSafe(response);
      const status = response.status || (data as { status?: number } | undefined)?.status;
      const resolvedStatus = typeof status === 'number' ? status : response.status;
      if (resolvedStatus === 401) throw new STTError('UNAVAILABLE', TRANSCRIPTION_ERROR_MESSAGE, resolvedStatus);
      if (resolvedStatus === 413) throw new STTError('ENGINE', 'Payload Too Large', resolvedStatus);
      if (resolvedStatus === 415) throw new STTError('ENGINE', 'Unsupported Media Type', resolvedStatus);
      if (resolvedStatus >= 500) throw new STTError('UNAVAILABLE', TRANSCRIPTION_ERROR_MESSAGE, resolvedStatus);
      throw new STTError('ENGINE', TRANSCRIPTION_ERROR_MESSAGE, resolvedStatus);
    }

    const data = (await parseJsonSafe(response)) as { text?: string } | undefined;
    if (!data || typeof data.text !== 'string') {
      throw new STTError('ENGINE', TRANSCRIPTION_ERROR_MESSAGE);
    }

    return data.text;
  } catch (error) {
    throw normalizeSttError(error);
  } finally {
    clearTimeout(timer);
  }
}

class BackendFallbackSttService implements SttService {
  private status: SttStatus = 'idle';
  private lastError: SttErrorCode | null = null;
  private readonly listeners = new Set<Listener>();
  private recording: AudioRecorder | null = null;
  private recordingUri: string | null = null;
  private activeLocale: SttConfig['locale'] = 'es-ES';
  private autoStopTimer: ReturnType<typeof setTimeout> | null = null;

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
      await this.recording.stop();
      this.recordingUri = this.recording.uri ?? null;
    } catch (error) {
      this.setErrorState('ENGINE');
      throw error instanceof Error ? error : new Error('Failed to stop recording');
    } finally {
      this.recording = null;
    }

    if (!this.recordingUri) {
      this.setErrorState('ENGINE');
      throw new Error('Recording URI unavailable');
    }

    try {
      const text = await transcribeAudioViaBackend(this.recordingUri, {
        language: this.activeLocale.startsWith('en') ? 'en' : 'es',
      });
      this.status = 'idle';
      this.notifyListeners({ text, isFinal: true });
    } catch (error) {
      const normalized = normalizeSttError(error);
      this.setErrorState(normalized.code);
      throw error instanceof Error ? error : new Error('Transcription failed');
    } finally {
      await this.cleanupRecordingFile();
    }
  }

  async cancel(): Promise<void> {
    this.clearAutoStopTimer();
    if (this.recording) {
      try {
        await this.recording.stop();
      } catch {
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
    const current: PermissionResponse | null = await getRecordingPermissionsAsync();
    if (current?.granted) {
      return true;
    }
    const response = await requestRecordingPermissionsAsync();
    return response.granted;
  }

  private async prepareRecorder(): Promise<void> {
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    const recorder = new AudioModule.AudioRecorder(STT_PRESET);
    await recorder.prepareToRecordAsync(STT_PRESET);
    recorder.record();
    this.recording = recorder;
    this.recordingUri = null;
  }

  private scheduleAutoStop(maxSeconds?: number): void {
    this.clearAutoStopTimer();
    if (!maxSeconds || maxSeconds <= 0) {
      return;
    }
    this.autoStopTimer = setTimeout(() => {
      void this.stop().catch(() => {});
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
      } catch {
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
}

export async function transcribeAudio(
  fileUri: string,
  options?: TranscriptionOptions,
): Promise<string> {
  try {
    return await transcribeAudioViaBackend(fileUri, options);
  } catch (error) {
    throw normalizeSttError(error);
  }
}

export type TranscriptionResult =
  | { ok: true; text: string }
  | { ok: false; error: string; code?: SttErrorCode };

export async function transcribeAudioWithResult(
  fileUri: string,
  options?: TranscriptionOptions,
): Promise<TranscriptionResult> {
  try {
    const text = await transcribeAudio(fileUri, options);
    return { ok: true, text };
  } catch (error) {
    const normalized = normalizeSttError(error);
    const message = normalized.message || TRANSCRIPTION_ERROR_MESSAGE;
    return { ok: false, error: message, code: normalized.code };
  }
}

export async function transcribeAudioWithFallback(
  fileUri: string,
  options?: TranscriptionOptions & { fallbackText?: string },
): Promise<SttTranscriptionResult> {
  const fallbackText = options?.fallbackText ?? STT_FALLBACK_TEXT;
  const result = await transcribeAudioWithResult(fileUri, options);
  if (result.ok) {
    return { text: result.text, fromFallback: false };
  }
  return { text: fallbackText, fromFallback: true, code: result.code ?? 'UNKNOWN' };
}
