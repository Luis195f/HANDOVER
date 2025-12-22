import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    // Asegura un mock explícito para este test (evita flakiness si otro test cambia el mock)
    vi.mocked(transcribeAudioWithResult).mockResolvedValueOnce({ ok: true, text: 'mock transcription' });

    const screen = renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('audio-ai-transcribe')).toBeTruthy();
    });

    // IMPORTANTE: envolver la acción async en act()
    await act(async () => {
      fireEvent.press(screen.getByTestId('audio-ai-transcribe'));
    });

    // Espera a que realmente se llame al servicio
    await waitFor(() => {
      expect(transcribeAudioWithResult).toHaveBeenCalledWith('file://mock-note.m4a', { language: 'es' });
    });

    // Lee el valor de forma robusta (value o defaultValue)
    await waitFor(() => {
      const input = screen.getByTestId('audio-transcription-input');
      const v = String((input as any).props.value ?? (input as any).props.defaultValue ?? '');
      expect(v).toContain('mock transcription');
    });
  });

  it('permite editar manualmente cuando la transcripción falla', async () => {
    vi.mocked(transcribeAudioWithResult).mockResolvedValueOnce({ ok: false, error: 'network' });

    const screen = renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('audio-ai-transcribe')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('audio-ai-transcribe'));
    });

    const input = screen.getByTestId('audio-transcription-input');
    fireEvent.changeText(input, 'manual note');

    await waitFor(() => {
      expect(
        screen.getByText('No se pudo transcribir con IA. Puedes seguir escribiendo manualmente.'),
      ).toBeTruthy();
      expect(screen.getByPlaceholderText('Transcripción editable de la nota').props.value).toBe('manual note');
    });
  });

  it('añade texto dictado cuando el STT notifica un resultado final', async () => {
    const screen = renderScreen();

    const dictationButton = screen.getByTestId('audio-dictation-toggle');

    await act(async () => {
      fireEvent.press(dictationButton);
    });

    const { __emitSttResult } = await import('@/src/lib/stt');

    await act(async () => {
      (__emitSttResult as any)({ text: 'dictado final', isFinal: true });
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Transcripción editable de la nota').props.value).toContain('dictado final');
    });
  });
});
