import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Controller, useFormContext, useWatch } from 'react-hook-form';

import type { HandoverValues } from '@/src/validation/schemas';

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

export default function ClinicalScalesSection() {
  const { control, formState } = useFormContext<HandoverValues>();
  const { hasPain } = usePainAssessmentState();
  const errors = formState.errors ?? {};
  const painErrors = errors.painAssessment ?? {};
  const evaScoreError = painErrors?.evaScore?.message as string | undefined;
  const locationError = painErrors?.location?.message as string | undefined;
  const actionsError = painErrors?.actionsTaken?.message as string | undefined;

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
});
