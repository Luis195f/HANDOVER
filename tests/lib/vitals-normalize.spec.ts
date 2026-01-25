import { describe, expect, it } from 'vitest';

import { normalizeVitalPoints } from '@/src/lib/vitals/normalize';

describe('vitals normalize helpers', () => {
  it('filtra valores no finitos y ordena por tiempo', () => {
    const points = [
      { time: '2024-01-01T02:00:00Z', value: '80' },
      { time: '2024-01-01T01:00:00Z', value: Number.NaN },
      { time: '2024-01-01T00:00:00Z', value: '90' },
      { time: '2024-01-01T03:00:00Z', value: Infinity },
    ];

    const normalized = normalizeVitalPoints(points, 'hr', 50);

    expect(normalized).toHaveLength(2);
    expect(normalized[0].timestamp).toBeLessThan(normalized[1].timestamp);
    expect(normalized.map((point) => point.value)).toEqual([90, 80]);
  });

  it('aplica clamp a outliers', () => {
    const points = [{ time: '2024-01-01T00:00:00Z', value: 999 }];

    const normalized = normalizeVitalPoints(points, 'spo2', 50);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].value).toBe(100);
  });
});
