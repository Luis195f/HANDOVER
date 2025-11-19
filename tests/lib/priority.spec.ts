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
  it('marca como crítico cuando NEWS2 es alto y hay soporte invasivo', () => {
    const critical = computePriority({
      ...baseInput,
      patientId: 'p-critical',
      displayName: 'Crítico',
      vitals: { rr: 28, spo2: 90, tempC: 39.2, sbp: 88, hr: 135, o2: true, avpu: 'V' },
      devices: [{ id: 'vent', label: 'Ventilación mecánica', category: 'invasive', critical: true }],
      pendingTasks: [{ id: 'urgent', title: 'Gasometría', urgent: true }],
      recentIncidentFlag: true,
      referenceTime: '2024-02-01T00:00:00Z',
    });

    expect(critical.level).toBe('critical');
    expect(critical.reasons).toContain('HIGH_NEWS2');
    expect(critical.reasons).toContain('INVASIVE_DEVICE');
    expect(critical.reasons).toContain('RECENT_INCIDENT');
    expect(critical.reasonSummary).toContain('NEWS2');
    expect(critical.reasonSummary.toLowerCase()).toContain('incidente');
  });

  it('retorna prioridad alta con NEWS2 intermedio', () => {
    const high = computePriority({
      ...baseInput,
      patientId: 'p-high',
      displayName: 'Alto',
      vitals: { rr: 21, spo2: 95, tempC: 38.5, sbp: 108, hr: 98, avpu: 'A' },
    });

    expect(high.level).toBe('high');
    expect(high.reasons).toContain('HIGH_NEWS2');
  });

  it('retorna prioridad media con NEWS2 moderado sin otros factores', () => {
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

  it('retorna prioridad baja cuando no hay alertas', () => {
    const low = computePriority({
      ...baseInput,
      patientId: 'p-low',
      displayName: 'Bajo',
      vitals: { rr: 16, spo2: 97, tempC: 37, sbp: 120, hr: 85 },
    });

    expect(low.level).toBe('low');
    expect(low.reasons).toHaveLength(0);
  });
});

describe('computePriorityList', () => {
  it('ordena por nivel, NEWS2 y recencia de incidentes', () => {
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
        displayName: 'Crítico',
        vitals: { rr: 28, spo2: 90, tempC: 39.2, sbp: 88, hr: 135, o2: true, avpu: 'V' },
        devices: [{ id: 'vent', label: 'VM', category: 'invasive', critical: true }],
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

    expect(prioritized.map(p => p.patientId)).toEqual(['p-critical', 'p-high', 'p-medium', 'p-low']);
    expect(prioritized[0].reasonSummary).toContain('NEWS2');
    expect(prioritized[1].reasonSummary.toLowerCase()).toContain('news2 6');
  });
});
