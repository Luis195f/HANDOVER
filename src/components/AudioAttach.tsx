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

type Props = {
  onRecorded: (uri: string) => void;
  startLabel?: string;        // "Adjuntar audio de incidencias", etc.
  stopLabel?: string;         // "Detener y adjuntar"
};

export default function AudioAttach({
  onRecorded,
  startLabel = 'Grabar audio',
  stopLabel = 'Detener y adjuntar',
}: Props) {
  const presets = RecordingPresets as Record<string, RecordingOptions | undefined>;
  const preset = (presets.HIGH_QUALITY ?? presets.LOW_QUALITY ?? Object.values(presets)[0]) as RecordingOptions;
  const recorder = useAudioRecorder(preset);
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
      if (recorder.uri) onRecorded(recorder.uri);
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
