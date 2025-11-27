import React from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import { Controller, useFormContext } from 'react-hook-form';
import { type HandoverValues as HandoverFormValues } from '@/src/validation/schemas';
import type { SttConfig, SttStatus } from '@/src/lib/stt';
import type { DictationField } from '@/src/screens/HandoverForm';

export type DictationMicButtonProps = {
  active: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
};

export type AdministrativeSectionProps = {
  styles: Record<string, any>;
  onEditShift: () => void;
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

type StaffListField = keyof HandoverFormValues['administrativeData'];

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
  styles: Record<string, any>;
}) => {
  const { control } = useFormContext<HandoverFormValues>();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Controller
        control={control}
        name={`administrativeData.${name}` as const}
        render={({ field: { onChange, value } }) => (
          <TextInput
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
  onEditShift,
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
  const incidentsError = administrativeErrors.incidents?.message as string | undefined;
  const { activeDictationField, sttStatus, dictationUnavailable, handleDictationPress, renderDictationStatus } =
    dictationState;

  return (
    <>
      <View style={styles.buttonRow}>
        <Button title="Editar detalles del turno" color="#2563EB" onPress={onEditShift} />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Unidad</Text>
        <Controller
          control={control}
          name="administrativeData.unit"
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
          name="administrativeData.shiftEnd"
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
            disabled={dictationUnavailable}
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
