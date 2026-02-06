import React, { useMemo } from 'react';
import { Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Controller, useFieldArray, type Control, type FieldErrors } from 'react-hook-form';

import type { RootStackParamList } from '@/src/navigation/types';
import { useSelectedUnitId } from '@/src/state/filterStore';
import { SHIFT_TYPES, type AdministrativeData } from '@/src/types/administrative';
import { useZodForm } from '@/src/validation/form-hooks';
import { zAdministrativeData } from '@/src/validation/schemas';

type Props = NativeStackScreenProps<RootStackParamList, 'ShiftDetails'>;
type ShiftDetailsControl = Control<AdministrativeData>;
type ShiftDetailsErrors = FieldErrors<AdministrativeData>;

type StaffListInputProps = {
  control: ShiftDetailsControl;
  name: 'staffIn' | 'staffOut';
  label: string;
  placeholder: string;
  error?: string;
};

type IncidentListInputProps = {
  control: ShiftDetailsControl;
  name: 'incidents';
  label: string;
  placeholder: string;
  helper?: string;
  error?: string;
};

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 16 },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
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
  textArea: { height: 120, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  spacer: { width: 12 },
  inlineActions: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  error: { color: '#DC2626', marginTop: 4 },
  helper: { color: '#4B5563', marginTop: 4 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#CBD5F5',
    backgroundColor: '#fff',
  },
  optionButtonSelected: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  optionText: { color: '#1F2937', fontWeight: '500' },
  optionTextSelected: { color: '#fff', fontWeight: '600' },
});

const deriveShiftType = (shiftStartValue?: string | null) => {
  if (!shiftStartValue) return SHIFT_TYPES[0];
  const date = new Date(shiftStartValue);
  const hours = date.getHours();
  if (Number.isNaN(hours)) return SHIFT_TYPES[0];
  if (hours >= 6 && hours < 14) return 'Mañana';
  if (hours >= 14 && hours < 22) return 'Tarde';
  return 'Noche';
};

function StaffListInput({ control, name, label, placeholder, error }: StaffListInputProps) {
  const { fields, append, remove } = useFieldArray<AdministrativeData, typeof name>({ control, name });

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {fields.map((field, index) => (
        <View key={field.id} style={[styles.row, { marginBottom: 8 }]}>
          <View style={styles.flex}>
            <Controller
              control={control}
              name={`${name}.${index}` as const}
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={styles.input}
                  placeholder={`${placeholder} ${index + 1}`}
                  onBlur={onBlur}
                  value={value ?? ''}
                  onChangeText={onChange}
                />
              )}
            />
          </View>
          <View style={styles.spacer} />
          <Button title="Eliminar" onPress={() => remove(index)} />
        </View>
      ))}
      <View style={styles.inlineActions}>
        <Button title="Añadir" onPress={() => append('')} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function IncidentListInput({ control, name, label, placeholder, helper, error }: IncidentListInputProps) {
  const { fields, append, remove } = useFieldArray<AdministrativeData, typeof name>({ control, name });

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {fields.map((field, index) => (
        <View key={field.id} style={[styles.row, { marginBottom: 8 }]}>
          <View style={styles.flex}>
            <Controller
              control={control}
              name={`${name}.${index}` as const}
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder={`${placeholder} ${index + 1}`}
                  onBlur={onBlur}
                  multiline
                  value={value ?? ''}
                  onChangeText={onChange}
                />
              )}
            />
          </View>
          <View style={styles.spacer} />
          <Button title="Eliminar" onPress={() => remove(index)} />
        </View>
      ))}
      <View style={styles.inlineActions}>
        <Button title="Añadir" onPress={() => append('')} />
      </View>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function buildInitialAdministrativeData(
  params: Props['route']['params'],
  selectedUnitId: string,
): AdministrativeData {
  const provided = params?.administrativeData;
  const shiftStartDefault = provided?.shiftStart ?? new Date().toISOString();
  const shiftEndDefault = provided?.shiftEnd ?? new Date(Date.now() + 4 * 3600 * 1000).toISOString();
  return {
    unit: provided?.unit ?? selectedUnitId ?? '',
    census: provided?.census ?? 0,
    staffIn: provided?.staffIn ?? [],
    staffOut: provided?.staffOut ?? [],
    shiftStart: shiftStartDefault,
    shiftEnd: shiftEndDefault,
    shiftType: provided?.shiftType ?? deriveShiftType(shiftStartDefault),
    generalNotes: provided?.generalNotes ?? undefined,
    incidents: provided?.incidents ?? [],
  };
}

