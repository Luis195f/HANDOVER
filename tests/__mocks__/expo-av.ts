// tests/__mocks__/expo-av.ts
// Stub ultra-simple para tests: evita entrar al código real de expo-av (Audio/Video)

export const InterruptionModeAndroid = {
  DO_NOT_MIX: 'DO_NOT_MIX',
  DUCK_OTHERS: 'DUCK_OTHERS',
  DUCK_OTHERS_AND_CONTINUE_PLAYING: 'DUCK_OTHERS_AND_CONTINUE_PLAYING',
} as const;

export const InterruptionModeIOS = {
  MIX_WITH_OTHERS: 'MIX_WITH_OTHERS',
  DO_NOT_MIX: 'DO_NOT_MIX',
  DUCK_OTHERS: 'DUCK_OTHERS',
} as const;

export const Audio = {
  // Simular permisos siempre concedidos
  requestPermissionsAsync: async () => ({
    status: 'granted',
    granted: true,
    canAskAgain: true,
    expires: 'never',
    permissions: {},
  }),
  getPermissionsAsync: async () => ({
    status: 'granted',
    granted: true,
    canAskAgain: true,
    expires: 'never',
    permissions: {},
  }),

  // Stub del modo de audio
  setAudioModeAsync: async (_options?: any) => {
    return;
  },

  // Clase Recording simplificada
  Recording: class {
    async prepareToRecordAsync(_options?: any) {
      return;
    }
    async startAsync() {
      return;
    }
    async stopAndUnloadAsync() {
      return;
    }
    getURI() {
      return 'file:///mock-recording.m4a';
    }
  },

  RecordingOptionsPresets: {
    HIGH_QUALITY: {},
  },
};

export type VideoProps = any;

// Componente Video “vacío”, sin JSX, solo devuelve null
export function Video(_props: VideoProps) {
  return null;
}

// Algunas constantes típicas que a veces se usan
export const ResizeMode = {
  CONTAIN: 'contain',
  COVER: 'cover',
  STRETCH: 'stretch',
} as const;

(Video as any).RESIZE_MODE_CONTAIN = 'contain';
(Video as any).RESIZE_MODE_COVER = 'cover';
(Video as any).RESIZE_MODE_STRETCH = 'stretch';

const defaultExport = {
  Audio,
  Video,
  InterruptionModeAndroid,
  InterruptionModeIOS,
  ResizeMode,
};

export default defaultExport;
