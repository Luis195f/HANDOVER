import React from 'react';
import { Switch, Text, TextInput, View } from 'react-native';
import { Controller, useFormContext } from 'react-hook-form';

import type { HandoverValues } from '@/src/validation/schemas';
import { PickerField, nursingStyles, stoolPatternOptions } from './nursingShared';

type EliminationSectionProps = {
  parseNumber: (value: string) => number | undefined;
};

export function EliminationSection({ parseNumber }: EliminationSectionProps) {
  const {
    control,
    formState: { errors },
  } = useFormContext<HandoverValues>();
  const eliminationErrors = errors.elimination ?? {};

  return (
    <View>
      <Controller
        control={control}
        name="elimination.urineMl"
        defaultValue={undefined}
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={nursingStyles.field}>
            <Text style={nursingStyles.label}>Diuresis (mL)</Text>
            <TextInput
              testID="elimination.urineMl"
              style={nursingStyles.input}
              keyboardType="numeric"
              placeholder="800"
              onBlur={onBlur}
              value={value == null ? '' : String(value)}
              onChangeText={(text) => onChange(parseNumber(text))}
            />
            {eliminationErrors?.urineMl?.message ? (
              <Text style={nursingStyles.error}>{eliminationErrors.urineMl.message as string}</Text>
            ) : null}
          </View>
        )}
      />
      <Controller
        control={control}
        name="elimination.stoolPattern"
        defaultValue={undefined}
        render={({ field: { onChange, value } }) => (
          <PickerField
            testID="elimination.stoolPattern"
            label="Patrón deposicional"
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
        defaultValue={false}
        render={({ field: { onChange, value } }) => (
          <View style={[nursingStyles.field, nursingStyles.switchRow]}>
            <Text style={nursingStyles.label}>Sonda rectal</Text>
            <Switch
              accessibilityLabel="Sonda rectal"
              value={!!value}
              onValueChange={onChange}
            />
          </View>
        )}
      />
    </View>
  );
}

export default EliminationSection;
