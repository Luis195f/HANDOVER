import { describe, expect, it, vi } from 'vitest';

import { buildPrioritySnapshot, computeTurnMetrics } from '@/src/lib/analytics';
import { computePriorityList, type PriorityInput, type PrioritizedPatient } from '@/src/lib/priority';
import * as priority from '@/src/lib/priority';

describe('computeTurnMetrics', () => {
  it('handles an empty shift', () => {
    const metrics = computeTurnMetrics([]);

    expect(metrics.totalPatients).toBe(0);
    expect(metrics.averageNews2).toBeNull();
    expect(metrics.byPriority).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
    expect(metrics.incidentsCount).toBe(0);
    expect(metrics.pendingCriticalTasks).toBe(0);
  });

  it('aggregates shift metrics including critical pending tasks', () => {
    const patients: PrioritizedPatient[] = [
      {
        patientId: 'p-critical',
        displayName: 'Critico',
        news2Score: 7,
        level: 'critical',
        reasons: ['RECENT_INCIDENT'],
        reasonSummary: 'NEWS2 7, incidente reciente',
        pendingCriticalTasksCount: 2,
      },
      {
        patientId: 'p-high',
        displayName: 'Alto',
        news2Score: 5,
        level: 'high',
        reasons: ['PENDING_URGENT_TASK'],
        reasonSummary: 'NEWS2 5, tareas criticas',
        pendingCriticalTasksCount: 1,
      },
      {
        patientId: 'p-medium',
        displayName: 'Medio',
        news2Score: 3,
        level: 'medium',
        reasons: [],
        reasonSummary: 'NEWS2 3',
      },
      {
        patientId: 'p-low',
        displayName: 'Bajo',
        news2Score: 1,
        level: 'low',
        reasons: [],
        reasonSummary: 'NEWS2 1',
      },
    ];

    const metrics = computeTurnMetrics(patients);

    expect(metrics.totalPatients).toBe(4);
    expect(metrics.byPriority).toEqual({ critical: 1, high: 1, medium: 1, low: 1 });
    expect(metrics.averageNews2).toBeCloseTo(4);
    expect(metrics.incidentsCount).toBe(1);
    expect(metrics.pendingCriticalTasks).toBe(3);
  });

  it('derives metrics from ordered PriorityInput items', () => {
    const inputs: PriorityInput[] = [
      {
        patientId: 'p-1',
        displayName: 'Urgente',
        unitId: 'icu-a',
        vitals: { rr: 28, spo2: 90, tempC: 39.2, sbp: 88, hr: 135, o2: true, avpu: 'V' },
        devices: [{ id: 'dev-vent', label: 'VM', category: 'invasive', critical: true }],
        risks: {},
        pendingTasks: [{ id: 't1', title: 'Gasometria', priority: 'critical', category: 'critical-task' }],
        recentIncidentFlag: true,
      },
      {
        patientId: 'p-2',
        displayName: 'Estable',
        unitId: 'icu-a',
        vitals: { rr: 16, spo2: 97, tempC: 36.8, sbp: 120, hr: 85 },
        devices: [],
        risks: {},
        pendingTasks: [],
      },
    ];

    const prioritized = computePriorityList(inputs);
    const metrics = computeTurnMetrics(prioritized);

    expect(metrics.totalPatients).toBe(2);
    expect(metrics.byPriority.critical).toBe(1);
    expect(metrics.byPriority.low).toBe(1);
    expect(metrics.incidentsCount).toBe(1);
    expect(metrics.pendingCriticalTasks).toBe(1);
    expect(metrics.averageNews2).toBeGreaterThan(0);
  });
});

describe('buildPrioritySnapshot', () => {
  it('delegates to computePriorityList', () => {
    const computeSpy = vi.spyOn(priority, 'computePriorityList');
    const inputs: PriorityInput[] = [
      {
        patientId: 'p-1',
        displayName: 'Paciente 1',
        unitId: 'icu-a',
        vitals: {},
        devices: [],
        risks: {},
        pendingTasks: [],
      },
    ];

    buildPrioritySnapshot(inputs);

    expect(computeSpy).toHaveBeenCalledWith(inputs);
    computeSpy.mockRestore();
  });
});
