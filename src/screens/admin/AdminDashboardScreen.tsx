import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { useAdminDashboardData } from '../../hooks/useAdminDashboardData';
import { hasRole } from '../../security/acl';
import { useAuth } from '../../security/auth';
import type { IceaDashboardAlert, IceaDashboardUnitSummary } from '../../types/admin';

function formatDate(value: string | null | undefined) {
  if (!value) return 'Sin datos';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('es-ES');
}

function statusLabel(status: string) {
  switch (status) {
    case 'degraded':
      return 'Degradado';
    case 'attention':
      return 'Atencion';
    case 'active':
      return 'Activo';
    case 'nominal':
      return 'Nominal';
    case 'empty':
      return 'Sin actividad';
    default:
      return status || 'Sin datos';
  }
}

function bannerColors(kind: 'demo' | 'stale' | 'degraded' | 'error') {
  switch (kind) {
    case 'demo':
      return { backgroundColor: '#eff6ff', borderColor: '#93c5fd', textColor: '#1d4ed8' };
    case 'stale':
      return { backgroundColor: '#fffbeb', borderColor: '#fcd34d', textColor: '#92400e' };
    case 'error':
      return { backgroundColor: '#fef2f2', borderColor: '#fca5a5', textColor: '#991b1b' };
    default:
      return { backgroundColor: '#fff7ed', borderColor: '#fdba74', textColor: '#c2410c' };
  }
}

function Banner({ kind, children }: { kind: 'demo' | 'stale' | 'degraded' | 'error'; children: React.ReactNode }) {
  const colors = bannerColors(kind);
  return (
    <View
      style={{
        marginBottom: 12,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        backgroundColor: colors.backgroundColor,
        borderColor: colors.borderColor,
      }}
    >
      <Text style={{ color: colors.textColor }}>{children}</Text>
    </View>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <View
      style={{
        flexBasis: '48%',
        padding: 12,
        marginBottom: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#fff',
      }}
    >
      <Text style={{ color: '#475569', marginBottom: 4 }}>{label}</Text>
      <Text style={{ fontSize: 20, fontWeight: '700', color: '#0f172a' }}>{value}</Text>
      {detail ? <Text style={{ marginTop: 4, color: '#64748b' }}>{detail}</Text> : null}
    </View>
  );
}

function AlertCard({ alert }: { alert: IceaDashboardAlert }) {
  const borderColor = alert.severity === 'high' ? '#fca5a5' : '#fcd34d';
  const backgroundColor = alert.severity === 'high' ? '#fef2f2' : '#fffbeb';
  return (
    <View
      style={{
        padding: 12,
        marginBottom: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor,
        backgroundColor,
      }}
    >
      <Text style={{ fontWeight: '600' }}>
        {(alert.unitId ?? 'sin-unidad') + ' · ' + alert.source + ' · ' + alert.status}
      </Text>
      <Text>{alert.title}</Text>
      <Text>{alert.message}</Text>
      <Text style={{ fontSize: 12, marginTop: 4 }}>{formatDate(alert.createdAt)}</Text>
    </View>
  );
}

