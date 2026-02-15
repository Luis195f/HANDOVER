const grantedPermission = {
  status: 'granted',
  granted: true,
  canAskAgain: true,
  expires: 'never',
} as const;

export const RecordingPresets = {
  HIGH_QUALITY: {},
  LOW_QUALITY: {},
} as const;

export async function getRecordingPermissionsAsync() {
  return grantedPermission;
}

export async function requestRecordingPermissionsAsync() {
  return grantedPermission;
}

export async function setAudioModeAsync(_options?: unknown) {
  return;
}

export class MockAudioRecorder {
  uri: string | null = null;

  async prepareToRecordAsync(_options?: unknown) {
    return;
  }

  record() {
    this.uri = this.uri ?? 'file:///mock-recording.m4a';
  }

  async stop() {
    this.uri = this.uri ?? 'file:///mock-recording.m4a';
  }
}

export const AudioModule = {
  AudioRecorder: MockAudioRecorder,
  async requestRecordingPermissionsAsync() {
    return grantedPermission;
  },
};

export function useAudioRecorder() {
  return {
    isRecording: false,
    uri: 'file:///mock-recording.m4a',
    record: () => undefined,
    stop: async () => undefined,
    prepareToRecordAsync: async () => undefined,
  };
}
