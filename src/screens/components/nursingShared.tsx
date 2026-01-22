import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { type DietType, type MobilityLevel, type StoolPattern } from '@/src/types/handover';

type Option<TValue extends string> = { label: string; value: TValue };

type PickerFieldProps<TValue extends string> = {
  label: string;
  value?: TValue;
  options: Array<Option<TValue>>;
  onValueChange: (value: TValue) => void;
  placeholder?: string;
  error?: string;
};

export function PickerField<TValue extends string>({
  label,
  value,
  options,
  onValueChange,
  placeholder,
  error,
}: PickerFieldProps<TValue>) {
  const [visible, setVisible] = useState(false);
  const selectedLabel = useMemo(() => options.find((opt) => opt.value === value)?.label, [options, value]);

  return (
    <View style={nursingStyles.field}>
      <Text style={nursingStyles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        style={nursingStyles.picker}
        onPress={() => setVisible(true)}
      >
        <Text style={nursingStyles.pickerText}>{selectedLabel ?? placeholder ?? 'Seleccionar'}</Text>
      </Pressable>
      {error ? <Text style={nursingStyles.error}>{error}</Text> : null}
      <Modal transparent animationType="fade" visible={visible} onRequestClose={() => setVisible(false)}>
        <Pressable style={nursingStyles.modalBackdrop} onPress={() => setVisible(false)}>
          <View style={nursingStyles.modalContent}>
            {options.map((option) => (
              <Pressable
                key={option.value}
                style={nursingStyles.modalOption}
                onPress={() => {
                  onValueChange(option.value);
                  setVisible(false);
                }}
              >
                <Text style={nursingStyles.modalOptionText}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export const dietTypeOptions: Array<Option<DietType>> = [
  { label: 'Oral', value: 'oral' },
  { label: 'Enteral', value: 'enteral' },
  { label: 'Parenteral', value: 'parenteral' },
  { label: 'Ayunas (NPO)', value: 'npo' },
  { label: 'Otra', value: 'other' },
];

export const stoolPatternOptions: Array<Option<StoolPattern>> = [
  { label: 'Normal', value: 'normal' },
  { label: 'Diarrea', value: 'diarrhea' },
  { label: 'Constipación', value: 'constipation' },
  { label: 'Sin deposición', value: 'no_stool' },
];

export const mobilityOptions: Array<Option<MobilityLevel>> = [
  { label: 'Independiente', value: 'independent' },
  { label: 'Con ayuda', value: 'assisted' },
  { label: 'Encamado', value: 'bedbound' },
];

export const nursingStyles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 16, fontWeight: '500', marginBottom: 4 },
  textArea: { height: 120, textAlignVertical: 'top' },
  input: {
    borderColor: '#CBD5F5',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  error: { color: '#DC2626', marginTop: 4 },
  picker: {
    borderColor: '#CBD5F5',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  pickerText: { fontSize: 16 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    width: '100%',
    maxWidth: 360,
    paddingVertical: 8,
  },
  modalOption: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomColor: '#E5E7EB',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalOptionText: { fontSize: 16 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  flex: { flex: 1 },
  spacer: { width: 12 },
  readOnlyInput: { backgroundColor: '#F3F4F6', color: '#111827' },
});
