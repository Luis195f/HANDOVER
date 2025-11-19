// src/screens/AudioNote.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  useAudioRecorder,
  setAudioModeAsync,
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  type RecordingOptions,
  type PermissionResponse,
} from "expo-audio";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  createSttService,
  type SttErrorCode,
  type SttService,
  type SttStatus,
} from "@/src/lib/stt";

type AudioNoteStackParamList = { AudioNote: { onDoneRoute?: string } | undefined };

const FALLBACK_PRESET =
  RecordingPresets.HIGH_QUALITY ??
  RecordingPresets.LOW_QUALITY ??
  Object.values(RecordingPresets)[0];

if (!FALLBACK_PRESET) {
  throw new Error("Expo Audio recording presets unavailable");
}

const REC_OPTS = FALLBACK_PRESET as RecordingOptions;

type Props = NativeStackScreenProps<AudioNoteStackParamList, "AudioNote">;

const sttStyles = StyleSheet.create({
  dictationButton: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#1f2a44",
    alignItems: "center",
  },
  dictationButtonActive: { backgroundColor: "#1d3a73" },
  dictationHint: { color: "#cdd6f6", marginTop: 8 },
  dictationError: { color: "#fbbf24", marginTop: 8 },
  transcriptionInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#2f3a59",
    borderRadius: 12,
    padding: 12,
    minHeight: 120,
    color: "#eaf2ff",
    backgroundColor: "#11182a",
    textAlignVertical: "top",
  },
});

const appendDictationText = (current: string, addition: string) => {
  const trimmed = addition.trim();
  if (!trimmed) {
    return current;
  }
  if (!current.trim()) {
    return trimmed;
  }
  return `${current.trimEnd()}\n${trimmed}`;
};

