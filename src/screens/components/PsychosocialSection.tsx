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
        defaultValue=""
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={nursingStyles.field}>
            <Text style={nursingStyles.label}>Estado emocional</Text>
            <TextInput
              testID="psychosocial-emotional-status"
              accessibilityLabel="Estado emocional"
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
        defaultValue=""
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={nursingStyles.field}>
            <Text style={nursingStyles.label}>Notas familiares</Text>
            <TextInput
              testID="psychosocial-family-notes"
              accessibilityLabel="Notas familiares"
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
        defaultValue={false}
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
