import React, { useEffect } from 'react';
import { Button } from 'react-native';
import {
  useAudioRecorder,
  RecordingPresets,
  usePermissions,
} from 'expo-audio';

type Props = {
  onRecorded?: (uri: string) => void;
  onAttach?: (uri: string) => void;
  startLabel?: string;
  stopLabel?: string;
};

export default function AudioAttach({
  onRecorded,
  onAttach,
  startLabel = 'Grabar audio',
  stopLabel = 'Detener y adjuntar',
}: Props) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY as any);
  const [permission, requestPermission] = usePermissions();

  useEffect(() => {
    if (!permission?.granted) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  return (
    <Button
      title={recorder.isRecording ? stopLabel : startLabel}
      onPress={async () => {
        if (recorder.isRecording) {
          await recorder.stop();
          const uri = recorder.uri ?? undefined;
          if (uri) {
            onRecorded?.(uri);
            onAttach?.(uri);
          }
        } else {
          if (typeof recorder.prepareToRecordAsync === 'function') {
            await recorder.prepareToRecordAsync();
          }
          if (typeof recorder.record === 'function') {
            recorder.record();
          }
        }
      }}
    />
  );
}
