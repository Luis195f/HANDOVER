import React from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { BedsideChecklistItem } from '@/src/config/bedsideChecklist';
import type { HandoverValues } from '@/src/validation/schemas';
import { isBedsideChecklistComplete } from '@/src/lib/bedsideChecklist';

function LineArrayField({
  label,
  name,
  placeholder,
  helper,
}: {
  label: string;
  name:
    | 'contingencyPlan.watchItems'
    | 'contingencyPlan.immediateActions'
    | 'contingencyPlan.escalationCriteria';
  placeholder: string;
  helper?: string;
}) {
  const { control } = useFormContext<HandoverValues>();

  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, onBlur, value } }) => (
        <View style={styles.field}>
          <Text style={styles.label}>{label}</Text>
          <TextInput
            accessibilityLabel={label}
            style={[styles.input, styles.textArea]}
            multiline
            onBlur={onBlur}
            value={Array.isArray(value) ? value.join('\n') : ''}
            onChangeText={(text) =>
              onChange(
                text
                  .split('\n')
                  .map((item) => item.trim())
                  .filter(Boolean),
              )
            }
            placeholder={placeholder}
          />
          {helper ? <Text style={styles.helper}>{helper}</Text> : null}
        </View>
      )}
    />
  );
}

// BEGIN HANDOVER D1 – BedsideChecklist
export function BedsideChecklistSection({
  items,
  highlightMissing = false,
}: { items: BedsideChecklistItem[]; highlightMissing?: boolean }) {
  const {
    control,
    watch,
    formState: { errors, submitCount },
  } = useFormContext<HandoverValues>();
  const checklistErrors = errors.bedsideChecklist;
  const checklist = watch('bedsideChecklist');
  const checklistMetadata = checklist as Record<string, boolean | string | undefined> | undefined;
  const checklistMessage =
    typeof checklistErrors?.message === 'string'
      ? checklistErrors.message
      : submitCount > 0 && !isBedsideChecklistComplete(checklist, items)
        ? 'Completa el checklist de cabecera de cama antes de cerrar el pase de turno.'
        : undefined;

  const formatChecklistTimestamp = (timestamp?: string | boolean) => {
    if (!timestamp || typeof timestamp !== 'string') return null;
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderSwitch = (item: BedsideChecklistItem) => (
    <Controller
      key={item.key}
      control={control}
      name={`bedsideChecklist.${item.key}` as const}
      defaultValue={false}
      render={({ field: { onChange, value } }) => (
        <View style={styles.switchBlock}>
          <View style={styles.switchRow}>
            <Text
              style={[
                styles.switchLabel,
                highlightMissing && !value ? styles.missingLabel : null,
              ]}
            >
              {item.label}
            </Text>
            <Switch
              accessibilityLabel={item.label}
              value={Boolean(value)}
              onValueChange={(next) => onChange(Boolean(next))}
            />
          </View>
          {item.helper ? <Text style={styles.helper}>{item.helper}</Text> : null}
          {value ? (
            <Text style={styles.timestamp}>
              {(() => {
                const timestamp = formatChecklistTimestamp(
                  checklistMetadata?.[`${item.key}_timestamp`],
                );
                return timestamp ? `Marcado ${timestamp}` : 'Marcado';
              })()}
            </Text>
          ) : null}
        </View>
      )}
    />
  );

  return (
    <View>
      <Text style={styles.sectionTitle}>Checklist de cabecera de cama</Text>
      {items.map((item) => renderSwitch(item))}

      <Controller
        control={control}
        name="bedsideChecklist.bedsideNotes"
        defaultValue=""
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

      <Text style={styles.subsectionTitle}>Plan inmediato y contingencias</Text>
      <LineArrayField
        label="Qué vigilar"
        name="contingencyPlan.watchItems"
        placeholder="Una señal por línea"
        helper="Registra solo señales que cambian la conducta del turno."
      />
      <LineArrayField
        label="Qué hacer primero"
        name="contingencyPlan.immediateActions"
        placeholder="Una acción por línea"
      />
      <LineArrayField
        label="Criterios de escalado"
        name="contingencyPlan.escalationCriteria"
        placeholder="Un criterio por línea"
      />

      <Controller
        control={control}
        name="contingencyPlan.escalationContact"
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={styles.field}>
            <Text style={styles.label}>A quién avisar</Text>
            <TextInput
              accessibilityLabel="Contacto de escalado"
              style={styles.input}
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
              placeholder="Ej: médico de guardia / supervisor"
            />
          </View>
        )}
      />

      <Controller
        control={control}
        name="contingencyPlan.fallbackPlan"
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Plan de contingencia</Text>
            <TextInput
              accessibilityLabel="Plan de contingencia"
              style={[styles.input, styles.textArea]}
              multiline
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
              placeholder="Qué hacer si la evolución cambia o el recurso no está disponible"
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
  subsectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 16, marginBottom: 10 },
  switchBlock: { marginBottom: 12 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  switchLabel: { flex: 1, fontSize: 16, marginRight: 12 },
  timestamp: { color: '#4B5563', fontSize: 12, marginTop: 4 },
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
  helper: { color: '#6B7280', marginTop: 6, fontSize: 12 },
  error: { color: '#DC2626', marginTop: 6 },
  missingLabel: { color: '#DC2626', fontWeight: '600' },
});

