import * as ExpoCamera from 'expo-camera';
import * as ExpoAudio from 'expo-audio';

import { ensureMediaPermissions, ensurePermissions } from '@/src/lib/permissions';

type Perm = { status: string; granted: boolean; canAskAgain: boolean };

const Camera = (ExpoCamera as any).Camera as {
  getCameraPermissionsAsync: jest.Mock<Promise<Perm>, []>;
  requestCameraPermissionsAsync: jest.Mock<Promise<Perm>, []>;
};

const AudioMod: any = ExpoAudio;
// Nuestro mock expone Audio.{getPermissionsAsync, requestPermissionsAsync} como alias
const Audio = (AudioMod.Audio ?? AudioMod) as {
  getPermissionsAsync: jest.Mock<Promise<Perm>, []>;
  requestPermissionsAsync: jest.Mock<Promise<Perm>, []>;
};

describe('permissions', () => {
  beforeEach(() => {
    // Defaults “neutros” (cada test puede sobreescribir).
    Camera.getCameraPermissionsAsync.mockResolvedValue({ status: 'denied', granted: false, canAskAgain: true });
    Camera.requestCameraPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });

    Audio.getPermissionsAsync.mockResolvedValue({ status: 'denied', granted: false, canAskAgain: true });
    Audio.requestPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true, canAskAgain: false });
  });

  test('ensurePermissions requests each permission once', async () => {
    // Forzar que tenga que pedir permisos: current = denied, luego request = granted
    Camera.getCameraPermissionsAsync.mockResolvedValueOnce({ status: 'denied', granted: false, canAskAgain: true });
    Camera.requestCameraPermissionsAsync.mockResolvedValueOnce({ status: 'granted', granted: true, canAskAgain: true });

    Audio.getPermissionsAsync.mockResolvedValueOnce({ status: 'denied', granted: false, canAskAgain: true });
    Audio.requestPermissionsAsync.mockResolvedValueOnce({ status: 'granted', granted: true, canAskAgain: false });

    const result = await ensurePermissions('camera', 'microphone');

    expect(Camera.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(Audio.requestPermissionsAsync).toHaveBeenCalledTimes(1);

    expect(result.camera.granted).toBe(true);
    expect(result.microphone.granted).toBe(true);
    expect(result.microphone.canAskAgain).toBe(false);
  });

  test('ensureMediaPermissions returns true when all granted', async () => {
    Camera.getCameraPermissionsAsync.mockResolvedValueOnce({ status: 'granted', granted: true, canAskAgain: true });
    Audio.getPermissionsAsync.mockResolvedValueOnce({ status: 'granted', granted: true, canAskAgain: true });

    const granted = await ensureMediaPermissions();
    expect(granted).toBe(true);
  });

  test('ensureMediaPermissions returns false when any denied', async () => {
    // Bloqueado / no se puede volver a pedir
    Camera.getCameraPermissionsAsync.mockResolvedValueOnce({ status: 'denied', granted: false, canAskAgain: false });
    Audio.getPermissionsAsync.mockResolvedValueOnce({ status: 'granted', granted: true, canAskAgain: true });

    const granted = await ensureMediaPermissions();
    expect(granted).toBe(false);
    // En este escenario no debería pedir cámara si no puede
    expect(Camera.requestCameraPermissionsAsync).toHaveBeenCalledTimes(0);
  });

  test('ensurePermissions throws for unknown permission', async () => {
    await expect(ensurePermissions('unknown' as any)).rejects.toThrow();
  });
});
