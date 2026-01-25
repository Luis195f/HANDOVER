export type VitalClampKey = 'hr' | 'rr' | 'spo2' | 'sbp' | 'dbp' | 'tempC' | 'temp';

export type VitalRange = { min: number; max: number };

export const VITAL_CLAMP_RANGES: Record<VitalClampKey, VitalRange> = {
  hr: { min: 20, max: 240 },
  rr: { min: 4, max: 80 },
  spo2: { min: 50, max: 100 },
  sbp: { min: 50, max: 260 },
  dbp: { min: 30, max: 160 },
  tempC: { min: 30, max: 43 },
  temp: { min: 30, max: 43 },
};

export const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const clampVitalValue = (key: VitalClampKey, value: number) => {
  const range = VITAL_CLAMP_RANGES[key];
  return Math.min(range.max, Math.max(range.min, value));
};

export const normalizeVitalValue = (key: VitalClampKey, value: unknown): number | null => {
  const parsed = toFiniteNumber(value);
  if (parsed == null) return null;
  return clampVitalValue(key, parsed);
};

export type NormalizedVitalPoint = { time: string; value: number; timestamp: number };

export const normalizeVitalPoints = (
  points: Array<{ time: string; value: unknown }>,
  key: VitalClampKey,
  maxPoints = 50,
): NormalizedVitalPoint[] => {
  const mapped = points
    .map((point) => {
      const timestamp = new Date(point.time).getTime();
      if (!Number.isFinite(timestamp)) return null;
      const value = normalizeVitalValue(key, point.value);
      if (value == null) return null;
      return { time: point.time, value, timestamp };
    })
    .filter((point): point is NormalizedVitalPoint => point !== null)
    .sort((a, b) => a.timestamp - b.timestamp);

  const deduped: NormalizedVitalPoint[] = [];
  for (const point of mapped) {
    const last = deduped.at(-1);
    if (last && last.timestamp === point.timestamp) {
      deduped[deduped.length - 1] = point;
    } else {
      deduped.push(point);
    }
  }

  if (deduped.length <= maxPoints) {
    return deduped;
  }

  return deduped.slice(-maxPoints);
};
