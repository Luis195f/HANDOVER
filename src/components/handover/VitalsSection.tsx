import React from 'react';
import { ActivityIndicator, Button, Text, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';
import { Controller, useFormContext, useWatch, type FieldPath } from 'react-hook-form';
import { type HandoverValues as HandoverFormValues } from '@/src/validation/schemas';
import { glucoseMgDlToMmolL } from '@/src/validation/normalization';
import { VitalTrendsChart } from '@/src/screens/components/VitalTrendsChart';
import ClinicalSuggestions from '@/src/components/ClinicalSuggestions';
import type { SuggestionsResult } from '@/src/lib/ai-suggestions';
import type { deriveRiskEvaluationFromValues } from '@/src/lib/scores/handoverRisk';
import type { VitalTrendsData } from '../../../types/vitals';
import VitalSignsChart from '@/src/components/VitalSignsChart';
import { PickerField, avpuOptions } from '@/src/screens/components/nursingShared';

export type VitalsSectionProps = {
  styles: Record<string, TextStyle | ViewStyle>;
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
} as const satisfies Record<VitalField, FieldPath<HandoverFormValues>>;

const VITAL_FIELD_CONFIG = [
  { key: 'hr', label: 'Frecuencia cardíaca (/min)', placeholder: '80', keyboard: 'numeric' },
  { key: 'rr', label: 'Frecuencia respiratoria (/min)', placeholder: '16', keyboard: 'numeric' },
  { key: 'tempC', label: 'Temperatura (°C)', placeholder: '37.2', keyboard: 'numeric' },
  { key: 'spo2', label: 'SpO₂ (%)', placeholder: '96', keyboard: 'numeric' },
  { key: 'sbp', label: 'TA sistólica (mmHg)', placeholder: '118', keyboard: 'numeric' },
  { key: 'dbp', label: 'TA diastólica (mmHg)', placeholder: '75', keyboard: 'numeric' },
  // Política UI: una sola unidad de entrada (mg/dL); mmol/L se deriva automáticamente para compatibilidad.
  { key: 'glucoseMgDl', label: 'Glucemia (mg/dL)', placeholder: '110', keyboard: 'numeric' },
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
  styles: Record<string, TextStyle | ViewStyle>;
  parseNumericInput: (value: string) => number | undefined;
}) => {
  const {
    control,
    setValue,
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
                      onChangeText={(text) => {
                        const parsed = parseNumericInput(text);
                        onChange(parsed);
                        if (item.key === 'glucoseMgDl') {
                          setValue(
                            'vitals.glucoseMmolL',
                            typeof parsed === 'number' ? glucoseMgDlToMmolL(parsed) : undefined,
                            { shouldDirty: true, shouldValidate: false },
                          );
                        }
                      }}
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
        <Controller
          control={control}
          name="vitals.avpu"
          render={({ field: { onChange, value } }) => (
            <PickerField
              testID="vitals.avpu"
              label="AVPU"
              placeholder="Seleccionar"
              value={value}
              options={avpuOptions}
              onValueChange={onChange}
              error={errors?.vitals?.avpu?.message as string | undefined}
            />
          )}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Registro (ISO)</Text>
        <Controller
          control={control}
          name="vitals.recordedAt"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="2024-01-01T08:00:00Z"
              autoCapitalize="none"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={(text) => {
                const trimmed = text.trim();
                onChange(trimmed.length ? trimmed : undefined);
              }}
            />
          )}
        />
        {errors?.vitals?.recordedAt?.message ? (
          <Text style={styles.error}>{errors.vitals.recordedAt.message}</Text>
        ) : null}
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Emitido (ISO)</Text>
        <Controller
          control={control}
          name="vitals.issuedAt"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="2024-01-01T08:05:00Z"
              autoCapitalize="none"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={(text) => {
                const trimmed = text.trim();
                onChange(trimmed.length ? trimmed : undefined);
              }}
            />
          )}
        />
        {errors?.vitals?.issuedAt?.message ? (
          <Text style={styles.error}>{errors.vitals.issuedAt.message}</Text>
        ) : null}
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
  const { control } = useFormContext<HandoverFormValues>();
  const watchedVitals = useWatch({ control, name: 'vitals' });

  return (
    <>
      <VitalsGroup styles={styles} parseNumericInput={parseNumericInput} />
      <View style={styles.vitalTrendsBlock}>
        <VitalSignsChart vitals={watchedVitals} />
      </View>
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
