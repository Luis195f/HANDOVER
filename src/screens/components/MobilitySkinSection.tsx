import React from 'react';
import { Switch, Text, TextInput, View } from 'react-native';
import { Controller, useFormContext } from 'react-hook-form';

import type { HandoverValues } from '@/src/validation/schemas';
import { PickerField, mobilityOptions, nursingStyles } from './nursingShared';

export function MobilitySkinSection() {
  const {
    control,
    formState: { errors },
  } = useFormContext<HandoverValues>();

  const mobilityErrors = errors.mobility ?? {};
  const skinErrors = errors.skin ?? {};

  return (
    <View>
      <Controller
        control={control}
        name="mobility.mobilityLevel"
        defaultValue={undefined}
        render={({ field: { onChange, value } }) => (
          <PickerField
            testID="mobility.mobilityLevel"
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
        defaultValue=""
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={nursingStyles.field}>
            <Text style={nursingStyles.label}>Plan de cambios de posición</Text>
            <TextInput
              style={nursingStyles.input}
              placeholder="Ej: cada 2 horas"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
            />
            {mobilityErrors?.repositioningPlan?.message ? (
              <Text style={nursingStyles.error}>
                {mobilityErrors.repositioningPlan.message as string}
              </Text>
            ) : null}
          </View>
        )}
      />

      <Controller
        control={control}
        name="skin.skinStatus"
        defaultValue=""
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={nursingStyles.field}>
            <Text style={nursingStyles.label}>Estado de piel</Text>
            <TextInput
              style={nursingStyles.input}
              placeholder="Ej: Íntegra"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
            />
            {skinErrors?.skinStatus?.message ? (
              <Text style={nursingStyles.error}>{skinErrors.skinStatus.message as string}</Text>
            ) : null}
          </View>
        )}
      />

      <Controller
        control={control}
        name="skin.hasPressureInjury"
        defaultValue={false}
        render={({ field: { onChange, value } }) => (
          <View style={[nursingStyles.field, nursingStyles.switchRow]}>
            <Text style={nursingStyles.label}>Úlcera por presión</Text>
            <Switch
              accessibilityLabel="Úlcera por presión"
              value={!!value}
              onValueChange={onChange}
            />
          </View>
        )}
      />
    </View>
  );
}

export default MobilitySkinSection;
