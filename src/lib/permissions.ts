import * as ExpoCamera from 'expo-camera';
import { Audio as ExpoAudio } from 'expo-av';

export type PermissionStatus = 'granted' | 'denied' | 'blocked';

type PermissionState = {
  status?: string;
  granted: boolean;
  canAskAgain?: boolean;
};

export type PermissionGuidance = {
  status: PermissionStatus;
  granted: boolean;
  canAskAgain: boolean;
  reason?: string;
};

export type PermissionKey = 'camera' | 'microphone';

type CameraModule = {
  getCameraPermissionsAsync: () => Promise<PermissionState>;
  requestCameraPermissionsAsync: () => Promise<PermissionState>;
};

type PermissionFlow = {
  name: string;
  getCurrent: () => Promise<PermissionState>;
  request: () => Promise<PermissionState>;
};

const Camera: CameraModule =
  (ExpoCamera as unknown as { Camera?: CameraModule })?.Camera ??
  (ExpoCamera as unknown as CameraModule);

const microphoneFlow: PermissionFlow = {
  name: 'micrófono',
  getCurrent: () => ExpoAudio.getPermissionsAsync() as Promise<PermissionState>,
  request: () => ExpoAudio.requestPermissionsAsync() as Promise<PermissionState>,
};

const cameraFlow: PermissionFlow = {
  name: 'cámara',
  getCurrent: () => Camera.getCameraPermissionsAsync() as Promise<PermissionState>,
  request: () => Camera.requestCameraPermissionsAsync() as Promise<PermissionState>,
};

const toGuidance = (
  status: PermissionStatus,
  canAskAgain: boolean,
  reason?: string,
): PermissionGuidance => ({
  status,
  granted: status === 'granted',
  canAskAgain,
  reason,
});

const blockedGuidance = (name: string, reason?: string): PermissionGuidance =>
  toGuidance('blocked', false, reason ?? `${name} bloqueado`);

async function ensurePermission(flow: PermissionFlow): Promise<PermissionGuidance> {
  // Si getCurrent falla, para tests/robustez lo tratamos como blocked (no seguimos “a ciegas”).
  let current: PermissionState;
  try {
    current = await flow.getCurrent();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return blockedGuidance(flow.name, message);
  }

  if (current.granted) {
    // Cuando ya está granted, canAskAgain no debería bloquear la UX: lo normal es true.
    return toGuidance('granted', true);
  }

  if (current.canAskAgain === false) {
    return blockedGuidance(flow.name);
  }

  let requested: PermissionState;
  try {
    requested = await flow.request();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return blockedGuidance(flow.name, message);
  }

  if (requested.granted) {
    return toGuidance('granted', true);
  }

  if (requested.canAskAgain === false) {
    return blockedGuidance(flow.name);
  }

  return toGuidance('denied', true, `${flow.name} denegado`);
}

export async function ensureMediaPermissions(): Promise<boolean> {
  const [camera, microphone] = await Promise.all([ensureCameraPermission(), ensureAudioPermission()]);
  return camera.status === 'granted' && microphone.status === 'granted';
}

export async function ensurePermissions(
  ...permissions: PermissionKey[]
): Promise<Record<PermissionKey, PermissionGuidance>> {
  const results: Partial<Record<PermissionKey, PermissionGuidance>> = {};

  for (const permission of permissions) {
    if (permission === 'camera') {
      results.camera = await ensureCameraPermission();
      continue;
    }
    if (permission === 'microphone') {
      results.microphone = await ensureAudioPermission();
      continue;
    }
    throw new Error(`Unknown permission: ${permission}`);
  }

  return results as Record<PermissionKey, PermissionGuidance>;
}

export async function ensureCameraPermission(): Promise<PermissionGuidance> {
  return ensurePermission(cameraFlow);
}

export async function ensureAudioPermission(): Promise<PermissionGuidance> {
  return ensurePermission(microphoneFlow);
}
