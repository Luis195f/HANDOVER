import React from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { BedsideChecklistItem } from '@/src/config/bedsideChecklist';
import type { HandoverValues } from '@/src/validation/schemas';
import { isBedsideChecklistComplete } from './bedsideChecklist.constants';

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
  const checklistErrors = (errors as any)?.bedsideChecklist;
  const checklist = watch('bedsideChecklist');
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
          {value ? (
            <Text style={styles.timestamp}>
              {(() => {
                const timestamp = formatChecklistTimestamp(
                  checklist?.[`${item.key}_timestamp`],
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
  error: { color: '#DC2626', marginTop: 6 },
  missingLabel: { color: '#DC2626', fontWeight: '600' },
});
