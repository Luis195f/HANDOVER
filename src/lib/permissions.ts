import * as ExpoAudio from 'expo-audio';
import * as ExpoCamera from 'expo-camera';

type PermissionResponse = {
  status?: 'granted' | 'denied' | 'undetermined';
  granted?: boolean;
  canAskAgain?: boolean;
};

export type PermissionCheckResult = {
  status: 'granted' | 'denied' | 'blocked';
  canAskAgain: boolean;
  reason?: string;
};

function formatReason(kind: 'camera' | 'microphone', outcome: 'denied' | 'blocked'): string {
  if (outcome === 'denied') {
    return `Permiso de ${kind === 'camera' ? 'cámara' : 'micrófono'} denegado por el usuario.`;
  }
  return `Permiso de ${kind === 'camera' ? 'cámara' : 'micrófono'} bloqueado. Habilítalo en ajustes del sistema.`;
}

function normalizeResponse(kind: 'camera' | 'microphone', response: PermissionResponse): PermissionCheckResult {
  if (response.granted || response.status === 'granted') {
    return { status: 'granted', canAskAgain: response.canAskAgain ?? false };
  }
  if (response.canAskAgain) {
    return {
      status: 'denied',
      canAskAgain: true,
      reason: formatReason(kind, 'denied'),
    };
  }
  return {
    status: 'blocked',
    canAskAgain: false,
    reason: formatReason(kind, 'blocked'),
  };
}

type PermissionAccessors = {
  getAsync: () => Promise<PermissionResponse>;
  requestAsync: () => Promise<PermissionResponse>;
};

async function safeRequest(
  kind: 'camera' | 'microphone',
  accessors: PermissionAccessors,
): Promise<PermissionCheckResult> {
  try {
    const current = await accessors.getAsync();
    const normalized = normalizeResponse(kind, current);
    if (normalized.status === 'granted') {
      return normalized;
    }
    if (!normalized.canAskAgain) {
      return normalized;
    }
    const requested = await accessors.requestAsync();
    return normalizeResponse(kind, requested);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'blocked',
      canAskAgain: false,
      reason: message ? `No se pudo verificar permisos de ${kind}: ${message}` : `No se pudo verificar permisos de ${kind}.`,
    };
  }
}

const audioPermissions = ExpoAudio as unknown as {
  getRecordingPermissionsAsync: () => Promise<PermissionResponse>;
  requestRecordingPermissionsAsync: () => Promise<PermissionResponse>;
};

const cameraPermissions = (ExpoCamera as unknown as {
  Camera?: {
    getCameraPermissionsAsync: () => Promise<PermissionResponse>;
    requestCameraPermissionsAsync: () => Promise<PermissionResponse>;
  };
  getCameraPermissionsAsync?: () => Promise<PermissionResponse>;
  requestCameraPermissionsAsync?: () => Promise<PermissionResponse>;
}).Camera ?? (ExpoCamera as unknown as {
  getCameraPermissionsAsync: () => Promise<PermissionResponse>;
  requestCameraPermissionsAsync: () => Promise<PermissionResponse>;
});

function buildAccessors(
  module: {
    getCameraPermissionsAsync?: () => Promise<PermissionResponse>;
    requestCameraPermissionsAsync?: () => Promise<PermissionResponse>;
    getRecordingPermissionsAsync?: () => Promise<PermissionResponse>;
    requestRecordingPermissionsAsync?: () => Promise<PermissionResponse>;
  },
  kind: 'camera' | 'microphone',
): PermissionAccessors {
  if (kind === 'camera') {
    if (!module.getCameraPermissionsAsync || !module.requestCameraPermissionsAsync) {
      throw new Error('Camera permission APIs are unavailable');
    }
    return {
      getAsync: module.getCameraPermissionsAsync,
      requestAsync: module.requestCameraPermissionsAsync,
    };
  }

  if (!module.getRecordingPermissionsAsync || !module.requestRecordingPermissionsAsync) {
    throw new Error('Audio permission APIs are unavailable');
  }
  return {
    getAsync: module.getRecordingPermissionsAsync,
    requestAsync: module.requestRecordingPermissionsAsync,
  };
}

export async function ensureAudioPermission(): Promise<PermissionCheckResult> {
  try {
    return await safeRequest('microphone', buildAccessors(audioPermissions, 'microphone'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      status: 'blocked',
      canAskAgain: false,
      reason: reason ? `No se pudo verificar permisos de micrófono: ${reason}` : undefined,
    };
  }
}

export async function ensureCameraPermission(): Promise<PermissionCheckResult> {
  try {
    return await safeRequest('camera', buildAccessors(cameraPermissions, 'camera'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      status: 'blocked',
      canAskAgain: false,
      reason: reason ? `No se pudo verificar permisos de cámara: ${reason}` : undefined,
    };
  }
}
