import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import AudioNote from '@/src/screens/AudioNote';
import { transcribeAudioWithResult } from '@/src/lib/stt';

vi.mock('@/src/lib/stt', () => {
  let status: 'idle' | 'listening' | 'processing' | 'error' = 'idle';
  const listeners = new Set<(result: { text: string; isFinal: boolean }) => void>();
  const service = {
    start: vi.fn(async () => {
      status = 'listening';
    }),
    stop: vi.fn(async () => {
      status = 'idle';
      listeners.forEach((listener) => listener({ text: '', isFinal: true }));
    }),
    cancel: vi.fn(async () => {
      status = 'idle';
    }),
    addListener: (handler: (result: { text: string; isFinal: boolean }) => void) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    getStatus: () => status,
    getLastError: () => null,
  };

  return {
    createSttService: () => service,
    transcribeAudioWithResult: vi.fn(async () => ({ ok: true, text: 'mock transcription' })),
    __emitSttResult: (payload: { text: string; isFinal: boolean }) => {
      listeners.forEach((listener) => listener(payload));
    },
  };
});

vi.mock('expo-audio', () => {
  const recorder = {
    isRecording: false,
    uri: 'file://mock-note.m4a',
    record: vi.fn(),
    stop: vi.fn(async () => 'file://mock-note.m4a'),
    prepareToRecordAsync: vi.fn(async () => undefined),
  };

  return {
    useAudioRecorder: () => recorder,
    setAudioModeAsync: vi.fn(async () => undefined),
    RecordingPresets: { HIGH_QUALITY: {} },
    getRecordingPermissionsAsync: vi.fn(async () => ({ granted: true })),
    requestRecordingPermissionsAsync: vi.fn(async () => ({ granted: true })),
  };
});

const navigationMock = { goBack: vi.fn() } as any;

const renderScreen = () =>
  render(
    <AudioNote
      navigation={navigationMock}
      route={{ key: 'AudioNote', name: 'AudioNote', params: undefined }}
    />,
  );

describe('AudioNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rellena la transcripción al transcribir el audio grabado con IA', async () => {
    const screen = renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('audio-ai-transcribe')).toBeTruthy();
    });

    await fireEvent.press(screen.getByTestId('audio-ai-transcribe'));

    await waitFor(() => {
      const input = screen.getByTestId('audio-transcription-input');
      expect(input.props.value).toContain('mock transcription');
    });

    expect(transcribeAudioWithResult).toHaveBeenCalledWith('file://mock-note.m4a', { language: 'es' });
  });

  it('permite editar manualmente cuando la transcripción falla', async () => {
    vi.mocked(transcribeAudioWithResult).mockResolvedValueOnce({ ok: false, error: 'network' });
    const screen = renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('audio-ai-transcribe')).toBeTruthy();
    });

    await fireEvent.press(screen.getByTestId('audio-ai-transcribe'));

    const input = screen.getByTestId('audio-transcription-input');
    fireEvent.changeText(input, 'manual note');

    await waitFor(() => {
      expect(screen.getByText('No se pudo transcribir con IA. Puedes seguir escribiendo manualmente.')).toBeTruthy();
      expect(screen.getByPlaceholderText('Transcripción editable de la nota').props.value).toBe('manual note');
    });
  });

  it('añade texto dictado cuando el STT notifica un resultado final', async () => {
    const screen = renderScreen();

    const dictationButton = screen.getByTestId('audio-dictation-toggle');
    await fireEvent.press(dictationButton);

    const { __emitSttResult } = await import('@/src/lib/stt');
    await act(async () => {
      (__emitSttResult as any)({ text: 'dictado final', isFinal: true });
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Transcripción editable de la nota').props.value).toContain(
        'dictado final',
      );
    });
  });
});
