// src/screens/HandoverForm.tsx
import React, { useEffect } from "react";
import {
  Alert,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Controller } from "react-hook-form";

import { useZodForm } from "@/src/validation/form-hooks";
import { zHandover } from "@/src/validation/schemas";
import { buildHandoverBundle } from "@/src/lib/fhir-map";
import type { RootStackParamList } from "@/src/navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "HandoverForm">;

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  section: { marginBottom: 24 },
  h2: { fontSize: 18, fontWeight: "600", marginBottom: 12 },
  label: { fontSize: 16, fontWeight: "600", marginBottom: 4 },
  input: {
    borderColor: "#CBD5F5",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  inputError: { borderColor: "#DC2626" },
  error: { color: "#DC2626", marginBottom: 8 },
  buttonWrapper: { marginTop: 12 },
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1 },
  spacer: { width: 12 },
});

export default function HandoverForm({ navigation, route }: Props) {
  // Params seguros (si vienen undefined no rompen)
  const {
    patientId: patientIdParam,
    unitId: unitIdParam,
    specialtyId,
  } = route.params ?? {};

  // Estado inicial del form
  const form = useZodForm(zHandover, {
    unitId: unitIdParam ?? "",
    start: new Date().toISOString(),
    end: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
    patientId: patientIdParam ?? "",
    staffIn: "",
    staffOut: "",
    dxMedical: "",
    dxNursing: "",
    evolution: "",
  });

  // Sincroniza params -> form SOLO si no está dirty (evita pisar cambios del usuario)
  useEffect(() => {
    const isDirty = Boolean((form.formState as { isDirty?: boolean })?.isDirty);

    if (patientIdParam) {
      const currentPid = form.getValues("patientId");
      if (!isDirty && currentPid !== patientIdParam) {
        form.setValue("patientId", patientIdParam, {
          shouldValidate: true,
          shouldDirty: true,
        });
      }
    }

    if (unitIdParam) {
      const currentUnit = form.getValues("unitId");
      if (!isDirty && currentUnit !== unitIdParam) {
        form.setValue("unitId", unitIdParam, {
          shouldValidate: true,
          shouldDirty: true,
        });
      }
    }
  }, [form, patientIdParam, unitIdParam]);

  const { control, formState } = form;
  const errors = (formState as any)?.errors ?? {};

  // Permite 36,5 => 36.5 y vacíos => undefined
  const parseNumericInput = (value: string) => {
    if (value === "") return undefined;
    const normalized = value.replace(",", ".");
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? undefined : parsed;
    // Los límites/validaciones exactos los aplica Zod (schema)
  };

  const onScanPress = () => {
    const routeNames =
      (navigation as any)?.getState?.()?.routeNames ?? ([] as string[]);
    if (routeNames.includes("QRScan")) {
      navigation.navigate("QRScan" as never, { returnTo: "HandoverForm" } as never);
    } else {
      Alert.alert(
        "Escáner no disponible",
        "Esta build no incluye la pantalla de QR (opcional para demo)."
      );
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    const splitCsv = (s?: string) =>
      (s ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

    const bundle = buildHandoverBundle({
      ...values,
      specialtyId,
      dxMedical: splitCsv(values.dxMedical),
      dxNursing: splitCsv(values.dxNursing),
    } as any);

    console.log("BUNDLE_READY", JSON.stringify(bundle, null, 2));
    Alert.alert("Entrega guardada (demo)", "Validada con Zod y lista para enviar.");
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
              style={[styles.input, errors.unitId && styles.inputError]}
              placeholder="Unidad"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.unitId && (
          <Text style={styles.error}>{errors.unitId.message as string}</Text>
        )}

        <Text style={styles.label}>Inicio</Text>
        <Controller
          control={control}
          name="start"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={[styles.input, errors.start && styles.inputError]}
              placeholder="Inicio (ISO)"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.start && (
          <Text style={styles.error}>{errors.start.message as string}</Text>
        )}

        <Text style={styles.label}>Fin</Text>
        <Controller
          control={control}
          name="end"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={[styles.input, errors.end && styles.inputError]}
              placeholder="Fin (ISO)"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.end && (
          <Text style={styles.error}>{errors.end.message as string}</Text>
        )}

        <Text style={styles.label}>Enfermería entrante</Text>
        <Controller
          control={control}
          name="staffIn"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={[styles.input, errors.staffIn && styles.inputError]}
              placeholder="Entrante"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.staffIn && (
          <Text style={styles.error}>{errors.staffIn.message as string}</Text>
        )}

        <Text style={styles.label}>Enfermería saliente</Text>
        <Controller
          control={control}
          name="staffOut"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={[styles.input, errors.staffOut && styles.inputError]}
              placeholder="Saliente"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.staffOut && (
          <Text style={styles.error}>{errors.staffOut.message as string}</Text>
        )}

        <Text style={styles.label}>Paciente</Text>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Controller
              control={control}
              name="patientId"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={[styles.input, errors.patientId && styles.inputError]}
                  placeholder="Paciente"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value ?? ""}
                />
              )}
            />
          </View>
          <View style={styles.spacer} />
          <Button title="ESCANEAR" onPress={onScanPress} />
        </View>
        {errors.patientId && (
          <Text style={styles.error}>{errors.patientId.message as string}</Text>
        )}

        <Text style={styles.h2}>Diagnósticos</Text>

        <Text style={styles.label}>Médicos (separados por coma)</Text>
        <Controller
          control={control}
          name="dxMedical"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={[styles.input, errors.dxMedical && styles.inputError]}
              placeholder="Diagnósticos médicos"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.dxMedical && (
          <Text style={styles.error}>{errors.dxMedical.message as string}</Text>
        )}

        <Text style={styles.label}>Enfermería (separados por coma)</Text>
        <Controller
          control={control}
          name="dxNursing"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={[styles.input, errors.dxNursing && styles.inputError]}
              placeholder="Diagnósticos de enfermería"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.dxNursing && (
          <Text style={styles.error}>{errors.dxNursing.message as string}</Text>
        )}

        <Text style={styles.h2}>Evolución</Text>
        <Controller
          control={control}
          name="evolution"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={[styles.input, { height: 120, textAlignVertical: "top" }]}
              multiline
              placeholder="Notas de evolución"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        {errors.evolution && (
          <Text style={styles.error}>{errors.evolution.message as string}</Text>
        )}

        <View style={styles.buttonWrapper}>
          <Button title="Guardar" onPress={onSubmit} />
        </View>
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
              {!!fieldState.error && (
                <Text style={styles.error}>{fieldState.error.message}</Text>
              )}
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
              {!!fieldState.error && (
                <Text style={styles.error}>{fieldState.error.message}</Text>
              )}
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
              {!!fieldState.error && (
                <Text style={styles.error}>{fieldState.error.message}</Text>
              )}
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
              {!!fieldState.error && (
                <Text style={styles.error}>{fieldState.error.message}</Text>
              )}
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
              {!!fieldState.error && (
                <Text style={styles.error}>{fieldState.error.message}</Text>
              )}
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
              {!!fieldState.error && (
                <Text style={styles.error}>{fieldState.error.message}</Text>
              )}
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
              {!!fieldState.error && (
                <Text style={styles.error}>{fieldState.error.message}</Text>
              )}
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
            justifyContent: "center",
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
