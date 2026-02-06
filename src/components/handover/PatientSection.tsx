import React from 'react';
import { Button, Text, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';
import { Controller, useFormContext } from 'react-hook-form';
import { type HandoverValues as HandoverFormValues } from '@/src/validation/schemas';

export type PatientSectionProps = {
  styles: Record<string, TextStyle | ViewStyle>;
  onScanPress: () => void;
};

export const PatientSection: React.FC<PatientSectionProps> = ({ styles, onScanPress }) => {
  const {
    control,
    formState: { errors },
  } = useFormContext<HandoverFormValues>();
  const patientError = errors.patientId?.message as string | undefined;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Paciente</Text>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Controller
            control={control}
            name="patientId"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                testID="handover-patient-id"
                placeholder="Paciente"
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
        </View>
        <View style={styles.spacer} />
        <Button title="Escanear" onPress={onScanPress} testID="handover-scan-qr" />
      </View>
      {patientError ? <Text style={styles.error}>{patientError}</Text> : null}
    </View>
  );
};
