// src/screens/AudioNote.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
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
  transcribeAudioWithResult,
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
  const [lastUri, setLastUri] = useState<string | null>(recorder.uri ?? null);
  const sttServiceRef = useRef<SttService>(createSttService());
  const hasLoggedPermissionRef = useRef(false);
  const sttService = sttServiceRef.current;
  const [transcription, setTranscription] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
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

  useEffect(() => {
    if (!permission || permission.granted) return;
    if (hasLoggedPermissionRef.current) return;
    hasLoggedPermissionRef.current = true;
    console.warn('[HNDV][WARN][PERM_MIC_DENIED]', {
      screen: 'AudioAttach',
      status: permission.status,
      canAskAgain: permission.canAskAgain,
    });
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

  const handleAiTranscription = async () => {
    const uri = lastUri ?? recorder.uri;
    if (!uri) {
      setTranscriptionError('Graba una nota antes de transcribir.');
      return;
    }

    setIsTranscribing(true);
    setTranscriptionError(null);
    try {
      const result = await transcribeAudioWithResult(uri, { language: 'es' });
      if (result.ok) {
        if (result.text.trim()) {
          setTranscription((current) => appendDictationText(current, result.text));
        }
        return;
      }
      const message =
        result.error && result.error !== 'network'
          ? result.error
          : 'No se pudo transcribir con IA. Puedes seguir escribiendo manualmente.';
      setTranscriptionError(message);
    } catch (error) {
      console.warn('[audio-note] ai transcription error', error);
      setTranscriptionError('No se pudo transcribir con IA. Inténtalo más tarde.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const startRecording = async () => {
    setRecordingError(null);
    try {
      if (typeof recorder.prepareToRecordAsync === "function") {
        await recorder.prepareToRecordAsync();
      }
      recorder.record?.();
    } catch (error) {
      console.warn('[audio-note] start recording error', error);
      setRecordingError('No se pudo iniciar la grabación. Revisa los permisos de micrófono.');
    }
  };

  const stopRecording = async () => {
    try {
      const maybeUri = (await recorder.stop?.()) as unknown;
      const uri =
        (typeof maybeUri === "string" && maybeUri.length > 0 && maybeUri) ||
        recorder.uri ||
        null;
      if (uri) {
        setLastUri(uri);
      }
      return uri;
    } catch (error) {
      console.warn('[audio-note] stop recording error', error);
      setRecordingError('No se pudo detener la grabación. Intenta nuevamente.');
      return null;
    }
  };

  const onToggle = async () => {
    if (recorder.isRecording) {
      await stopRecording();
      return;
    }
    const granted = await ensurePermissionGranted();
    if (!granted) {
      setRecordingError('Activa los permisos de micrófono para grabar la nota.');
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

  const handleOpenSettings = async () => {
    try {
      await Linking.openSettings();
    } catch {
      console.warn('[HNDV][WARN][PERM_OPEN_SETTINGS_FAILED]', { screen: 'AudioAttach' });
    }
  };

  if (permission && !permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0b1220", padding: 16, justifyContent: "center" }}>
        <Text style={{ color: "#eaf2ff", fontSize: 16, textAlign: "center" }}>
          Permiso de micrófono denegado. Actívalo en Ajustes para grabar audio.
        </Text>
        <Pressable
          onPress={handleOpenSettings}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: 16,
            paddingVertical: 12,
            borderRadius: 12,
            backgroundColor: pressed ? "#1d3a73" : "#2563EB",
            alignItems: "center",
          })}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>Abrir Ajustes</Text>
        </Pressable>
        {permission.canAskAgain ? (
          <Pressable
            onPress={requestPermission}
            accessibilityRole="button"
            style={({ pressed }) => ({
              marginTop: 12,
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: pressed ? "#1f2937" : "#E5E7EB",
              alignItems: "center",
            })}
          >
            <Text style={{ color: "#111827", fontWeight: "700" }}>Reintentar</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0b1220", padding: 16 }}>
      <Text style={{ color: "#eaf2ff", fontSize: 18, fontWeight: "700", marginBottom: 12 }}>
        Nota de audio
      </Text>

      <Pressable
        onPress={onToggle}
        testID="audio-record-toggle"
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
      {recordingError ? <Text style={sttStyles.dictationError}>{recordingError}</Text> : null}

      <Pressable
        onPress={toggleDictation}
        disabled={dictationUnavailable}
        testID="audio-dictation-toggle"
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
      <Pressable
        onPress={handleAiTranscription}
        disabled={!hasUri || isTranscribing}
        testID="audio-ai-transcribe"
        style={({ pressed }) => ({
          ...sttStyles.dictationButton,
          backgroundColor: '#0d3a5a',
          opacity: pressed && !isTranscribing ? 0.85 : 1,
        })}
      >
        <Text style={{ color: '#eaf2ff', fontWeight: '700' }}>
          {isTranscribing ? 'Transcribiendo…' : 'Transcribir nota con IA'}
        </Text>
      </Pressable>
      {isTranscribing ? <Text style={sttStyles.dictationHint}>Procesando audio…</Text> : null}
      {transcriptionError ? <Text style={sttStyles.dictationError}>{transcriptionError}</Text> : null}
      <TextInput
        style={sttStyles.transcriptionInput}
        multiline
        placeholder="Transcripción editable de la nota"
        placeholderTextColor="#7081a7"
        value={transcription}
        onChangeText={setTranscription}
        testID="audio-transcription-input"
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
