import React, { useEffect } from "react";
import { Alert, Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Controller } from "react-hook-form";

import { useZodForm } from "@/src/validation/form-hooks";
import { zHandover } from "@/src/validation/schemas";
import { buildHandoverBundle } from "@/src/lib/fhir-map";
import type { RootStackParamList } from "@/src/navigation/types";
import AudioAttach from "@/src/components/AudioAttach";
import { transcribeAudio } from "@/src/lib/stt";

type Props = NativeStackScreenProps<RootStackParamList, "HandoverForm">;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16
  },
  section: {
    marginBottom: 24
  },
  h2: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12
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
  inputError: {
    borderColor: "#DC2626"
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
  const { patientId, unitId, specialtyId } = route.params;

  const form = useZodForm(zHandover, {
    unitId: unitId ?? "",
    start: new Date().toISOString(),
    end: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
    patientId: patientId ?? "",
    staffIn: "",
    staffOut: "",
    dxMedical: "",
    dxNursing: "",
    evolution: ""
  });

  useEffect(() => {
    const current = form.getValues('patientId');
    if (patientId && current !== patientId && !form.formState.isDirty) {
      form.setValue("patientId", patientId, { shouldValidate: true, shouldDirty: true });
    }
    const currentUnit = form.getValues('unitId');
    if (unitId && currentUnit !== unitId && !form.formState.isDirty) {
      form.setValue("unitId", unitId, { shouldValidate: true, shouldDirty: true });
    }
  }, [form, patientId, unitId]);

  const { control, formState: { errors }, setValue, getValues } = form;

  const parseNumericInput = (value: string) => {
    if (value === "") {
      return undefined;
    }
    const normalized = value.replace(",", ".");
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const onSubmit = form.handleSubmit(async (values) => {
    const splitCsv = (s?: string) =>
      (s ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

    const dxMed = splitCsv(values.dxMedical);
    const dxNur = splitCsv(values.dxNursing);

    const bundle = buildHandoverBundle({
      ...values,
      specialtyId,
      dxMedical: dxMed,
      dxNursing: dxNur
    } as any);
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
                  placeholder="Paciente"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value ?? ""}
                />
              )}
            />
          </View>
          <View style={styles.spacer} />
          <Button title="Escanear" onPress={() => navigation.navigate('QRScan', { returnTo: 'HandoverForm' })} />
        </View>
        {errors.patientId && <Text style={styles.error}>{errors.patientId.message as string}</Text>}

        <Text style={styles.h2}>Diagnósticos</Text>
        <Text style={styles.label}>Médicos (separados por coma)</Text>
        <Controller
          control={control}
          name="dxMedical"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={[styles.input, errors.dxMedical ? styles.inputError : undefined]}
              placeholder="Diagnósticos médicos"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.dxMedical && <Text style={styles.error}>{errors.dxMedical.message as string}</Text>}

        <Text style={styles.label}>Enfermería (separados por coma)</Text>
        <Controller
          control={control}
          name="dxNursing"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={[styles.input, errors.dxNursing ? styles.inputError : undefined]}
              placeholder="Diagnósticos de enfermería"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.dxNursing && <Text style={styles.error}>{errors.dxNursing.message as string}</Text>}

        <Text style={styles.h2}>Evolución</Text>
        <Controller
          control={control}
          name="evolution"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={[styles.input, { height: 120, textAlignVertical: 'top' }]}
              multiline
              placeholder="Notas de evolución"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.evolution && <Text style={styles.error}>{errors.evolution.message as string}</Text>}

        <View style={styles.buttonWrapper}>
          <Button title="Guardar" onPress={onSubmit} />
        </View>
      </View>

      <View style={styles.section}>
        <AudioAttach
          onAttach={async (uri) => {
            const text = await transcribeAudio(uri);
            setValue('evolution', `${getValues('evolution')}${text ? `\n${text}` : ''}`);
          }}
        />
      </View>
    </ScrollView>
  );
}
