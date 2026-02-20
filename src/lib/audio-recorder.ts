import { useCallback, useEffect, useRef, useState } from "react";
import { useAudioRecorder as useExpoAudioRecorder, type RecordingOptions } from "expo-audio";

export type AudioRecorderHook = {
  isRecording: boolean;
  uri: string | null;
  record: () => void;
  stop: () => Promise<string | undefined>;
  prepareToRecordAsync: () => Promise<void>;
};

const isE2E = process.env.EXPO_PUBLIC_E2E === "true";
const STOP_URI_RETRIES = 10;
const STOP_URI_RETRY_DELAY_MS = 50;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const useAudioRecorderWithFallback = (options: RecordingOptions): AudioRecorderHook => {
  // ✅ Caso real: usamos el hook de expo, pero normalizamos stop() => uri
  if (!isE2E) {
    const base = useExpoAudioRecorder(options) as unknown as {
      isRecording: boolean;
      uri: string | null;
      record: () => void;
      stop: () => Promise<void>;
      prepareToRecordAsync: () => Promise<void>;
    };

    const uriRef = useRef<string | null>(base.uri);
    useEffect(() => {
      uriRef.current = base.uri;
    }, [base.uri]);

    const stop = useCallback(async () => {
      await base.stop();
      for (let attempt = 0; attempt < STOP_URI_RETRIES; attempt += 1) {
        const latestUri = base.uri ?? uriRef.current;
        if (latestUri) {
          return latestUri;
        }
        await sleep(STOP_URI_RETRY_DELAY_MS);
      }
      return undefined;
    }, [base]);

    return {
      isRecording: base.isRecording,
      uri: base.uri,
      record: base.record,
      stop,
      prepareToRecordAsync: base.prepareToRecordAsync,
    };
  }

  // ✅ Caso E2E: fallback determinista
  const [isRecording, setIsRecording] = useState(false);
  const [uri, setUri] = useState<string | null>(null);

  const prepareToRecordAsync = useCallback(async () => {}, []);

  const record = useCallback(() => {
    setIsRecording(true);
  }, []);

  const stop = useCallback(async () => {
    setIsRecording(false);
    const nextUri = `file://e2e/audio-${Date.now()}.m4a`;
    setUri(nextUri);
    return nextUri;
  }, []);

  return { isRecording, uri, record, stop, prepareToRecordAsync };
};
