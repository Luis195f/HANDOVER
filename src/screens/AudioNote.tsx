// src/screens/AudioNote.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
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

export default function AudioNote({ navigation }: Props) {
  const recorder = useAudioRecorder(REC_OPTS);
  const [permission, setPermission] = useState<PermissionResponse | null>(null);
  const [lastUri, setLastUri] = useState<string | null>(null);

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
