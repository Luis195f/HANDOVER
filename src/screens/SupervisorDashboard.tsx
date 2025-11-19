// Dashboard de supervisión de turno basado en un TurnFilter de unidad y franja horaria.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';

import { UNITS } from '@/src/config/units';
import {
  buildPrioritySnapshot,
  computeTurnMetrics,
  getTurnData,
  type TurnFilter,
  type TurnMetrics,
} from '@/src/lib/analytics';
import type { PrioritizedPatient } from '@/src/lib/priority';
import type { RootStackParamList } from '@/src/navigation/types';

type ShiftKey = 'morning' | 'evening' | 'night';

type ShiftOption = { key: ShiftKey; label: string; startHour: number; endHour: number };

const SHIFT_OPTIONS: ShiftOption[] = [
  { key: 'morning', label: 'Mañana', startHour: 7, endHour: 15 },
  { key: 'evening', label: 'Tarde', startHour: 15, endHour: 23 },
  { key: 'night', label: 'Noche', startHour: 23, endHour: 7 },
];

function resolveShiftRange(option: ShiftOption): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(option.startHour, 0, 0, 0);

  const end = new Date(start);
  end.setHours(option.endHour, 0, 0, 0);
  if (option.endHour <= option.startHour) {
    end.setDate(end.getDate() + 1);
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

const priorityLabels: Record<PrioritizedPatient['level'], string> = {
  critical: 'CRÍTICO',
  high: 'ALTO',
  medium: 'MEDIO',
  low: 'BAJO',
};

export function SupervisorDashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [selectedUnitId, setSelectedUnitId] = useState<string>(UNITS[0]?.id ?? '');
  const [shiftKey, setShiftKey] = useState<ShiftKey>('morning');
  const [patients, setPatients] = useState<PrioritizedPatient[]>([]);
  const [metrics, setMetrics] = useState<TurnMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filter = useMemo<TurnFilter>(() => {
    const shift = SHIFT_OPTIONS.find(option => option.key === shiftKey) ?? SHIFT_OPTIONS[0];
    const range = resolveShiftRange(shift);
    return {
      unitId: selectedUnitId,
      ...range,
    };
  }, [selectedUnitId, shiftKey]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const inputs = await getTurnData(filter);
      const prioritized = buildPrioritySnapshot(inputs);
      setPatients(prioritized);
      setMetrics(computeTurnMetrics(prioritized));
    } catch (err) {
      setError('No se pudieron cargar los datos del turno. Intenta nuevamente.');
      setPatients([]);
      setMetrics(null);
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const renderPatient = useCallback(
    ({ item }: { item: PrioritizedPatient }) => {
      const priorityStyleKey = `priority_${item.level}` as keyof typeof styles;
      return (
        <Pressable
          style={styles.patientCard}
          onPress={() => navigation.navigate('HandoverMain', { patientId: item.patientId })}
          accessibilityRole="button"
          testID={`patient-card-${item.patientId}`}
        >
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.patientName}>{item.displayName}</Text>
              {item.bedLabel ? <Text style={styles.patientBed}>Cama {item.bedLabel}</Text> : null}
            </View>
            <View style={[styles.priorityBadge, styles[priorityStyleKey]]}>
              <Text style={styles.priorityBadgeText}>{priorityLabels[item.level]}</Text>
            </View>
          </View>
          <Text style={styles.reasonText}>{item.reasonSummary}</Text>
          <Text style={styles.metaText}>NEWS2: {item.news2Score}</Text>
          {/* TODO: añadir extracto SBAR compacto cuando esté disponible para esta vista */}
        </Pressable>
      );
    },
    [navigation],
  );

  const renderMetrics = useCallback(() => {
    const baseMetrics =
      metrics ?? ({
        totalPatients: 0,
        byPriority: { critical: 0, high: 0, medium: 0, low: 0 },
        averageNews2: null,
        pendingCriticalTasks: 0,
        incidentsCount: 0,
      } satisfies TurnMetrics);

    return (
      <View style={styles.metricsGrid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Pacientes totales</Text>
          <Text style={styles.metricValue}>{baseMetrics.totalPatients}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Por prioridad</Text>
          <Text style={styles.metricDetail}>
            Críticos: {baseMetrics.byPriority.critical} · Altos: {baseMetrics.byPriority.high}
          </Text>
          <Text style={styles.metricDetail}>
            Medios: {baseMetrics.byPriority.medium} · Bajos: {baseMetrics.byPriority.low}
          </Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>NEWS2 promedio</Text>
          <Text style={styles.metricValue}>{baseMetrics.averageNews2 ?? '—'}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Tareas críticas pendientes</Text>
          <Text style={styles.metricValue}>{baseMetrics.pendingCriticalTasks}</Text>
          <Text style={[styles.metricLabel, styles.incidentsLabel]}>Incidentes recientes</Text>
          <Text style={styles.metricValue}>{baseMetrics.incidentsCount}</Text>
        </View>
      </View>
    );
  }, [metrics]);

  const selectedUnit = useMemo(() => UNITS.find(unit => unit.id === selectedUnitId), [selectedUnitId]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Dashboard de turno</Text>

      <View style={styles.filters}>
        <Text style={styles.sectionLabel}>Unidad</Text>
        <View style={styles.chipRow}>
          {UNITS.map(unit => (
            <Pressable
              key={unit.id}
              onPress={() => setSelectedUnitId(unit.id)}
              style={[styles.chip, selectedUnitId === unit.id && styles.chipSelected]}
              accessibilityLabel={`Unidad ${unit.name}`}
              accessibilityRole="button"
            >
              <Text style={[styles.chipText, selectedUnitId === unit.id && styles.chipTextSelected]}>
                {unit.name}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Turno</Text>
        <View style={styles.chipRow}>
          {SHIFT_OPTIONS.map(option => (
            <Pressable
              key={option.key}
              onPress={() => setShiftKey(option.key)}
              style={[styles.chip, shiftKey === option.key && styles.chipSelected]}
              accessibilityLabel={`Turno ${option.label}`}
              accessibilityRole="button"
            >
              <Text style={[styles.chipText, shiftKey === option.key && styles.chipTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {selectedUnit ? (
          <Text style={styles.filterHint}>
            {selectedUnit.name} · {new Date(filter.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            {' - '}
            {new Date(filter.end).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.loader} testID="dashboard-loader">
          <ActivityIndicator />
          <Text style={styles.loaderText}>Cargando dashboard...</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox} testID="dashboard-error">
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={loadData} accessibilityRole="button">
            <Text style={styles.retryButtonText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {renderMetrics()}
          <FlatList
            data={patients}
            keyExtractor={item => item.patientId}
            contentContainerStyle={patients.length === 0 ? styles.emptyContainer : styles.listContent}
            ListEmptyComponent={!isLoading ? <Text style={styles.emptyText}>No hay pacientes en este turno.</Text> : null}
            renderItem={renderPatient}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 12,
    backgroundColor: '#f8fafc',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
  },
  filters: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionLabel: {
    fontWeight: '700',
    color: '#0f172a',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: '#e2e8f0',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  chipSelected: {
    backgroundColor: '#1d4ed8',
  },
  chipText: {
    color: '#0f172a',
    fontWeight: '600',
  },
  chipTextSelected: {
    color: '#fff',
  },
  filterHint: {
    color: '#475569',
    fontSize: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricCard: {
    flexBasis: '48%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  metricLabel: {
    color: '#0f172a',
    fontWeight: '600',
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginTop: 4,
  },
  metricDetail: {
    marginTop: 4,
    color: '#334155',
  },
  incidentsLabel: {
    marginTop: 8,
  },
  loader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  loaderText: {
    color: '#334155',
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderColor: '#f87171',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  errorText: {
    color: '#991b1b',
    fontWeight: '600',
  },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#b91c1c',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  listContent: {
    gap: 10,
    paddingBottom: 80,
  },
  emptyContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#475569',
  },
  patientCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  patientName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  patientBed: {
    color: '#475569',
  },
  priorityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  priorityBadgeText: {
    color: '#fff',
    fontWeight: '700',
  },
  priority_critical: {
    backgroundColor: '#b91c1c',
  },
  priority_high: {
    backgroundColor: '#ea580c',
  },
  priority_medium: {
    backgroundColor: '#ca8a04',
  },
  priority_low: {
    backgroundColor: '#16a34a',
  },
  reasonText: {
    color: '#334155',
    marginBottom: 4,
  },
  metaText: {
    color: '#64748b',
    fontSize: 12,
  },
});

export default SupervisorDashboardScreen;