export default function AudioNote({ navigation }: Props) {
  const recorder = useAudioRecorder(REC_OPTS);
  const [permission, setPermission] = useState<PermissionResponse | null>(null);
  const [lastUri, setLastUri] = useState<string | null>(null);
  const sttServiceRef = useRef<SttService>(createSttService());
  const sttService = sttServiceRef.current;
  const [transcription, setTranscription] = useState('');
  const [dictationStatus, setDictationStatus] = useState<SttStatus>(sttService.getStatus());
  const [dictationError, setDictationError] = useState<SttErrorCode | null>(sttService.getLastError());
  const [dictatedPartial, setDictatedPartial] = useState('');

  const requestPermission = useCallback(async () => {
    const result = await requestRecordingPermissionsAsync();
    setPermission(result);
    return result;
  }, []);

  const loadInitialPermission = useCallback(async () => {
    const current = await getRecordingPermissionsAsync();
    setPermission(current);
    if (!current.granted) {
      await requestPermission();
    }
  }, [requestPermission]);

  useEffect(() => {
    void loadInitialPermission();
  }, [loadInitialPermission]);

  useEffect(() => {
    if (!permission?.granted) {
      return;
    }
    void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
  }, [permission]);

  const ensurePermissionGranted = useCallback(async () => {
    if (permission?.granted) {
      return true;
    }
    const result = await requestPermission();
    return result.granted;
  }, [permission, requestPermission]);

  useEffect(() => {
    if (!recorder.isRecording && recorder.uri && recorder.uri !== lastUri) {
      setLastUri(recorder.uri);
    }
  }, [recorder.isRecording, recorder.uri, lastUri]);

  useEffect(() => {
    const unsubscribe = sttService.addListener((result) => {
      setDictationStatus(sttService.getStatus());
      setDictationError(sttService.getLastError());
      if (!result.isFinal) {
        setDictatedPartial(result.text);
        return;
      }
      setDictatedPartial('');
      const trimmed = result.text.trim();
      if (trimmed) {
        setTranscription((current) => appendDictationText(current, trimmed));
      }
    });
    return () => {
      unsubscribe();
      void sttService.cancel();
    };
  }, [sttService]);

  const dictationUnavailable =
    dictationError === 'UNSUPPORTED' || sttService.getLastError() === 'UNSUPPORTED';

  const toggleDictation = async () => {
    if (dictationUnavailable) {
      setDictationError('UNSUPPORTED');
      return;
    }
    if (dictationStatus === 'listening') {
      try {
        setDictationStatus('processing');
        await sttService.stop();
      } catch (error) {
        console.warn('[audio-note] stt stop error', error);
        setDictationError(sttService.getLastError() ?? 'UNKNOWN');
      } finally {
        setDictationStatus(sttService.getStatus());
      }
      return;
    }
    setDictatedPartial('');
    setDictationError(null);
    try {
      await sttService.start({ locale: 'es-ES', interimResults: true, maxSeconds: 120 });
    } catch (error) {
      console.warn('[audio-note] stt start error', error);
      setDictationError(sttService.getLastError() ?? 'UNKNOWN');
    } finally {
      setDictationStatus(sttService.getStatus());
    }
  };

  const startRecording = async () => {
    if (typeof recorder.prepareToRecordAsync === "function") {
      await recorder.prepareToRecordAsync();
    }
    recorder.record?.();
  };

  const stopRecording = async () => {
    const maybeUri = (await recorder.stop?.()) as unknown;
    const uri =
      (typeof maybeUri === "string" && maybeUri.length > 0 && maybeUri) ||
      recorder.uri ||
      null;
    if (uri) {
      setLastUri(uri);
    }
    return uri;
  };

  const onToggle = async () => {
    if (recorder.isRecording) {
      await stopRecording();
      return;
    }
    const granted = await ensurePermissionGranted();
    if (!granted) {
      return;
    }
    await startRecording();
  };

  const accept = () => {
    const uri = lastUri ?? recorder.uri;
    if (uri) {
      // mismo patrón que usabas antes para devolver el URI
      (global as any).__lastAudioUri = uri;
      (global as any).__lastAudioTranscription = transcription;
      navigation.goBack();
    }
  };

  const hasUri = useMemo(() => !!(lastUri ?? recorder.uri), [lastUri, recorder.uri]);

  return (
    <View style={{ flex: 1, backgroundColor: "#0b1220", padding: 16 }}>
      <Text style={{ color: "#eaf2ff", fontSize: 18, fontWeight: "700", marginBottom: 12 }}>
        Nota de audio
      </Text>

      <Pressable
        onPress={onToggle}
        style={({ pressed }) => ({
          padding: 16,
          borderRadius: 12,
          backgroundColor: pressed ? "#6b2d2d" : "#8b2e2e",
          alignItems: "center",
        })}
      >
        <Text style={{ color: "#fff", fontWeight: "700" }}>
          {recorder.isRecording ? "Detener" : "Grabar"}
        </Text>
      </Pressable>

      <Pressable
        onPress={toggleDictation}
        disabled={dictationUnavailable}
        style={({ pressed }) => ({
          ...sttStyles.dictationButton,
          ...(dictationStatus === 'listening' ? sttStyles.dictationButtonActive : null),
          opacity: pressed && !dictationUnavailable ? 0.85 : 1,
        })}
      >
        <Text style={{ color: '#eaf2ff', fontWeight: '700' }}>
          {dictationStatus === 'listening' ? 'Detener dictado' : 'Dictar nota (transcripción)'}
        </Text>
      </Pressable>
      {dictationStatus === 'listening' && (
        <Text style={sttStyles.dictationHint}>
          Escuchando… {dictatedPartial ? `“${dictatedPartial}”` : ''}
        </Text>
      )}
      {dictationStatus === 'processing' && (
        <Text style={sttStyles.dictationHint}>Procesando transcripción…</Text>
      )}
      {dictationError && dictationError !== 'UNSUPPORTED' && (
        <Text style={sttStyles.dictationError}>
          {dictationError === 'PERMISSION_DENIED'
            ? 'Activa los permisos de micrófono para dictar la nota.'
            : 'No pudimos transcribir en este momento. Puedes seguir editando el texto manualmente.'}
        </Text>
      )}
      {dictationUnavailable && (
        <Text style={sttStyles.dictationError}>
          La transcripción por voz no está disponible en este dispositivo.
        </Text>
      )}
      <TextInput
        style={sttStyles.transcriptionInput}
        multiline
        placeholder="Transcripción editable de la nota"
        placeholderTextColor="#7081a7"
        value={transcription}
        onChangeText={setTranscription}
      />
      <Text style={{ color: '#9fb3d9', marginTop: 8 }}>
        Puedes editar el texto antes de adjuntarlo.
      </Text>
      {/* TODO: Integrar envío automático del audio grabado al backend Whisper para generar esta transcripción sin dictado manual. */}

      {hasUri && (
        <>
          <Text style={{ color: "#9fb3d9", marginTop: 12 }}>
            Archivo: {(lastUri ?? recorder.uri)?.split("/").pop()}
          </Text>
          <Pressable
            onPress={accept}
            style={({ pressed }) => ({
              padding: 12,
              borderRadius: 10,
              backgroundColor: pressed ? "#2f6b3a" : "#2b7a46",
              alignItems: "center",
              marginTop: 12,
            })}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>Adjuntar al handover</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
