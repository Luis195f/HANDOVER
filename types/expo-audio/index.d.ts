declare module 'expo-audio' {
  export type PermissionResponse = {
    granted: boolean;
    canAskAgain?: boolean;
    expires?: string | number;
    status?: 'granted' | 'denied' | 'undetermined' | string;
  };

  export const RecordingPresets: Record<string, unknown>;
  export function useAudioRecorder(preset?: unknown): any;
  export function getRecordingPermissionsAsync(): Promise<PermissionResponse>;
  export function requestRecordingPermissionsAsync(): Promise<PermissionResponse>;
  export function setAudioModeAsync(options?: Record<string, unknown>): Promise<void>;
  export type RecordingOptions = Record<string, unknown>;
}
