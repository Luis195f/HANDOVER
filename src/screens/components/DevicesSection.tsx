import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Button, Switch, StyleSheet } from 'react-native';
import { Controller, useFieldArray, useFormContext } from 'react-hook-form';

import type { HandoverValues } from '@/src/validation/schemas';

type Props = {
  styles: ReturnType<typeof StyleSheet.create>;
};

export function DevicesSection({ styles }: Props) {
  const { control } = useFormContext<HandoverValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'devices' });
  const [pendingName, setPendingName] = useState('');
  const [pendingActive, setPendingActive] = useState(true);

  const trimmedName = useMemo(() => pendingName.trim(), [pendingName]);

  const handleAdd = () => {
    if (!trimmedName) {
      return;
    }
    append({ name: trimmedName, active: pendingActive });
    setPendingName('');
    setPendingActive(true);
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.field}>
        <Text style={styles.label}>Dispositivo</Text>
        <TextInput
          value={pendingName}
          onChangeText={setPendingName}
          placeholder="Ej: Vía central subclavia, Sonda Foley, Drenaje pleural"
          style={[styles.input, styles.textArea, { height: 60 }]}
          multiline
        />
      </View>
      <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
        <View style={styles.row}>
          <Text style={styles.label}>Activo</Text>
          <View style={styles.spacer} />
          <Switch value={pendingActive} onValueChange={setPendingActive} />
        </View>
        <Button title="Agregar" onPress={handleAdd} disabled={!trimmedName} />
      </View>

      <View style={{ gap: 8 }}>
        {fields.map((field, index) => (
          <View
            key={field.id}
            style={[
              styles.row,
              {
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderWidth: 1,
                borderColor: '#E5E7EB',
                borderRadius: 8,
                backgroundColor: '#F9FAFB',
              },
            ]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Controller
                control={control}
                name={`devices.${index}.name`}
                defaultValue={field.name ?? ''}
                render={({ field: { value, onChange, onBlur } }) => (
                  <TextInput
                    style={[
                      styles.input,
                      {
                        height: 44,
                        paddingVertical: 10,
                        textDecorationLine: value && !fields[index].active ? 'line-through' : 'none',
                        color: value && !fields[index].active ? '#6B7280' : undefined,
                      },
                    ]}
                    value={value}
                    onBlur={onBlur}
                    onChangeText={onChange}
                  />
                )}
              />
              <View style={styles.row}>
                <Controller
                  control={control}
                  name={`devices.${index}.active`}
                  defaultValue={field.active ?? true}
                  render={({ field: { value, onChange } }) => (
                    <View style={styles.row}>
                      <Switch value={value ?? true} onValueChange={onChange} />
                      <View style={styles.spacer} />
                      <Text style={{ color: value ? '#111827' : '#6B7280' }}>
                        {value ? 'Activo' : 'Retirado'}
                      </Text>
                    </View>
                  )}
                />
              </View>
            </View>
            <View style={styles.spacer} />
            <Button title="Quitar" onPress={() => remove(index)} />
          </View>
        ))}
      </View>
    </View>
  );
}

export default DevicesSection;
