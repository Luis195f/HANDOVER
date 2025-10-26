import React, { useEffect } from "react";
import { Alert, Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Controller } from "react-hook-form";

import { useZodForm } from "@/src/validation/form-hooks";
import { zHandover } from "@/src/validation/schemas";
import { buildHandoverBundle } from "@/src/lib/fhir-map";
import type { RootStackParamList } from "@/src/navigation/RootNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "HandoverForm">;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16
  },
  section: {
    marginBottom: 24
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4
  },
  input: {
    borderColor: "#CBD5F5",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8
  },
  error: {
    color: "#DC2626",
    marginBottom: 8
  },
  buttonWrapper: {
    marginTop: 12
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  flex: {
    flex: 1,
  },
  spacer: {
    width: 12
  }
});

export default function HandoverForm({ navigation, route }: Props) {
  const patientIdFromParams = route.params?.patientId;

  const form = useZodForm(zHandover, {
    unitId: "",
    start: new Date().toISOString(),
    end: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
    patientId: patientIdFromParams ?? "",
    staffIn: "",
    staffOut: ""
  });

  useEffect(() => {
    const current = form.getValues('patientId');
    if (patientIdFromParams && current !== patientIdFromParams && !form.formState.isDirty) {
      form.setValue("patientId", patientIdFromParams, { shouldValidate: true, shouldDirty: true });
    }
  }, [form, patientIdFromParams]);

  const { control, formState: { errors } } = form;

  const onSubmit = form.handleSubmit(async (values) => {
    const bundle = buildHandoverBundle(values as any);
    console.log("BUNDLE_READY", JSON.stringify(bundle, null, 2));
    Alert.alert("Entrega guardada (stub) y validada por Zod.");
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.section}>
        <Text style={styles.label}>Unidad</Text>
        <Controller
          control={control}
          name="unitId"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="Unidad"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.unitId && <Text style={styles.error}>{errors.unitId.message as string}</Text>}

        <Text style={styles.label}>Inicio</Text>
        <Controller
          control={control}
          name="start"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="Inicio (ISO)"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.start && <Text style={styles.error}>{errors.start.message as string}</Text>}

        <Text style={styles.label}>Fin</Text>
        <Controller
          control={control}
          name="end"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="Fin (ISO)"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.end && <Text style={styles.error}>{errors.end.message as string}</Text>}

        <Text style={styles.label}>Enfermería entrante</Text>
        <Controller
          control={control}
          name="staffIn"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="Entrante"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.staffIn && <Text style={styles.error}>{errors.staffIn.message as string}</Text>}

        <Text style={styles.label}>Enfermería saliente</Text>
        <Controller
          control={control}
          name="staffOut"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="Saliente"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.staffOut && <Text style={styles.error}>{errors.staffOut.message as string}</Text>}

        <Text style={styles.label}>Paciente</Text>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Controller
              control={control}
              name="patientId"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={styles.input}
                  placeholder="patientId"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value ?? ''}
                  autoCapitalize="none"
                />
              )}
            />
            {errors.patientId && <Text style={styles.error}>{errors.patientId.message as string}</Text>}
          </View>
          <View style={styles.spacer} />
          <Button
            title="Escanear"
            onPress={() => navigation.navigate('QRScan', { returnTo: 'HandoverForm' })}
          />
        </View>
      </View>

      <View style={styles.buttonWrapper}>
        <Button title="GUARDAR" onPress={onSubmit} />
      </View>
    </ScrollView>
  );
}
