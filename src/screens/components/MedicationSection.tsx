import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Controller, useFieldArray, useFormContext, useWatch, type Control } from 'react-hook-form';
import { v4 as uuid } from 'uuid';

import { MEDICATIONS_QUICKPICK_ICU } from '@/src/lib/codes';
import type { MedicationItem } from '@/src/types/handover';
import { zMedicationRoute, type HandoverValues as HandoverFormValues } from '@/src/validation/schemas';

const routeOptions = zMedicationRoute.options.map((value) => ({
  label:
    value === 'iv'
      ? 'Intravenosa'
      : value === 'im'
        ? 'Intramuscular'
        : value === 'sc'
          ? 'Subcutánea'
          : value === 'inhaled'
            ? 'Inhalada'
            : value === 'topical'
              ? 'Tópica'
              : value === 'oral'
                ? 'Oral'
                : 'Otra',
  value,
}));

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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
  },
  chipText: { color: '#312E81', fontWeight: '600' },
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
    maxHeight: '80%',
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
  textArea: { height: 96, textAlignVertical: 'top' },
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
  helper: { color: '#4B5563', marginBottom: 8 },
  warning: { color: '#92400E', backgroundColor: '#FFFBEB', padding: 10, borderRadius: 8, marginBottom: 12 },
  quickPickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  quickPickChip: {
    backgroundColor: '#ECFEFF',
    borderColor: '#06B6D4',
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  quickPickText: { color: '#0E7490', fontWeight: '600' },
});

type Props = {
  control: Control<HandoverFormValues>;
  name?: 'medications';
};

type EditingState = { index: number; isNew?: boolean } | null;

type MedicationSectionFormField = keyof Pick<MedicationItem, 'name' | 'dose' | 'route' | 'frequency' | 'isContinuous' | 'isHighAlert' | 'notes'>;

