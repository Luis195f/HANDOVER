import React from 'react';
import { Text, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';
import { Controller, useFormContext } from 'react-hook-form';

import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';

export type OxygenGroupSectionStyles = {
  field: ViewStyle;
  label: TextStyle;
  input: TextStyle;
  error: TextStyle;
};

export interface OxygenGroupSectionProps {
  styles: OxygenGroupSectionStyles;
  parseNumericInput: (value: string) => number | undefined;
}

export function OxygenGroupSection({ styles, parseNumericInput }: OxygenGroupSectionProps) {
  const {
    control,
    formState: { errors },
  } = useFormContext<HandoverFormValues>();

  const deviceError = errors?.oxygenTherapy?.device?.message as string | undefined;
  const flowError = errors?.oxygenTherapy?.flowLMin?.message as string | undefined;
  const fio2Error = errors?.oxygenTherapy?.fio2?.message as string | undefined;

  return (
    <View>
      <View style={styles.field}>
        <Text style={styles.label}>Dispositivo</Text>
        <Controller
          control={control}
          name="oxygenTherapy.device"
          defaultValue=""
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="Cánula / Mascarilla"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
            />
          )}
        />
        {deviceError ? <Text style={styles.error}>{deviceError}</Text> : null}
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Flujo O₂ (L/min)</Text>
        <Controller
          control={control}
          name="oxygenTherapy.flowLMin"
          defaultValue={undefined}
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              placeholder="2"
              onBlur={onBlur}
              value={value == null ? '' : String(value)}
              onChangeText={(text) => onChange(parseNumericInput(text))}
            />
          )}
        />
        {flowError ? <Text style={styles.error}>{flowError}</Text> : null}
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>FiO₂ (%)</Text>
        <Controller
          control={control}
          name="oxygenTherapy.fio2"
          defaultValue={undefined}
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              placeholder="30"
              onBlur={onBlur}
              value={value == null ? '' : String(value)}
              onChangeText={(text) => onChange(parseNumericInput(text))}
            />
          )}
        />
        {fio2Error ? <Text style={styles.error}>{fio2Error}</Text> : null}
      </View>
    </View>
  );
}

export default OxygenGroupSection;
