// BEGIN HANDOVER D6 – PatientBanner
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { PatientSummary } from '@/src/lib/fhir-client';
import type { IceaPatientRiskSummary } from '@/src/types/icea';

interface PatientBannerProps {
  summary: PatientSummary | null;
  loading: boolean;
  error?: string | null;
  iceaRisk?: IceaPatientRiskSummary | null;
  iceaRiskLoading?: boolean;
  iceaRiskError?: string | null;
  showIceaRisk?: boolean;
  showIceaCausalSummary?: boolean;
}

const genderLabels: Record<string, string> = {
  male: 'Masculino',
  female: 'Femenino',
  other: 'Otro',
};

const clinicalStatusLabels: Record<IceaPatientRiskSummary['clinicalStatus'], string> = {
  no_data: 'Sin dato',
  pending: 'Pendiente',
  provisional: 'Provisional',
  complete: 'Disponible',
  insufficient_evidence: 'Evidencia insuficiente',
  failed: 'No disponible',
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

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Sin fecha';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('es-ES');
};

function buildIceaScoreLine(iceaRisk: IceaPatientRiskSummary) {
  const parts: string[] = [];
  if (typeof iceaRisk.score === 'number') {
    parts.push(`Score ${iceaRisk.score.toFixed(1)}`);
  }
  if (iceaRisk.scoreLabel) {
    parts.push(iceaRisk.scoreLabel);
  }
  if (iceaRisk.confidence?.label) {
    parts.push(`Confianza ${iceaRisk.confidence.label}`);
  }
  return parts.join(' · ');
}

export function PatientBanner({
  summary,
  loading,
  error,
  iceaRisk,
  iceaRiskLoading = false,
  iceaRiskError,
  showIceaRisk = false,
  showIceaCausalSummary = false,
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
  const iceaScoreLine = iceaRisk ? buildIceaScoreLine(iceaRisk) : '';
  const showIceaEmptyState = showIceaRisk && !iceaRiskLoading && !iceaRiskError && !iceaRisk;

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

      {showIceaRisk ? (
        <View style={styles.iceaCard} testID="patient-banner-icea">
          <View style={styles.rowBetween}>
            <Text style={styles.iceaTitle}>Apoyo analítico ICEA+</Text>
            {iceaRisk ? (
              <Text style={styles.iceaStatus} testID="patient-banner-icea-status">
                {clinicalStatusLabels[iceaRisk.clinicalStatus]}
              </Text>
            ) : null}
          </View>
          {iceaRiskLoading ? (
            <Text style={styles.iceaText}>Consultando apoyo analítico…</Text>
          ) : null}
          {iceaRiskError ? (
            <Text style={styles.iceaWarn} testID="patient-banner-icea-error">
              No se pudo recuperar el apoyo analítico ICEA+.
            </Text>
          ) : null}
          {showIceaEmptyState ? (
            <Text style={styles.iceaText} testID="patient-banner-icea-empty">
              Sin apoyo analítico disponible por ahora. No sustituye juicio clínico.
            </Text>
          ) : null}
          {iceaRisk ? (
            <>
              {iceaScoreLine ? (
                <Text style={styles.iceaScore} testID="patient-banner-icea-score">
                  {iceaScoreLine}
                </Text>
              ) : null}
              <Text style={styles.iceaText} testID="patient-banner-icea-message">
                {iceaRisk.message}
              </Text>
              <Text style={styles.iceaMeta} testID="patient-banner-icea-meta">
                Actualizado {formatDateTime(iceaRisk.lastUpdatedAt)} · {iceaRisk.provenance.provider} vía {iceaRisk.provenance.source}
              </Text>
              {iceaRisk.stale ? (
                <Text style={styles.iceaWarn} testID="patient-banner-icea-stale">
                  Dato potencialmente desactualizado; verificar antes de usarlo.
                </Text>
              ) : null}
              {iceaRisk.warnings.length > 0 ? (
                <Text style={styles.iceaMeta} testID="patient-banner-icea-warnings">
                  Warnings: {iceaRisk.warnings.map((item) => item.message || item.code).join(' · ')}
                </Text>
              ) : null}
              {showIceaCausalSummary && iceaRisk.causalSummary?.summary ? (
                <Text style={styles.iceaMeta} testID="patient-banner-icea-causal">
                  Resumen causal: {iceaRisk.causalSummary.summary}
                </Text>
              ) : null}
            </>
          ) : null}
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
  iceaCard: {
    marginTop: 4,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    gap: 4,
  },
  iceaTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  iceaStatus: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E3A8A',
  },
  iceaScore: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  iceaText: {
    fontSize: 13,
    color: '#1F2937',
  },
  iceaMeta: {
    fontSize: 12,
    color: '#475569',
  },
  iceaWarn: {
    fontSize: 12,
    color: '#92400E',
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