export function MedicationSection({ control, name = 'medications' }: Props) {
  const { setValue, trigger, formState } = useFormContext<HandoverFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name });
  const medications = useWatch({ control, name }) as MedicationItem[] | undefined;
  const medsText = useWatch({ control, name: 'meds' }) as string | undefined;
  const [editing, setEditing] = useState<EditingState>(null);
  const errorBag = (formState.errors as any)?.[name] ?? [];

  const openEditor = (index: number) => setEditing({ index });

  const handleAdd = () => {
    const nextIndex = fields.length;
    append({
      id: uuid(),
      name: '',
      dose: '',
      route: undefined,
      frequency: '',
      isContinuous: false,
      isHighAlert: false,
      notes: '',
    });
    setEditing({ index: nextIndex, isNew: true });
  };

  const handleCancel = () => {
    if (editing?.isNew) {
      remove(editing.index);
    }
    setEditing(null);
  };

  const handleSave = async () => {
    if (editing == null) return;
    const basePath = `${name}.${editing.index}` as const;
    const ok = await trigger([`${basePath}.name`]);
    if (!ok) return;
    setEditing(null);
  };

  const getErrorForField = (index: number, field: MedicationSectionFormField): string | undefined => {
    const fieldErrors = errorBag?.[index];
    if (!fieldErrors) return undefined;
    const maybeError = (fieldErrors as any)?.[field]?.message;
    return typeof maybeError === 'string' ? maybeError : undefined;
  };

  const quickPickApply = (index: number, itemId: string) => {
    const selected = MEDICATIONS_QUICKPICK_ICU.find((item) => item.id === itemId);
    if (!selected) return;
    setValue(`${name}.${index}.name`, selected.name, { shouldDirty: true, shouldValidate: true });
    if (selected.code) {
      setValue(`${name}.${index}.code`, selected.code as any, { shouldDirty: true, shouldValidate: true });
    }
  };

  const renderModal = () => {
    if (editing == null) return null;
    const index = editing.index;
    return (
      <Modal transparent animationType="fade" visible onRequestClose={handleCancel}>
        <Pressable style={styles.modalBackdrop} onPress={handleCancel}>
          <Pressable style={styles.modalContent} onPress={(event) => event.stopPropagation()}>
            <ScrollView>
              <Text style={styles.sectionTitle}>Medicamento</Text>
              <View style={styles.quickPickRow}>
                {MEDICATIONS_QUICKPICK_ICU.map((item) => (
                  <Pressable
                    key={item.id}
                    style={styles.quickPickChip}
                    onPress={() => quickPickApply(index, item.id)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.quickPickText}>{item.name}</Text>
                  </Pressable>
                ))}
              </View>
              <Controller
                control={control}
                name={`${name}.${index}.name` as const}
                render={({ field: { onChange, onBlur, value } }) => (
                  <View style={styles.field}>
                    <Text style={styles.label}>Nombre</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Paracetamol"
                      onBlur={onBlur}
                      onChangeText={onChange}
                      value={value ?? ''}
                    />
                    {getErrorForField(index, 'name') ? (
                      <Text style={styles.helper}>{getErrorForField(index, 'name')}</Text>
                    ) : null}
                  </View>
                )}
              />
              <Controller
                control={control}
                name={`${name}.${index}.route` as const}
                render={({ field: { value, onChange } }) => (
                  <View style={styles.field}>
                    <Text style={styles.label}>Vía</Text>
                    <Pressable style={styles.select} onPress={() => onChange(value ?? undefined)}>
                      <Text style={styles.selectText}>
                        {routeOptions.find((opt) => opt.value === value)?.label ?? 'Seleccionar'}
                      </Text>
                    </Pressable>
                    <View style={styles.chipRow}>
                      {routeOptions.map((option) => (
                        <Pressable
                          key={option.value}
                          style={[styles.chip, value === option.value ? { backgroundColor: '#C7D2FE' } : null]}
                          onPress={() => onChange(option.value)}
                        >
                          <Text style={styles.chipText}>{option.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}
              />
              <Controller
                control={control}
                name={`${name}.${index}.dose` as const}
                render={({ field: { onChange, onBlur, value } }) => (
                  <View style={styles.field}>
                    <Text style={styles.label}>Dosis</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="1 g"
                      onBlur={onBlur}
                      value={value ?? ''}
                      onChangeText={onChange}
                    />
                  </View>
                )}
              />
              <Controller
                control={control}
                name={`${name}.${index}.frequency` as const}
                render={({ field: { onChange, onBlur, value } }) => (
                  <View style={styles.field}>
                    <Text style={styles.label}>Frecuencia</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="cada 8h"
                      onBlur={onBlur}
                      value={value ?? ''}
                      onChangeText={onChange}
                    />
                  </View>
                )}
              />
              <Controller
                control={control}
                name={`${name}.${index}.notes` as const}
                render={({ field: { onChange, onBlur, value } }) => (
                  <View style={styles.field}>
                    <Text style={styles.label}>Notas</Text>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      multiline
                      placeholder="Indicaciones adicionales"
                      onBlur={onBlur}
                      value={value ?? ''}
                      onChangeText={onChange}
                    />
                  </View>
                )}
              />
              <Controller
                control={control}
                name={`${name}.${index}.isContinuous` as const}
                render={({ field: { value, onChange } }) => (
                  <View style={[styles.field, styles.switchRow]}>
                    <Text style={styles.label}>Infusión continua</Text>
                    <Switch value={!!value} onValueChange={onChange} />
                  </View>
                )}
              />
              <Controller
                control={control}
                name={`${name}.${index}.isHighAlert` as const}
                render={({ field: { value, onChange } }) => (
                  <View style={[styles.field, styles.switchRow]}>
                    <Text style={styles.label}>Medicamento de alto riesgo</Text>
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
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    );
  };

  const renderBadge = (label: string) => (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );

  const renderMedication = (medication: MedicationItem, index: number) => {
    const details = [medication.dose, medication.route ? routeOptions.find((r) => r.value === medication.route)?.label : null, medication.frequency]
      .filter(Boolean)
      .join(' · ');

    return (
      <View key={medication.id} style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{medication.name}</Text>
        </View>
        {details ? <Text style={styles.cardMeta}>{details}</Text> : null}
        {medication.notes ? <Text style={styles.cardMeta}>{medication.notes}</Text> : null}
        <View style={styles.chipRow}>
          {medication.isContinuous ? renderBadge('Infusión continua') : null}
          {medication.isHighAlert ? renderBadge('Alto riesgo') : null}
        </View>
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
  };

  const hasLegacyText = useMemo(
    () => typeof medsText === 'string' && medsText.trim().length > 0,
    [medsText],
  );

  const hasStructured = (medications?.length ?? 0) > 0;

  return (
    <View>
      <Text style={styles.sectionTitle}>Medicaciones</Text>
      {hasLegacyText && !hasStructured ? (
        <Text style={styles.warning}>
          Hay texto libre de medicación previa. Puedes usarlo como referencia para transcribir a la lista
          estructurada.
        </Text>
      ) : null}

      {medications?.map(renderMedication)}

      <Pressable style={styles.button} onPress={handleAdd} accessibilityRole="button">
        <Text style={styles.buttonText}>Añadir medicación</Text>
      </Pressable>
      {renderModal()}
    </View>
  );
}

export default MedicationSection;
