// @ts-nocheck
// src/lib/audio.ts
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

/**
 * Solicita permisos de micrófono si aún no están concedidos.
 */
export async function ensureAudioPermissions(): Promise<boolean> {
  const { status } = await Audio.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Inicia la grabación con el preset de alta calidad de expo-av@16.
 * (Antes: Audio.RECORDING_OPTIONS_PRESET_HIGH_QUALITY)
 */
export async function startRecording(): Promise<Audio.Recording> {
  const hasPerm = await ensureAudioPermissions();
  if (!hasPerm) throw new Error('Permiso de micrófono denegado');

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    interruptionModeIOS: 1, // default
    shouldDuckAndroid: true,
    staysActiveInBackground: false,
  });

  const recording = new Audio.Recording();
  // 👇 Nuevo nombre en expo-av 16
  await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  await recording.startAsync();
  return recording;
}

/**
 * Detiene la grabación y devuelve la URI del archivo (o null).
 */
export async function stopRecording(recording: Audio.Recording): Promise<string | null> {
  try {
    await recording.stopAndUnloadAsync();
  } catch {
    // si ya estaba parada, ignoramos
  }
  const uri = recording.getURI() ?? null;
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
