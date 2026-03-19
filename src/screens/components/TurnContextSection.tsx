import React, { useMemo, useState } from 'react';
import { Controller, useFieldArray, useFormContext } from 'react-hook-form';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { TurnContext } from '@/src/types/handover';
import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';

type TurnContextIncident = NonNullable<TurnContext['serviceIncidents']>[number];
type ShiftPhase = NonNullable<TurnContext['shiftPhase']>;
type Workload = NonNullable<TurnContext['workload']>;

type Option<TValue extends string> = {
  label: string;
  value: TValue;
};

const SHIFT_PHASE_OPTIONS: Array<Option<ShiftPhase>> = [
  { label: 'Inicio', value: 'start' },
  { label: 'Mitad', value: 'mid' },
  { label: 'Cierre', value: 'closing' },
  { label: 'Cobertura', value: 'coverage' },
];

const WORKLOAD_OPTIONS: Array<Option<Workload>> = [
  { label: 'Estable', value: 'stable' },
  { label: 'Alta demanda', value: 'high' },
  { label: 'Saturado', value: 'saturated' },
  { label: 'Contingencia', value: 'contingency' },
];

const INCIDENT_KIND_OPTIONS: Array<Option<TurnContextIncident['kind']>> = [
  { label: 'Ingreso', value: 'admission' },
  { label: 'Traslado', value: 'transfer' },
  { label: 'Dotación', value: 'staffing' },
  { label: 'Insumos', value: 'supply' },
  { label: 'Sistema', value: 'system' },
  { label: 'Otro', value: 'other' },
];

const INCIDENT_SEVERITY_OPTIONS: Array<Option<TurnContextIncident['severity']>> = [
  { label: 'Baja', value: 'low' },
  { label: 'Moderada', value: 'moderate' },
  { label: 'Alta', value: 'high' },
];

const createIncidentDraft = (): TurnContextIncident => ({
  kind: 'other',
  severity: 'moderate',
  description: '',
  resolved: false,
});

