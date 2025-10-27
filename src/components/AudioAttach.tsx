// src/components/AudioAttach.tsx
import React, { useEffect } from 'react';
import { View, Button, Alert } from 'react-native';
import {
  useAudioRecorder,
  useAudioRecorderState,
  AudioModule,
  setAudioModeAsync,
  RecordingPresets,
  type RecordingOptions,
} from 'expo-audio';

const FALLBACK_PRESET =
  RecordingPresets.HIGH_QUALITY ??
  RecordingPresets.LOW_QUALITY ??
  Object.values(RecordingPresets)[0];

if (!FALLBACK_PRESET) {
  throw new Error('Expo audio recording presets unavailable');
}

const DEFAULT_RECORDING_OPTIONS = FALLBACK_PRESET as RecordingOptions;

type Props = {
  onRecorded?: (uri: string) => void;
  onAttach?: (uri: string) => void;
  startLabel?: string;        // "Adjuntar audio de incidencias", etc.
  stopLabel?: string;         // "Detener y adjuntar"
};

export default function AudioAttach({
  onRecorded,
  onAttach,
  startLabel = 'Grabar audio',
  stopLabel = 'Detener y adjuntar',
}: Props) {
  const recorder = useAudioRecorder(DEFAULT_RECORDING_OPTIONS);
  const state = useAudioRecorderState(recorder);

  useEffect(() => {
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        Alert.alert('Permiso', 'Debes conceder permiso de micrófono para grabar.');
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    })();
  }, []);

  const onPress = async () => {
    if (state.isRecording) {
      await recorder.stop();
      if (recorder.uri) {
        onRecorded?.(recorder.uri);
        onAttach?.(recorder.uri);
      }
      return;
    }
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  return (
    <View>
      <Button
        title={state.isRecording ? stopLabel : startLabel}
        onPress={onPress}
      />
    </View>
  );
}
