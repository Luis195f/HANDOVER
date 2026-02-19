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
 * - pat-002 aparece primero en el orden "normal"
 * - pat-001 debe quedar primero al activar prioridad clínica y contener "NEWS2"
 */
const API_PATIENTS = [
  {
    id: 'pat-002',
    name: 'Paciente 2',
    unitId: 'icu-a',
    bedLabel: '2',
    vitals: {},
    devices: [],
    risks: {},
  },
  {
    id: 'pat-001',
    name: 'Paciente 1',
    unitId: 'icu-a',
    bedLabel: '1',
    vitals: {},
    devices: [],
    risks: { news2: 7 },
  },
] as const;

// ✅ helper: deja correr microtasks/effects
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * ✅ PatientList carga por apiGet('/api/patients?...'), así que mockeamos esa fuente REAL.
 */
vi.mock('@/src/lib/api', () => ({
  apiGet: vi.fn(async (url: string) => {
    // opcional: si quieres asegurar que la URL es la esperada
    // if (!url.startsWith('/api/patients')) throw new Error(`Unexpected url: ${url}`);

    // PatientList hace: Array.isArray(data) ? data : (data?.results ?? [])
    // devolvemos array directo para que sea simple.
    return [...API_PATIENTS];
  }),
}));

/**
 * ✅ Evita que src/lib/queue.ts importe SQLite en tests.
 * PatientList solo necesita estos exports para pintar estado offline; devolvemos no-op.
 */
vi.mock('@/src/lib/queue', () => ({
  listOfflineQueue: vi.fn(() => []),
  summarizePatientQueueState: vi.fn(() => ({})),
}));

/**
 * ✅ Controlamos la prioridad clínica aquí (sin depender de cálculos reales).
 * PatientList usa computePriority / computePriorityList; devolvemos estructura estable.
 */
vi.mock('@/src/lib/priority', () => ({
  computePriority: (input: any) => {
    const id = String(input?.patientId ?? input?.id ?? '');
    if (id === 'pat-001') {
      return {
        patientId: 'pat-001',
        reasonSummary: 'NEWS2: 7 (riesgo)',
      };
    }
    return {
      patientId: id || 'pat-002',
      reasonSummary: 'Sin alertas',
    };
  },

  computePriorityList: (inputs: any[]) => {
    // Cuando activas prioridad clínica, queremos pat-001 primero.
    // Mantén la salida con patientId + reasonSummary (lo que el test valida).
    const ids = inputs.map(x => String(x?.patientId ?? x?.id ?? ''));
    const has001 = ids.includes('pat-001');
    const has002 = ids.includes('pat-002');

    const out: Array<{ patientId: string; reasonSummary: string }> = [];
    if (has001) out.push({ patientId: 'pat-001', reasonSummary: 'NEWS2: 7 (riesgo)' });
    if (has002) out.push({ patientId: 'pat-002', reasonSummary: 'Sin alertas' });

    // fallback por si cambia el input shape
    if (out.length === 0) {
      out.push({ patientId: 'pat-001', reasonSummary: 'NEWS2: 7 (riesgo)' });
      out.push({ patientId: 'pat-002', reasonSummary: 'Sin alertas' });
    }
    return out;
  },
}));

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

describe('PatientList – prioridad clínica', () => {
  const navigation: any = { navigate: vi.fn(), setOptions: vi.fn() };

  const findSwitchInElement = (node: any): any | null => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === Switch) return node;

    const children = node.props?.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        const found = findSwitchInElement(child);
        if (found) return found;
      }
      return null;
    }

    return findSwitchInElement(children);
  };

  it('ordena por prioridad clínica y muestra el resumen', async () => {
    let renderer: ReturnType<typeof create>;

    // 1) Render + esperar a que apiGet resuelva y setPatients haga re-render
    await act(async () => {
      renderer = create(<PatientList navigation={navigation} />);
      await flush();
      await flush();
    });

    // 2) Si tu UI requiere seleccionar filtros para cargar, mantenemos tu lógica
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

    // 3) Data inicial (orden normal)
    const initialList = renderer!.root.findByType(FlatList);
    const initialData = (initialList.props.data ?? []) as Array<{ patientId: string }>;

    expect(Array.isArray(initialData)).toBe(true);
    expect(initialData.length).toBeGreaterThan(0);

    // En orden “normal” esperamos pat-002 primero (según fixture + tu intención del test)
    expect(initialData[0].patientId).toBe('pat-002');

    // 4) Activar prioridad clínica + esperar re-render
    const listAfterLoad = renderer!.root.findByType(FlatList);
    const header = listAfterLoad.props.ListHeaderComponent;
    const toggle = findSwitchInElement(header);
    expect(toggle).toBeTruthy();
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
    expect(sorted[0].patientId).toBe('pat-001');
    expect(sorted[0].reasonSummary).toContain('NEWS2');
  });
});
