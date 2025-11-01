import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import * as ReactNative from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import Chip from '@/src/components/Chip';

describe('Chip component', () => {
  it('renderiza estado por defecto', () => {
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(<Chip label="Disponible" />);
    });

    const pressable = renderer!.root.findByType('Pressable');
    expect(pressable.props.accessibilityState).toMatchObject({ selected: false });
    expect(typeof pressable.props.style).toBe('function');

    const resolvedStyles = pressable.props.style({ pressed: false });
    expect(resolvedStyles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          paddingHorizontal: 12,
          borderRadius: 999,
        }),
        expect.objectContaining({
          backgroundColor: '#E5E7EB',
          borderColor: '#CBD5E1',
          opacity: 1,
        }),
      ])
    );

    const text = renderer!.root.findByType('Text');
    expect(text.props.children).toBe('Disponible');
    expect(text.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fontWeight: '600' }),
        expect.objectContaining({ color: '#111827' }),
      ])
    );
  });

  it('aplica estilo seleccionado', () => {
    const schemeSpy = vi.spyOn(ReactNative, 'useColorScheme');
    schemeSpy.mockReturnValue('dark');

    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(<Chip label="Seleccionado" selected />);
    });

    const pressable = renderer!.root.findByType('Pressable');
    const resolvedStyles = pressable.props.style({ pressed: false });
    expect(resolvedStyles[1]).toMatchObject({
      backgroundColor: '#1D4ED8',
      borderColor: '#475569',
    });

    const text = renderer!.root.findByType('Text');
    const styles = Array.isArray(text.props.style)
      ? text.props.style
      : [text.props.style];
    expect(styles[1]).toMatchObject({ color: '#FFFFFF' });

    schemeSpy.mockRestore();
  });

  it('respeta estilos personalizados y onPress', () => {
    const onPress = vi.fn();
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(
        <Chip
          label="Acción"
          onPress={onPress}
          selected
          style={{ marginBottom: 0 }}
          textStyle={{ fontSize: 20 }}
        />
      );
    });

    const pressable = renderer!.root.findByType('Pressable');
    expect(pressable.props.onPress).toBeTypeOf('function');
    pressable.props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);

    const resolvedStyles = pressable.props.style({ pressed: true });
    expect(resolvedStyles[2]).toMatchObject({ marginBottom: 0 });
    expect(resolvedStyles[1]).toMatchObject({ opacity: 0.9 });

    const text = renderer!.root.findByType('Text');
    const styles = Array.isArray(text.props.style)
      ? text.props.style
      : [text.props.style];
    expect(styles[1]).toMatchObject({ color: '#FFFFFF' });
    expect(styles[2]).toMatchObject({ fontSize: 20 });
  });
});
