import { ensureMediaPermissions, ensurePermissions } from '@/src/lib/permissions';

const cameraMock = jest.requireMock('expo-camera');
const audioMock = jest.requireMock('expo-av');

describe('permissions', () => {
  beforeEach(() => {
    cameraMock.Camera.requestCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    audioMock.Audio.requestPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: false });
  });

  test('ensurePermissions requests each permission once', async () => {
    const result = await ensurePermissions('camera', 'microphone');
    expect(cameraMock.Camera.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(audioMock.Audio.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(result.camera.granted).toBe(true);
    expect(result.microphone.canAskAgain).toBe(false);
  });

  test('ensureMediaPermissions returns true when all granted', async () => {
    const granted = await ensureMediaPermissions();
    expect(granted).toBe(true);
  });

  test('ensureMediaPermissions returns false when any denied', async () => {
    cameraMock.Camera.requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    const granted = await ensureMediaPermissions();
    expect(granted).toBe(false);
  });

  test('ensurePermissions throws for unknown permission', async () => {
    await expect(ensurePermissions('camera', 'microphone', 'invalid' as any)).rejects.toThrow(/Unknown permission/);
  });
});
