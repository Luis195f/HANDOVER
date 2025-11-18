import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Controller, useFormContext, useWatch } from 'react-hook-form';

import type { HandoverValues } from '@/src/validation/schemas';

type BradenSubscaleName =
  | 'braden.sensoryPerception'
  | 'braden.moisture'
  | 'braden.activity'
  | 'braden.mobility'
  | 'braden.nutrition'
  | 'braden.frictionShear';

type BradenOption = { label: string; value: 1 | 2 | 3 | 4 };
type BradenRiskLevel = 'alto' | 'moderado' | 'bajo' | 'sin_riesgo';
type GlasgowFieldName = 'glasgow.eye' | 'glasgow.verbal' | 'glasgow.motor';
type GlasgowOption = { label: string; value: number };
type GlasgowSeverity = 'grave' | 'moderado' | 'leve';

function usePainAssessmentState() {
  const { control, setValue } = useFormContext<HandoverValues>();
  const hasPain = useWatch({ control, name: 'painAssessment.hasPain' });
  const evaScore = useWatch({ control, name: 'painAssessment.evaScore' });

  useEffect(() => {
    if (hasPain === false) {
      // Clear values when the patient has no pain to avoid stale data.
      setValue('painAssessment.evaScore', null, { shouldDirty: false, shouldValidate: true });
      setValue('painAssessment.location', null, { shouldDirty: false, shouldValidate: false });
      setValue('painAssessment.actionsTaken', null, { shouldDirty: false, shouldValidate: false });
      return;
    }

    // Default EVA to 0 when pain is enabled and no score has been provided yet.
    if (hasPain === true && evaScore == null) {
      setValue('painAssessment.evaScore', 0, { shouldDirty: false, shouldValidate: false });
    }
  }, [evaScore, hasPain, setValue]);

  return useMemo(() => ({ hasPain: !!hasPain }), [hasPain]);
}

function computeBradenRiskLevel(total: number): BradenRiskLevel {
  if (total <= 12) return 'alto';
  if (total <= 14) return 'moderado';
  if (total <= 18) return 'bajo';
  return 'sin_riesgo';
}

function computeGlasgowSeverity(total: number): GlasgowSeverity {
  if (total <= 8) return 'grave';
  if (total <= 12) return 'moderado';
  return 'leve';
}

