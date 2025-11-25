import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import { DemoModeBanner } from '@/src/components/DemoModeBanner';

describe('DemoModeBanner', () => {
  it('muestra indicador y permite salir del modo demo', () => {
    const onExit = vi.fn();
    const { getByText } = render(<DemoModeBanner visible onExit={onExit} />);

    fireEvent.press(getByText('Salir del modo demo'));

    expect(getByText('Modo demo – datos ficticios')).toBeTruthy();
    expect(onExit).toHaveBeenCalled();
  });
});
