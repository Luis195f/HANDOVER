import React, { useEffect } from "react";
import { Alert, Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Controller } from "react-hook-form";

import { useZodForm } from "@/src/validation/form-hooks";
import { zHandover } from "@/src/validation/schemas";
import { buildHandoverBundle } from "@/src/lib/fhir-map";
import type { RootStackParamList } from "@/src/navigation/RootNavigator";
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
  const patientIdFromParams = route.params?.patientId;

  const form = useZodForm(zHandover, {
    unitId: "",
    start: new Date().toISOString(),
    end: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
    patientId: patientIdFromParams ?? "",
    staffIn: "",
    staffOut: "",
    dxMedical: "",
    dxNursing: "",
    evolution: ""
  });

  useEffect(() => {
    const current = form.getValues('patientId');
    if (patientIdFromParams && current !== patientIdFromParams && !form.formState.isDirty) {
      form.setValue("patientId", patientIdFromParams, { shouldValidate: true, shouldDirty: true });
    }
  }, [form, patientIdFromParams]);

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

      <View style={styles.section}>
        <Text style={styles.h2}>Diagnóstico / Evolución</Text>

        <Text style={styles.label}>Dx médicos</Text>
        <Controller
          control={control}
          name="dxMedical"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="Dx médicos, separados por coma"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.dxMedical && <Text style={styles.error}>{errors.dxMedical.message as string}</Text>}

        <Text style={styles.label}>Dx enfermería</Text>
        <Controller
          control={control}
          name="dxNursing"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="Dx enfermería, separados por coma"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.dxNursing && <Text style={styles.error}>{errors.dxNursing.message as string}</Text>}

        <Text style={styles.label}>Evolución</Text>
        <Controller
          control={control}
          name="evolution"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={[styles.input, { minHeight: 120, textAlignVertical: "top" }]}
              placeholder="Evolución"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
              multiline
            />
          )}
        />
        {errors.evolution && <Text style={styles.error}>{errors.evolution.message as string}</Text>}

        <AudioAttach
          onRecorded={async (uri) => {
            setValue("audioUri", uri, { shouldDirty: true });
            const transcript = await transcribeAudio(uri);
            const previous = getValues("evolution") ?? "";
            const trimmed = previous.trim();
            const nextEvolution = trimmed.length ? `${trimmed}\n${transcript}` : transcript;
            setValue("evolution", nextEvolution, { shouldDirty: true, shouldValidate: true });
          }}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.h2}>Signos vitales</Text>

        <Controller
          control={control}
          name="vitals.hr"
          render={({ field, fieldState }) => (
            <>
              <TextInput
                placeholder="Frecuencia cardíaca (/min)"
                keyboardType="numeric"
                value={field.value?.toString() ?? ""}
                onChangeText={(t) => field.onChange(parseNumericInput(t))}
                style={[styles.input, fieldState.error && styles.inputError]}
              />
              {!!fieldState.error && <Text style={styles.error}>{fieldState.error.message}</Text>}
            </>
          )}
        />

        <Controller
          control={control}
          name="vitals.rr"
          render={({ field, fieldState }) => (
            <>
              <TextInput
                placeholder="Frecuencia respiratoria (/min)"
                keyboardType="numeric"
                value={field.value?.toString() ?? ""}
                onChangeText={(t) => field.onChange(parseNumericInput(t))}
                style={[styles.input, fieldState.error && styles.inputError]}
              />
              {!!fieldState.error && <Text style={styles.error}>{fieldState.error.message}</Text>}
            </>
          )}
        />

        <Controller
          control={control}
          name="vitals.temp"
          render={({ field, fieldState }) => (
            <>
              <TextInput
                placeholder="Temperatura (°C)"
                keyboardType="numeric"
                value={field.value?.toString() ?? ""}
                onChangeText={(t) => field.onChange(parseNumericInput(t))}
                style={[styles.input, fieldState.error && styles.inputError]}
              />
              {!!fieldState.error && <Text style={styles.error}>{fieldState.error.message}</Text>}
            </>
          )}
        />

        <Controller
          control={control}
          name="vitals.spo2"
          render={({ field, fieldState }) => (
            <>
              <TextInput
                placeholder="SpO₂ (%)"
                keyboardType="numeric"
                value={field.value?.toString() ?? ""}
                onChangeText={(t) => field.onChange(parseNumericInput(t))}
                style={[styles.input, fieldState.error && styles.inputError]}
              />
              {!!fieldState.error && <Text style={styles.error}>{fieldState.error.message}</Text>}
            </>
          )}
        />

        <Controller
          control={control}
          name="vitals.sbp"
          render={({ field, fieldState }) => (
            <>
              <TextInput
                placeholder="Tensión sistólica (mmHg)"
                keyboardType="numeric"
                value={field.value?.toString() ?? ""}
                onChangeText={(t) => field.onChange(parseNumericInput(t))}
                style={[styles.input, fieldState.error && styles.inputError]}
              />
              {!!fieldState.error && <Text style={styles.error}>{fieldState.error.message}</Text>}
            </>
          )}
        />

        <Controller
          control={control}
          name="vitals.dbp"
          render={({ field, fieldState }) => (
            <>
              <TextInput
                placeholder="Tensión diastólica (mmHg)"
                keyboardType="numeric"
                value={field.value?.toString() ?? ""}
                onChangeText={(t) => field.onChange(parseNumericInput(t))}
                style={[styles.input, fieldState.error && styles.inputError]}
              />
              {!!fieldState.error && <Text style={styles.error}>{fieldState.error.message}</Text>}
            </>
          )}
        />

        <Controller
          control={control}
          name="vitals.bgMgDl"
          render={({ field, fieldState }) => (
            <>
              <TextInput
                placeholder="Glucemia (mg/dL)"
                keyboardType="numeric"
                value={field.value?.toString() ?? ""}
                onChangeText={(t) => field.onChange(parseNumericInput(t))}
                style={[styles.input, fieldState.error && styles.inputError]}
              />
              {!!fieldState.error && <Text style={styles.error}>{fieldState.error.message}</Text>}
            </>
          )}
        />

        <View
          testID="vitals-trend"
          style={{
            height: 140,
            borderWidth: 1,
            borderColor: "#E5E7EB",
            borderRadius: 8,
            marginTop: 8,
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <Text>Trend chart placeholder</Text>
        </View>
      </View>

      <View style={styles.buttonWrapper}>
        <Button title="GUARDAR" onPress={onSubmit} />
      </View>
    </ScrollView>
  );
}
