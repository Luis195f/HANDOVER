import React from 'react';
import {
  Alert,
  Button,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';

import Chip from '@/src/components/Chip';
import { postBundle } from '@/src/lib/fhir-client';
import { mapToFhirBundle } from '@/src/lib/handover';
import type { RootStackParamList } from '@/src/navigation/types';
import { handoverSchema, type HandoverData } from '@/src/schemas/handover';

const DIAGNOSIS_OPTIONS = ['Neumonía', 'FA', 'EPOC', 'DM2', 'IAM'] as const;
const RISK_OPTIONS = ['Caídas', 'Convulsiones', 'Aislamiento', 'CLABSI'] as const;

type Props = NativeStackScreenProps<RootStackParamList, 'Handover'>;

const defaultRisks = RISK_OPTIONS.reduce<Record<string, boolean>>((acc, key) => {
  acc[key] = false;
  return acc;
}, {});

const defaultValues: HandoverData = {
  patientId: '',
  admin: { unit: '', staffOut: '', staffIn: '', census: 0 },
  dxList: [],
  evolution: '',
  vitals: {},
  risks: defaultRisks,
  meds: [],
};

export default function Handover({ navigation }: Props) {
  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<HandoverData>({
    resolver: zodResolver(handoverSchema),
    defaultValues,
  });
  const meds = watch('meds');

  const toggleDiagnosis = React.useCallback(
    (dx: string) => {
      const current = new Set(watch('dxList') ?? []);
      if (current.has(dx)) {
        current.delete(dx);
      } else {
        current.add(dx);
      }
      setValue('dxList', Array.from(current));
    },
    [setValue, watch]
  );

  const parseNumber = React.useCallback((value: string) => {
    if (!value) return undefined;
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }, []);

  const adminErrors = errors.admin as Record<string, { message?: string }> | undefined;
  const patientError = errors.patientId as { message?: string } | undefined;

  const onAddMedication = React.useCallback(() => {
    const current = meds ?? [];
    setValue('meds', [...current, { name: '' }]);
  }, [meds, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const bundle = mapToFhirBundle(values);
      await postBundle(bundle);
      Alert.alert('Envío correcto', 'Se envió el handover.');
      navigation.goBack();
    } catch (error: any) {
      Alert.alert('Error', error?.message ?? 'No se pudo enviar');
    }
  });

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <View style={{ marginBottom: 24 }}>
        <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 12 }}>Datos administrativos</Text>
        <Controller
          control={control}
          name="patientId"
          render={({ field }) => (
            <TextInput
              placeholder="ID del paciente"
              value={field.value}
              onChangeText={field.onChange}
              style={{ borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 4 }}
            />
          )}
        />
        {patientError?.message ? (
          <Text style={{ color: '#dc2626', marginBottom: 8 }}>{patientError.message}</Text>
        ) : null}
        <Controller
          control={control}
          name="admin.unit"
          render={({ field }) => (
            <TextInput
              placeholder="Unidad"
              value={field.value}
              onChangeText={field.onChange}
              style={{ borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 4 }}
            />
          )}
        />
        {adminErrors?.unit?.message ? (
          <Text style={{ color: '#dc2626', marginBottom: 8 }}>{adminErrors.unit.message}</Text>
        ) : null}
        <Controller
          control={control}
          name="admin.staffOut"
          render={({ field }) => (
            <TextInput
              placeholder="Enfermero saliente"
              value={field.value}
              onChangeText={field.onChange}
              style={{ borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 4 }}
            />
          )}
        />
        {adminErrors?.staffOut?.message ? (
          <Text style={{ color: '#dc2626', marginBottom: 8 }}>{adminErrors.staffOut.message}</Text>
        ) : null}
        <Controller
          control={control}
          name="admin.staffIn"
          render={({ field }) => (
            <TextInput
              placeholder="Enfermero entrante"
              value={field.value}
              onChangeText={field.onChange}
              style={{ borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 4 }}
            />
          )}
        />
        {adminErrors?.staffIn?.message ? (
          <Text style={{ color: '#dc2626', marginBottom: 8 }}>{adminErrors.staffIn.message}</Text>
        ) : null}
        <Controller
          control={control}
          name="admin.census"
          render={({ field }) => (
            <TextInput
              placeholder="Censo (nº pacientes)"
              keyboardType="number-pad"
              value={String(field.value ?? '')}
              onChangeText={(text) => field.onChange(parseNumber(text) ?? 0)}
              style={{ borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 4 }}
            />
          )}
        />
        {adminErrors?.census?.message ? (
          <Text style={{ color: '#dc2626', marginBottom: 8 }}>{adminErrors.census.message}</Text>
        ) : null}
      </View>

      <View style={{ marginBottom: 24 }}>
        <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 12 }}>Diagnósticos frecuentes</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {DIAGNOSIS_OPTIONS.map((dx) => (
            <Chip
              key={dx}
              label={dx}
              selected={(watch('dxList') ?? []).includes(dx)}
              onPress={() => toggleDiagnosis(dx)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginBottom: 24 }}>
        <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 12 }}>Riesgos</Text>
        {RISK_OPTIONS.map((risk) => (
          <Controller
            key={risk}
            control={control}
            name={`risks.${risk}` as const}
            render={({ field }) => (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <Text>{risk}</Text>
                <Switch value={!!field.value} onValueChange={field.onChange} />
              </View>
            )}
          />
        ))}
      </View>

      <View style={{ marginBottom: 24 }}>
        <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 12 }}>Signos vitales</Text>
        {([
          { name: 'vitals.hr', label: 'Frecuencia cardíaca (/min)' },
          { name: 'vitals.rr', label: 'Respiraciones (/min)' },
          { name: 'vitals.sbp', label: 'TA sistólica (mmHg)' },
          { name: 'vitals.temp', label: 'Temperatura (°C)' },
          { name: 'vitals.spo2', label: 'SpO₂ (%)' },
        ] as const).map((fieldDef) => (
          <Controller
            key={fieldDef.name}
            control={control}
            name={fieldDef.name}
            render={({ field }) => (
              <TextInput
                placeholder={fieldDef.label}
                keyboardType="numeric"
                value={field.value == null ? '' : String(field.value)}
                onChangeText={(text) => field.onChange(parseNumber(text))}
                style={{ borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 }}
              />
            )}
          />
        ))}
      </View>

      <View style={{ marginBottom: 24 }}>
        <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 12 }}>Medicaciones</Text>
        {(meds ?? []).map((_, index) => (
          <View key={`med-${index}`} style={{ marginBottom: 12 }}>
            <Controller
              control={control}
              name={`meds.${index}.name`}
              render={({ field: medicationField }) => (
                <TextInput
                  placeholder="Nombre"
                  value={medicationField.value}
                  onChangeText={medicationField.onChange}
                  style={{ borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 }}
                />
              )}
            />
            <Controller
              control={control}
              name={`meds.${index}.dose`}
              render={({ field: medicationField }) => (
                <TextInput
                  placeholder="Dosis"
                  value={medicationField.value ?? ''}
                  onChangeText={medicationField.onChange}
                  style={{ borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 }}
                />
              )}
            />
            <Controller
              control={control}
              name={`meds.${index}.route`}
              render={({ field: medicationField }) => (
                <TextInput
                  placeholder="Vía"
                  value={medicationField.value ?? ''}
                  onChangeText={medicationField.onChange}
                  style={{ borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 }}
                />
              )}
            />
            <Controller
              control={control}
              name={`meds.${index}.time`}
              render={({ field: medicationField }) => (
                <TextInput
                  placeholder="Horario"
                  value={medicationField.value ?? ''}
                  onChangeText={medicationField.onChange}
                  style={{ borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 }}
                />
              )}
            />
            <Button
              title="Eliminar"
              onPress={() => {
                const current = meds ?? [];
                setValue(
                  'meds',
                  current.filter((__, idx) => idx !== index),
                );
              }}
            />
          </View>
        ))}
        <Button title="Añadir medicación" onPress={onAddMedication} />
      </View>

      <View style={{ marginBottom: 24 }}>
        <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 12 }}>Evolución</Text>
        <Controller
          control={control}
          name="evolution"
          render={({ field }) => (
            <TextInput
              placeholder="Resumen clínico"
              multiline
              numberOfLines={4}
              value={field.value ?? ''}
              onChangeText={field.onChange}
              style={{ borderWidth: 1, borderRadius: 12, padding: 12, textAlignVertical: 'top' }}
            />
          )}
        />
      </View>

      <Button title="Guardar" onPress={onSubmit} />
    </ScrollView>
  );
}
