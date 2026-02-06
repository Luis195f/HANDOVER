import { useCallback, useState } from "react";
import { useAudioRecorder as useExpoAudioRecorder, type RecordingOptions } from "expo-audio";

type AudioRecorderHook = {
  isRecording: boolean;
  uri: string | null;
  record?: () => void;
  stop?: () => Promise<string | undefined>;
  prepareToRecordAsync?: () => Promise<void>;
};

const isE2E = process.env.EXPO_PUBLIC_E2E === "true";

export const useAudioRecorderWithFallback = (options: RecordingOptions): AudioRecorderHook => {
  if (!isE2E) {
    return useExpoAudioRecorder(options);
  }

  const [isRecording, setIsRecording] = useState(false);
  const [uri, setUri] = useState<string | null>(null);

  const prepareToRecordAsync = useCallback(async () => {
    return;
  }, []);

  const record = useCallback(() => {
    setIsRecording(true);
  }, []);

  const stop = useCallback(async () => {
    setIsRecording(false);
    const nextUri = `file://e2e/audio-${Date.now()}.m4a`;
    setUri(nextUri);
    return nextUri;
  }, []);

  return {
    isRecording,
    uri,
    record,
    stop,
    prepareToRecordAsync,
  };
};
