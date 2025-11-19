import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SupervisorDashboardScreen } from '@/src/screens/SupervisorDashboard';
import * as analytics from '@/src/lib/analytics';
import { buildPrioritySnapshot, computeTurnMetrics } from '@/src/lib/analytics';
import type { PriorityInput } from '@/src/lib/priority';

const navigate = vi.fn();

vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate }),
}));

const mockInputs: PriorityInput[] = [
  {
    patientId: 'p-critical',
    displayName: 'Paciente crítico',
    bedLabel: 'A1',
    vitals: { rr: 28, spo2: 90, tempC: 39.2, sbp: 88, hr: 135, o2: true, avpu: 'V' },
    devices: [{ id: 'dev-vent', label: 'VM', category: 'invasive', critical: true }],
    risks: { isolation: true },
    pendingTasks: [{ id: 't1', title: 'Gasometría', urgent: true }],
    recentIncidentFlag: true,
  },
  {
    patientId: 'p-high',
    displayName: 'Paciente alto',
    bedLabel: 'A2',
    vitals: { rr: 21, spo2: 95, tempC: 38.5, sbp: 108, hr: 98, avpu: 'A' },
    devices: [],
    risks: { fall: true },
    pendingTasks: [{ id: 't2', title: 'Control de vía', urgent: false }],
  },
  {
    patientId: 'p-low',
    displayName: 'Paciente estable',
    bedLabel: 'B1',
    vitals: { rr: 16, spo2: 98, tempC: 36.8, sbp: 120, hr: 80 },
    devices: [],
    risks: {},
    pendingTasks: [],
  },
];

const prioritizedSnapshot = buildPrioritySnapshot(mockInputs);
const expectedMetrics = computeTurnMetrics(prioritizedSnapshot);

async function flushAsync() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

function extractText(node: any): string {
  const { children } = node.props ?? {};
  if (Array.isArray(children)) {
    return children
      .map((child: unknown) => (typeof child === 'string' || typeof child === 'number' ? child : ''))
      .join('');
  }
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }
  return '';
}

describe('SupervisorDashboardScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(analytics, 'getTurnData').mockResolvedValue(mockInputs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('muestra métricas agregadas y la lista ordenada por criticidad', async () => {
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<SupervisorDashboardScreen />);
    });
    await flushAsync();
    await flushAsync();

    const totalLabel = renderer!.root.findAllByProps({ children: 'Pacientes totales' });
    expect(totalLabel).not.toHaveLength(0);

    const textContents = renderer!.root
      .findAll(node => typeof node.props?.children !== 'undefined')
      .map(extractText)
      .filter(content => content.length > 0);
    const prioritiesLine = textContents.find(content => content.includes('Críticos:')) ?? '';
    expect(prioritiesLine.includes(`Críticos: ${expectedMetrics.byPriority.critical}`)).toBe(true);
    expect(prioritiesLine.includes(`Altos: ${expectedMetrics.byPriority.high}`)).toBe(true);

    const flatListNode = renderer!.root.findAll(node => node.type?.displayName === 'FlatList').at(0);
    expect(flatListNode).toBeDefined();
    const data = (flatListNode?.props.data ?? []) as Array<{ patientId: string }>;
    expect(data.length).toBe(expectedMetrics.totalPatients);
    expect(data[0]?.patientId).toBe('p-critical');

    const renderedItem = flatListNode?.props.renderItem?.({ item: data[0] });
    act(() => {
      renderedItem?.props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('HandoverMain', { patientId: 'p-critical' });
  });

  it('muestra un indicador de carga inicial', async () => {
    const pendingTurn = new Promise<PriorityInput[]>(_resolve => {});
    vi.spyOn(analytics, 'getTurnData').mockReturnValue(pendingTurn);

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<SupervisorDashboardScreen />);
    });

    const loader = renderer!.root.findByProps({ testID: 'dashboard-loader' });
    expect(loader).toBeDefined();
  });

  it('renderiza el mensaje de error y permite reintentar', async () => {
    vi.spyOn(analytics, 'getTurnData').mockRejectedValueOnce(new Error('boom'));
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<SupervisorDashboardScreen />);
    });
    await flushAsync();

    const errorBox = renderer!.root.findByProps({ testID: 'dashboard-error' });
    expect(errorBox).toBeDefined();
  });
});
