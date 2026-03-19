import React from 'react';
import { FlatList, Switch, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import PatientList from '@/src/screens/PatientList';

vi.mock('expo', () => ({
  requireNativeModule: () => ({}),
}));

const API_PATIENTS = [
  {
    id: 'pat-002',
    name: 'Paciente 2',
    unitId: 'icu-a',
    bedLabel: '2',
    vitals: {},
    devices: [],
    risks: {},
    pendingTasks: [],
  },
  {
    id: 'pat-001',
    name: 'Paciente 1',
    unitId: 'icu-a',
    bedLabel: '1',
    vitals: {},
    devices: [{ id: 'vent', label: 'Ventilación mecánica', category: 'invasive', critical: true }],
    risks: { isolation: true },
    pendingTasks: [
      {
        id: 'task-1',
        title: 'Gasometría urgente',
        critical: true,
        dueBy: '2026-03-19T10:45:00.000Z',
      },
    ],
    recentIncidentFlag: true,
  },
] as const;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

vi.mock('@/src/lib/api', () => ({
  apiGet: vi.fn(async () => [...API_PATIENTS]),
}));

vi.mock('@/src/lib/queue', () => ({
  listOfflineQueue: vi.fn(() => []),
  summarizePatientQueueState: vi.fn(() => 'synced'),
}));

vi.mock('@/src/lib/priority', () => ({
  computePriority: (input: { patientId?: string }) => {
    const id = String(input?.patientId ?? '');
    if (id === 'pat-001') {
      return {
        patientId: 'pat-001',
        displayName: 'Paciente 1',
        bedLabel: '1',
        news2Score: 7,
        totalScore: 12,
        baseScore: 10,
        level: 'critical',
        baseLevel: 'critical',
        reasons: ['HIGH_NEWS2', 'PENDING_URGENT_TASK', 'RECENT_INCIDENT'],
        reasonSummary: 'NEWS2 7, incidente reciente, 1 pendiente crítico',
        pendingCriticalTasksCount: 1,
        explanation: {
          engine: 'mpac-v1-hybrid-rules',
          version: 1,
          sourceData: ['NEWS2 7 (alto)'],
          clinicalChange: ['Incidente reciente registrado'],
          pendingCritical: ['Gasometría urgente (crítico)'],
          activeContext: {
            unitId: 'icu-a',
            specialtyId: null,
            unitProfileId: null,
            specialtyOverlayIds: [],
            activeProfileIds: [],
            labels: ['HANDOVER Core'],
            usesCoreFallback: true,
            hasHumanSpecialtyOverride: false,
          },
          coreDimensions: [],
          modifiers: [],
        },
      };
    }

    return {
      patientId: id || 'pat-002',
      displayName: 'Paciente 2',
      bedLabel: '2',
      news2Score: 0,
      totalScore: 0,
      baseScore: 0,
      level: 'low',
      baseLevel: 'low',
      reasons: [],
      reasonSummary: 'Sin señal contextual relevante',
      pendingCriticalTasksCount: 0,
      explanation: {
        engine: 'mpac-v1-hybrid-rules',
        version: 1,
        sourceData: [],
        clinicalChange: [],
        pendingCritical: [],
        activeContext: {
          unitId: 'icu-a',
          specialtyId: null,
          unitProfileId: null,
          specialtyOverlayIds: [],
          activeProfileIds: [],
          labels: ['HANDOVER Core'],
          usesCoreFallback: true,
          hasHumanSpecialtyOverride: false,
        },
        coreDimensions: [],
        modifiers: [],
      },
    };
  },
  computePriorityList: (inputs: Array<{ patientId?: string }>) => {
    const ids = inputs.map((item) => String(item?.patientId ?? ''));
    const ordered = ['pat-001', 'pat-002'].filter((id) => ids.includes(id));
    return ordered.map((id) => {
      const items = id === 'pat-001'
        ? {
            patientId: 'pat-001',
            displayName: 'Paciente 1',
            bedLabel: '1',
            news2Score: 7,
            totalScore: 12,
            baseScore: 10,
            level: 'critical',
            baseLevel: 'critical',
            reasons: ['HIGH_NEWS2', 'PENDING_URGENT_TASK', 'RECENT_INCIDENT'],
            reasonSummary: 'NEWS2 7, incidente reciente, 1 pendiente crítico',
            pendingCriticalTasksCount: 1,
            explanation: {
              engine: 'mpac-v1-hybrid-rules',
              version: 1,
              sourceData: ['NEWS2 7 (alto)'],
              clinicalChange: ['Incidente reciente registrado'],
              pendingCritical: ['Gasometría urgente (crítico)'],
              activeContext: {
                unitId: 'icu-a',
                specialtyId: null,
                unitProfileId: null,
                specialtyOverlayIds: [],
                activeProfileIds: [],
                labels: ['HANDOVER Core'],
                usesCoreFallback: true,
                hasHumanSpecialtyOverride: false,
              },
              coreDimensions: [],
              modifiers: [],
            },
          }
        : {
            patientId: 'pat-002',
            displayName: 'Paciente 2',
            bedLabel: '2',
            news2Score: 0,
            totalScore: 0,
            baseScore: 0,
            level: 'low',
            baseLevel: 'low',
            reasons: [],
            reasonSummary: 'Sin señal contextual relevante',
            pendingCriticalTasksCount: 0,
            explanation: {
              engine: 'mpac-v1-hybrid-rules',
              version: 1,
              sourceData: [],
              clinicalChange: [],
              pendingCritical: [],
              activeContext: {
                unitId: 'icu-a',
                specialtyId: null,
                unitProfileId: null,
                specialtyOverlayIds: [],
                activeProfileIds: [],
                labels: ['HANDOVER Core'],
                usesCoreFallback: true,
                hasHumanSpecialtyOverride: false,
              },
              coreDimensions: [],
              modifiers: [],
            },
          };
      return items;
    });
  },
}));

vi.mock('@/src/security/acl', () => ({
  ensureUnitAccess: vi.fn(),
  hasRole: () => false,
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
  const props = {
    navigation: { navigate: vi.fn(), setOptions: vi.fn() },
    route: { key: 'PatientList-key', name: 'PatientList', params: undefined },
  } as const;

  function hasText(renderer: ReturnType<typeof create>, needle: string) {
    return renderer.root.findAll((node) => {
      if (node.type !== Text) return false;
      const value = node.props?.children;
      if (typeof value === 'string') return value.includes(needle);
      if (Array.isArray(value)) return value.join('').includes(needle);
      return false;
    }).length > 0;
  }

  function findSwitchInElement(node: unknown): React.ReactTestInstance | null {
    if (!node || typeof node !== 'object') return null;
    if ((node as React.ReactTestInstance).type === Switch) {
      return node as React.ReactTestInstance;
    }

    const children = (node as { props?: { children?: unknown } }).props?.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        const found = findSwitchInElement(child);
        if (found) return found;
      }
      return null;
    }

    return findSwitchInElement(children);
  }

  it('ordena por prioridad contextual de forma automática y permite volver al orden base', async () => {
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(<PatientList {...(props as unknown as React.ComponentProps<typeof PatientList>)} />);
      await flush();
      await flush();
    });

    const initialData = (renderer!.root.findByType(FlatList).props.data ?? []) as Array<{ patientId: string }>;
    expect(initialData[0].patientId).toBe('pat-001');
    expect(renderer!.root.findByProps({ testID: 'priority-omission-pat-001' })).toBeTruthy();
    expect(renderer!.root.findByProps({ testID: 'priority-window-pat-001' })).toBeTruthy();
    expect(hasText(renderer!, 'No omitir: Gasometría urgente')).toBe(true);

    const header = renderer!.root.findByType(FlatList).props.ListHeaderComponent;
    const toggle = findSwitchInElement(header);
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle.props.onValueChange(false);
      await flush();
      await flush();
    });

    const unsortedData = (renderer!.root.findByType(FlatList).props.data ?? []) as Array<{ patientId: string }>;
    expect(unsortedData[0].patientId).toBe('pat-002');
  });
});



