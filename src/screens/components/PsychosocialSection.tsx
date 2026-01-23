import React from 'react';
import { Switch, Text, TextInput, View } from 'react-native';
import { Controller, useFormContext } from 'react-hook-form';

import type { HandoverValues } from '@/src/validation/schemas';
import { nursingStyles } from './nursingShared';

export function PsychosocialSection() {
  const { control } = useFormContext<HandoverValues>();

  return (
    <View>
      <Controller
        control={control}
        name="psychosocial.emotionalStatus"
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={nursingStyles.field}>
            <Text style={nursingStyles.label}>Estado emocional</Text>
            <TextInput
              style={nursingStyles.input}
              placeholder="Ej: tranquilo, ansioso"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
            />
          </View>
        )}
      />
      <Controller
        control={control}
        name="psychosocial.familyNotes"
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={nursingStyles.field}>
            <Text style={nursingStyles.label}>Notas familiares</Text>
            <TextInput
              style={[nursingStyles.input, nursingStyles.textArea]}
              multiline
              placeholder="Ej: Familia presente en turno de tarde"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
            />
          </View>
        )}
      />
      <Controller
        control={control}
        name="psychosocial.familyVisits"
        render={({ field: { onChange, value } }) => (
          <View style={[nursingStyles.field, nursingStyles.switchRow]}>
            <Text style={nursingStyles.label}>Visitas familiares</Text>
            <Switch
              accessibilityLabel="Visitas familiares"
              value={!!value}
              onValueChange={onChange}
            />
          </View>
        )}
      />
    </View>
  );
}

export default PsychosocialSection;
