// BEGIN HANDOVER: PATIENT_HEADER_COMPONENT
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { usePatientSummary } from '@/src/hooks/usePatientSummary';

interface PatientHeaderProps {
  patientId?: string;
  showId?: boolean;
}

export function PatientHeader({ patientId, showId = false }: PatientHeaderProps) {
  const { loading, error, summary } = usePatientSummary(patientId);

  if (!patientId) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Paciente no vinculado</Text>
        <Text style={styles.caption}>Esta entrega no está asociada a ningún paciente.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.row}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Cargando datos del paciente…</Text>
        </View>
      )}

      {!loading && summary && (
        <>
          <Text style={styles.name}>{summary.displayName}</Text>
          <Text style={styles.detail}>{summary.ageLabel} · {summary.bedLabel}</Text>
          {showId && <Text style={styles.id}>ID: {summary.id}</Text>}
          {error && <Text style={styles.error}>{error} (mostrando identificador local)</Text>}
        </>
      )}

      {!loading && !summary && (
        <>
          <Text style={styles.title}>Paciente #{patientId}</Text>
          {error && <Text style={styles.error}>{error}</Text>}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomColor: '#E5E7EB',
    borderBottomWidth: (StyleSheet as any).hairlineWidth ?? 1,
    backgroundColor: '#F9FAFB',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#4B5563',
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  detail: {
    marginTop: 4,
    fontSize: 14,
    color: '#374151',
  },
  id: {
    marginTop: 4,
    fontSize: 12,
    color: '#6B7280',
  },
  error: {
    marginTop: 4,
    fontSize: 12,
    color: '#DC2626',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  caption: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7280',
  },
});
// END HANDOVER: PATIENT_HEADER_COMPONENT
