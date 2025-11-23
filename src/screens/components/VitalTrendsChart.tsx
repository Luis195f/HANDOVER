// BEGIN HANDOVER D2 – VitalTrends chart component
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import type { VitalPoint, VitalTrendsData } from '../../../types/vitals';

interface VitalTrendsChartProps {
  trends: VitalTrendsData | null;
}

const CHART_WIDTH = 140;
const CHART_HEIGHT = 48;

const styles = StyleSheet.create({
  container: { gap: 8 },
  title: { fontWeight: '700', fontSize: 15, marginBottom: 4 },
  scrollContent: { paddingVertical: 4 },
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

const normalizePoints = (points: VitalPoint[]) => {
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

export const VitalTrendsChart: React.FC<VitalTrendsChartProps> = ({ trends }) => {
  if (!trends) {
    return null;
  }

  const renderSeries = (label: string, points: VitalPoint[], key: string) => {
    const latestValue = points.at(-1)?.value;
    const normalized = normalizePoints(points);
    return (
      <View key={key} style={styles.seriesRow} testID={`vital-series-${key}`}>
        <View style={styles.seriesHeader}>
          <Text style={styles.seriesLabel}>{label}</Text>
          {latestValue != null ? <Text style={styles.seriesValue}>{latestValue}</Text> : null}
        </View>
        {normalized ? (
          <View style={styles.chartBox}>
            <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
              <Polyline
                points={normalized.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#2563EB"
                strokeWidth={2}
              />
              {normalized.length > 0 ? (
                <Circle cx={normalized.at(-1)!.x} cy={normalized.at(-1)!.y} r={3} fill="#1D4ED8" />
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
        <View style={styles.seriesWrapper}>
          {renderSeries('Frecuencia cardíaca (lpm)', trends.hr, 'hr')}
          {renderSeries('PA sistólica (mmHg)', trends.sbp, 'sbp')}
          {renderSeries('FR (rpm)', trends.rr, 'rr')}
          {renderSeries('SpO₂ (%)', trends.spo2, 'spo2')}
          {renderSeries('Temperatura (°C)', trends.temp, 'temp')}
        </View>
      </ScrollView>
    </View>
  );
};
// END HANDOVER D2 – VitalTrends chart component
