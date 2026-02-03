import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

type PanResponderConfig = {
  onPanResponderGrant?: (event: { nativeEvent: { locationX: number; locationY: number } }) => void;
  onPanResponderMove?: (event: { nativeEvent: { locationX: number; locationY: number } }) => void;
  onPanResponderRelease?: () => void;
  onPanResponderTerminate?: () => void;
  onStartShouldSetPanResponder?: () => boolean;
  onMoveShouldSetPanResponder?: () => boolean;
};

vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    ...actual,
    PanResponder: {
      create: (handlers: PanResponderConfig) => ({
        panHandlers: {
          onResponderGrant: handlers.onPanResponderGrant,
          onResponderMove: handlers.onPanResponderMove,
          onResponderRelease: handlers.onPanResponderRelease,
          onResponderTerminate: handlers.onPanResponderTerminate,
          onStartShouldSetResponder: handlers.onStartShouldSetPanResponder,
          onMoveShouldSetResponder: handlers.onMoveShouldSetPanResponder,
        },
      }),
    },
  };
});

import { SignaturePad } from '@/src/components/SignaturePad';
import { __setMockSvgDataUrl } from 'react-native-svg';

describe('SignaturePad', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-05T10:30:00.000Z'));
    __setMockSvgDataUrl('mock-signature');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the signature pad', () => {
    const { getByTestId } = render(<SignaturePad onChange={vi.fn()} />);
    expect(getByTestId('signature-pad')).toBeTruthy();
  });

  it('captures a signature payload', () => {
    const onChange = vi.fn();
    const { getByTestId } = render(
      <SignaturePad
        onChange={onChange}
        value={{ imageBase64: 'existing', signedAt: '2025-01-05T10:20:00.000Z' }}
      />,
    );

    fireEvent.press(getByTestId('signature-pad-save'));

    expect(onChange).toHaveBeenCalledWith({
      imageBase64: 'mock-signature',
      signedAt: '2025-01-05T10:30:00.000Z',
    });
  });
});
