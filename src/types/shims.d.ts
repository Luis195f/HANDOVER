// Ambient shims to keep the TypeScript compiler happy without touching runtime deps.
declare module '*.png' { const value: any; export default value; }
declare module '*.jpg' { const value: any; export default value; }

// Expo / React Native modules missing types in this workspace
declare module 'expo-sqlite';
declare module 'expo-secure-store';
declare module 'expo-notifications';

declare module 'expo-audio' {
  export type RecordingOptions = Record<string, unknown>;
  export const RecordingPresets: Record<string, RecordingOptions>;

  export interface AudioRecorder {
    prepareToRecordAsync(): Promise<void>;
    record(): void;
    stop(): Promise<void>;
    uri?: string;
  }

  export function useAudioRecorder(options?: RecordingOptions): AudioRecorder;
  export function useAudioRecorderState(recorder: AudioRecorder): { isRecording: boolean };
  export const AudioModule: {
    requestRecordingPermissionsAsync(): Promise<{ granted: boolean }>;
  };
  export function setAudioModeAsync(config: { playsInSilentMode?: boolean; allowsRecording?: boolean }): Promise<void>;
}

declare module 'expo-barcode-scanner' {
  import type { ComponentType } from 'react';
  export const BarCodeScanner: ComponentType<any> & {
    requestPermissionsAsync(): Promise<{ status: string }>;
  };
}

// Navigation helpers
declare module '@react-navigation/native' {
  export function useFocusEffect(effect: (...args: any[]) => void | (() => void)): void;
}

declare const __DEV__: boolean;

declare namespace JSX {
  interface Element {}
  interface IntrinsicAttributes {
    key?: string | number | null;
  }
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

declare var process: {
  env: Record<string, string | undefined> & {
    NODE_ENV?: string;
    EXPO_PUBLIC_API_BASE?: string;
    EXPO_PUBLIC_API_TOKEN?: string;
    EXPO_PUBLIC_FHIR_BASE?: string;
    API_BASE?: string;
    API_TOKEN?: string;
    BYPASS_SCOPE?: string;
    EXPO_PUBLIC_BYPASS_SCOPE?: string;
  };
};

declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): any;
declare function clearInterval(handle?: any): void;

declare function describe(name: string, fn: () => void | Promise<void>): void;
declare function it(name: string, fn: () => void | Promise<void>): void;
declare function test(name: string, fn: () => void | Promise<void>): void;
declare function expect(actual: any): any;
