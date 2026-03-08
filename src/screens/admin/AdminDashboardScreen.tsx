import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { useAdminDashboardData } from '../../hooks/useAdminDashboardData';
import { hasRole } from '../../security/acl';
import { useAuth } from '../../security/auth';

function formatDate(value: string | null | undefined) {
  if (!value) return 'Sin datos';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('es-ES');
}

export function AdminDashboardScreen() {
  const { session, loading: authLoading } = useAuth();
  const canAdminister = hasRole(session, ['admin', 'supervisor']);
  const { data, loading, error, reload, refreshRemoteSummary, refreshingUnitId } = useAdminDashboardData(canAdminister);
  const canTriggerActions = hasRole(session, ['admin']);

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
        <Text style={{ marginTop: 8 }}>Cargando dashboard ICEA...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <Text style={{ marginBottom: 8 }}>No se pudo cargar el dashboard ICEA.</Text>
        <Pressable onPress={reload}>
          <Text style={{ color: 'blue' }}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  if (!data) return null;

  const units = data.units ?? [];
  const recentEvents = data.recentEvents ?? [];

  return (
    <ScrollView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: '600', marginBottom: 8 }}>
        Orquestación ICEA+
      </Text>
      <Text style={{ marginBottom: 16 }}>
        Estado local del pipeline y últimos eventos persistidos en HANDOVER.
      </Text>
      <Text style={{ marginBottom: 16, color: '#475569' }}>
        Generado: {formatDate(data.generatedAt)}
      </Text>

      <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 8 }}>
        Resumen por unidad
      </Text>
      {units.map((unit) => (
        <View
          key={unit.unitId}
          style={{
            padding: 12,
            marginBottom: 10,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: '#ddd',
            backgroundColor: '#fff',
          }}
        >
          <Text style={{ fontWeight: '600', marginBottom: 6 }}>{unit.unitId}</Text>
          <Text>Total handovers: {unit.totalHandovers}</Text>
          <Text>En cola: {unit.queued}</Text>
          <Text>En ejecución: {unit.running}</Text>
          <Text>Entregados a ICEA: {unit.delivered}</Text>
          <Text>Completados: {unit.succeeded}</Text>
          <Text>Reintento: {unit.retry}</Text>
          <Text>Fallidos: {unit.failed}</Text>
          <Text>Última actualización: {formatDate(unit.lastUpdatedAt)}</Text>
          <Text>Último refresh remoto: {formatDate(unit.lastDashboardRefreshAt)}</Text>
          {canTriggerActions ? (
            <Pressable
              onPress={() => void refreshRemoteSummary(unit.unitId)}
              disabled={refreshingUnitId === unit.unitId}
              style={{ marginTop: 10 }}
            >
              <Text style={{ color: refreshingUnitId === unit.unitId ? '#94a3b8' : '#2563eb' }}>
                {refreshingUnitId === unit.unitId ? 'Actualizando...' : 'Refrescar dashboard summary'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      <Text style={{ fontSize: 16, fontWeight: '600', marginVertical: 8 }}>
        Últimos eventos ICEA
      </Text>
      {recentEvents.map((event) => (
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
            {event.unitId ?? 'sin-unidad'} · {event.stage} · {event.status}
          </Text>
          <Text>Acción: {event.action ?? 'automática'}</Text>
          {event.detail ? <Text>Detalle: {event.detail}</Text> : null}
          {event.requestId ? <Text>requestId: {event.requestId}</Text> : null}
          <Text style={{ fontSize: 12, marginTop: 4 }}>{formatDate(event.createdAt)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

