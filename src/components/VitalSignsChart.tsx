import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { VictoryAxis, VictoryChart, VictoryGroup, VictoryLegend, VictoryLine, VictoryScatter } from 'victory-native';
import { useThemeTokens } from '@/src/theme';
import type { HandoverValues } from '@/src/validation/schemas';
import { normalizeVitalValue } from '@/src/lib/vitals/normalize';

type VitalValues = NonNullable<HandoverValues['vitals']>;

type VitalKey = 'hr' | 'sbp' | 'spo2' | 'rr' | 'tempC';

type VitalSeries = {
  key: VitalKey;
  label: string;
  unit: string;
  color: string;
};

type VitalSnapshot = {
  timestamp: number;
  values: Partial<Record<VitalKey, number>>;
};

const MAX_POINTS = 12;

const VITAL_SERIES: VitalSeries[] = [
  { key: 'hr', label: 'FC', unit: 'lpm', color: '#2563EB' },
  { key: 'sbp', label: 'TA sistólica', unit: 'mmHg', color: '#F97316' },
  { key: 'spo2', label: 'SpO₂', unit: '%', color: '#16A34A' },
  { key: 'rr', label: 'FR', unit: 'rpm', color: '#7C3AED' },
  { key: 'tempC', label: 'Temp', unit: '°C', color: '#DC2626' },
];

const styles = StyleSheet.create({
  container: { gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '700' },
  subtitle: { fontSize: 12 },
  chartCard: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  placeholder: { fontSize: 13, textAlign: 'center', paddingVertical: 12 },
});

const formatTimeLabel = (value: string | number | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
};

const normalizeHistory = (history: VitalSnapshot[]) => {
  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
  const deduped: VitalSnapshot[] = [];

  for (const entry of sorted) {
    const last = deduped.at(-1);
    if (last && last.timestamp === entry.timestamp) {
      deduped[deduped.length - 1] = entry;
    } else {
      deduped.push(entry);
    }
  }

  return deduped
    .map((entry) => {
      const values = Object.entries(entry.values).reduce<Partial<Record<VitalKey, number>>>((acc, [key, value]) => {
        const normalized = normalizeVitalValue(key as VitalKey, value);
        if (normalized != null) {
          acc[key as VitalKey] = normalized;
        }
        return acc;
      }, {});
      return { ...entry, values };
    })
    .filter((entry) => Object.keys(entry.values).length > 0)
    .slice(-MAX_POINTS);
};

const buildSeriesData = (history: VitalSnapshot[], key: VitalKey) => {
  const data: Array<{ x: Date; y: number }> = [];
  let lastValue: number | null = null;

  history.forEach((entry) => {
    const nextValue = entry.values[key];
    if (typeof nextValue === 'number') {
      lastValue = nextValue;
    }
    if (lastValue != null) {
      data.push({ x: new Date(entry.timestamp), y: lastValue });
    }
  });

  return data;
};

const buildChartDomain = (seriesData: Array<{ data: Array<{ y: number }> }>) => {
  const values = seriesData.flatMap((series) => series.data.map((point) => point.y));
  if (values.length === 0) return undefined;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = Math.max(1, range * 0.1);
  return { y: [min - padding, max + padding] as [number, number] };
};

export type VitalSignsChartProps = {
  vitals?: HandoverValues['vitals'];
};

export default function VitalSignsChart({ vitals }: VitalSignsChartProps) {
  const { colors, spacing } = useThemeTokens();
  const { width } = useWindowDimensions();
  const [history, setHistory] = useState<VitalSnapshot[]>([]);
  const lastValuesRef = useRef<Partial<Record<VitalKey, number>>>({});

  useEffect(() => {
    if (!vitals) return;

    const updatedValues: Partial<Record<VitalKey, number>> = {};
    let hasUpdates = false;

    VITAL_SERIES.forEach(({ key }) => {
      const nextValue = normalizeVitalValue(key, (vitals as VitalValues)[key]);
      if (typeof nextValue === 'number' && nextValue !== lastValuesRef.current[key]) {
        updatedValues[key] = nextValue;
        hasUpdates = true;
      }
    });

    if (!hasUpdates) return;

    const timestamp = Date.now();
    lastValuesRef.current = { ...lastValuesRef.current, ...updatedValues };
    setHistory((prev) => [...prev, { timestamp, values: updatedValues }].slice(-MAX_POINTS));
  }, [vitals?.hr, vitals?.sbp, vitals?.spo2, vitals?.rr, vitals?.tempC]);

  const normalizedHistory = useMemo(() => normalizeHistory(history), [history]);
  const seriesData = useMemo(
    () =>
      VITAL_SERIES.map((series) => ({
        ...series,
        data: buildSeriesData(normalizedHistory, series.key),
      })),
    [normalizedHistory],
  );

  const legendData = seriesData
    .filter((series) => series.data.length > 0)
    .map((series) => ({ name: `${series.label} (${series.unit})` }));

  const hasEnoughData = seriesData.some((series) => series.data.length >= 2);
  const chartWidth = Math.max(280, width - spacing.lg * 2);
  const chartDomain = useMemo(() => buildChartDomain(seriesData), [seriesData]);

  return (
    <View style={styles.container} testID="vitals-signs-chart">
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Signos vitales en tiempo real</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>Últimos registros</Text>
      </View>
      <View style={[styles.chartCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        {hasEnoughData ? (
          <VictoryChart
            width={chartWidth}
            height={220}
            padding={{ top: 24, bottom: 48, left: 56, right: 24 }}
            domainPadding={{ y: 12 }}
            scale={{ x: 'time' }}
            domain={chartDomain}
          >
            <VictoryLegend
              x={spacing.md}
              y={4}
              orientation="horizontal"
              gutter={spacing.md}
              data={legendData}
              style={{ labels: { fill: colors.muted, fontSize: 10 } }}
              colorScale={seriesData.filter((series) => series.data.length > 0).map((series) => series.color)}
            />
            <VictoryAxis
              tickFormat={(value) => formatTimeLabel(value)}
              style={{
                axis: { stroke: colors.border },
                ticks: { stroke: colors.border },
                tickLabels: { fill: colors.muted, fontSize: 10, padding: 6 },
                grid: { stroke: 'transparent' },
              }}
            />
            <VictoryAxis
              dependentAxis
              style={{
                axis: { stroke: colors.border },
                ticks: { stroke: colors.border },
                tickLabels: { fill: colors.muted, fontSize: 10, padding: 4 },
                grid: { stroke: colors.border, strokeDasharray: '4,4' },
              }}
            />
            {seriesData.map((series) =>
              series.data.length > 0 ? (
                <VictoryGroup key={series.key}>
                  <VictoryLine
                    data={series.data}
                    interpolation="natural"
                    style={{ data: { stroke: series.color, strokeWidth: 2 } }}
                  />
                  <VictoryScatter data={series.data} size={3} style={{ data: { fill: series.color } }} />
                </VictoryGroup>
              ) : null,
            )}
          </VictoryChart>
        ) : (
          <Text style={[styles.placeholder, { color: colors.muted }]}>
            Ingresa al menos dos registros para visualizar la tendencia.
          </Text>
        )}
      </View>
    </View>
  );
}
