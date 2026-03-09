import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { UNITS } from '@/src/config/units';
import { useAdminDashboardData } from '@/src/hooks/useAdminDashboardData';
import { hasRole } from '@/src/security/acl';
import { useAuth } from '@/src/security/auth';

function formatDate(value: string | null | undefined) {
  if (!value) return 'Sin datos';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('es-ES');
}

function UnitMetric({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {detail ? <Text style={styles.metricDetail}>{detail}</Text> : null}
    </View>
  );
}

export function SupervisorDashboardScreen() {
  const { session, loading: authLoading } = useAuth();
  const canViewDashboard = hasRole(session, ['supervisor', 'admin']);
  const isDemoSession = session?.mode === 'demo';
  const [selectedUnitId, setSelectedUnitId] = useState<string>(session?.units?.[0] ?? UNITS[0]?.id ?? '');
  const { data, loading, error, reload, stale } = useAdminDashboardData(canViewDashboard, {
    unitId: selectedUnitId,
    demoMode: isDemoSession,
  });

  const selectedUnit = useMemo(() => data?.units.find((unit) => unit.unitId === selectedUnitId) ?? data?.units[0] ?? null, [data, selectedUnitId]);

  if (authLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session || !canViewDashboard) {
    return (
      <View style={styles.centered}>
        <Text>Acceso restringido. Solo supervisor o admin.</Text>
      </View>
    );
  }

  if (loading && !data) {
    return (
      <View style={styles.centered} testID="dashboard-loader">
        <ActivityIndicator />
        <Text style={styles.loaderText}>Cargando dashboard operativo...</Text>
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={styles.container} testID="dashboard-error">
        <Text style={styles.errorText}>{error.message}</Text>
        <Pressable style={styles.retryButton} onPress={reload} accessibilityRole="button">
          <Text style={styles.retryButtonText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Dashboard de supervisor</Text>
      <Text style={styles.subtitle}>Vista backend-driven del estado operativo por unidad y del pipeline ICEA.</Text>

      {data?.demoMode ? <Text style={styles.bannerInfo}>Modo demo explicito: datos ficticios etiquetados como demo.</Text> : null}
      {stale ? <Text style={styles.bannerWarn}>El resumen puede estar stale; se muestra el ultimo dato persistido.</Text> : null}
      {data?.degraded ? <Text style={styles.bannerWarn}>Estado degradado: {data.degradationReasons.join(', ')}</Text> : null}
      {error && data ? <Text style={styles.bannerWarn}>No se pudo refrescar el backend; se conserva el ultimo resumen local.</Text> : null}

      <View style={styles.filters}>
        <Text style={styles.sectionLabel}>Unidad</Text>
        <View style={styles.chipRow}>
          {UNITS.map((unit) => (
            <Pressable
              key={unit.id}
              onPress={() => setSelectedUnitId(unit.id)}
              style={[styles.chip, selectedUnitId === unit.id && styles.chipSelected]}
              accessibilityLabel={`Unidad ${unit.name}`}
              accessibilityRole="button"
            >
              <Text style={[styles.chipText, selectedUnitId === unit.id && styles.chipTextSelected]}>{unit.name}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.filterHint}>Generado: {formatDate(data?.generatedAt)}</Text>
      </View>

      {!selectedUnit ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No hay actividad real para esta unidad.</Text>
        </View>
      ) : (
        <>
          <View style={styles.metricsGrid}>
            <UnitMetric label="Handovers" value={selectedUnit.totalHandovers} detail={`24h ${selectedUnit.activity.handoversLast24h}`} />
            <UnitMetric label="Pipeline" value={selectedUnit.activity.activePipeline} detail={selectedUnit.activity.status} />
            <UnitMetric label="Outbox" value={selectedUnit.outbox.delivered} detail={`retry ${selectedUnit.outbox.retry} · failed ${selectedUnit.outbox.failed}`} />
            <UnitMetric label="Bridge" value={selectedUnit.bridge.scored} detail={`pending ${selectedUnit.bridge.pending} · stale ${selectedUnit.bridge.stale}`} />
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Estado operativo</Text>
            <Text>Ultima actividad: {formatDate(selectedUnit.activity.lastActivityAt)}</Text>
            <Text>Eventos 24h: {selectedUnit.activity.eventsLast24h}</Text>
            <Text>Alertas abiertas: {selectedUnit.alertsOpen}</Text>
            <Text>Refresh remoto: {formatDate(selectedUnit.lastDashboardRefreshAt)}</Text>
            {selectedUnit.degradationReasons.length > 0 ? (
              <Text style={styles.panelWarn}>Degradado por: {selectedUnit.degradationReasons.join(', ')}</Text>
            ) : null}
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Tiempo promedio por seccion</Text>
            {selectedUnit.handoverTiming.length === 0 ? <Text style={styles.emptyText}>Sin datos de timing.</Text> : null}
            {selectedUnit.handoverTiming.map((item) => (
              <Text key={`${item.unitId}-${item.sectionId}`} style={styles.metricDetail}>
                {item.sectionId}: {Math.round(item.avgDurationMs)} ms ({item.samples})
              </Text>
            ))}
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Alertas de la unidad</Text>
            {data?.alerts.filter((alert) => alert.unitId === selectedUnit.unitId).length === 0 ? (
              <Text style={styles.emptyText}>Sin alertas activas.</Text>
            ) : null}
            {data?.alerts
              .filter((alert) => alert.unitId === selectedUnit.unitId)
              .map((alert) => (
                <View key={alert.id} style={styles.alertCard}>
                  <Text style={styles.alertTitle}>{alert.title}</Text>
                  <Text>{alert.message}</Text>
                  <Text style={styles.alertMeta}>{formatDate(alert.createdAt)}</Text>
                </View>
              ))}
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Eventos recientes</Text>
            {data?.recentEvents.filter((event) => event.unitId === selectedUnit.unitId).length === 0 ? (
              <Text style={styles.emptyText}>Sin eventos recientes para esta unidad.</Text>
            ) : null}
            {data?.recentEvents
              .filter((event) => event.unitId === selectedUnit.unitId)
              .map((event) => (
                <View key={event.id} style={styles.eventCard}>
                  <Text style={styles.alertTitle}>{event.stage} · {event.status}</Text>
                  {event.detail ? <Text>{event.detail}</Text> : null}
                  <Text style={styles.alertMeta}>{formatDate(event.createdAt)}</Text>
                </View>
              ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 16,
    gap: 12,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    color: '#475569',
  },
  bannerInfo: {
    color: '#1d4ed8',
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 10,
  },
  bannerWarn: {
    color: '#92400e',
    backgroundColor: '#fffbeb',
    borderRadius: 10,
    padding: 10,
  },
  filters: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    gap: 8,
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
  },
  metricLabel: {
    color: '#475569',
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
  panel: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  panelTitle: {
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  panelWarn: {
    color: '#92400e',
  },
  alertCard: {
    borderWidth: 1,
    borderColor: '#fde68a',
    backgroundColor: '#fffbeb',
    borderRadius: 10,
    padding: 10,
  },
  eventCard: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
  },
  alertTitle: {
    fontWeight: '600',
    color: '#0f172a',
  },
  alertMeta: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 4,
  },
  emptyBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  emptyText: {
    color: '#64748b',
  },
  loaderText: {
    color: '#334155',
    marginTop: 8,
  },
  errorText: {
    color: '#991b1b',
    fontWeight: '600',
    marginBottom: 8,
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
});

export default SupervisorDashboardScreen;
