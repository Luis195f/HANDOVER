import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Controller, type Control, type FieldErrors } from 'react-hook-form';

import { type DietType, type MobilityLevel, type StoolPattern } from '@/src/types/handover';
import type { HandoverValues } from '@/src/validation/schemas';

type HandoverFormControl = Control<HandoverValues>;
type HandoverFormErrors = FieldErrors<HandoverValues>;

type Option<TValue extends string> = { label: string; value: TValue };

type PickerFieldProps<TValue extends string> = {
  label: string;
  value?: TValue;
  options: Array<Option<TValue>>;
  onValueChange: (value: TValue) => void;
  placeholder?: string;
  error?: string;
};

function PickerField<TValue extends string>({
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
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        style={styles.picker}
        onPress={() => setVisible(true)}
      >
        <Text style={styles.pickerText}>{selectedLabel ?? placeholder ?? 'Seleccionar'}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Modal transparent animationType="fade" visible={visible} onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setVisible(false)}>
          <View style={styles.modalContent}>
            {options.map((option) => (
              <Pressable
                key={option.value}
                style={styles.modalOption}
                onPress={() => {
                  onValueChange(option.value);
                  setVisible(false);
                }}
              >
                <Text style={styles.modalOptionText}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

type Props = {
  control: HandoverFormControl;
  errors: HandoverFormErrors;
  parseNumber: (value: string) => number | undefined;
};

const dietTypeOptions: Array<Option<DietType>> = [
  { label: 'Oral', value: 'oral' },
  { label: 'Enteral', value: 'enteral' },
  { label: 'Parenteral', value: 'parenteral' },
  { label: 'Ayunas (NPO)', value: 'npo' },
  { label: 'Otra', value: 'other' },
];

const stoolPatternOptions: Array<Option<StoolPattern>> = [
  { label: 'Normal', value: 'normal' },
  { label: 'Diarrea', value: 'diarrhea' },
  { label: 'Constipación', value: 'constipation' },
  { label: 'Sin deposición', value: 'no_stool' },
];

const mobilityOptions: Array<Option<MobilityLevel>> = [
  { label: 'Independiente', value: 'independent' },
  { label: 'Con ayuda', value: 'assisted' },
  { label: 'Encamado', value: 'bedbound' },
];

export function SpecificCareSection({ control, errors, parseNumber }: Props) {
  const nutritionErrors = errors.nutrition ?? {};
  const eliminationErrors = errors.elimination ?? {};
  const mobilityErrors = errors.mobility ?? {};
  const skinErrors = errors.skin ?? {};

  return (
    <View>
      <Text style={styles.sectionSubtitle}>Nutrición</Text>
      <Controller
        control={control}
        name="nutrition.dietType"
        render={({ field: { onChange, value } }) => (
          <PickerField
            label="Tipo de dieta"
            placeholder="Seleccionar"
            value={value}
            options={dietTypeOptions}
            onValueChange={onChange}
            error={nutritionErrors?.dietType?.message as string | undefined}
          />
        )}
      />
      <Controller
        control={control}
        name="nutrition.tolerance"
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Tolerancia</Text>
            <TextInput
              style={styles.input}
              placeholder="Observaciones de tolerancia"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
            />
            {nutritionErrors?.tolerance?.message ? (
              <Text style={styles.error}>{nutritionErrors.tolerance.message as string}</Text>
            ) : null}
          </View>
        )}
      />
      <Controller
        control={control}
        name="nutrition.intakeMl"
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Ingesta (mL)</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              placeholder="500"
              onBlur={onBlur}
              value={value == null ? '' : String(value)}
              onChangeText={(text) => onChange(parseNumber(text))}
            />
            {nutritionErrors?.intakeMl?.message ? (
              <Text style={styles.error}>{nutritionErrors.intakeMl.message as string}</Text>
            ) : null}
          </View>
        )}
      />

      <Text style={styles.sectionSubtitle}>Eliminación</Text>
      <Controller
        control={control}
        name="elimination.urineMl"
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Diuresis (mL)</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              placeholder="800"
              onBlur={onBlur}
              value={value == null ? '' : String(value)}
              onChangeText={(text) => onChange(parseNumber(text))}
            />
            {eliminationErrors?.urineMl?.message ? (
              <Text style={styles.error}>{eliminationErrors.urineMl.message as string}</Text>
            ) : null}
          </View>
        )}
      />
      <Controller
        control={control}
        name="elimination.stoolPattern"
        render={({ field: { onChange, value } }) => (
          <PickerField
            label="Patrón evacuatorio"
            placeholder="Seleccionar"
            value={value}
            options={stoolPatternOptions}
            onValueChange={onChange}
            error={eliminationErrors?.stoolPattern?.message as string | undefined}
          />
        )}
      />
      <Controller
        control={control}
        name="elimination.hasRectalTube"
        render={({ field: { onChange, value } }) => (
          <View style={[styles.field, styles.switchRow]}>
            <Text style={styles.label}>Sonda rectal</Text>
            <Switch value={!!value} onValueChange={onChange} />
          </View>
        )}
      />

      <Text style={styles.sectionSubtitle}>Movilidad</Text>
      <Controller
        control={control}
        name="mobility.mobilityLevel"
        render={({ field: { onChange, value } }) => (
          <PickerField
            label="Nivel de movilidad"
            placeholder="Seleccionar"
            value={value}
            options={mobilityOptions}
            onValueChange={onChange}
            error={mobilityErrors?.mobilityLevel?.message as string | undefined}
          />
        )}
      />
      <Controller
        control={control}
        name="mobility.repositioningPlan"
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Plan de cambios de posición</Text>
            <TextInput
              style={styles.input}
              placeholder="Ej: cada 2 horas"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
            />
            {mobilityErrors?.repositioningPlan?.message ? (
              <Text style={styles.error}>{mobilityErrors.repositioningPlan.message as string}</Text>
            ) : null}
          </View>
        )}
      />

      <Text style={styles.sectionSubtitle}>Piel</Text>
      <Controller
        control={control}
        name="skin.skinStatus"
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Estado de piel</Text>
            <TextInput
              style={styles.input}
              placeholder="Ej: Íntegra"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
            />
            {skinErrors?.skinStatus?.message ? (
              <Text style={styles.error}>{skinErrors.skinStatus.message as string}</Text>
            ) : null}
          </View>
        )}
      />
      <Controller
        control={control}
        name="skin.hasPressureInjury"
        render={({ field: { onChange, value } }) => (
          <View style={[styles.field, styles.switchRow]}>
            <Text style={styles.label}>Úlcera por presión</Text>
            <Switch value={!!value} onValueChange={onChange} />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 16, fontWeight: '500', marginBottom: 4 },
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
  sectionSubtitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
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
});

export default SpecificCareSection;
