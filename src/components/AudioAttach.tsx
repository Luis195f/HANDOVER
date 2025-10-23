// src/components/AudioAttach.tsx
import React, { useEffect } from 'react';
import { View, Button, Alert } from 'react-native';
import {
  useAudioRecorder,
  useAudioRecorderState,
  AudioModule,
  setAudioModeAsync,
  type RecordingOptions,
} from 'expo-audio';
import { Audio } from 'expo-av';

type RecorderOptions = Parameters<typeof useAudioRecorder>[0];

function resolveRecorderOptions(): RecorderOptions {
  const presets = Audio.RecordingOptionsPresets as Record<string, Audio.RecordingOptions | undefined> | undefined;
  const preset = presets?.HIGH_QUALITY ?? Object.values(presets ?? {}).find((opt): opt is Audio.RecordingOptions => Boolean(opt));
  if (!preset) {
    throw new Error('Expo AV recording presets unavailable');
  }
  return preset as unknown as RecorderOptions;
}

const REC_OPTS = resolveRecorderOptions();

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
  const recorder = useAudioRecorder(REC_OPTS as RecordingOptions);
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
