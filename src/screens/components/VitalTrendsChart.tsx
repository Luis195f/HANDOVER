// BEGIN HANDOVER D2 – VitalTrends chart component
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import type { VitalPoint, VitalTrendsData } from '../../../types/vitals';
import { normalizeVitalPoints, type NormalizedVitalPoint } from '@/src/lib/vitals/normalize';

interface VitalTrendsChartProps {
  trends: VitalTrendsData | null;
}

const CHART_WIDTH = 140;
const CHART_HEIGHT = 48;
const MAX_TREND_POINTS = 50;

const styles = StyleSheet.create({
  container: { gap: 8 },
  title: { fontWeight: '700', fontSize: 15, marginBottom: 4 },
  scrollContent: { paddingVertical: 4, paddingHorizontal: 12 },
  seriesWrapper: { gap: 12 },
  seriesRow: { marginBottom: 12 },
  seriesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  seriesLabel: { fontSize: 13, fontWeight: '500', color: '#111827', flex: 1 },
  seriesValue: { fontSize: 13, fontWeight: '600', color: '#1F2937', marginLeft: 12 },
  chartBox: {
    marginTop: 6,
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    borderRadius: 8,
    borderColor: '#E5E7EB',
    borderWidth: 1,
    backgroundColor: '#F9FAFB',
    padding: 4,
  },
  placeholder: { fontSize: 12, color: '#6B7280', marginTop: 6 },
});

const normalizePoints = (points: NormalizedVitalPoint[]) => {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return points.map((point, index) => {
    const x = (index / (points.length - 1)) * (CHART_WIDTH - 8) + 4;
    const y = CHART_HEIGHT - ((point.value - min) / range) * (CHART_HEIGHT - 8) - 4;
    return { x, y };
  });
};

type SeriesConfig = {
  key: 'hr' | 'sbp' | 'rr' | 'spo2' | 'temp';
  label: string;
  points: VitalPoint[];
};

export const VitalTrendsChart: React.FC<VitalTrendsChartProps> = ({ trends }) => {
  const series = useMemo<SeriesConfig[]>(() => {
    if (!trends) return [];
    return [
      { key: 'hr', label: 'Frecuencia cardíaca (lpm)', points: trends.hr },
      { key: 'sbp', label: 'PA sistólica (mmHg)', points: trends.sbp },
      { key: 'rr', label: 'FR (rpm)', points: trends.rr },
      { key: 'spo2', label: 'SpO₂ (%)', points: trends.spo2 },
      { key: 'temp', label: 'Temperatura (°C)', points: trends.temp },
    ];
  }, [trends]);

  if (!trends) {
    return null;
  }

  const renderSeries = (seriesConfig: SeriesConfig) => {
    const normalized = normalizeVitalPoints(seriesConfig.points, seriesConfig.key, MAX_TREND_POINTS);
    const latestValue = normalized.at(-1)?.value;
    const normalizedPoints = normalizePoints(normalized);
    return (
      <View key={seriesConfig.key} style={styles.seriesRow} testID={`vital-series-${seriesConfig.key}`}>
        <View style={styles.seriesHeader}>
          <Text style={styles.seriesLabel}>{seriesConfig.label}</Text>
          {latestValue != null ? <Text style={styles.seriesValue}>{latestValue}</Text> : null}
        </View>
        {normalizedPoints ? (
          <View style={styles.chartBox}>
            <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
              <Polyline
                points={normalizedPoints.map((point) => `${point.x},${point.y}`).join(' ')}
                fill="none"
                stroke="#2563EB"
                strokeWidth={2}
              />
              {normalizedPoints.length > 0 ? (
                <Circle
                  cx={normalizedPoints.at(-1)!.x}
                  cy={normalizedPoints.at(-1)!.y}
                  r={3}
                  fill="#1D4ED8"
                />
              ) : null}
            </Svg>
          </View>
        ) : (
          <Text style={styles.placeholder}>Sin datos suficientes</Text>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Gráficos de tendencia (24h)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.seriesWrapper}>{series.map((seriesConfig) => renderSeries(seriesConfig))}</View>
      </ScrollView>
    </View>
  );
};
// END HANDOVER D2 – VitalTrends chart component
