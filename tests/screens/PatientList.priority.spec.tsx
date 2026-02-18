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

// ✅ helper: deja correr microtasks / effects
const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('PatientList – prioridad clínica', () => {
  const navigation: any = { navigate: vi.fn(), setOptions: vi.fn() };

  it('ordena por prioridad clínica y muestra el resumen', async () => {
    let renderer: ReturnType<typeof create>;

    // 1) Render + primer flush (montaje + effects)
    await act(async () => {
      renderer = create(<PatientList navigation={navigation} />);
      await flushPromises();
    });

    // 2) Si el componente requiere “seleccionar filtros” para cargar, simulamos taps
    await act(async () => {
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

      // deja correr el re-render si esos taps disparan estado/efectos
      await flushPromises();
    });

    // 3) Reintenta leer data (en RN+hooks puede tardar 1–2 ticks)
    let initialData: Array<{ patientId: string }> = [];

    for (let i = 0; i < 3; i++) {
      // re-buscar la FlatList cada iteración (no reutilices referencias viejas)
      const list = renderer!.root.findByType(FlatList);
      initialData = (list.props.data ?? []) as Array<{ patientId: string }>;

      if (Array.isArray(initialData) && initialData.length > 0) break;

      await act(async () => {
        await flushPromises();
      });
    }

    expect(Array.isArray(initialData)).toBe(true);
    expect(initialData.length).toBeGreaterThan(0);

    // Orden “normal”
    expect(initialData[0].patientId).toBe('pat-002');

    // 4) Toggle prioridad clínica + flush para re-render
    const toggle = renderer!.root.findByType(Switch);
    await act(async () => {
      toggle.props.onValueChange(true);
      await flushPromises();
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
