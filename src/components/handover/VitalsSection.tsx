import React from 'react';
import { ActivityIndicator, Button, Text, TextInput, View } from 'react-native';
import { Controller, useFormContext, type FieldPath } from 'react-hook-form';
import { type HandoverValues as HandoverFormValues } from '@/src/validation/schemas';
import { VitalTrendsChart } from '@/src/screens/components/VitalTrendsChart';
import ClinicalSuggestions from '@/src/components/ClinicalSuggestions';
import type { SuggestionsResult } from '@/src/lib/ai-suggestions';
import type { deriveRiskEvaluationFromValues } from '@/src/lib/scores/handoverRisk';
import type { VitalTrendsData } from '../../../types/vitals';

export type VitalsSectionProps = {
  styles: Record<string, any>;
  parseNumericInput: (value: string) => number | undefined;
  riskEvaluation: ReturnType<typeof deriveRiskEvaluationFromValues>;
  loadingVitalTrends: boolean;
  vitalTrendsError: string | null;
  vitalTrends: VitalTrendsData | null;
  aiSuggestionsEnabled: boolean;
  suggestionsState: { vitals: SuggestionsResult | null; diagnosis: SuggestionsResult | null };
  suggestionsLoading: 'vitals' | 'diagnosis' | null;
  suggestionsError: string | null;
  requestSuggestions: (section: 'vitals' | 'diagnosis') => void;
};

const VITAL_FIELDS = [
  'hr',
  'rr',
  'tempC',
  'spo2',
  'sbp',
  'dbp',
  'glucoseMgDl',
  'glucoseMmolL',
] as const;

type VitalField = (typeof VITAL_FIELDS)[number];

const VITAL_FIELD_PATHS = {
  hr: 'vitals.hr',
  rr: 'vitals.rr',
  tempC: 'vitals.tempC',
  spo2: 'vitals.spo2',
  sbp: 'vitals.sbp',
  dbp: 'vitals.dbp',
  glucoseMgDl: 'vitals.glucoseMgDl',
  glucoseMmolL: 'vitals.glucoseMmolL',
} as const satisfies Record<VitalField, FieldPath<HandoverFormValues>>;

const VITAL_FIELD_CONFIG = [
  { key: 'hr', label: 'Frecuencia cardíaca (/min)', placeholder: '80', keyboard: 'numeric' },
  { key: 'rr', label: 'Frecuencia respiratoria (/min)', placeholder: '16', keyboard: 'numeric' },
  { key: 'tempC', label: 'Temperatura (°C)', placeholder: '37.2', keyboard: 'numeric' },
  { key: 'spo2', label: 'SpO₂ (%)', placeholder: '96', keyboard: 'numeric' },
  { key: 'sbp', label: 'TA sistólica (mmHg)', placeholder: '118', keyboard: 'numeric' },
  { key: 'dbp', label: 'TA diastólica (mmHg)', placeholder: '75', keyboard: 'numeric' },
  { key: 'glucoseMgDl', label: 'Glucemia (mg/dL)', placeholder: '110', keyboard: 'numeric' },
  { key: 'glucoseMmolL', label: 'Glucemia (mmol/L)', placeholder: '6.1', keyboard: 'numeric' },
] as const satisfies ReadonlyArray<{
  key: VitalField;
  label: string;
  placeholder: string;
  keyboard?: 'default' | 'numeric';
}>;

const VitalsGroup = ({
  styles,
  parseNumericInput,
}: {
  styles: Record<string, any>;
  parseNumericInput: (value: string) => number | undefined;
}) => {
  const {
    control,
    formState: { errors },
  } = useFormContext<HandoverFormValues>();

  return (
    <View>
      <View style={styles.vitalsGrid}>
        {VITAL_FIELD_CONFIG.map((item) => {
          const name = VITAL_FIELD_PATHS[item.key];
          const errorPath: ['vitals', VitalField] = ['vitals', item.key];
          const errorValue = errorPath.reduce<unknown>((acc, key) => {
            if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
              return (acc as Record<string, unknown>)[key];
            }
            return undefined;
          }, errors);
          const errorMessage =
            typeof (errorValue as { message?: unknown } | undefined)?.message === 'string'
              ? (errorValue as { message?: string }).message
              : undefined;
          return (
            <View key={name} style={styles.vitalsCell}>
              <View style={styles.field}>
                <Text style={styles.label}>{item.label}</Text>
                <Controller
                  control={control}
                  name={name}
                  render={({ field: { onChange, onBlur, value } }) => (
                    <TextInput
                      style={styles.input}
                      keyboardType={item.keyboard === 'numeric' ? 'numeric' : 'default'}
                      placeholder={item.placeholder}
                      onBlur={onBlur}
                      value={value == null ? '' : String(value)}
                      onChangeText={(text) => onChange(parseNumericInput(text))}
                    />
                  )}
                />
                {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>AVPU</Text>
        <Controller
          control={control}
          name="vitals.avpu"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="A / C / V / P / U"
              autoCapitalize="characters"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={(text) => onChange(text.trim().toUpperCase().slice(0, 1) || undefined)}
            />
          )}
        />
        {errors?.vitals?.avpu?.message ? <Text style={styles.error}>{errors.vitals.avpu.message}</Text> : null}
      </View>
    </View>
  );
};

export const VitalsSection: React.FC<VitalsSectionProps> = ({
  styles,
  parseNumericInput,
  riskEvaluation,
  loadingVitalTrends,
  vitalTrendsError,
  vitalTrends,
  aiSuggestionsEnabled,
  suggestionsState,
  suggestionsLoading,
  suggestionsError,
  requestSuggestions,
}) => {
  return (
    <>
      <VitalsGroup styles={styles} parseNumericInput={parseNumericInput} />
      <View style={styles.vitalTrendsBlock}>
        {loadingVitalTrends ? <ActivityIndicator size="small" /> : null}
        {vitalTrendsError ? (
          <Text style={styles.vitalTrendsError}>No se pudieron cargar las tendencias de signos vitales.</Text>
        ) : null}
        <VitalTrendsChart trends={vitalTrends} />
      </View>
      <View
        style={[
          styles.riskBanner,
          riskEvaluation.level === 'high'
            ? styles.riskHigh
            : riskEvaluation.level === 'moderate'
              ? styles.riskModerate
              : styles.riskLow,
        ]}
      >
        <Text style={styles.riskTitle}>
          {riskEvaluation.level === 'high'
            ? 'Riesgo alto detectado'
            : riskEvaluation.level === 'moderate'
              ? 'Riesgo moderado'
              : 'Riesgo bajo'}
        </Text>
        {riskEvaluation.reasons.length > 0 ? (
          riskEvaluation.reasons.map((reason) => (
            <Text key={reason} style={styles.riskReason}>
              • {reason}
            </Text>
          ))
        ) : (
          <Text style={styles.riskReason}>
            Completa signos vitales y la escala de Braden para calcular el riesgo.
          </Text>
        )}
      </View>
      {aiSuggestionsEnabled ? (
        <View style={styles.inlineActions}>
          <Button
            title="Ver sugerencias de intervenciones (IA)"
            onPress={() => requestSuggestions('vitals')}
            disabled={suggestionsLoading === 'vitals'}
          />
        </View>
      ) : null}
      {aiSuggestionsEnabled ? (
        <ClinicalSuggestions
          suggestions={suggestionsState.vitals}
          isLoading={suggestionsLoading === 'vitals'}
          onRefresh={() => requestSuggestions('vitals')}
          errorMessage={suggestionsError}
        />
      ) : null}
    </>
  );
};
