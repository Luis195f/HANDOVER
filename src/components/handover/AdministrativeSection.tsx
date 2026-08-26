import React from 'react';
import { Pressable, Text, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';
import { Controller, useFormContext } from 'react-hook-form';
import { type HandoverValues as HandoverFormValues } from '@/src/validation/schemas';
import type { SttConfig, SttStatus } from '@/src/lib/stt';
import type { DictationField } from '@/src/screens/HandoverForm';
import { SHIFT_TYPES } from '@/src/types/administrative';

export type DictationMicButtonProps = {
  active: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
};

export type AdministrativeSectionProps = {
  styles: Record<string, TextStyle | ViewStyle>;
  parseNumericInput: (value: string) => number | undefined;
  dictationState: {
    activeDictationField: DictationField | null;
    sttStatus: SttStatus | null;
    dictationUnavailable: boolean;
    renderDictationStatus: (field: DictationField) => React.ReactNode;
    handleDictationPress: (field: DictationField, config: SttConfig) => void;
  };
  DictationMicButton: React.ComponentType<DictationMicButtonProps>;
};

type StaffListField = Extract<keyof HandoverFormValues['administrativeData'], string>;

const StaffListInput = ({
  name,
  label,
  placeholder,
  error,
  styles,
}: {
  name: StaffListField;
  label: string;
  placeholder: string;
  error?: string;
  styles: Record<string, TextStyle | ViewStyle>;
}) => {
  const { control } = useFormContext<HandoverFormValues>();
  const fieldKey = name;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Controller
        control={control}
        name={`administrativeData.${fieldKey}` as const}
        render={({ field: { onChange, value } }) => (
          <TextInput
            testID={`handover-${fieldKey}`}
            style={[styles.input, styles.textArea]}
            multiline
            placeholder={placeholder}
            value={Array.isArray(value) ? value.join('\n') : ''}
            onChangeText={(text) =>
              onChange(
                text
                  .split('\n')
                  .map((item) => item.trim())
                  .filter(Boolean),
              )
            }
          />
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.helperText}>Separa cada persona en una línea.</Text>
    </View>
  );
};

export const AdministrativeSection: React.FC<AdministrativeSectionProps> = ({
  styles,
  parseNumericInput,
  dictationState,
  DictationMicButton,
}) => {
  const { control, formState } = useFormContext<HandoverFormValues>();
  const errors = formState.errors ?? {};
  const administrativeErrors = errors.administrativeData ?? {};
  const unitError = administrativeErrors.unit?.message as string | undefined;
  const censusError = administrativeErrors.census?.message as string | undefined;
  const startError = administrativeErrors.shiftStart?.message as string | undefined;
  const endError = administrativeErrors.shiftEnd?.message as string | undefined;
  const staffInError = administrativeErrors.staffIn?.message as string | undefined;
  const staffOutError = administrativeErrors.staffOut?.message as string | undefined;
  const shiftTypeError = administrativeErrors.shiftType?.message as string | undefined;
  const generalNotesError = administrativeErrors.generalNotes?.message as string | undefined;
  const incidentsError = administrativeErrors.incidents?.message as string | undefined;
  const { activeDictationField, sttStatus, handleDictationPress, renderDictationStatus } =
    dictationState;

  return (
    <>
      <View style={styles.field}>
        <Text style={styles.label}>Unidad</Text>
        <Controller
          control={control}
          name="administrativeData.unit"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              testID="handover-administrative-unit"
              accessibilityLabel="Unidad"
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
          name="administrativeData.census"
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
      <View style={styles.field}>
        <Text style={styles.label}>Inicio de turno</Text>
        <Controller
          control={control}
          name="administrativeData.shiftStart"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="2026-08-27T06:00"
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
          name="administrativeData.shiftEnd"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="2026-08-27T14:00"
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
          name="administrativeData.shiftType"
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
      <StaffListInput
        name="staffIn"
        label="Personal entrante"
        placeholder="Nombre"
        error={staffInError}
        styles={styles}
      />
      <StaffListInput
        name="staffOut"
        label="Personal saliente"
        placeholder="Nombre"
        error={staffOutError}
        styles={styles}
      />
      <View style={styles.field}>
        <Text style={styles.label}>Notas generales</Text>
        <Controller
          control={control}
          name="administrativeData.generalNotes"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={[styles.input, styles.textArea]}
              multiline
              placeholder="Notas generales del turno"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
            />
          )}
        />
        {generalNotesError ? <Text style={styles.error}>{generalNotesError}</Text> : null}
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Observaciones del turno</Text>
        <View style={styles.dictationRow}>
          <View style={styles.flex}>
            <Controller
              control={control}
              name="administrativeData.incidents"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={[styles.input, styles.textArea]}
                  multiline
                  placeholder="Incidentes o novedades del turno (una por línea)"
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
                />
              )}
            />
          </View>
          <DictationMicButton
            active={activeDictationField === 'incidents' && sttStatus === 'listening'}
            label="Dictar observaciones"
            onPress={() =>
              handleDictationPress('incidents', {
                locale: 'es-ES',
                interimResults: true,
                maxSeconds: 60,
              })
            }
          />
        </View>
        {renderDictationStatus('incidents')}
        {incidentsError ? <Text style={styles.error}>{incidentsError}</Text> : null}
        <Text style={styles.helperText}>Separa cada observación en una línea.</Text>
      </View>
    </>
  );
};
