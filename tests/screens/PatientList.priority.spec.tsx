import React from 'react';
import { FlatList, Switch } from 'react-native';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import PatientList from '@/src/screens/PatientList';

vi.mock('expo', () => ({
  requireNativeModule: () => ({}),
}));

/**
 * Fixtures mínimos para que PatientList tenga data:
 * - pat-002 aparece primero en el orden "normal" (ej: más reciente / default)
 * - pat-001 tiene reasonSummary con "NEWS2" y debe quedar primero al activar prioridad clínica
 */
const PATIENT_LIST_ROWS_DEFAULT = [
  {
    patientId: 'pat-002',
    reasonSummary: 'Sin alertas',
    unit: 'icu-a',
    service: 'uci',
    room: '2',
    updatedAt: '2026-02-18T10:00:00Z',
  },
  {
    patientId: 'pat-001',
    reasonSummary: 'NEWS2: 7 (riesgo)',
    unit: 'icu-a',
    service: 'uci',
    room: '1',
    updatedAt: '2026-02-18T09:00:00Z',
  },
];

function mockGetAllSync(sql?: unknown) {
  const q = (typeof sql === 'string' ? sql : '').toLowerCase();

  // Solo respondemos a selects (lo más seguro para no romper otras rutas).
  if (!q.includes('select')) return [];

  // Si PatientList hace JOINs o consulta una "vista" de lista, devolvemos lo que el test necesita.
  // (Esto cubre: select ... from patients, join handovers, etc.)
  if (q.includes('patient') || q.includes('handover') || q.includes('join')) {
    return PATIENT_LIST_ROWS_DEFAULT;
  }

  return [];
}

vi.mock('expo-sqlite', () => {
  const db = {
    getAllSync: vi.fn((sql: any) => mockGetAllSync(sql)),
    runSync: vi.fn(),
    withTransactionSync: (fn: any) =>
      fn({
        getAllSync: vi.fn((sql: any) => mockGetAllSync(sql)),
        runSync: vi.fn(),
        withTransactionSync: (cb: any) =>
          cb({
            getAllSync: vi.fn((sql: any) => mockGetAllSync(sql)),
            runSync: vi.fn(),
          }),
      }),
  };

  return {
    openDatabaseSync: () => db,
    SQLiteProvider: ({ children }: any) => children,
  };
});

vi.mock('@/src/security/acl', () => ({
  currentUser: () => ({ id: 'tester' }),
  hasUnitAccess: () => true,
  // Evita edge-cases de UI (botón supervisor, etc.)
  hasRole: (_session: any, _roles: string[]) => false,
}));

vi.mock('@/src/security/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'tester' }, roles: ['nurse'] },
    loading: false,
    loginWithOAuth: vi.fn(),
    loginWithCredentials: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('@/src/lib/otel', () => ({
  mark: vi.fn(),
}));

describe('PatientList – prioridad clínica', () => {
  const navigation: any = { navigate: vi.fn(), setOptions: vi.fn() };

  it('ordena por prioridad clínica y muestra el resumen', () => {
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = create(<PatientList navigation={navigation} />);
    });

    // Si el componente requiere “seleccionar filtros” para cargar, simulamos los taps
    act(() => {
      const specialtyAll = renderer!
        .root
        .findAll(node => node.props?.accessibilityLabel === 'Todas las especialidades')
        .at(0);
      specialtyAll?.props.onPress?.();

      const unitsAll = renderer!
        .root
        .findAll(node => node.props?.accessibilityLabel === 'Todas las unidades')
        .at(0);
      unitsAll?.props.onPress?.();
    });

    const list = renderer!.root.findByType(FlatList);
    const initialData = list.props.data as Array<{ patientId: string }>;

    // ✅ ahora initialData debe existir y tener contenido
    expect(Array.isArray(initialData)).toBe(true);
    expect(initialData.length).toBeGreaterThan(0);

    // Orden “normal”
    expect(initialData[0].patientId).toBe('pat-002');

    const toggle = renderer!.root.findByType(Switch);
    act(() => {
      toggle.props.onValueChange(true);
    });

    const sorted = renderer!.root.findByType(FlatList).props.data as Array<{
      patientId: string;
      reasonSummary: string;
    }>;

    // Orden por prioridad clínica activado
    expect(sorted[0].patientId).toBe('pat-001');
    expect(sorted[0].reasonSummary).toContain('NEWS2');
  });
});
