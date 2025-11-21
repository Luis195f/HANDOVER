import React from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { useAdminDashboardData } from '../../hooks/useAdminDashboardData';
import { hasRole } from '../../security/acl';
import { useAuth } from '../../security/auth';

export function AdminDashboardScreen() {
  const { session, loading: authLoading } = useAuth();
  const { data, loading, error, reload } = useAdminDashboardData();

  const canAdminister = hasRole(session, ['admin', 'supervisor']);

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
        <Text style={{ marginTop: 8 }}>Cargando dashboard...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <Text style={{ marginBottom: 8 }}>No se pudo cargar el dashboard.</Text>
        <TouchableOpacity onPress={reload}>
          <Text style={{ color: 'blue' }}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!data) return null;

  return (
    <ScrollView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: '600', marginBottom: 8 }}>
        Dashboard administrativo
      </Text>
      <Text style={{ marginBottom: 16 }}>
        Resumen multi-unidad basado en datos de handovers.
      </Text>

      <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 8 }}>
        Unidades
      </Text>
      {data.units.map((u) => (
        <View
          key={u.unitId}
          style={{
            padding: 12,
            marginBottom: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: '#ddd',
          }}
        >
          <Text style={{ fontWeight: '600' }}>{u.unitName}</Text>
          <Text>Total handovers: {u.totalHandovers}</Text>
          <Text>Completados: {u.completedHandovers}</Text>
          <Text>Pendientes: {u.pendingHandovers}</Text>
          <Text>Pacientes críticos: {u.criticalPatients}</Text>
        </View>
      ))}

      <Text style={{ fontSize: 16, fontWeight: '600', marginVertical: 8 }}>
        Actividad de personal
      </Text>
      {data.staff.map((s) => (
        <View
          key={s.staffId}
          style={{
            padding: 12,
            marginBottom: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: '#ddd',
          }}
        >
          <Text style={{ fontWeight: '600' }}>
            {s.name} ({s.role})
          </Text>
          <Text>Unidad: {s.unitId}</Text>
          <Text>Handovers completados: {s.handoversCompleted}</Text>
          <Text>Handovers recibidos: {s.handoversReceived}</Text>
          {s.lastHandoverAt && <Text>Último handover: {s.lastHandoverAt}</Text>}
        </View>
      ))}

      <Text style={{ fontSize: 16, fontWeight: '600', marginVertical: 8 }}>
        Alertas clínicas
      </Text>
      {data.alerts.map((a) => (
        <View
          key={a.id}
          style={{
            padding: 12,
            marginBottom: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: '#f99',
            backgroundColor: '#fee',
          }}
        >
          <Text style={{ fontWeight: '600' }}>
            [{a.type}] {a.patientDisplay ?? a.patientId}
          </Text>
          <Text>{a.message}</Text>
          <Text style={{ fontSize: 12, marginTop: 4 }}>{a.createdAt}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
