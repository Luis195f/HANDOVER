import React from 'react';
import { ActivityIndicator, Button, Text, TextInput, View } from 'react-native';
import { Controller, useFormContext } from 'react-hook-form';
import { type HandoverValues as HandoverFormValues } from '@/src/validation/schemas';
import { VitalTrendsChart } from '@/src/screens/components/VitalTrendsChart';
import ClinicalSuggestions from '@/src/components/ClinicalSuggestions';
import type { SuggestionsResult } from '@/src/lib/ai-suggestions';
import type { deriveRiskEvaluationFromValues } from '@/src/lib/scores/handoverRisk';

export type VitalsSectionProps = {
  styles: Record<string, any>;
  parseNumericInput: (value: string) => number | undefined;
  riskEvaluation: ReturnType<typeof deriveRiskEvaluationFromValues>;
  loadingVitalTrends: boolean;
  vitalTrendsError: string | null;
  vitalTrends: Array<{ time: string; label: string; value: number } | null>;
  aiSuggestionsEnabled: boolean;
  suggestionsState: { vitals: SuggestionsResult | null; diagnosis: SuggestionsResult | null };
  suggestionsLoading: 'vitals' | 'diagnosis' | null;
  suggestionsError: string | null;
  requestSuggestions: (section: 'vitals' | 'diagnosis') => void;
};

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
  const fields: Array<{
    name: `vitals.${string}`;
    label: string;
    placeholder: string;
    keyboard?: 'default' | 'numeric';
    errorPath: string[];
  }> = [
    { name: 'vitals.hr', label: 'Frecuencia cardíaca (/min)', placeholder: '80', keyboard: 'numeric', errorPath: ['vitals', 'hr'] },
    { name: 'vitals.rr', label: 'Frecuencia respiratoria (/min)', placeholder: '16', keyboard: 'numeric', errorPath: ['vitals', 'rr'] },
    { name: 'vitals.tempC', label: 'Temperatura (°C)', placeholder: '37.2', keyboard: 'numeric', errorPath: ['vitals', 'tempC'] },
    { name: 'vitals.spo2', label: 'SpO₂ (%)', placeholder: '96', keyboard: 'numeric', errorPath: ['vitals', 'spo2'] },
    { name: 'vitals.sbp', label: 'TA sistólica (mmHg)', placeholder: '118', keyboard: 'numeric', errorPath: ['vitals', 'sbp'] },
    { name: 'vitals.dbp', label: 'TA diastólica (mmHg)', placeholder: '75', keyboard: 'numeric', errorPath: ['vitals', 'dbp'] },
    {
      name: 'vitals.glucoseMgDl',
      label: 'Glucemia (mg/dL)',
      placeholder: '110',
      keyboard: 'numeric',
      errorPath: ['vitals', 'glucoseMgDl'],
    },
    {
      name: 'vitals.glucoseMmolL',
      label: 'Glucemia (mmol/L)',
      placeholder: '6.1',
      keyboard: 'numeric',
      errorPath: ['vitals', 'glucoseMmolL'],
    },
  ];

  return (
    <View>
      <View style={styles.vitalsGrid}>
        {fields.map((item) => {
          const errorValue = item.errorPath.reduce<unknown>((acc, key) => {
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
            <View key={item.name as string} style={styles.vitalsCell}>
              <View style={styles.field}>
                <Text style={styles.label}>{item.label}</Text>
                <Controller
                  control={control}
                  name={item.name}
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