export default function ShiftDetailsScreen({ navigation, route }: Props) {
  const selectedUnitId = useSelectedUnitId();
  const initialAdministrativeData = useMemo(
    () => buildInitialAdministrativeData(route.params, selectedUnitId),
    [route.params, selectedUnitId],
  );

  const form = useZodForm(zAdministrativeData, initialAdministrativeData);
  const { control, formState } = form;
  const errors: ShiftDetailsErrors = formState.errors;

  const unitError = errors.unit?.message as string | undefined;
  const censusError = errors.census?.message as string | undefined;
  const startError = errors.shiftStart?.message as string | undefined;
  const endError = errors.shiftEnd?.message as string | undefined;
  const staffInError = errors.staffIn?.message as string | undefined;
  const staffOutError = errors.staffOut?.message as string | undefined;
  const shiftTypeError = errors.shiftType?.message as string | undefined;
  const generalNotesError = errors.generalNotes?.message as string | undefined;
  const incidentsError = errors.incidents?.message as string | undefined;

  const parseNumericInput = (value: string) => {
    if (value === '') return undefined;
    const normalized = value.replace(',', '.');
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const onSubmit = form.handleSubmit((values) => {
    const target = route.params?.returnTo ?? 'HandoverForm';
    if (target === 'PatientList') {
      navigation.navigate('PatientList');
      return;
    }
    navigation.navigate(target, { administrativeData: values });
  });

  const onCancel = () => {
    navigation.goBack();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Datos de unidad</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Unidad</Text>
          <Controller
            control={control}
            name="unit"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder="UCI Adulto"
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {unitError ? <Text style={styles.error}>{unitError}</Text> : null}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Censo de pacientes</Text>
          <Controller
            control={control}
            name="census"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder="0"
                keyboardType="numeric"
                onBlur={onBlur}
                value={value == null ? '' : String(value)}
                onChangeText={(text) => onChange(parseNumericInput(text))}
              />
            )}
          />
          {censusError ? <Text style={styles.error}>{censusError}</Text> : null}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Horario</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Inicio de turno</Text>
          <Controller
            control={control}
            name="shiftStart"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder="2024-01-01T08:00"
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {startError ? <Text style={styles.error}>{startError}</Text> : null}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Fin de turno</Text>
          <Controller
            control={control}
            name="shiftEnd"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder="2024-01-01T20:00"
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {endError ? <Text style={styles.error}>{endError}</Text> : null}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Tipo de turno</Text>
          <Controller
            control={control}
            name="shiftType"
            render={({ field: { onChange, value } }) => (
              <View style={styles.optionRow}>
                {SHIFT_TYPES.map((option) => {
                  const selected = value === option;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      style={[styles.optionButton, selected && styles.optionButtonSelected]}
                      onPress={() => onChange(option)}
                    >
                      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          />
          {shiftTypeError ? <Text style={styles.error}>{shiftTypeError}</Text> : null}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Personal entrante/saliente</Text>
        <StaffListInput
          control={control}
          name="staffIn"
          label="Personal entrante"
          placeholder="Nombre"
          error={staffInError}
        />
        <StaffListInput
          control={control}
          name="staffOut"
          label="Personal saliente"
          placeholder="Nombre"
          error={staffOutError}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Observaciones</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Notas generales</Text>
          <Controller
            control={control}
            name="generalNotes"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Notas generales del turno"
                onBlur={onBlur}
                multiline
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {generalNotesError ? <Text style={styles.error}>{generalNotesError}</Text> : null}
        </View>
        <IncidentListInput
          control={control}
          name="incidents"
          label="Observaciones/Incidentes"
          placeholder="Incidencia"
          helper="Registra cada observación en una línea diferente."
          error={incidentsError}
        />
      </View>

      <View style={[styles.section, styles.buttonRow]}>
        <View style={styles.flex}>
          <Button title="Guardar" color="#2563EB" onPress={onSubmit} />
        </View>
        <View style={styles.flex}>
          <Button title="Cancelar" color="#9CA3AF" onPress={onCancel} />
        </View>
      </View>
    </ScrollView>
  );
}
