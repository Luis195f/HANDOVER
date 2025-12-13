import React from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { HandoverValues } from '@/src/validation/schemas';

// BEGIN HANDOVER D1 – BedsideChecklist
export function BedsideChecklistSection({
  highlightMissing = false,
}: { highlightMissing?: boolean } = {}) {
  const {
    control,
    formState: { errors },
  } = useFormContext<HandoverValues>();
  const checklistErrors = (errors as any)?.bedsideChecklist;
  const checklistMessage = typeof checklistErrors?.message === 'string' ? checklistErrors.message : undefined;

  const renderSwitch = (
    name: keyof HandoverValues['bedsideChecklist'],
    label: string,
  ) => (
    <Controller
      key={name}
      control={control}
      name={`bedsideChecklist.${name}` as const}
      render={({ field: { onChange, value } }) => (
        <View style={styles.switchRow}>
          <Text
            style={[
              styles.switchLabel,
              highlightMissing && !value ? styles.missingLabel : null,
            ]}
          >
            {label}
          </Text>
          <Switch
            accessibilityLabel={label}
            value={Boolean(value)}
            onValueChange={(next) => onChange(Boolean(next))}
          />
        </View>
      )}
    />
  );

  return (
    <View>
      <Text style={styles.sectionTitle}>Checklist de cabecera de cama</Text>
      {renderSwitch('patientIdentityConfirmed', 'Paciente identificado (nombre + pulsera)')}
      {renderSwitch('allergiesReviewed', 'Alergias y alertas revisadas')}
      {renderSwitch('linesAndDevicesChecked', 'Líneas, catéteres y dispositivos verificados')}
      {renderSwitch('medicationPlanReviewed', 'Plan de medicación y tratamientos verificado')}
      {renderSwitch('safetyMeasuresApplied', 'Medidas de seguridad aplicadas (barandillas, cama baja, etc.)')}
      {renderSwitch('questionsAnswered', 'Preguntas del equipo entrante resueltas')}

      <Controller
        control={control}
        name="bedsideChecklist.bedsideNotes"
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Notas de cabecera de cama (opcional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              multiline
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
              placeholder="Observaciones breves"
            />
          </View>
        )}
      />

      {checklistMessage ? <Text style={styles.error}>{checklistMessage}</Text> : null}
      {checklistErrors?.bedsideNotes?.message ? (
        <Text style={styles.error}>{checklistErrors.bedsideNotes.message as string}</Text>
      ) : null}
    </View>
  );
}
// END HANDOVER D1 – BedsideChecklist

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  switchLabel: { flex: 1, fontSize: 16, marginRight: 12 },
  field: { marginTop: 8 },
  label: { fontSize: 16, fontWeight: '500', marginBottom: 6 },
  input: {
    borderColor: '#CBD5F5',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  textArea: { height: 120, textAlignVertical: 'top' },
  error: { color: '#DC2626', marginTop: 6 },
  missingLabel: { color: '#DC2626', fontWeight: '600' },
});
