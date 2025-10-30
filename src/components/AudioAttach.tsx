import React, { useCallback, useEffect, useState } from 'react';
import { Button } from 'react-native';
import {
  useAudioRecorder,
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  type PermissionResponse,
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
    if (typeof recorder.prepareToRecordAsync === 'function') {
      await recorder.prepareToRecordAsync();
    }
    recorder.record?.();
  };

  const stopRecording = async () => {
    const maybeUri = (await recorder.stop?.()) as unknown;
    const uri =
      (typeof maybeUri === 'string' && maybeUri.length > 0 && maybeUri) ||
      recorder.uri ||
      null;
    if (uri) {
      setLastUri(uri);
      onRecorded?.(uri);
      onAttach?.(uri);
    }
  };

  const onToggle = async () => {
    if (recorder.isRecording) {
      await stopRecording();
    } else {
      const granted = await ensurePermissionGranted();
      if (!granted) {
        return;
      }
      await startRecording();
    }
  };

  return <Button title={recorder.isRecording ? stopLabel : startLabel} onPress={onToggle} />;
}
