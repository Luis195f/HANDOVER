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

function mockGetAll(sql?: unknown) {
  const q = (typeof sql === 'string' ? sql : '').toLowerCase();

  // Solo respondemos a selects (lo más seguro para no romper otras rutas).
  if (!q.includes('select')) return [];

  // Cubrimos consultas típicas de listado (patients, joins, vistas, etc.)
  if (
    q.includes('patient') ||
    q.includes('handover') ||
    q.includes('join') ||
    q.includes('list') ||
    q.includes('view')
  ) {
    return PATIENT_LIST_ROWS_DEFAULT;
  }

  // Si el SQL no contiene keywords pero igual es un SELECT, devolvemos fixture
  // para evitar flakiness por nombres de tablas/vistas distintos.
  return PATIENT_LIST_ROWS_DEFAULT;
}

/**
 * ✅ Mock DB “universal”: soporta sync + async + context + transactions.
 */
const db = {
  // sync
  getAllSync: vi.fn((sql: any) => mockGetAll(sql)),
  getFirstSync: vi.fn((sql: any) => (mockGetAll(sql)[0] ?? null)),
  runSync: vi.fn(),
  execSync: vi.fn(),

  // async
  getAllAsync: vi.fn(async (sql: any) => mockGetAll(sql)),
  getFirstAsync: vi.fn(async (sql: any) => (mockGetAll(sql)[0] ?? null)),
  runAsync: vi.fn(async () => undefined),
  execAsync: vi.fn(async () => undefined),

  // transactions
  withTransactionSync: (fn: any) =>
    fn({
      ...db,
      withTransactionSync: (cb: any) => cb(db),
    }),
  withTransactionAsync: async (fn: any) =>
    fn({
      ...db,
      withTransactionAsync: async (cb: any) => cb(db),
    }),
};

function makeExpoSqliteMock() {
  return {
    // distintas APIs según versión
    openDatabaseSync: () => db,
    openDatabaseAsync: async () => db,
    openDatabase: () => db,

    // provider/context (algunas apps usan esto)
    SQLiteProvider: ({ children }: any) => children,
    useSQLiteContext: () => db,
  };
}

// ✅ Mock principal
vi.mock('expo-sqlite', () => makeExpoSqliteMock());

// ✅ Muchísimas apps importan desde aquí
vi.mock('expo-sqlite/next', () => makeExpoSqliteMock());

vi.mock('@/src/security/acl', () => ({
  currentUser: () => ({ id: 'tester' }),
  hasUnitAccess: () => true,
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
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('PatientList – prioridad clínica', () => {
  const navigation: any = { navigate: vi.fn(), setOptions: vi.fn() };

  it('ordena por prioridad clínica y muestra el resumen', async () => {
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(<PatientList navigation={navigation} />);
      await flush();
      await flush();
    });

    // Si el componente requiere “seleccionar filtros” para cargar, simulamos los taps
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

      await flush();
      await flush();
    });

    // Releer FlatList tras los flush
    const list = renderer!.root.findByType(FlatList);
    const initialData = (list.props.data ?? []) as Array<{ patientId: string }>;

    expect(Array.isArray(initialData)).toBe(true);
    expect(initialData.length).toBeGreaterThan(0);

    // Orden “normal”
    expect(initialData[0].patientId).toBe('pat-002');

    const toggle = renderer!.root.findByType(Switch);
    await act(async () => {
      toggle.props.onValueChange(true);
      await flush();
      await flush();
    });

    const sorted = (renderer!.root.findByType(FlatList).props.data ?? []) as Array<{
      patientId: string;
      reasonSummary: string;
    }>;

    expect(sorted.length).toBeGreaterThan(0);

    // Orden por prioridad clínica activado
    expect(sorted[0].patientId).toBe('pat-001');
    expect(sorted[0].reasonSummary).toContain('NEWS2');
  });
});
