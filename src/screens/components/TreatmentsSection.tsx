import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Controller, useFieldArray, useFormContext, useWatch, type Control } from 'react-hook-form';
import { v4 as uuid } from 'uuid';

import type { TreatmentItem } from '@/src/types/handover';
import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';

const TREATMENT_LABELS: Record<TreatmentItem['type'], string> = {
  woundCare: 'Curación de heridas',
  respiratory: 'Respiratorio',
  mobilization: 'Movilización',
  education: 'Educación',
  other: 'Otro',
};

const treatmentOptions = Object.entries(TREATMENT_LABELS).map(([value, label]) => ({ value, label })) as Array<{
  value: TreatmentItem['type'];
  label: string;
}>;

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  card: {
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  cardMeta: { color: '#4B5563', marginTop: 6 },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  button: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  secondaryButton: {
    backgroundColor: '#E5E7EB',
  },
  secondaryButtonText: { color: '#111827', fontWeight: '600' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  field: { marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6 },
  input: {
    borderColor: '#CBD5E1',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  select: {
    borderColor: '#CBD5E1',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  selectText: { color: '#111827' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});

type Props = {
  control: Control<HandoverFormValues>;
  name?: 'treatments';
};

type EditingState = { index: number; isNew?: boolean } | null;

type TreatmentField = keyof Pick<TreatmentItem, 'description' | 'scheduledAt' | 'type'>;

export function TreatmentsSection({ control, name = 'treatments' }: Props) {
  const { trigger, formState } = useFormContext<HandoverFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name });
  const treatments = useWatch({ control, name }) as TreatmentItem[] | undefined;
  const [editing, setEditing] = useState<EditingState>(null);
  const errorBag = (formState.errors as any)?.[name] ?? [];

  const openEditor = (index: number) => setEditing({ index });
  const handleAdd = () => {
    const nextIndex = fields.length;
    append({ id: uuid(), type: 'other', description: '', done: false });
    setEditing({ index: nextIndex, isNew: true });
  };

  const handleCancel = () => {
    if (editing?.isNew) remove(editing.index);
    setEditing(null);
  };

  const handleSave = async () => {
    if (editing == null) return;
    const basePath = `${name}.${editing.index}` as const;
    const ok = await trigger([`${basePath}.description`, `${basePath}.type`]);
    if (!ok) return;
    setEditing(null);
  };

  const getErrorForField = (index: number, field: TreatmentField) => {
    const fieldErrors = errorBag?.[index];
    if (!fieldErrors) return undefined;
    const maybeError = (fieldErrors as any)?.[field]?.message;
    return typeof maybeError === 'string' ? maybeError : undefined;
  };

  const renderModal = () => {
    if (editing == null) return null;
    const index = editing.index;
    return (
      <Modal transparent animationType="fade" visible onRequestClose={handleCancel}>
        <Pressable style={styles.modalBackdrop} onPress={handleCancel}>
          <Pressable style={styles.modalContent} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.sectionTitle}>Tratamiento no farmacológico</Text>
            <Controller
              control={control}
              name={`${name}.${index}.type` as const}
              render={({ field: { onChange, value } }) => (
                <View style={styles.field}>
                  <Text style={styles.label}>Tipo</Text>
                  <Pressable style={styles.select}>
                    <Text style={styles.selectText}>
                      {treatmentOptions.find((opt) => opt.value === value)?.label ?? 'Seleccionar'}
                    </Text>
                  </Pressable>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {treatmentOptions.map((option) => (
                      <Pressable
                        key={option.value}
                        style={[styles.button, value === option.value ? null : styles.secondaryButton]}
                        onPress={() => onChange(option.value)}
                      >
                        <Text
                          style={value === option.value ? styles.buttonText : styles.secondaryButtonText}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {getErrorForField(index, 'type') ? (
                    <Text style={styles.cardMeta}>{getErrorForField(index, 'type')}</Text>
                  ) : null}
                </View>
              )}
            />
            <Controller
              control={control}
              name={`${name}.${index}.description` as const}
              render={({ field: { onChange, onBlur, value } }) => (
                <View style={styles.field}>
                  <Text style={styles.label}>Descripción</Text>
                  <TextInput
                    style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]}
                    multiline
                    placeholder="Ej: Cura de úlcera sacra"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value ?? ''}
                  />
                  {getErrorForField(index, 'description') ? (
                    <Text style={styles.cardMeta}>{getErrorForField(index, 'description')}</Text>
                  ) : null}
                </View>
              )}
            />
            <Controller
              control={control}
              name={`${name}.${index}.scheduledAt` as const}
              render={({ field: { onChange, onBlur, value } }) => (
                <View style={styles.field}>
                  <Text style={styles.label}>Programado para</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="2024-05-01T10:00"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value ?? ''}
                  />
                </View>
              )}
            />
            <Controller
              control={control}
              name={`${name}.${index}.done` as const}
              render={({ field: { value, onChange } }) => (
                <View style={[styles.field, styles.switchRow]}>
                  <Text style={styles.label}>Completado</Text>
                  <Switch value={!!value} onValueChange={onChange} />
                </View>
              )}
            />
            <View style={styles.buttonRow}>
              <Pressable style={[styles.button, styles.secondaryButton]} onPress={handleCancel}>
                <Text style={styles.secondaryButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={handleSave}>
                <Text style={styles.buttonText}>Guardar</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  };

  const renderTreatment = (treatment: TreatmentItem, index: number) => (
    <View key={treatment.id} style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{TREATMENT_LABELS[treatment.type]}</Text>
      </View>
      <Text style={styles.cardMeta}>{treatment.description}</Text>
      {treatment.scheduledAt ? (
        <Text style={styles.cardMeta}>Programado: {treatment.scheduledAt}</Text>
      ) : null}
      <Text style={styles.cardMeta}>Estado: {treatment.done ? 'Completado' : 'En progreso'}</Text>
      <View style={styles.buttonRow}>
        <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => openEditor(index)}>
          <Text style={styles.secondaryButtonText}>Editar</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={() => remove(index)}>
          <Text style={styles.buttonText}>Eliminar</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View>
      <Text style={styles.sectionTitle}>Tratamientos no farmacológicos</Text>
      {treatments?.map(renderTreatment)}
      <Pressable style={styles.button} onPress={handleAdd} accessibilityRole="button">
        <Text style={styles.buttonText}>Añadir tratamiento no farmacológico</Text>
      </Pressable>
      {renderModal()}
    </View>
  );
}

export default TreatmentsSection;
