import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { UNITS } from '@/src/config/units';
import { useAdminDashboardData } from '@/src/hooks/useAdminDashboardData';
import { hasRole } from '@/src/security/acl';
import { useAuth } from '@/src/security/auth';
import type { IceaOpsErrorSummary, IceaOpsEventSummary, IceaOpsShiftSummary } from '@/src/types/admin';

function formatDate(value: string | null | undefined) {
  if (!value) return 'Sin datos';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('es-ES');
}

function stateTone(state: string | null | undefined) {
  switch (state) {
    case 'healthy':
      return { backgroundColor: '#f0fdf4', borderColor: '#86efac', textColor: '#166534' };
    case 'backlog':
      return { backgroundColor: '#fffbeb', borderColor: '#fcd34d', textColor: '#92400e' };
    case 'stale':
      return { backgroundColor: '#fff7ed', borderColor: '#fdba74', textColor: '#9a3412' };
    case 'failed':
      return { backgroundColor: '#fef2f2', borderColor: '#fca5a5', textColor: '#991b1b' };
    default:
      return { backgroundColor: '#fefce8', borderColor: '#facc15', textColor: '#854d0e' };
  }
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

function ErrorCard({ item }: { item: IceaOpsErrorSummary }) {
  return (
    <View style={styles.itemCard}>
      <Text style={styles.itemTitle}>{item.source} · {item.errorFamily}</Text>
      <Text>Casos: {item.count}</Text>
      <Text style={styles.itemMeta}>{formatDate(item.lastSeenAt)}</Text>
    </View>
  );
}

function ShiftCard({ shift }: { shift: IceaOpsShiftSummary }) {
  const tone = stateTone(shift.state);
  return (
    <View style={[styles.itemCard, { borderColor: tone.borderColor, backgroundColor: tone.backgroundColor }]}>
      <Text style={[styles.itemTitle, { color: tone.textColor }]}>{shift.shift}</Text>
      <Text>Estado: {shift.state}</Text>
      <Text>Pending count: {shift.pendingCount}</Text>
      <Text style={styles.itemMeta}>{formatDate(shift.lastUpdatedAt)}</Text>
    </View>
  );
}

function EventCard({ event }: { event: IceaOpsEventSummary }) {
  const tone = stateTone(event.status);
  return (
    <View style={[styles.itemCard, { borderColor: tone.borderColor, backgroundColor: tone.backgroundColor }]}>
      <Text style={[styles.itemTitle, { color: tone.textColor }]}>{event.source} · {event.status}</Text>
      {event.stage ? <Text>Etapa: {event.stage}</Text> : null}
      {event.errorFamily ? <Text>Familia error: {event.errorFamily}</Text> : null}
      {event.requestId ? <Text>request_id: {event.requestId}</Text> : null}
      {event.bundleId ? <Text>bundle_id: {event.bundleId}</Text> : null}
      {event.payloadHash ? <Text>payload_hash: {event.payloadHash}</Text> : null}
      <Text style={styles.itemMeta}>{formatDate(event.updatedAt)}</Text>
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

  const selectedUnit = useMemo(
    () => data?.unit ?? data?.summary.units.find((unit) => unit.unitId === selectedUnitId) ?? data?.summary.units[0] ?? null,
    [data, selectedUnitId],
  );
  const selectedEvents = useMemo(
    () => data?.unit?.recentEvents ?? data?.events.filter((event) => event.unitId === selectedUnitId) ?? [],
    [data, selectedUnitId],
  );

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
        <Text style={styles.loaderText}>Cargando observabilidad operativa...</Text>
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
      <Text style={styles.subtitle}>Estado operativo agregado del outbox, bridge y pipeline ICEA por unidad.</Text>

      {data?.summary.available === false ? (
        <Text style={styles.bannerWarn}>Observabilidad unavailable: {data.summary.unavailableReason ?? 'feature flag deshabilitado.'}</Text>
      ) : null}
      {data?.summary.state ? <Text style={styles.bannerInfo}>Estado global: {data.summary.state}</Text> : null}
      {data?.summary.flags.bridgeEnabled === false ? (
        <Text style={styles.bannerWarn}>Bridge ICEA en shadow mode no disponible en este entorno.</Text>
      ) : null}
      {stale ? <Text style={styles.bannerWarn}>El resumen puede estar stale; se muestra el último dato persistido.</Text> : null}
      {error && data ? <Text style={styles.bannerWarn}>No se pudo refrescar el backend; se conserva el último resumen local.</Text> : null}

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
        <Text style={styles.filterHint}>Generado: {formatDate(data?.summary.generatedAt)}</Text>
      </View>

      {!selectedUnit ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No hay actividad real para esta unidad.</Text>
        </View>
      ) : (
        <>
          <View style={styles.metricsGrid}>
            <UnitMetric label="Estado" value={selectedUnit.state} detail={`Pending ${selectedUnit.pendingCount}`} />
            <UnitMetric
              label="Handovers exportados"
              value={selectedUnit.counts.handoversExported}
              detail={`Outbox delivered ${selectedUnit.counts.outbox.delivered}`}
            />
            <UnitMetric
              label="Bridge"
              value={selectedUnit.counts.bridge.scored}
              detail={`Pending ${selectedUnit.counts.bridge.pending} · Stale ${selectedUnit.counts.bridge.stale}`}
            />
            <UnitMetric
              label="Pipeline"
              value={selectedUnit.counts.pipeline.events}
              detail={`Running ${selectedUnit.counts.pipeline.running} · Failed ${selectedUnit.counts.pipeline.failed}`}
            />
          </View>

          <View style={styles.panel} testID="dashboard-ops-panel">
            <Text style={styles.panelTitle}>Freshness y backlog</Text>
            <Text>Última actualización: {formatDate(selectedUnit.lastUpdatedAt)}</Text>
            <Text>Último intento outbox: {formatDate(selectedUnit.freshness.lastOutboundAttemptAt)}</Text>
            <Text>Último delivery outbox: {formatDate(selectedUnit.freshness.lastOutboundDeliveredAt)}</Text>
            <Text>Última respuesta bridge: {formatDate(selectedUnit.freshness.lastBridgeReceivedAt)}</Text>
            <Text>Último evento pipeline: {formatDate(selectedUnit.freshness.lastPipelineEventAt)}</Text>
            {!selectedUnit.available && selectedUnit.unavailableReason ? (
              <Text style={styles.panelWarn}>Unavailable: {selectedUnit.unavailableReason}</Text>
            ) : null}
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Latencias</Text>
            <Text>
              Outbox delivery: {selectedUnit.latencies.outboxDelivery.avgMs ?? 'Sin datos'} ms promedio · p95{' '}
              {selectedUnit.latencies.outboxDelivery.p95Ms ?? 'Sin datos'}
            </Text>
            <Text>
              Bridge response: {selectedUnit.latencies.bridgeResponse.avgMs ?? 'Sin datos'} ms promedio · p95{' '}
              {selectedUnit.latencies.bridgeResponse.p95Ms ?? 'Sin datos'}
            </Text>
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Shifts observables</Text>
            {selectedUnit.shifts.length === 0 ? <Text style={styles.emptyText}>Sin señal de shift persistida.</Text> : null}
            {selectedUnit.shifts.map((shift) => (
              <ShiftCard key={`${selectedUnit.unitId}-${shift.shift}`} shift={shift} />
            ))}
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Familias de error</Text>
            {selectedUnit.errors.length === 0 ? <Text style={styles.emptyText}>Sin errores tipificados activos.</Text> : null}
            {selectedUnit.errors.map((item) => (
              <ErrorCard key={`${item.source}-${item.errorFamily}`} item={item} />
            ))}
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Eventos recientes</Text>
            {selectedEvents.length === 0 ? <Text style={styles.emptyText}>Sin eventos recientes para esta unidad.</Text> : null}
            {selectedEvents.map((event) => (
              <EventCard key={event.eventId} event={event} />
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
  itemCard: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
  },
  itemTitle: {
    fontWeight: '600',
    color: '#0f172a',
  },
  itemMeta: {
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
