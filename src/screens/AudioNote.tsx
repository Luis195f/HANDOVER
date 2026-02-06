// src/screens/AudioNote.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import {
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
import { t } from "@/src/i18n";
import { useThemeTokens } from "@/src/theme";
import { useAudioRecorderWithFallback } from "@/src/lib/audio-recorder";

type AudioNoteStackParamList = {
  AudioNote: { onDoneRoute?: "HandoverForm" | "HandoverMain" | "PatientList" } | undefined;
};

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

export default function AudioNote({ navigation, route }: Props) {
  const { colors } = useThemeTokens();
  const recorder = useAudioRecorderWithFallback(REC_OPTS);
  const [permission, setPermission] = useState<PermissionResponse | null>(null);
  const [lastUri, setLastUri] = useState<string | null>(recorder.uri ?? null);
  const sttServiceRef = useRef<SttService>(createSttService());
  const sttService = sttServiceRef.current;
  const [transcription, setTranscription] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [dictationStatus, setDictationStatus] = useState<SttStatus>(sttService.getStatus());
  const [dictationError, setDictationError] = useState<SttErrorCode | null>(sttService.getLastError());
  const [dictatedPartial, setDictatedPartial] = useState('');
  const [uploadToFhir, setUploadToFhir] = useState(false);
  const isE2E = process.env.EXPO_PUBLIC_E2E === 'true';

  const requestPermission = useCallback(async () => {
    if (isE2E) {
      const grantedPermission: PermissionResponse = {
        status: 'granted',
        granted: true,
        canAskAgain: true,
      };
      setPermission(grantedPermission);
      return grantedPermission;
    }
    const result = await requestRecordingPermissionsAsync();
    setPermission(result);
    return result;
  }, [isE2E]);

  const loadInitialPermission = useCallback(async () => {
    if (isE2E) {
      const grantedPermission: PermissionResponse = {
        status: 'granted',
        granted: true,
        canAskAgain: true,
      };
      setPermission(grantedPermission);
      return;
    }
    const current = await getRecordingPermissionsAsync();
    setPermission(current);
    if (!current.granted) {
      await requestPermission();
    }
  }, [isE2E, requestPermission]);

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
      } catch {
        setDictationError(sttService.getLastError() ?? 'UNKNOWN');
      } finally {
        setDictationStatus(sttService.getStatus());
      }
      return;
    }
    setDictatedPartial('');
    setDictationError(null);
    try {
      const granted = await ensurePermissionGranted();
      if (!granted) {
        setDictationError('PERMISSION_DENIED');
        Alert.alert(t('permissions.microphoneDeniedTitle'), t('permissions.microphoneRequiredDictation'));
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await sttService.start({ locale: 'es-ES', interimResults: true, maxSeconds: 120 });
    } catch {
      setDictationError(sttService.getLastError() ?? 'UNKNOWN');
    } finally {
      setDictationStatus(sttService.getStatus());
    }
  };

  const handleAiTranscription = async () => {
    const uri = lastUri ?? recorder.uri;
    if (!uri) {
      setTranscriptionError(t('audioNote.noteRequired'));
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
          : t('audioNote.aiTranscriptionFailed');
      setTranscriptionError(message);
    } catch {
      setTranscriptionError(t('audioNote.aiTranscriptionFailedLater'));
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
    } catch {
      setRecordingError(t('audioNote.recordStartFailed'));
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
    } catch {
      setRecordingError(t('audioNote.recordStopFailed'));
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
      setRecordingError(t('audioNote.recordPermissionHint'));
      Alert.alert(t('permissions.microphoneDeniedTitle'), t('permissions.microphoneRequiredRecord'));
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await startRecording();
  };

  const accept = () => {
    const uri = lastUri ?? recorder.uri;
    if (uri) {
      const onDoneRoute = route.params?.onDoneRoute ?? 'HandoverForm';
      navigation.navigate({
        name: onDoneRoute,
        params: {
          audioNote: {
            uri,
            transcription: transcription.trim() ? transcription : undefined,
            uploadToFhir,
          },
        },
        merge: true,
      } as never);
    }
  };

  const hasUri = useMemo(() => !!(lastUri ?? recorder.uri), [lastUri, recorder.uri]);

  const handleOpenSettings = async () => {
    try {
      await Linking.openSettings();
    } catch {
    }
  };

  if (permission && !permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0b1220", padding: 16, justifyContent: "center" }}>
        <Text style={{ color: "#eaf2ff", fontSize: 16, textAlign: "center" }}>
          {t('permissions.microphoneDeniedScreenMessage')}
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
          <Text style={{ color: "#fff", fontWeight: "700" }}>{t('common.openSettings')}</Text>
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
            <Text style={{ color: "#111827", fontWeight: "700" }}>{t('common.retry')}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0b1220", padding: 16 }}>
      <Text style={{ color: "#eaf2ff", fontSize: 18, fontWeight: "700", marginBottom: 12 }}>
        {t('audioNote.title')}
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
          {recorder.isRecording ? t('audioNote.recordStop') : t('audioNote.recordStart')}
        </Text>
      </Pressable>
      {recordingError ? (
        <Text style={[sttStyles.dictationError, { color: colors.danger }]}>{recordingError}</Text>
      ) : null}

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
          {dictationStatus === 'listening'
            ? t('audioNote.dictationStop')
            : t('audioNote.dictationStart')}
        </Text>
      </Pressable>
      {dictationStatus === 'listening' && (
        <Text style={sttStyles.dictationHint}>
          {t('audioNote.dictationListening')} {dictatedPartial ? `“${dictatedPartial}”` : ''}
        </Text>
      )}
      {dictationStatus === 'processing' && (
        <Text style={sttStyles.dictationHint}>{t('audioNote.dictationProcessing')}</Text>
      )}
      {dictationError && dictationError !== 'UNSUPPORTED' && (
        <Text style={[sttStyles.dictationError, { color: colors.danger }]}>
          {dictationError === 'PERMISSION_DENIED'
            ? t('audioNote.dictationPermissionError')
            : t('audioNote.dictationGenericError')}
        </Text>
      )}
      {dictationUnavailable && (
        <Text style={[sttStyles.dictationError, { color: colors.danger }]}>
          {t('audioNote.dictationUnavailable')}
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
          {isTranscribing ? t('audioNote.aiTranscriptionInProgress') : t('audioNote.aiTranscriptionAction')}
        </Text>
      </Pressable>
      {isTranscribing ? <Text style={sttStyles.dictationHint}>{t('audioNote.aiProcessingAudio')}</Text> : null}
      {transcriptionError ? (
        <Text style={[sttStyles.dictationError, { color: colors.danger }]}>{transcriptionError}</Text>
      ) : null}
      <TextInput
        style={sttStyles.transcriptionInput}
        multiline
        placeholder={t('audioNote.transcriptionPlaceholder')}
        placeholderTextColor="#7081a7"
        value={transcription}
        onChangeText={setTranscription}
        testID="audio-transcription-input"
      />
      <Text style={{ color: '#9fb3d9', marginTop: 8 }}>
        {t('audioNote.transcriptionEditHint')}
      </Text>
      <View style={{ marginTop: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ color: '#eaf2ff', flex: 1 }}>{t('audioNote.uploadToFhirToggle')}</Text>
          <Switch value={uploadToFhir} onValueChange={setUploadToFhir} />
        </View>
        <Text style={{ color: '#9fb3d9', marginTop: 6 }}>
          {t('audioNote.uploadToFhirHelper')}
        </Text>
      </View>
      {/* La transcripción puede enviarse al backend IA usando el botón de "Transcribir nota con IA". */}

      {hasUri && (
        <>
          <Text style={{ color: "#9fb3d9", marginTop: 12 }}>
            {t('audioNote.fileLabel', { fileName: (lastUri ?? recorder.uri)?.split('/').pop() ?? '' })}
          </Text>
          <Pressable
            onPress={accept}
            testID="audio-attach"
            style={({ pressed }) => ({
              padding: 12,
              borderRadius: 10,
              backgroundColor: pressed ? "#2f6b3a" : "#2b7a46",
              alignItems: "center",
              marginTop: 12,
            })}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>{t('audioNote.attachToHandover')}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
