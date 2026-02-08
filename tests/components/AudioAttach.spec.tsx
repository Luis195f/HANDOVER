import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AudioAttach from '@/src/components/AudioAttach';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  type PermissionResponse,
} from 'expo-audio';

// ✅ Mock del wrapper REAL que usa el componente
import { useAudioRecorderWithFallback } from '@/src/lib/audio-recorder';

type MockRecorder = {
  isRecording: boolean;
  uri: string | null;
  prepareToRecordAsync?: ReturnType<typeof vi.fn>;
  record?: ReturnType<typeof vi.fn>;
  stop?: ReturnType<typeof vi.fn>;
};

const mockRecorder: MockRecorder = {
  isRecording: false,
  uri: null,
  prepareToRecordAsync: vi.fn(async () => undefined),
  record: vi.fn(),
  stop: vi.fn(async () => 'file://test-audio.m4a'),
};

// ✅ Mantén mock de permisos (esto SÍ lo usa AudioAttach)
vi.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: 'HIGH_QUALITY', LOW_QUALITY: 'LOW_QUALITY' },
  getRecordingPermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestRecordingPermissionsAsync: vi.fn(async () => ({ granted: true })),
}));

// ✅ Mock del wrapper: SIEMPRE devuelve el recorder del test
vi.mock('@/src/lib/audio-recorder', () => ({
  useAudioRecorderWithFallback: vi.fn(() => mockRecorder),
}));

describe('AudioAttach', () => {
  beforeEach(() => {
    mockRecorder.isRecording = false;
    mockRecorder.uri = null;
    mockRecorder.prepareToRecordAsync?.mockClear();
    mockRecorder.record?.mockClear();
    mockRecorder.stop?.mockClear();

    vi.mocked(useAudioRecorderWithFallback).mockReturnValue(mockRecorder as any);

    vi.mocked(getRecordingPermissionsAsync).mockResolvedValue({ granted: true } as PermissionResponse);
    vi.mocked(requestRecordingPermissionsAsync).mockResolvedValue({ granted: true } as PermissionResponse);
  });

  it('inicia y detiene la grabación llamando callbacks con URI', async () => {
    const onRecorded = vi.fn();
    const onAttach = vi.fn();

    const view = render(<AudioAttach onRecorded={onRecorded} onAttach={onAttach} />);

    await waitFor(() => {
      expect(getRecordingPermissionsAsync).toHaveBeenCalled();
    });

    // ✅ onPress es async -> espera con act
    await act(async () => {
      fireEvent.press(view.getByText('Grabar audio'));
    });

    await waitFor(() => {
      expect(mockRecorder.prepareToRecordAsync).toHaveBeenCalled();
      expect(mockRecorder.record).toHaveBeenCalled();
    });

    // Simula que ya está grabando (re-render para que cambie el botón)
    mockRecorder.isRecording = true;
    await act(async () => {
      view.update(<AudioAttach onRecorded={onRecorded} onAttach={onAttach} />);
    });

    await waitFor(() => {
      expect(view.getByText('Detener y adjuntar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(view.getByText('Detener y adjuntar'));
    });

    await waitFor(() => {
      expect(mockRecorder.stop).toHaveBeenCalled();
      expect(onRecorded).toHaveBeenCalledWith('file://test-audio.m4a');
    });

    expect(onAttach).toHaveBeenCalledWith('file://test-audio.m4a');
  });

  it('no inicia grabación si el permiso está denegado', async () => {
    vi.mocked(getRecordingPermissionsAsync).mockResolvedValue({ granted: false } as PermissionResponse);
    vi.mocked(requestRecordingPermissionsAsync).mockResolvedValue({ granted: false } as PermissionResponse);

    const view = render(<AudioAttach />);

    await waitFor(() => {
      expect(getRecordingPermissionsAsync).toHaveBeenCalled();
    });

    await act(async () => {
      fireEvent.press(view.getByText('Grabar audio'));
    });

    await waitFor(() => {
      expect(requestRecordingPermissionsAsync).toHaveBeenCalled();
    });

    expect(mockRecorder.record).not.toHaveBeenCalled();
  });
});
