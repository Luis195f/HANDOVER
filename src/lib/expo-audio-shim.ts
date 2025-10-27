import { Audio } from 'expo-av';

export type RecordingOptions = Audio.RecordingOptions;

export const RecordingPresets = {
  HIGH_QUALITY: Audio.RecordingOptionsPresets.HIGH_QUALITY,
  LOW_QUALITY: Audio.RecordingOptionsPresets.LOW_QUALITY,
} as const;

export { Audio };
