import { afterEach, describe, expect, it, vi } from 'vitest';

const audioState = {
  current: { status: 'denied', granted: false, canAskAgain: true },
  request: { status: 'granted', granted: true, canAskAgain: false },
};
const cameraState = {
  current: { status: 'denied', granted: false, canAskAgain: true },
  request: { status: 'denied', granted: false, canAskAgain: false },
};

vi.mock('expo-audio', () => ({
  getRecordingPermissionsAsync: vi.fn(async () => ({ ...audioState.current })),
  requestRecordingPermissionsAsync: vi.fn(async () => ({ ...audioState.request })),
}));

vi.mock('expo-camera', () => ({
  Camera: {
    getCameraPermissionsAsync: vi.fn(async () => ({ ...cameraState.current })),
    requestCameraPermissionsAsync: vi.fn(async () => ({ ...cameraState.request })),
  },
}));

import { ensureAudioPermission, ensureCameraPermission } from '../permissions';

describe('permissions helpers', () => {
  afterEach(() => {
    audioState.current = { status: 'denied', granted: false, canAskAgain: true } as any;
    audioState.request = { status: 'granted', granted: true, canAskAgain: false } as any;
    cameraState.current = { status: 'denied', granted: false, canAskAgain: true } as any;
    cameraState.request = { status: 'denied', granted: false, canAskAgain: false } as any;
  });

  it('returns granted when audio permission already granted', async () => {
    audioState.current = { status: 'granted', granted: true, canAskAgain: true } as any;
    const result = await ensureAudioPermission();
    expect(result).toEqual({ status: 'granted', canAskAgain: true });
  });

  it('requests audio permission when denied but can ask again', async () => {
    audioState.current = { status: 'denied', granted: false, canAskAgain: true } as any;
    audioState.request = { status: 'granted', granted: true, canAskAgain: false } as any;
    const result = await ensureAudioPermission();
    expect(result.status).toBe('granted');
    expect(result.canAskAgain).toBe(false);
  });

  it('marks audio permission as blocked when cannot ask again', async () => {
    audioState.current = { status: 'denied', granted: false, canAskAgain: false } as any;
    const result = await ensureAudioPermission();
    expect(result.status).toBe('blocked');
    expect(result.canAskAgain).toBe(false);
    expect(result.reason).toMatch(/bloqueado/i);
  });

  it('handles camera permission flow and returns denied guidance', async () => {
    cameraState.current = { status: 'denied', granted: false, canAskAgain: true } as any;
    cameraState.request = { status: 'denied', granted: false, canAskAgain: false } as any;
    const result = await ensureCameraPermission();
    expect(result.status).toBe('blocked');
    expect(result.reason).toMatch(/cámara/i);
  });

  it('returns blocked when permission APIs throw', async () => {
    const audioModule = await import('expo-audio');
    (audioModule.requestRecordingPermissionsAsync as any).mockRejectedValueOnce(new Error('boom'));

    const result = await ensureAudioPermission();
    expect(result.status).toBe('blocked');
    expect(result.reason).toMatch(/boom/);
  });
});
