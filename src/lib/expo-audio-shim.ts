import type { RecordingOptions } from 'expo-av/build/Audio/Recording.types';

type RecordingPresetsMap = Record<string, RecordingOptions>;

type RecordingConstantsModule = {
  RecordingOptionsPresets: RecordingPresetsMap;
};

type ExpoAudioConstantsModule = {
  RecordingPresets: RecordingPresetsMap;
};

function loadRecordingPresets(): RecordingPresetsMap {
  try {
    const { RecordingOptionsPresets } = require('expo-av/build/Audio/RecordingConstants') as RecordingConstantsModule;
    if (RecordingOptionsPresets) {
      return RecordingOptionsPresets;
    }
  } catch {
    // noop - fall back to expo-audio implementation below
  }

  try {
    const { RecordingPresets } = require('expo-audio/build/RecordingConstants') as ExpoAudioConstantsModule;
    if (RecordingPresets) {
      return RecordingPresets;
    }
  } catch {
    // Final fallback: return empty map so the app does not crash in environments without the module.
  }

  return {} as RecordingPresetsMap;
}

export const RecordingPresets = loadRecordingPresets();
export type { RecordingOptions };