function BradenSubscaleField({
  label,
  name,
  options,
  error,
}: {
  label: string;
  name: BradenSubscaleName;
  options: BradenOption[];
  error?: string;
}) {
  const { control } = useFormContext<HandoverValues>();

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Controller
        control={control}
        name={name}
        render={({ field: { onChange, value } }) => (
          <View style={styles.optionRow}>
            {options.map((option) => {
              const selected = value === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  style={[styles.optionButton, selected && styles.optionButtonSelected]}
                  onPress={() => onChange(option.value)}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function GlasgowField({
  label,
  name,
  options,
  error,
}: {
  label: string;
  name: GlasgowFieldName;
  options: GlasgowOption[];
  error?: string;
}) {
  const { control } = useFormContext<HandoverValues>();

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Controller
        control={control}
        name={name}
        render={({ field: { onChange, value } }) => (
          <View style={styles.optionRow}>
            {options.map((option) => {
              const selected = value === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  style={[styles.optionButton, selected && styles.optionButtonSelected]}
                  onPress={() => onChange(option.value)}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export default function ClinicalScalesSection() {
  const { control, formState, setValue } = useFormContext<HandoverValues>();
  const { hasPain } = usePainAssessmentState();
  const errors = formState.errors ?? {};
  const painErrors = errors.painAssessment ?? {};
  const evaScoreError = painErrors?.evaScore?.message as string | undefined;
  const locationError = painErrors?.location?.message as string | undefined;
  const actionsError = painErrors?.actionsTaken?.message as string | undefined;
  const bradenErrors = errors.braden ?? {};
  const glasgowErrors = errors.glasgow ?? {};
  const eyeError = glasgowErrors?.eye?.message as string | undefined;
  const verbalError = glasgowErrors?.verbal?.message as string | undefined;
  const motorError = glasgowErrors?.motor?.message as string | undefined;

  const sensoryPerception = useWatch({ control, name: 'braden.sensoryPerception' });
  const moisture = useWatch({ control, name: 'braden.moisture' });
  const activity = useWatch({ control, name: 'braden.activity' });
  const mobility = useWatch({ control, name: 'braden.mobility' });
  const nutrition = useWatch({ control, name: 'braden.nutrition' });
  const frictionShear = useWatch({ control, name: 'braden.frictionShear' });
  const totalScore = useWatch({ control, name: 'braden.totalScore' });
  const riskLevel = useWatch({ control, name: 'braden.riskLevel' });
  const eye = useWatch({ control, name: 'glasgow.eye' });
  const verbal = useWatch({ control, name: 'glasgow.verbal' });
  const motor = useWatch({ control, name: 'glasgow.motor' });
  const glasgowTotal = useWatch({ control, name: 'glasgow.total' });
  const glasgowSeverity = useWatch({ control, name: 'glasgow.severity' });

  useEffect(() => {
    const scores = [
      sensoryPerception,
      moisture,
      activity,
      mobility,
      nutrition,
      frictionShear,
    ];
    const allFilled = scores.every((score) => typeof score === 'number');

    if (allFilled) {
      const computedTotal = (scores as number[]).reduce((acc, value) => acc + value, 0);
      const computedRisk = computeBradenRiskLevel(computedTotal);

      setValue('braden.totalScore', computedTotal, { shouldDirty: false, shouldValidate: true });
      setValue('braden.riskLevel', computedRisk, { shouldDirty: false, shouldValidate: true });
      return;
    }

    setValue('braden.totalScore', undefined as unknown as number, {
      shouldDirty: false,
      shouldValidate: false,
    });
    setValue('braden.riskLevel', undefined as unknown as BradenRiskLevel, {
      shouldDirty: false,
      shouldValidate: false,
    });
  }, [activity, frictionShear, mobility, moisture, nutrition, sensoryPerception, setValue]);

  useEffect(() => {
    const scores = [eye, verbal, motor];
    const allFilled = scores.every((score) => typeof score === 'number');

    if (allFilled) {
      const computedTotal = (scores as number[]).reduce((acc, value) => acc + value, 0);
      const computedSeverity = computeGlasgowSeverity(computedTotal);

      setValue('glasgow.total', computedTotal, { shouldDirty: false, shouldValidate: true });
      setValue('glasgow.severity', computedSeverity, { shouldDirty: false, shouldValidate: true });
      return;
    }

    setValue('glasgow.total', undefined as unknown as number, {
      shouldDirty: false,
      shouldValidate: false,
    });
    setValue('glasgow.severity', undefined as unknown as GlasgowSeverity, {
      shouldDirty: false,
      shouldValidate: false,
    });
  }, [eye, motor, setValue, verbal]);

  const riskLabelText = useMemo(() => {
    if (!riskLevel) return '—';
    const map: Record<NonNullable<typeof riskLevel>, string> = {
      alto: 'Alto',
      moderado: 'Moderado',
      bajo: 'Bajo',
      sin_riesgo: 'Sin riesgo',
    };
    return map[riskLevel];
  }, [riskLevel]);

  const glasgowSeverityLabel = useMemo(() => {
    if (!glasgowSeverity) return '—';
    const map: Record<NonNullable<typeof glasgowSeverity>, string> = {
      grave: 'Grave',
      moderado: 'Moderado',
      leve: 'Leve',
    };
    return map[glasgowSeverity];
  }, [glasgowSeverity]);

  const subscaleOptions: Record<BradenSubscaleName, BradenOption[]> = {
    'braden.sensoryPerception': [
      { value: 1, label: '1: Completamente limitado' },
      { value: 2, label: '2: Muy limitado' },
      { value: 3, label: '3: Ligeramente limitado' },
      { value: 4, label: '4: Sin limitación' },
    ],
    'braden.moisture': [
      { value: 1, label: '1: Constantemente húmeda' },
      { value: 2, label: '2: Muy húmeda' },
      { value: 3, label: '3: Ocasionalmente húmeda' },
      { value: 4, label: '4: Rara vez húmeda' },
    ],
    'braden.activity': [
      { value: 1, label: '1: Encamado' },
      { value: 2, label: '2: Sedentario' },
      { value: 3, label: '3: Camina ocasionalmente' },
      { value: 4, label: '4: Camina frecuentemente' },
    ],
    'braden.mobility': [
      { value: 1, label: '1: Completamente inmóvil' },
      { value: 2, label: '2: Muy limitado' },
      { value: 3, label: '3: Ligeramente limitado' },
      { value: 4, label: '4: Sin limitación' },
    ],
    'braden.nutrition': [
      { value: 1, label: '1: Muy pobre' },
      { value: 2, label: '2: Probablemente inadecuada' },
      { value: 3, label: '3: Adecuada' },
      { value: 4, label: '4: Excelente' },
    ],
    'braden.frictionShear': [
      { value: 1, label: '1: Problema importante' },
      { value: 2, label: '2: Problema potencial' },
      { value: 3, label: '3: Sin problema aparente' },
      { value: 4, label: '4: Muy buen control' },
    ],
  };

  const glasgowOptions: Record<GlasgowFieldName, GlasgowOption[]> = {
    'glasgow.eye': [
      { value: 4, label: '4: Espontánea' },
      { value: 3, label: '3: Al llamado' },
      { value: 2, label: '2: Al dolor' },
      { value: 1, label: '1: Ninguna' },
    ],
    'glasgow.verbal': [
      { value: 5, label: '5: Orientado' },
      { value: 4, label: '4: Confuso' },
      { value: 3, label: '3: Palabras inaprop.' },
      { value: 2, label: '2: Sonidos incompr.' },
      { value: 1, label: '1: Ninguna' },
    ],
    'glasgow.motor': [
      { value: 6, label: '6: Obedece órdenes' },
      { value: 5, label: '5: Localiza dolor' },
      { value: 4, label: '4: Retirada' },
      { value: 3, label: '3: Flexión anormal' },
      { value: 2, label: '2: Extensión' },
      { value: 1, label: '1: Ninguna' },
    ],
  };

  const parseEvaScore = (text: string) => {
    if (text.trim() === '') return null;
    const normalized = text.replace(',', '.');
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? null : parsed;
  };

  return (
    <View>
      <Text style={styles.sectionSubtitle}>Dolor / EVA</Text>
      <Controller
        control={control}
        name="painAssessment.hasPain"
        render={({ field: { onChange, value } }) => (
          <View style={[styles.field, styles.switchRow]}>
            <Text style={styles.label}>Paciente con dolor</Text>
            <Switch value={!!value} onValueChange={onChange} />
          </View>
        )}
      />

      <Controller
        control={control}
        name="painAssessment.evaScore"
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Dolor: {value ?? '—'}/10</Text>
            <TextInput
              style={[styles.input, !hasPain && styles.disabledInput]}
              editable={hasPain}
              keyboardType="numeric"
              placeholder="0"
              onBlur={onBlur}
              value={value == null ? '' : String(value)}
              onChangeText={(text) => onChange(parseEvaScore(text))}
            />
            {evaScoreError ? <Text style={styles.error}>{evaScoreError}</Text> : null}
          </View>
        )}
      />

      <Controller
        control={control}
        name="painAssessment.location"
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Localización del dolor</Text>
            <TextInput
              style={[styles.input, !hasPain && styles.disabledInput]}
              editable={hasPain}
              placeholder="Ej: abdomen, cabeza"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
            />
            {locationError ? <Text style={styles.error}>{locationError}</Text> : null}
          </View>
        )}
      />

      <Controller
        control={control}
        name="painAssessment.actionsTaken"
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Medidas / analgesia administrada</Text>
            <TextInput
              style={[styles.input, styles.textArea, !hasPain && styles.disabledInput]}
              editable={hasPain}
              multiline
              placeholder="Paracetamol 1g IV, reposición de posición"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
            />
            {actionsError ? <Text style={styles.error}>{actionsError}</Text> : null}
          </View>
        )}
      />

      <Text style={styles.sectionSubtitle}>Braden – Riesgo de úlceras por presión</Text>
      <BradenSubscaleField
        label="Percepción sensorial"
        name="braden.sensoryPerception"
        options={subscaleOptions['braden.sensoryPerception']}
        error={bradenErrors?.sensoryPerception?.message as string | undefined}
      />
      <BradenSubscaleField
        label="Humedad"
        name="braden.moisture"
        options={subscaleOptions['braden.moisture']}
        error={bradenErrors?.moisture?.message as string | undefined}
      />
      <BradenSubscaleField
        label="Actividad"
        name="braden.activity"
        options={subscaleOptions['braden.activity']}
        error={bradenErrors?.activity?.message as string | undefined}
      />
      <BradenSubscaleField
        label="Movilidad"
        name="braden.mobility"
        options={subscaleOptions['braden.mobility']}
        error={bradenErrors?.mobility?.message as string | undefined}
      />
      <BradenSubscaleField
        label="Nutrición"
        name="braden.nutrition"
        options={subscaleOptions['braden.nutrition']}
        error={bradenErrors?.nutrition?.message as string | undefined}
      />
      <BradenSubscaleField
        label="Fricción / cizalla"
        name="braden.frictionShear"
        options={subscaleOptions['braden.frictionShear']}
        error={bradenErrors?.frictionShear?.message as string | undefined}
      />

      <View style={styles.summaryRow}>
        <Text style={styles.label}>Puntaje total</Text>
        <Text style={styles.summaryValue}>{typeof totalScore === 'number' ? totalScore : '—'}</Text>
      </View>
      {bradenErrors?.totalScore?.message ? (
        <Text style={styles.error}>{bradenErrors.totalScore.message as string}</Text>
      ) : null}

      <View style={styles.summaryRow}>
        <Text style={styles.label}>Riesgo</Text>
        <Text style={styles.summaryValue}>{riskLabelText}</Text>
      </View>
      {bradenErrors?.riskLevel?.message ? (
        <Text style={styles.error}>{bradenErrors.riskLevel.message as string}</Text>
      ) : null}

      <Text style={styles.sectionSubtitle}>Glasgow – Estado neurológico</Text>
      <GlasgowField
        label="Apertura ocular"
        name="glasgow.eye"
        options={glasgowOptions['glasgow.eye']}
        error={eyeError}
      />
      <GlasgowField
        label="Respuesta verbal"
        name="glasgow.verbal"
        options={glasgowOptions['glasgow.verbal']}
        error={verbalError}
      />
      <GlasgowField
        label="Respuesta motora"
        name="glasgow.motor"
        options={glasgowOptions['glasgow.motor']}
        error={motorError}
      />

      <View style={styles.summaryRow}>
        <Text style={styles.label}>Puntaje total</Text>
        <Text style={styles.summaryValue}>{typeof glasgowTotal === 'number' ? glasgowTotal : '—'}</Text>
      </View>
      {glasgowErrors?.total?.message ? (
        <Text style={styles.error}>{glasgowErrors.total.message as string}</Text>
      ) : null}

      <View style={styles.summaryRow}>
        <Text style={styles.label}>Severidad</Text>
        <Text style={styles.summaryValue}>{glasgowSeverityLabel}</Text>
      </View>
      {glasgowErrors?.severity?.message ? (
        <Text style={styles.error}>{glasgowErrors.severity.message as string}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionSubtitle: { fontSize: 16, fontWeight: '600', marginBottom: 12 },
  field: { marginBottom: 16 },
  label: { fontSize: 16, fontWeight: '500', marginBottom: 6 },
  input: {
    borderColor: '#CBD5F5',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  textArea: { height: 120, textAlignVertical: 'top' },
  error: { color: '#DC2626', marginTop: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  disabledInput: { backgroundColor: '#F3F4F6' },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  optionButton: {
    borderColor: '#CBD5F5',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginHorizontal: 4,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  optionButtonSelected: { backgroundColor: '#1D4ED8', borderColor: '#1D4ED8' },
  optionText: { fontSize: 14, color: '#111827' },
  optionTextSelected: { color: '#fff', fontWeight: '600' },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryValue: { fontSize: 16, fontWeight: '600' },
});
