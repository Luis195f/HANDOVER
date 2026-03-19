import { describe, expect, it } from 'vitest';

import { computePriority, computePriorityList, type PriorityInput } from '@/src/lib/priority';

const baseInput: PriorityInput = {
  patientId: 'p-base',
  displayName: 'Paciente Base',
  vitals: {},
  devices: [],
  risks: {},
  pendingTasks: [],
};

describe('computePriority', () => {
  it('marks a patient as critical and exposes explainable output', () => {
    const critical = computePriority({
      ...baseInput,
      patientId: 'p-critical',
      displayName: 'Critico',
      vitals: { rr: 28, spo2: 90, tempC: 39.2, sbp: 88, hr: 135, o2: true, avpu: 'V' },
      devices: [{ id: 'vent', label: 'Ventilacion mecanica', category: 'invasive', critical: true }],
      pendingTasks: [{ id: 'urgent', title: 'Gasometria', priority: 'critical', category: 'critical-task' }],
      recentIncidentFlag: true,
      referenceTime: '2024-02-01T00:00:00Z',
    });

    expect(critical.level).toBe('critical');
    expect(critical.reasons).toContain('HIGH_NEWS2');
    expect(critical.reasons).toContain('INVASIVE_DEVICE');
    expect(critical.reasons).toContain('RECENT_INCIDENT');
    expect(critical.reasonSummary).toContain('NEWS2');
    expect(critical.reasonSummary.toLowerCase()).toContain('incidente');
    expect(critical.totalScore).toBeGreaterThan(0);
    expect(critical.pendingCriticalTasksCount).toBe(1);
    expect(critical.explanation?.sourceData[0]).toContain('NEWS2');
    expect(critical.explanation?.clinicalChange.length).toBeGreaterThan(0);
  });

  it('returns high priority for an intermediate NEWS2 score', () => {
    const high = computePriority({
      ...baseInput,
      patientId: 'p-high',
      displayName: 'Alto',
      vitals: { rr: 21, spo2: 95, tempC: 38.5, sbp: 108, hr: 98, avpu: 'A' },
    });

    expect(high.level).toBe('high');
    expect(high.reasons).toContain('HIGH_NEWS2');
    expect(high.explanation?.coreDimensions.some((dimension) => dimension.key === 'instability')).toBe(true);
  });

  it('returns medium priority for moderate NEWS2 without other factors', () => {
    const medium = computePriority({
      ...baseInput,
      patientId: 'p-medium',
      displayName: 'Medio',
      vitals: { rr: 21, spo2: 96, tempC: 37.5, sbp: 118, hr: 110 },
    });

    expect(medium.level).toBe('medium');
    expect(medium.reasons).not.toContain('HIGH_NEWS2');
    expect(medium.reasonSummary).toBe('NEWS2 3');
  });

  it('returns low priority when no clinical signals are present', () => {
    const low = computePriority({
      ...baseInput,
      patientId: 'p-low',
      displayName: 'Bajo',
      vitals: { rr: 16, spo2: 97, tempC: 37, sbp: 120, hr: 85 },
    });

    expect(low.level).toBe('low');
    expect(low.reasons).toHaveLength(0);
    expect(low.explanation?.pendingCritical).toHaveLength(0);
  });
});

describe('computePriorityList', () => {
  it('sorts by effective level, total score, NEWS2, and incident recency', () => {
    const inputs: PriorityInput[] = [
      {
        ...baseInput,
        patientId: 'p-high',
        displayName: 'Alto',
        vitals: { rr: 21, spo2: 95, tempC: 38.5, sbp: 108, hr: 98 },
      },
      {
        ...baseInput,
        patientId: 'p-critical',
        displayName: 'Critico',
        vitals: { rr: 28, spo2: 90, tempC: 39.2, sbp: 88, hr: 135, o2: true, avpu: 'V' },
        devices: [{ id: 'vent', label: 'VM', category: 'invasive', critical: true }],
        pendingTasks: [{ id: 'urgent', title: 'Gasometria', priority: 'critical', category: 'critical-task' }],
        recentIncidentFlag: true,
        referenceTime: '2024-02-01T00:00:00Z',
      },
      {
        ...baseInput,
        patientId: 'p-medium',
        displayName: 'Medio',
        vitals: { rr: 21, spo2: 96, tempC: 37.5, sbp: 118, hr: 110 },
      },
      {
        ...baseInput,
        patientId: 'p-low',
        displayName: 'Bajo',
        vitals: { rr: 16, spo2: 97, tempC: 37, sbp: 120, hr: 85 },
      },
    ];

    const prioritized = computePriorityList(inputs);

    expect(prioritized.map((patient) => patient.patientId)).toEqual(['p-critical', 'p-high', 'p-medium', 'p-low']);
    expect(prioritized[0].reasonSummary).toContain('NEWS2');
    expect(prioritized[1].reasonSummary.toLowerCase()).toContain('news2 6');
  });
});
