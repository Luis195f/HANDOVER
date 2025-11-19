import React from 'react';
import { FlatList, Switch, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import PatientList from '@/src/screens/PatientList';

vi.mock('@/src/security/acl', () => ({
  currentUser: () => ({ id: 'tester' }),
  hasUnitAccess: () => true,
}));

vi.mock('@/src/lib/otel', () => ({
  mark: vi.fn(),
}));

describe('PatientList – prioridad clínica', () => {
  type NavigationMock = { navigate: (...args: unknown[]) => void };
  const navigation: NavigationMock = { navigate: vi.fn() };

  it('ordena por prioridad clínica y muestra el resumen', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<PatientList navigation={navigation} />);
    });

    act(() => {
      const specialtyAll = renderer!
        .root
        .findAll(node => node.props?.accessibilityLabel === 'Todas las especialidades')
        .at(0);
      specialtyAll?.props.onPress();

      const unitsAll = renderer!
        .root
        .findAll(node => node.props?.accessibilityLabel === 'Todas las unidades')
        .at(0);
      unitsAll?.props.onPress();
    });

    const list = renderer!.root.findByType(FlatList);
    const initialData = list.props.data as Array<{ patientId: string }>;
    expect(initialData[0].patientId).toBe('pat-002');

    const toggle = renderer!.root.findByType(Switch);
    act(() => {
      toggle.props.onValueChange(true);
    });

    const sorted = renderer!.root.findByType(FlatList).props.data as Array<{ patientId: string; reasonSummary: string }>;
    expect(sorted[0].patientId).toBe('pat-001');
    expect(sorted[0].reasonSummary).toContain('NEWS2');
  });
});
