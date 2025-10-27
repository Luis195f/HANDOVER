import { useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';

type ExpoAudioModule = typeof Audio extends infer T ? (T extends object ? T : Record<string, unknown>) : Record<string, unknown>;

type RecordingOptionsShape = Record<string, unknown>;

type RecordingClass = ExpoAudioModule extends { Recording: new () => infer R } ? R : {
  prepareToRecordAsync: (options: RecordingOptionsShape) => Promise<void>;
  startAsync: () => Promise<void>;
  stopAndUnloadAsync: () => Promise<void>;
  getURI: () => string | null;
};

export type RecordingOptions = RecordingClass extends { prepareToRecordAsync: (options: infer O) => Promise<void> } ? O : RecordingOptionsShape;

const ExpoAudio = Audio as unknown as {
  RecordingOptionsPresets?: Record<string, RecordingOptions>;
  setAudioModeAsync?: (...params: unknown[]) => Promise<unknown>;
  requestPermissionsAsync?: (...params: unknown[]) => Promise<unknown>;
  getPermissionsAsync?: (...params: unknown[]) => Promise<unknown>;
  Recording?: new () => RecordingClass;
};

export const RecordingPresets = ExpoAudio.RecordingOptionsPresets ?? ({} as Record<string, RecordingOptions>);

type SetAudioModeSignature = typeof ExpoAudio.setAudioModeAsync extends (...params: infer P) => infer R
  ? { params: P; return: R }
  : { params: [mode: unknown]; return: Promise<unknown> };

export async function setAudioModeAsync(
  ...params: SetAudioModeSignature['params']
): Promise<SetAudioModeSignature['return']> {
  if (!ExpoAudio.setAudioModeAsync) {
    throw new Error('Audio.setAudioModeAsync is not available');
  }
  return ExpoAudio.setAudioModeAsync(
    ...(params as Parameters<NonNullable<typeof ExpoAudio.setAudioModeAsync>>)
  ) as Promise<SetAudioModeSignature['return']>;
}

type PermissionSignature = typeof ExpoAudio.requestPermissionsAsync extends (...params: infer P) => infer R
  ? { params: P; return: R }
  : { params: []; return: Promise<unknown> };

type GetPermissionSignature = typeof ExpoAudio.getPermissionsAsync extends (...params: infer P) => infer R
  ? { params: P; return: R }
  : { params: []; return: Promise<unknown> };

export const AudioModule = {
  requestRecordingPermissionsAsync: (
    ...params: PermissionSignature['params']
  ): Promise<PermissionSignature['return']> => {
    if (!ExpoAudio.requestPermissionsAsync) {
      throw new Error('Audio.requestPermissionsAsync is not available');
    }
    return ExpoAudio.requestPermissionsAsync(
      ...(params as Parameters<NonNullable<typeof ExpoAudio.requestPermissionsAsync>>)
    ) as Promise<PermissionSignature['return']>;
  },
  getRecordingPermissionsAsync: (
    ...params: GetPermissionSignature['params']
  ): Promise<GetPermissionSignature['return']> => {
    if (!ExpoAudio.getPermissionsAsync) {
      throw new Error('Audio.getPermissionsAsync is not available');
    }
    return ExpoAudio.getPermissionsAsync(
      ...(params as Parameters<NonNullable<typeof ExpoAudio.getPermissionsAsync>>)
    ) as Promise<GetPermissionSignature['return']>;
  },
};

type StopResult = { uri?: string };
type RecorderControls = {
  startAsync: (options?: RecordingOptions) => Promise<void>;
  stopAndUnloadAsync: () => Promise<StopResult>;
  getURI: () => string | undefined;
  isRecording: boolean;
};

export function useAudioRecorder(): RecorderControls {
  const RecordingCtor = ExpoAudio.Recording;
  if (!RecordingCtor) {
    throw new Error('Audio.Recording is not available');
  }

  const recordingRef = useRef<RecordingClass | null>(null);
  const [uri, setUri] = useState<string | undefined>(undefined);
  const [isRecording, setIsRecording] = useState<boolean>(false);

  const startAsync = async (options?: RecordingOptions) => {
    const preset =
      options ??
      ExpoAudio.RecordingOptionsPresets?.HIGH_QUALITY ??
      ({} as RecordingOptions);
    const recording = new RecordingCtor();
    await recording.prepareToRecordAsync(preset);
    await recording.startAsync();
    recordingRef.current = recording;
    setIsRecording(true);
  };

  const stopAndUnloadAsync = async (): Promise<StopResult> => {
    const recording = recordingRef.current;
    if (!recording) {
      return { uri };
    }

    try {
      await recording.stopAndUnloadAsync();
    } catch {
      // ignore errors from stopping an already stopped recording
    }

    const newUri = recording.getURI() ?? undefined;
    setUri(newUri);
    setIsRecording(false);
    return { uri: newUri };
  };

  const getURI = () => uri;

  return { startAsync, stopAndUnloadAsync, getURI, isRecording };
}

type RecorderLike = {
  isRecording?: boolean;
  getURI?: () => string | undefined;
};

type RecorderState = 'idle' | 'recording' | 'stopped';

export function useAudioRecorderState(recorder?: RecorderLike): RecorderState {
  const [state, setState] = useState<RecorderState>('idle');
  const currentUri = recorder?.getURI?.();

  useEffect(() => {
    if (recorder?.isRecording) {
      setState('recording');
    } else if (currentUri) {
      setState('stopped');
    } else {
      setState('idle');
    }
  }, [recorder?.isRecording, currentUri]);

  return state;
}
