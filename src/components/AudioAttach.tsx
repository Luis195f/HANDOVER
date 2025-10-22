// src/components/AudioAttach.tsx
import React, { useEffect } from 'react';
import { View, Button, Alert } from 'react-native';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  AudioModule,
  setAudioModeAsync,
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
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
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
