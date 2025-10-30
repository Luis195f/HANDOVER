import { useCallback, useEffect, useState } from 'react';
import type { PermissionResponse } from 'expo-audio/build/index';

export * from 'expo-audio/build/index';
export type * from 'expo-audio/build/Audio.types';
export type * from 'expo-audio/build/AudioModule.types';
export * from 'expo-audio/build/RecordingConstants';

import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio/build/ExpoAudio';

export function usePermissions(): [
  PermissionResponse | null,
  () => Promise<PermissionResponse>,
] {
  const [permission, setPermission] = useState<PermissionResponse | null>(null);

  useEffect(() => {
    let isMounted = true;

    getRecordingPermissionsAsync()
      .then((value) => {
        if (isMounted) setPermission(value);
      })
      .catch(() => {
        // ignore failures; caller can retry via request
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const request = useCallback(async () => {
    const result = await requestRecordingPermissionsAsync();
    setPermission(result);
    return result;
  }, []);

  return [permission, request];
}
