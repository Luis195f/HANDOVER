import * as ExpoCamera from 'expo-camera';
import * as ExpoAudio from 'expo-audio';

type PermissionStatus = 'granted' | 'denied' | 'blocked';

type PermissionState = {
  status?: PermissionStatus | string;
  granted: boolean;
  canAskAgain?: boolean;
};

type PermissionGuidance = {
  status: PermissionStatus;
  canAskAgain: boolean;
  reason?: string;
};

type CameraModule = {
  getCameraPermissionsAsync: () => Promise<PermissionState>;
  requestCameraPermissionsAsync: () => Promise<PermissionState>;
};

type PermissionFlow = {
  name: string;
  getCurrent: () => Promise<PermissionState>;
  request: () => Promise<PermissionState>;
};

const Camera: CameraModule = (ExpoCamera as unknown as { Camera?: CameraModule })?.Camera
  ?? (ExpoCamera as unknown as CameraModule);

const microphoneFlow: PermissionFlow = {
  name: 'micrófono',
  getCurrent: () => ExpoAudio.getRecordingPermissionsAsync() as Promise<PermissionState>,
  request: () => ExpoAudio.requestRecordingPermissionsAsync() as Promise<PermissionState>,
};

const cameraFlow: PermissionFlow = {
  name: 'cámara',
  getCurrent: () => Camera.getCameraPermissionsAsync() as Promise<PermissionState>,
  request: () => Camera.requestCameraPermissionsAsync() as Promise<PermissionState>,
};

const toGuidance = (status: PermissionStatus, canAskAgain: boolean, reason?: string): PermissionGuidance => ({
  status,
  canAskAgain,
  reason,
});

const blockedGuidance = (name: string, reason?: string): PermissionGuidance =>
  toGuidance('blocked', false, reason ?? `${name} bloqueado`);

async function ensurePermission(flow: PermissionFlow): Promise<PermissionGuidance> {
  try {
    const current = await flow.getCurrent();
    if (current.granted) {
      return toGuidance('granted', current.canAskAgain ?? true);
    }

    if (!current.canAskAgain) {
      return blockedGuidance(flow.name);
    }

    const requested = await flow.request();
    if (requested.granted) {
      return toGuidance('granted', requested.canAskAgain ?? true);
    }

    if (!requested.canAskAgain) {
      return blockedGuidance(flow.name);
    }

    return toGuidance('denied', requested.canAskAgain ?? true, `${flow.name} denegado`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return blockedGuidance(flow.name, message);
  }
}

export async function ensureMediaPermissions(): Promise<boolean> {
  const [camera, microphone] = await Promise.all([
    ensureCameraPermission(),
    ensureAudioPermission(),
  ]);
  return camera.status === 'granted' && microphone.status === 'granted';
}

export async function ensureCameraPermission(): Promise<PermissionGuidance> {
  return ensurePermission(cameraFlow);
}

export async function ensureAudioPermission(): Promise<PermissionGuidance> {
  return ensurePermission(microphoneFlow);
}
