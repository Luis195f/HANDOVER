// BEGIN HANDOVER D6 – PatientBanner
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { PatientSummary } from '@/src/lib/fhir-client';

interface PatientBannerProps {
  summary: PatientSummary | null;
  loading: boolean;
  error?: string | null;
}

const genderLabels: Record<string, string> = {
  male: 'Masculino',
  female: 'Femenino',
  other: 'Otro',
};

const formatGenderAge = (gender?: string, age?: number) => {
  const genderLabel = gender ? genderLabels[gender] ?? gender : undefined;
  if (genderLabel && typeof age === 'number') {
    return `${genderLabel}, ${age} años`;
  }
  if (typeof age === 'number') {
    return `${age} años`;
  }
  return genderLabel;
};

export function PatientBanner({
  summary,
  loading,
  error,
}: PatientBannerProps) {
  if (loading) {
    return (
      <View style={styles.container} testID="patient-banner">
        <View style={styles.row}>
          <ActivityIndicator />
          <Text style={styles.loadingText} testID="patient-banner-loading">
            Cargando datos del paciente…
          </Text>
        </View>
      </View>
    );
  }

  if (!summary) {
    return (
      <View style={styles.container} testID="patient-banner">
        <Text style={styles.placeholderTitle} testID="patient-banner-empty-title">
          Paciente no vinculado
        </Text>
        <Text style={styles.placeholderText} testID="patient-banner-empty-subtitle">
          Asocia un ID para mostrar el banner.
        </Text>
      </View>
    );
  }

  const genderAge = formatGenderAge(summary.gender, summary.age);
  const hasAllergies = Array.isArray(summary.allergies) && summary.allergies.length > 0;

  return (
    <View style={styles.container} testID="patient-banner">
      <View style={styles.rowBetween}>
        <Text style={styles.name} testID="patient-name">
          {summary.name}
        </Text>
        {genderAge ? (
          <Text style={styles.meta} testID="patient-gender-age">
            {genderAge}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowBetween}>
        {summary.bed ? (
          <Text style={styles.meta} testID="patient-bed">
            Cama {summary.bed}
          </Text>
        ) : null}
        {summary.mrn ? (
          <Text style={styles.meta} testID="patient-mrn">
            MRN {summary.mrn}
          </Text>
        ) : null}
      </View>

      {hasAllergies ? (
        <View style={styles.allergyRow} testID="patient-allergies">
          {summary.allergies!.map((item, index) => (
            <View style={styles.chip} key={item} testID={`patient-allergy-${index}`}>
              <Text style={styles.chipText}>{item}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {error ? (
        <Text style={styles.error} testID="patient-banner-error">
          No se pudo obtener la información del paciente
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomColor: '#E5E7EB',
    borderBottomWidth: StyleSheet.hairlineWidth ?? 1,
    backgroundColor: '#F9FAFB',
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  loadingText: {
    fontSize: 14,
    color: '#4B5563',
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  meta: {
    fontSize: 14,
    color: '#374151',
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderWidth: 1,
  },
  chipText: {
    color: '#92400E',
    fontWeight: '600',
  },
  allergyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  error: {
    fontSize: 12,
    color: '#DC2626',
  },
  placeholderTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  placeholderText: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7280',
  },
});
// END HANDOVER D6 – PatientBanner
