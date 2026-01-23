import React from 'react';
import { Text, TextInput, View } from 'react-native';
import { Controller, useFormContext } from 'react-hook-form';

import type { HandoverValues } from '@/src/validation/schemas';
import { PickerField, dietTypeOptions, nursingStyles } from './nursingShared';

type NutritionSectionProps = {
  parseNumber: (value: string) => number | undefined;
};

export function NutritionSection({ parseNumber }: NutritionSectionProps) {
  const {
    control,
    formState: { errors },
  } = useFormContext<HandoverValues>();

  const nutritionErrors = errors.nutrition ?? {};

  return (
    <View>
      <Controller
        control={control}
        name="nutrition.dietType"
        render={({ field: { onChange, value } }) => (
          <PickerField
            testID="nutrition.dietType"
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
          <View style={nursingStyles.field}>
            <Text style={nursingStyles.label}>Tolerancia</Text>
            <TextInput
              style={nursingStyles.input}
              placeholder="Observaciones de tolerancia"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
            />
            {nutritionErrors?.tolerance?.message ? (
              <Text style={nursingStyles.error}>{nutritionErrors.tolerance.message as string}</Text>
            ) : null}
          </View>
        )}
      />

      <Controller
        control={control}
        name="nutrition.intakeMl"
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={nursingStyles.field}>
            <Text style={nursingStyles.label}>Ingesta (mL)</Text>
            <TextInput
              style={nursingStyles.input}
              keyboardType="numeric"
              placeholder="500"
              onBlur={onBlur}
              value={value == null ? '' : String(value)}
              onChangeText={(text) => onChange(parseNumber(text))}
            />
            {nutritionErrors?.intakeMl?.message ? (
              <Text style={nursingStyles.error}>{nutritionErrors.intakeMl.message as string}</Text>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}

export default NutritionSection;