function SegmentedField<TValue extends string>({
  label,
  name,
  options,
}: {
  label: string;
  name: 'turnContext.shiftPhase' | 'turnContext.workload';
  options: Array<Option<TValue>>;
}) {
  const { control } = useFormContext<HandoverFormValues>();

  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value } }) => (
        <View style={styles.field}>
          <Text style={styles.label}>{label}</Text>
          <View style={styles.segmentedRow}>
            {options.map((option) => {
              const isActive = value === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityLabel={`${label} ${option.label}`}
                  style={[styles.chip, isActive ? styles.chipActive : null]}
                  onPress={() => onChange(option.value)}
                >
                  <Text style={[styles.chipText, isActive ? styles.chipTextActive : null]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    />
  );
}

export function TurnContextSection() {
  const { control } = useFormContext<HandoverFormValues>();
  const { fields, append, remove } = useFieldArray<HandoverFormValues, 'turnContext.serviceIncidents'>({
    control,
    name: 'turnContext.serviceIncidents',
  });
  const [draft, setDraft] = useState<TurnContextIncident>(createIncidentDraft);
  const canAddIncident = useMemo(() => draft.description.trim().length > 0, [draft.description]);

  const handleAddIncident = () => {
    if (!canAddIncident) return;
    append({ ...draft, description: draft.description.trim() });
    setDraft(createIncidentDraft());
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Contexto operativo del turno</Text>

      <SegmentedField label="Franja operativa" name="turnContext.shiftPhase" options={SHIFT_PHASE_OPTIONS} />
      <SegmentedField label="Carga del turno" name="turnContext.workload" options={WORKLOAD_OPTIONS} />

      <Controller
        control={control}
        name="turnContext.operationalSummary"
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Resumen operativo</Text>
            <TextInput
              accessibilityLabel="Resumen operativo del turno"
              style={[styles.input, styles.textArea]}
              multiline
              placeholder="Ej: relevo con dos ingresos recientes y alta presión asistencial"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
            />
          </View>
        )}
      />

      <View style={styles.card}>
        <Text style={styles.subsectionTitle}>Incidencias de servicio</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Tipo</Text>
          <View style={styles.segmentedRow}>
            {INCIDENT_KIND_OPTIONS.map((option) => {
              const isActive = draft.kind === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityLabel={`Tipo incidencia ${option.label}`}
                  style={[styles.chip, isActive ? styles.chipActive : null]}
                  onPress={() => setDraft((current) => ({ ...current, kind: option.value }))}
                >
                  <Text style={[styles.chipText, isActive ? styles.chipTextActive : null]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Severidad</Text>
          <View style={styles.segmentedRow}>
            {INCIDENT_SEVERITY_OPTIONS.map((option) => {
              const isActive = draft.severity === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityLabel={`Severidad incidencia ${option.label}`}
                  style={[styles.chip, isActive ? styles.chipActive : null]}
                  onPress={() => setDraft((current) => ({ ...current, severity: option.value }))}
                >
                  <Text style={[styles.chipText, isActive ? styles.chipTextActive : null]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Detalle</Text>
          <TextInput
            accessibilityLabel="Detalle de incidencia de servicio"
            style={styles.input}
            placeholder="Ej: falta cobertura de TCAE en sector B"
            value={draft.description}
            onChangeText={(text) => setDraft((current) => ({ ...current, description: text }))}
          />
        </View>

        <View style={[styles.field, styles.switchRow]}>
          <Text style={styles.label}>Resuelta en este turno</Text>
          <Switch
            accessibilityLabel="Incidencia resuelta"
            value={draft.resolved}
            onValueChange={(value) => setDraft((current) => ({ ...current, resolved: value }))}
          />
        </View>

        <Pressable
          accessibilityLabel="Añadir incidencia de servicio"
          accessibilityState={{ disabled: !canAddIncident }}
          style={[styles.addButton, !canAddIncident ? styles.addButtonDisabled : null]}
          onPress={handleAddIncident}
        >
          <Text style={styles.addButtonText}>Añadir incidencia</Text>
        </Pressable>

        {fields.length > 0 ? (
          <View style={styles.list}>
            {fields.map((field, index) => (
              <View key={field.id} style={styles.listItem}>
                <View style={styles.listHeader}>
                  <Text style={styles.listTitle}>{field.description}</Text>
                  <Pressable
                    accessibilityLabel={`Eliminar incidencia ${field.description}`}
                    onPress={() => remove(index)}
                  >
                    <Text style={styles.deleteButtonText}>Eliminar</Text>
                  </Pressable>
                </View>
                <View style={styles.badgeRow}>
                  <Text style={styles.badge}>{INCIDENT_KIND_OPTIONS.find((option) => option.value === field.kind)?.label ?? field.kind}</Text>
                  <Text style={styles.badge}>{INCIDENT_SEVERITY_OPTIONS.find((option) => option.value === field.severity)?.label ?? field.severity}</Text>
                  <Text style={styles.badge}>{field.resolved ? 'Resuelta' : 'Abierta'}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default TurnContextSection;

const styles = StyleSheet.create({
  container: { gap: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600' },
  subsectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  card: {
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
    gap: 12,
  },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600' },
  input: {
    borderColor: '#CBD5E1',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  segmentedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  chipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#1D4ED8',
  },
  chipText: { color: '#111827', fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  addButtonDisabled: { opacity: 0.5 },
  addButtonText: { color: '#fff', fontWeight: '700' },
  list: { gap: 10 },
  listItem: {
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#fff',
  },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  listTitle: { flex: 1, fontWeight: '700' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  badge: {
    backgroundColor: '#EEF2FF',
    color: '#312E81',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '700',
  },
  deleteButtonText: { color: '#DC2626', fontWeight: '700' },
});

