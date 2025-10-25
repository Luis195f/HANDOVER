// src/screens/AudioNote.tsx
import React, { useEffect } from "react";
import { View, Text, Pressable } from "react-native";
import {
  useAudioRecorder,
  useAudioRecorderState,
  AudioModule,
  setAudioModeAsync,
  RecordingPresets,
  type RecordingOptions,
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
  const state = useAudioRecorderState(recorder);

  useEffect(() => {
    (async () => {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    })();
  }, []);

  const onToggle = async () => {
    if (state.isRecording) {
      await recorder.stop();
      return;
    }
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  const accept = () => {
    const uri = recorder.uri;
    if (uri) {
      // mismo patrón que usabas antes para devolver el URI
      (global as any).__lastAudioUri = uri;
      navigation.goBack();
    }
  };

  const hasUri = !!recorder.uri;

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
          {state.isRecording ? "Detener" : "Grabar"}
        </Text>
      </Pressable>

      {hasUri && (
        <>
          <Text style={{ color: "#9fb3d9", marginTop: 12 }}>
            Archivo: {recorder.uri?.split("/").pop()}
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
