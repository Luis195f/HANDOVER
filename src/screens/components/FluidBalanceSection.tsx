import React, { useEffect } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Controller, useFormContext, useWatch } from 'react-hook-form';

import type { HandoverValues } from '@/src/validation/schemas';
import { nursingStyles } from './nursingShared';

type FluidBalanceSectionProps = {
  parseNumber: (value: string) => number | undefined;
};

export function FluidBalanceSection({ parseNumber }: FluidBalanceSectionProps) {
  const {
    control,
    formState: { errors },
    setValue,
  } = useFormContext<HandoverValues>();
  const fluidBalanceErrors = errors.fluidBalance ?? {};

  const intakeValue = useWatch({ control, name: 'fluidBalance.intakeMl' });
  const outputValue = useWatch({ control, name: 'fluidBalance.outputMl' });
  const netBalanceValue = useWatch({ control, name: 'fluidBalance.netBalanceMl' });

  useEffect(() => {
    if (typeof intakeValue === 'number' && typeof outputValue === 'number') {
      setValue('fluidBalance.netBalanceMl', intakeValue - outputValue, {
        shouldDirty: false,
        shouldValidate: true,
      });
      return;
    }
    setValue('fluidBalance.netBalanceMl', undefined, { shouldDirty: false, shouldValidate: true });
  }, [intakeValue, outputValue, setValue]);

  const netBalanceDisplay =
    typeof netBalanceValue === 'number'
      ? `${netBalanceValue > 0 ? '+' : ''}${netBalanceValue} mL`
      : '—';

  return (
    <View>
      <View style={[nursingStyles.row, nursingStyles.field]}>
        <View style={nursingStyles.flex}>
          <Text style={nursingStyles.label}>Entrada (mL)</Text>
          <Controller
            control={control}
            name="fluidBalance.intakeMl"
            defaultValue={undefined}
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={nursingStyles.input}
                keyboardType="numeric"
                placeholder="1000"
                onBlur={onBlur}
                value={value == null ? '' : String(value)}
                onChangeText={(text) => onChange(parseNumber(text))}
              />
            )}
          />
          {fluidBalanceErrors?.intakeMl?.message ? (
            <Text style={nursingStyles.error}>{fluidBalanceErrors.intakeMl.message as string}</Text>
          ) : null}
        </View>

        <View style={nursingStyles.spacer} />

        <View style={nursingStyles.flex}>
          <Text style={nursingStyles.label}>Salida (mL)</Text>
          <Controller
            control={control}
            name="fluidBalance.outputMl"
            defaultValue={undefined}
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={nursingStyles.input}
                keyboardType="numeric"
                placeholder="900"
                onBlur={onBlur}
                value={value == null ? '' : String(value)}
                onChangeText={(text) => onChange(parseNumber(text))}
              />
            )}
          />
          {fluidBalanceErrors?.outputMl?.message ? (
            <Text style={nursingStyles.error}>{fluidBalanceErrors.outputMl.message as string}</Text>
          ) : null}
        </View>
      </View>

      <View style={nursingStyles.field}>
        <Text style={nursingStyles.label}>Balance neto (mL)</Text>
        <TextInput
          testID="fluidBalance.netBalanceDisplay"
          style={[nursingStyles.input, nursingStyles.readOnlyInput]}
          value={netBalanceDisplay}
          editable={false}
        />
        {fluidBalanceErrors?.netBalanceMl?.message ? (
          <Text style={nursingStyles.error}>{fluidBalanceErrors.netBalanceMl.message as string}</Text>
        ) : null}
      </View>

      <Controller
        control={control}
        name="fluidBalance.notes"
        defaultValue=""
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={nursingStyles.field}>
            <Text style={nursingStyles.label}>Observaciones</Text>
            <TextInput
              style={[nursingStyles.input, nursingStyles.textArea]}
              multiline
              placeholder="Balance positivo +1500 ml, vigilar edema"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
            />
          </View>
        )}
      />
    </View>
  );
}

export default FluidBalanceSection;
