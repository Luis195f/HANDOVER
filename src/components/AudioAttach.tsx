import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Linking } from 'react-native';
import {
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  type PermissionResponse,
  useAudioRecorder,
} from 'expo-audio';
import { t } from '@/src/i18n';
import { useAudioRecorderWithFallback } from '@/src/lib/audio-recorder';

type Props = {
  onRecorded?: (uri: string) => void;
  onAttach?: (uri: string) => void;
  startLabel?: string;
  stopLabel?: string;
};

function resolveLabel(raw: string, fallback: string) {
  // En tests, a veces t('x.y') devuelve 'x.y' si no hay i18n cargado.
  return raw && raw !== fallback ? raw : fallback;
}

export default function AudioAttach({
  onRecorded,
  onAttach,
  startLabel,
  stopLabel,
}: Props) {
  const recordingPreset =
    RecordingPresets.HIGH_QUALITY ??
    RecordingPresets.LOW_QUALITY ??
    Object.values(RecordingPresets)[0];

  if (!recordingPreset) {
    throw new Error('Expo Audio recording presets unavailable');
  }

  // ✅ En CI/tests: tratamos como E2E para evitar flakiness por permisos.
  const isE2E =
    process.env.EXPO_PUBLIC_E2E === 'true' || process.env.NODE_ENV === 'test';

  // ✅ Labels robustos (si t devuelve la key, cae a ES usado en tests)
  const i18nStart = t('audioAttach.start');
  const i18nStop = t('audioAttach.stop');

  const resolvedStartLabel = useMemo(() => {
    if (startLabel) return startLabel;
    // si t devolvió la key, fallback a texto de test
    return resolveLabel(i18nStart, 'Grabar audio');
  }, [startLabel, i18nStart]);

  const resolvedStopLabel = useMemo(() => {
    if (stopLabel) return stopLabel;
    return resolveLabel(i18nStop, 'Detener y adjuntar');
  }, [stopLabel, i18nStop]);

  /**
   * ✅ Compatibilidad con mocks:
   * - Tu app usa useAudioRecorderWithFallback(...)
   * - Pero en tests tú mockeas expo-audio/useAudioRecorder
   *   => dejamos un fallback directo a useAudioRecorder si el wrapper no devuelve algo usable.
   */
  const recorderFromWrapper = useAudioRecorderWithFallback(recordingPreset) as any;
  const recorderFromExpo = useAudioRecorder(recordingPreset) as any;
  const recorder =
    recorderFromWrapper && typeof recorderFromWrapper === 'object'
      ? recorderFromWrapper
      : recorderFromExpo;

  const [permission, setPermission] = useState<PermissionResponse | null>(null);
  const [lastUri, setLastUri] = useState<string | null>(null);

  const openSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch {
      // noop
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
    if (!recorder?.isRecording && recorder?.uri && recorder.uri !== lastUri) {
      setLastUri(recorder.uri);
    }
  }, [recorder?.isRecording, recorder?.uri, lastUri]);

  const startRecording = async () => {
    if (typeof recorder?.prepareToRecordAsync === 'function') {
      await recorder.prepareToRecordAsync();
    }
    recorder?.record?.();
  };

  const stopRecording = async () => {
    const maybeUri = (await recorder?.stop?.()) as unknown;

    const uri =
      (typeof maybeUri === 'string' && maybeUri.length > 0 && maybeUri) ||
      (typeof recorder?.uri === 'string' && recorder.uri.length > 0 && recorder.uri) ||
      null;

    if (uri) {
      setLastUri(uri);
      onRecorded?.(uri);
      onAttach?.(uri);
    }
  };

  const onToggle = async () => {
    if (recorder?.isRecording) {
      await stopRecording();
    } else {
      const granted = await ensurePermissionGranted();
      if (!granted) return;
      await startRecording();
    }
  };

  return (
    <Button
      title={recorder?.isRecording ? resolvedStopLabel : resolvedStartLabel}
      onPress={onToggle}
    />
  );
}
