import * as ExpoCamera from 'expo-camera';
import * as ExpoAv from 'expo-av';

type CameraModule = {
  requestCameraPermissionsAsync: () => Promise<{ granted: boolean; canAskAgain?: boolean }>;
};

type AudioModule = {
  requestPermissionsAsync: () => Promise<{ granted: boolean; canAskAgain?: boolean }>;
};

const Camera: CameraModule = (ExpoCamera as unknown as { Camera?: CameraModule })?.Camera ?? (ExpoCamera as unknown as CameraModule);
const Audio: AudioModule = (ExpoAv as unknown as { Audio?: AudioModule })?.Audio ?? (ExpoAv as unknown as AudioModule);

export type PermissionName = 'camera' | 'microphone';

export type PermissionResult = {
  granted: boolean;
  canAskAgain: boolean;
};

async function requestCameraPermission(): Promise<PermissionResult> {
  const result = await Camera.requestCameraPermissionsAsync();
  return { granted: result.granted, canAskAgain: result.canAskAgain ?? false };
}

async function requestMicrophonePermission(): Promise<PermissionResult> {
  const result = await Audio.requestPermissionsAsync();
  return { granted: result.granted, canAskAgain: result.canAskAgain ?? false };
}

const permissionHandlers: Record<PermissionName, () => Promise<PermissionResult>> = {
  camera: requestCameraPermission,
  microphone: requestMicrophonePermission,
};

export async function ensurePermissions(...names: PermissionName[]): Promise<Record<PermissionName, PermissionResult>> {
  const uniqueNames = Array.from(new Set(names));
  const results: Partial<Record<PermissionName, PermissionResult>> = {};

  for (const name of uniqueNames) {
    const handler = permissionHandlers[name];
    if (!handler) {
      throw new Error(`Unknown permission: ${name}`);
    }
    results[name] = await handler();
  }

  return results as Record<PermissionName, PermissionResult>;
}

export async function ensureMediaPermissions(): Promise<boolean> {
  const results = await ensurePermissions('camera', 'microphone');
  return results.camera.granted && results.microphone.granted;
}

export async function ensureCameraPermission(): Promise<boolean> {
  const result = await ensurePermissions('camera');
  return result.camera.granted;
}

export async function ensureAudioPermission(): Promise<boolean> {
  const result = await ensurePermissions('microphone');
  return result.microphone.granted;
}
