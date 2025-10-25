// @ts-nocheck
// src/lib/audio.ts
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  type AudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system';

const FALLBACK_PRESET =
  RecordingPresets.HIGH_QUALITY ??
  RecordingPresets.LOW_QUALITY ??
  Object.values(RecordingPresets)[0];

if (!FALLBACK_PRESET) {
  throw new Error('Expo Audio recording presets unavailable');
}

const DEFAULT_RECORDING_OPTIONS = FALLBACK_PRESET as RecordingOptions;

/**
 * Solicita permisos de micrófono si aún no están concedidos.
 */
export async function ensureAudioPermissions(): Promise<boolean> {
  const status = await AudioModule.requestRecordingPermissionsAsync();
  return status.granted;
}

/**
 * Inicia la grabación con el preset de alta calidad de expo-audio.
 */
export async function startRecording(): Promise<AudioRecorder> {
  const hasPerm = await ensureAudioPermissions();
  if (!hasPerm) throw new Error('Permiso de micrófono denegado');

  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });

  const recorder = new AudioModule.AudioRecorder(DEFAULT_RECORDING_OPTIONS);
  await recorder.prepareToRecordAsync(DEFAULT_RECORDING_OPTIONS);
  recorder.record();
  return recorder;
}

/**
 * Detiene la grabación y devuelve la URI del archivo (o null).
 */
export async function stopRecording(recording: AudioRecorder): Promise<string | null> {
  try {
    await recording.stop();
  } catch {
    // si ya estaba parada, ignoramos
  }
  const uri = recording.uri ?? null;
  return uri;
}

/**
 * Lee un archivo binario (por URI) y lo devuelve en base64.
 * expo-file-system@19: usar string literals en encoding.
 */
export async function readFileAsBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
}

/**
 * Convierte una URI de audio en Data URL base64 con contentType opcional.
 */
export async function audioUriToDataUrl(uri: string, contentType = 'audio/mpeg'): Promise<string> {
  const b64 = await readFileAsBase64(uri);
  return `data:${contentType};base64,${b64}`;
}

/**
 * Utilidad opcional: borra un archivo si existe.
 */
export async function safeDeleteAsync(uri?: string | null): Promise<void> {
  if (!uri) return;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch {
    // No romper si falla la limpieza
  }
}

// Export default para soportar imports antiguos: import audio from './audio'
export default {
  ensureAudioPermissions,
  startRecording,
  stopRecording,
  readFileAsBase64,
  audioUriToDataUrl,
  safeDeleteAsync,
};
