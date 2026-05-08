import React from 'react';
import { Button, Text, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';
import { Controller, useFormContext } from 'react-hook-form';
import { type HandoverValues as HandoverFormValues } from '@/src/validation/schemas';

export type PatientSectionProps = {
  styles: Record<string, TextStyle | ViewStyle>;
  onScanPress: () => void;
  qrPatientScanEnabled: boolean;
  patientIdentificationHint: string;
};

export const PatientSection: React.FC<PatientSectionProps> = ({
  styles,
  onScanPress,
  qrPatientScanEnabled,
  patientIdentificationHint,
}) => {
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
                placeholder="Paciente o identificador institucional"
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
        </View>
        {qrPatientScanEnabled ? (
          <>
            <View style={styles.spacer} />
            <Button title="Escanear QR" onPress={onScanPress} testID="handover-scan-qr" />
          </>
        ) : null}
      </View>
      <Text style={styles.helperText}>{patientIdentificationHint}</Text>
      {patientError ? <Text style={styles.error}>{patientError}</Text> : null}
    </View>
  );
};
