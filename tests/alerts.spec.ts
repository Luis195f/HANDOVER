import { describe, expect, it } from 'vitest';

import { computeAlerts, summarizeAlerts } from '@/src/lib/alerts';
import type { Handover } from '@/src/types/handover';

describe('summarizeAlerts', () => {
  it('counts severities correctly', () => {
    const summary = summarizeAlerts([
      { id: '1', kind: 'NEWS2_HIGH', severity: 'critical', message: '' },
      { id: '2', kind: 'NEWS2_MODERATE', severity: 'warning', message: '' },
      { id: '3', kind: 'DEVICE_OLD', severity: 'warning', message: '' },
      { id: '4', kind: 'TASK_OVERDUE', severity: 'info', message: '' },
      { id: '5', kind: 'TASK_OVERDUE', severity: 'info', message: '' },
      { id: '6', kind: 'TASK_OVERDUE', severity: 'info', message: '' },
    ]);

    expect(summary).toEqual({ criticalCount: 1, warningCount: 2, infoCount: 3 });
  });
});

describe('computeAlerts', () => {
  const baseHandover: Handover = {
    administrativeData: {
      unit: 'UCI',
      census: 0,
      staffIn: [],
      staffOut: [],
      shiftStart: '2025-01-10T08:00:00Z',
      shiftEnd: '2025-01-10T16:00:00Z',
      shiftType: 'Mañana',
      generalNotes: undefined,
      incidents: [],
    },
    patientId: 'patient-1',
    dxMedical: null,
    dxNursing: null,
    bedsideChecklist: {},
  };

  it('emits NEWS2 alert when high score plus active risk', () => {
    const result = computeAlerts({
      ...baseHandover,
      vitals: { rr: 30, spo2: 85, tempC: 39, sbp: 80, hr: 130 },
      risksStructured: [{ type: 'fall', present: true, actions: [], notes: undefined }],
    });

    expect(result.some((alert) => alert.id === 'news2-high-with-risk')).toBe(true);
  });

  it('ignores malformed vitals payloads', () => {
    const result = computeAlerts({
      ...baseHandover,
      vitals: { tempC: Number.NaN } as Handover['vitals'],
    });

    expect(result).toEqual([]);
  });
});
