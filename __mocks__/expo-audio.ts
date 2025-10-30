export const RecordingPresets = { HIGH_QUALITY: {}, LOW_QUALITY: {} } as any;
export const useAudioRecorder = () => ({
  isRecording: false,
  start: async () => {},
  stop: async () => 'file://mock.m4a',
  record: () => {},
  prepareToRecordAsync: async () => {},
  uri: 'file://mock.m4a',
});
export const usePermissions = () =>
  [{ granted: true } as { granted: boolean }, async () => ({ granted: true })] as const;
export const setAudioModeAsync = async () => {};
export const getRecordingPermissionsAsync = async () => ({ granted: true } as const);
export const requestRecordingPermissionsAsync = async () => ({ granted: true } as const);
export default {
  useAudioRecorder,
  usePermissions,
  RecordingPresets,
  setAudioModeAsync,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
};
