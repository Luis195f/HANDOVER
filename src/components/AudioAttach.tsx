import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Linking } from 'react-native';
import {
  useAudioRecorder,
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  type PermissionResponse,
} from 'expo-audio';
import { t } from '@/src/i18n';

type Props = {
  onRecorded?: (uri: string) => void;
  onAttach?: (uri: string) => void;
  startLabel?: string;
  stopLabel?: string;
};

export default function AudioAttach({
  onRecorded,
  onAttach,
  startLabel = t('audioAttach.start'),
  stopLabel = t('audioAttach.stop'),
}: Props) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY as any);
  const [permission, setPermission] = useState<PermissionResponse | null>(null);
  const [lastUri, setLastUri] = useState<string | null>(null);

  const openSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch {
    }
  }, []);

  const showMicPermissionDenied = useCallback(() => {
    console.warn('[HNDV][WARN][PERM_MIC_DENIED]', { component: 'AudioAttach' });
    Alert.alert(
      t('permissions.microphoneDeniedTitle'),
      t('permissions.microphoneDeniedRecordMessage'),
      [
        { text: t('common.understood'), style: 'cancel' },
        { text: t('common.openSettings'), onPress: openSettings },
      ],
    );
  }, [openSettings]);

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
    if (!result.granted) {
      showMicPermissionDenied();
    }
    return result.granted;
  }, [permission, requestPermission, showMicPermissionDenied]);

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