function UnitCard({
  unit,
  canTriggerActions,
  refreshingUnitId,
  onRefresh,
}: {
  unit: IceaDashboardUnitSummary;
  canTriggerActions: boolean;
  refreshingUnitId: string | null;
  onRefresh: (unitId: string) => void;
}) {
  return (
    <View
      style={{
        padding: 12,
        marginBottom: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: unit.degraded ? '#fcd34d' : '#ddd',
        backgroundColor: '#fff',
      }}
    >
      <Text style={{ fontWeight: '600', marginBottom: 6 }}>{unit.unitId}</Text>
      <Text>Estado operativo: {statusLabel(unit.activity.status)}</Text>
      <Text>Total handovers: {unit.totalHandovers}</Text>
      <Text>Activos en pipeline: {unit.activity.activePipeline}</Text>
      <Text>Ultima actividad: {formatDate(unit.activity.lastActivityAt)}</Text>
      <Text>Handovers 24h: {unit.activity.handoversLast24h}</Text>
      <Text>Eventos 24h: {unit.activity.eventsLast24h}</Text>
      <Text>Outbox queued/retry/failed: {unit.outbox.queued}/{unit.outbox.retry}/{unit.outbox.failed}</Text>
      <Text>Bridge pending/scored/stale: {unit.bridge.pending}/{unit.bridge.scored}/{unit.bridge.stale}</Text>
      <Text>Alertas abiertas: {unit.alertsOpen}</Text>
      <Text>Ultimo refresh remoto: {formatDate(unit.lastDashboardRefreshAt)}</Text>
      {unit.handoverTiming.length > 0 ? (
        <Text style={{ marginTop: 6 }}>
          Timing: {unit.handoverTiming.map((item) => `${item.sectionId} ${Math.round(item.avgDurationMs)} ms`).join(' · ')}
        </Text>
      ) : (
        <Text style={{ marginTop: 6, color: '#64748b' }}>Timing: sin datos</Text>
      )}
      {unit.degradationReasons.length > 0 ? (
        <Text style={{ marginTop: 6, color: '#92400e' }}>Degradado por: {unit.degradationReasons.join(', ')}</Text>
      ) : null}
      {canTriggerActions ? (
        <Pressable onPress={() => onRefresh(unit.unitId)} disabled={refreshingUnitId === unit.unitId} style={{ marginTop: 10 }}>
          <Text style={{ color: refreshingUnitId === unit.unitId ? '#94a3b8' : '#2563eb' }}>
            {refreshingUnitId === unit.unitId ? 'Actualizando...' : 'Refrescar dashboard summary'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function AdminDashboardScreen() {
  const { session, loading: authLoading } = useAuth();
  const canAdminister = hasRole(session, ['admin', 'supervisor']);
  const canTriggerActions = hasRole(session, ['admin']);
  const isDemoSession = session?.mode === 'demo';
  const { data, loading, error, reload, refreshRemoteSummary, refreshingUnitId, stale, lastLoadedAt } = useAdminDashboardData(
    canAdminister,
    { demoMode: isDemoSession },
  );

  if (authLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session || !canAdminister) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <Text>Acceso restringido. Solo usuarios administrativos.</Text>
      </View>
    );
  }

  if (loading && !data) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Cargando dashboard operativo...</Text>
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <Banner kind="error">{error.message}</Banner>
        <Pressable onPress={reload}>
          <Text style={{ color: '#2563eb' }}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  if (!data) return null;

  const isEmpty = data.empty || (data.units.length === 0 && data.alerts.length === 0 && data.recentEvents.length === 0);

  return (
    <ScrollView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: '600', marginBottom: 8 }}>Dashboard admin ICEA+</Text>
      <Text style={{ marginBottom: 16 }}>Fuente: HANDOVER como backend operativo del pipeline y del outbox ICEA.</Text>
      <Text style={{ marginBottom: 4, color: '#475569' }}>Generado: {formatDate(data.generatedAt)}</Text>
      <Text style={{ marginBottom: 16, color: '#475569' }}>Ultima actividad: {formatDate(data.latestActivityAt ?? lastLoadedAt)}</Text>

      {data.demoMode ? <Banner kind="demo">Modo demo explicito: estos datos son ficticios y estan etiquetados como demo.</Banner> : null}
      {stale ? <Banner kind="stale">El dashboard muestra el ultimo estado disponible y puede estar stale.</Banner> : null}
      {data.degraded ? (
        <Banner kind="degraded">Estado degradado: {data.degradationReasons.join(', ') || 'revisar integracion ICEA.'}</Banner>
      ) : null}
      {error && data ? <Banner kind="error">No se pudo refrescar el backend. Se mantiene el ultimo resumen local.</Banner> : null}

      {isEmpty ? (
        <View style={{ paddingVertical: 24 }}>
          <Text style={{ marginBottom: 8 }}>Todavia no hay datos operativos para mostrar.</Text>
          <Text style={{ color: '#64748b' }}>Cuando entren handovers reales o eventos ICEA, el dashboard dejara de estar vacio.</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <SummaryCard label="Snapshots" value={data.pipeline.snapshots} detail={`Running ${data.pipeline.running} · Retry ${data.pipeline.retry}`} />
        <SummaryCard
          label="Outbox ICEA"
          value={data.outbox.totals.delivered}
          detail={`Queued ${data.outbox.totals.queued} · Failed ${data.outbox.totals.failed}`}
        />
        <SummaryCard
          label="Bridge scored"
          value={data.pipeline.bridge.scored}
          detail={`Pending ${data.pipeline.bridge.pending} · Stale ${data.pipeline.bridge.stale}`}
        />
        <SummaryCard label="Alertas" value={data.alerts.length} detail={data.degraded ? 'Requiere atencion' : 'Sin degradacion global'} />
      </View>

      <Text style={{ fontSize: 16, fontWeight: '600', marginVertical: 8 }}>Resumen por unidad</Text>
      {data.units.length === 0 ? <Text style={{ color: '#64748b', marginBottom: 12 }}>Sin unidades con actividad real.</Text> : null}
      {data.units.map((unit) => (
        <UnitCard
          key={unit.unitId}
          unit={unit}
          canTriggerActions={canTriggerActions}
          refreshingUnitId={refreshingUnitId}
          onRefresh={(unitId) => void refreshRemoteSummary(unitId)}
        />
      ))}

      <Text style={{ fontSize: 16, fontWeight: '600', marginVertical: 8 }}>Alertas e incidencias</Text>
      {data.alerts.length === 0 ? <Text style={{ color: '#64748b', marginBottom: 12 }}>Sin alertas operativas activas.</Text> : null}
      {data.alerts.map((alert) => (
        <AlertCard key={alert.id} alert={alert} />
      ))}

      <Text style={{ fontSize: 16, fontWeight: '600', marginVertical: 8 }}>Ultimos eventos ICEA</Text>
      {data.recentEvents.length === 0 ? <Text style={{ color: '#64748b', marginBottom: 12 }}>Sin eventos ICEA persistidos.</Text> : null}
      {data.recentEvents.map((event) => (
        <View
          key={event.id}
          style={{
            padding: 12,
            marginBottom: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: event.status === 'failed' ? '#fca5a5' : '#ddd',
            backgroundColor: event.status === 'failed' ? '#fef2f2' : '#fff',
          }}
        >
          <Text style={{ fontWeight: '600' }}>
            {(event.unitId ?? 'sin-unidad') + ' · ' + event.stage + ' · ' + event.status}
          </Text>
          <Text>Accion: {event.action ?? 'automatica'}</Text>
          {event.detail ? <Text>Detalle: {event.detail}</Text> : null}
          {event.requestId ? <Text>requestId: {event.requestId}</Text> : null}
          <Text style={{ fontSize: 12, marginTop: 4 }}>{formatDate(event.createdAt)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
