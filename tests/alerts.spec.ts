import { describe, expect, it } from 'vitest';

import { alertsFromData, summarizeAlerts } from '@/src/lib/alerts';

describe('alertsFromData', () => {
  it('returns empty array when no data', () => {
    expect(alertsFromData({})).toEqual([]);
  });

  it('detects high NEWS2 score', () => {
    const result = alertsFromData({ news2Score: 8 });

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('NEWS2_HIGH');
    expect(result[0].severity).toBe('critical');
  });

  it('detects moderate NEWS2 score', () => {
    const result = alertsFromData({ news2Score: 5 });

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('NEWS2_MODERATE');
    expect(result[0].severity).toBe('warning');
  });

  it('flags old device when insertedAt is older than 7 days', () => {
    const now = new Date('2025-01-10T00:00:00Z');
    const result = alertsFromData({
      now,
      devices: [{ code: 'DEV-1', insertedAt: '2025-01-01T00:00:00Z' }],
    });

    expect(result.some((alert) => alert.kind === 'DEVICE_OLD' && alert.severity === 'warning')).toBe(true);
  });

  it('sets critical severity for overdue critical tasks', () => {
    const now = new Date('2025-01-10T00:00:00Z');
    const result = alertsFromData({
      now,
      tasks: [
        { id: 'task-1', dueAt: '2025-01-05T00:00:00Z', completed: false, critical: true },
      ],
    });

    expect(result.some((alert) => alert.kind === 'TASK_OVERDUE' && alert.severity === 'critical')).toBe(true);
  });

  it('sets warning severity for overdue non-critical tasks', () => {
    const now = new Date('2025-01-10T00:00:00Z');
    const result = alertsFromData({
      now,
      tasks: [
        { id: 'task-1', dueAt: '2025-01-05T00:00:00Z', completed: false, critical: false },
      ],
    });

    expect(result.some((alert) => alert.kind === 'TASK_OVERDUE' && alert.severity === 'warning')).toBe(true);
  });

  it('detects allergy conflict with medication', () => {
    const result = alertsFromData({
      allergies: [{ code: 'ALLERGY-123' }],
      medications: [{ code: 'ALLERGY-123' }],
    });

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('ALLERGY_CONFLICT');
    expect(result[0].severity).toBe('critical');
  });

  it('does not duplicate alerts by kind', () => {
    const now = new Date('2025-01-10T00:00:00Z');
    const result = alertsFromData({
      news2Score: 9,
      now,
      devices: [
        { code: 'DEV-1', insertedAt: '2025-01-01T00:00:00Z' },
        { code: 'DEV-2', insertedAt: '2024-12-31T00:00:00Z' },
      ],
      tasks: [
        { id: 'task-1', dueAt: '2025-01-05T00:00:00Z', completed: false },
        { id: 'task-2', dueAt: '2025-01-06T00:00:00Z', completed: false, critical: true },
        { id: 'task-3', dueAt: '2025-01-07T00:00:00Z', completed: false },
      ],
    });

    const kinds = result.map((item) => item.kind);
    expect(kinds.filter((kind) => kind === 'NEWS2_HIGH')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'DEVICE_OLD')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'TASK_OVERDUE')).toHaveLength(1);
  });
});

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
