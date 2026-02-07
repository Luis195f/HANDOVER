import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AudioAttach from '@/src/components/AudioAttach';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  useAudioRecorder,
} from 'expo-audio';

type MockRecorder = {
  isRecording: boolean;
  uri: string | null;
  prepareToRecordAsync: ReturnType<typeof vi.fn>;
  record: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

const mockRecorder: MockRecorder = {
  isRecording: false,
  uri: null,
  prepareToRecordAsync: vi.fn(async () => undefined),
  record: vi.fn(),
  stop: vi.fn(async () => {
    mockRecorder.uri = 'file://test-audio.m4a';
    mockRecorder.isRecording = false;
    return mockRecorder.uri;
  }),
};

vi.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: 'HIGH_QUALITY' },
  useAudioRecorder: vi.fn(() => mockRecorder),
  getRecordingPermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestRecordingPermissionsAsync: vi.fn(async () => ({ granted: true })),
}));

describe('AudioAttach', () => {
  beforeEach(() => {
    mockRecorder.isRecording = false;
    mockRecorder.uri = null;
    mockRecorder.prepareToRecordAsync.mockClear();
    mockRecorder.record.mockClear();
    mockRecorder.stop.mockClear();
    vi.mocked(useAudioRecorder).mockReturnValue(mockRecorder as any);
    vi.mocked(getRecordingPermissionsAsync).mockResolvedValue({ granted: true } as any);
    vi.mocked(requestRecordingPermissionsAsync).mockResolvedValue({ granted: true } as any);
  });

  it('inicia y detiene la grabación llamando callbacks con URI', async () => {
    const onRecorded = vi.fn();
    const onAttach = vi.fn();

    const view = render(<AudioAttach onRecorded={onRecorded} onAttach={onAttach} />);

    await waitFor(() => {
      expect(getRecordingPermissionsAsync).toHaveBeenCalled();
    });

    fireEvent.press(view.getByText('Grabar audio'));

    await waitFor(() => {
      expect(mockRecorder.prepareToRecordAsync).toHaveBeenCalled();
      expect(mockRecorder.record).toHaveBeenCalled();
    });

    mockRecorder.isRecording = true;
    await act(async () => {
      view.update(<AudioAttach onRecorded={onRecorded} onAttach={onAttach} />);
    });

    await waitFor(() => {
      expect(view.getByText('Detener y adjuntar')).toBeTruthy();
    });

    fireEvent.press(view.getByText('Detener y adjuntar'));

    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalledWith('file://test-audio.m4a');
    });

    expect(onAttach).toHaveBeenCalledWith('file://test-audio.m4a');
  });

  it('no inicia grabación si el permiso está denegado', async () => {
    vi.mocked(getRecordingPermissionsAsync).mockResolvedValue({ granted: false } as any);
    vi.mocked(requestRecordingPermissionsAsync).mockResolvedValue({ granted: false } as any);

    const view = render(<AudioAttach />);

    await waitFor(() => {
      expect(getRecordingPermissionsAsync).toHaveBeenCalled();
    });

    fireEvent.press(view.getByText('Grabar audio'));

    await waitFor(() => {
      expect(requestRecordingPermissionsAsync).toHaveBeenCalled();
    });

    expect(mockRecorder.record).not.toHaveBeenCalled();
  });
});
