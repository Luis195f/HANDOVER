// src/screens/HandoverForm.tsx
// MVP Interoperable: tema oscuro, NEWS2, DBP, O₂ (dispositivo + flujo + FiO2),
// fechas inicio/fin (con botón "Ahora"), grabar/reproducir audios, autosave local,
// adjuntar audios a FHIR como DocumentReference, y envío directo a FHIR o vía backend.

import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import {
  View, Text, TextInput, Button, ScrollView, Switch, KeyboardAvoidingView, Keyboard,
  Platform, TouchableOpacity, Pressable, StyleSheet, Alert, useColorScheme, StatusBar
} from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import { z } from "zod";
import { Controller } from "react-hook-form";
import * as FileSystem from "expo-file-system";
import { useAudioPlayer } from "expo-audio";
import { v4 as uuidv4 } from "uuid";

import { UNITS } from "@/src/catalogs/units";
import { mark } from "@/src/lib/otel";
import { buildHandoverBundle, HandoverValues } from "@/src/lib/fhir-map";
import { enqueueTx, flushQueue } from "@/src/lib/queue";
import { postTransactionBundle } from "@/src/lib/fhir-client";
import { ENV, FHIR_BASE_URL } from "@/src/config/env";
import type { RootStackParamList } from "@/src/navigation/RootNavigator";
import { useZodForm } from "@/src/validation/form-hooks";

import { news2Score, news2PriorityTag } from "@/src/lib/priority";
import { prefillFromFHIR } from "@/src/lib/prefill";
import { alertsFrom } from "@/src/lib/alerts";
import { hasUnitAccess, normalizeUnitId } from "@/src/security/acl";
import AudioAttach from "@/src/components/AudioAttach";

/* ------------------------ FS compat (expo-file-system v19) ----------------- */
const DOC_DIR =
  (FileSystem as any).documentDirectory ??
  (FileSystem as any).cacheDirectory ??
  "";

/* --------------------------- Autosave local simple -------------------------- */
type DraftAPI<T> = { load: () => Promise<T | null>; save: (data: T) => Promise<void>; clear: () => Promise<void> };
function useLocalDraft<T extends object>(key: string): DraftAPI<T> {
  const dir = `${DOC_DIR}drafts/`;
  const path = `${dir}${key}.json`;
  async function ensureDir() {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return {
    load: async () => {
      try {
        await ensureDir();
        const info = await FileSystem.getInfoAsync(path);
        if (!info.exists) return null;
        const str = await FileSystem.readAsStringAsync(path, { encoding: "utf8" as const });
        return JSON.parse(str) as T;
      } catch {
        return null;
      }
    },
    save: async (data) => {
      try {
        await ensureDir();
        await FileSystem.writeAsStringAsync(path, JSON.stringify(data), { encoding: "utf8" as const });
      } catch {}
    },
    clear: async () => { try { await FileSystem.deleteAsync(path as any, { idempotent: true } as any); } catch {} }
  };
}

/* ---------------------------------- Schema --------------------------------- */
const zVitals = z.object({
  rr: z.coerce.number().int().nonnegative().optional(),
  hr: z.coerce.number().int().nonnegative().optional(),
  sbp: z.coerce.number().int().nonnegative().optional(),
  dbp: z.coerce.number().int().nonnegative().optional(),
  temp: z.coerce.number().positive().optional(),
  spo2: z.coerce.number().int().min(0).max(100).optional(),
  o2: z.boolean().default(false),
  o2Device: z.enum([
    "roomAir","nasalCannula","simpleMask","nonRebreather","venturi",
    "highFlowNasalCannula","cpapBipap","mechanicalVentilation","trachCollar",
  ]).optional(),
  o2FlowLpm: z.coerce.number().min(0).max(100).optional(),
  fio2: z.coerce.number().min(21).max(100).optional(),
  acvpu: z.enum(["A","C","V","P","U"]).default("A"),
});

const zAdmin = z.object({
  unitId: z.string().min(1, "Unidad requerida"),
  shiftStart: z.string().min(5, "Inicio requerido"),
  shiftEnd: z.string().min(5, "Fin requerido"),
  staff: z.object({
    nurseIn: z.string().min(1, "Entrante requerido"),
    nurseOut: z.string().min(1, "Saliente requerido"),
    auxiliaries: z.array(z.string()).optional(),
  }),
  census: z.object({
    total: z.coerce.number().int().nonnegative(),
    occupied: z.coerce.number().int().nonnegative(),
    admissions: z.coerce.number().int().nonnegative(),
    discharges: z.coerce.number().int().nonnegative(),
  }),
  incidents: z.string().optional(),
});

const zClose = z.object({
  signedBy: z.array(z.string()).default([]),
  signedAt: z.string().optional(),
  bedsideChecklist: z.object({
    idWristband: z.boolean().default(true),
    linesChecked: z.boolean().default(true),
    bedrails: z.boolean().default(true),
    devicesOk: z.boolean().default(true),
  }),
  summary: z.string().optional(),
  audioUri: z.string().optional(),
});

const zForm = z.object({
  patientId: z.string().min(1, "Paciente requerido"),
  admin: zAdmin,
  vitals: zVitals.default({ o2: false, acvpu: "A", o2Device: "roomAir" }),
  notes: z.string().optional(),
  notesAudioUri: z.string().optional(),
  incidentsAudioUri: z.string().optional(),
  checklistAudioUri: z.string().optional(),
  close: zClose,
});
type Form = z.infer<typeof zForm>;

/* ----------------------- Audio → FHIR (DocumentReference) ------------------ */
const readAsBase64 = async (uri: string): Promise<string> =>
  FileSystem.readAsStringAsync(uri, { encoding: "base64" as const });

const guessAudioContentType = (filename?: string) => {
  const m = (filename ?? "").toLowerCase().match(/\.(m4a|aac|mp4|3gp|3gpp|wav|ogg|oga|mp3)$/i);
  const ext = m?.[1] ?? "";
  switch (ext) { case "m4a": return "audio/m4a"; case "aac": return "audio/aac"; case "mp4": return "audio/mp4";
    case "3gp": case "3gpp": return "audio/3gpp"; case "wav": return "audio/wav";
    case "ogg": case "oga": return "audio/ogg"; default: return "audio/mpeg"; }
};
function augmentBundleWithAudio(bundle: any, opts: { audioDataB64: string; contentType: string; patientId: string; audioFilename?: string; label?: string }) {
  if (!bundle || !Array.isArray(bundle.entry)) return bundle;
  const encEntry = bundle.entry.find((e: any) => e?.resource?.resourceType === "Encounter");
  const patEntry = bundle.entry.find((e: any) => e?.resource?.resourceType === "Patient");
  const encounterRef = encEntry?.fullUrl ? { reference: encEntry.fullUrl } : undefined;
  const patientRef = patEntry?.fullUrl ? { reference: patEntry.fullUrl } : { reference: `Patient/${opts.patientId}` };
  const now = new Date().toISOString();
  const docId = `dr-${uuidv4()}`;
  const docRef = {
    fullUrl: `urn:uuid:${docId}`,
    resource: {
      resourceType: "DocumentReference",
      status: "current",
      type: { text: opts.label ?? "Handover Audio" },
      subject: patientRef,
      date: now,
      ...(encounterRef ? { context: { encounter: [encounterRef] } } : {}),
      content: [{ attachment: { contentType: opts.contentType, data: opts.audioDataB64, title: opts.audioFilename ?? `audio-${docId}.m4a` } }],
    },
  };
  return { ...bundle, entry: [...bundle.entry, docRef] };
}
async function addAudioUriToBundle(bundle: any, maybeUri?: string, patientId?: string, label?: string) {
  if (!maybeUri || !patientId) return bundle;
  try {
    const info = await FileSystem.getInfoAsync(maybeUri);
    if (!info.exists) return bundle;
    const fname = maybeUri.split("/").pop();
    const b64 = await readAsBase64(maybeUri);
    const contentType = guessAudioContentType(fname);
    return augmentBundleWithAudio(bundle, { audioDataB64: b64, contentType, patientId, audioFilename: fname, label });
  } catch { return bundle; }
}

/* --------------------------- Constantes/UI auxiliares ---------------------- */
const OXYGEN_DEVICES = [
  { code: "roomAir", label: "Aire ambiente" },
  { code: "nasalCannula", label: "Cánula nasal" },
  { code: "simpleMask", label: "Mascarilla simple" },
  { code: "nonRebreather", label: "No reinhalación" },
  { code: "venturi", label: "Venturi" },
  { code: "highFlowNasalCannula", label: "Alto flujo (HFNC)" },
  { code: "cpapBipap", label: "CPAP/BiPAP" },
  { code: "mechanicalVentilation", label: "Ventilación mecánica" },
  { code: "trachCollar", label: "Collar traqueal" },
] as const;
const TABS = ["Censo", "Signos", "Notas", "Checklist", "Firmas"] as const;

/* --------------------------------- Componente ------------------------------ */
export default function HandoverForm() {
  const route = useRoute<RouteProp<RootStackParamList, "HandoverForm">>();

  // Tolerar params extendidos aunque RootStackParamList no los defina
  type NavParams = Partial<{ patientId: string; unit: string; specialty: string }>;
  const params = (route.params ?? {}) as NavParams;

  const unitIdFromParams = useMemo(() => resolveUnitId(params?.unit) ?? firstUnitId, [params?.unit]);
  const patientId = params?.patientId ?? "";
  const specialtyFromParams = params?.specialty ?? "";

  const [authorId, setAuthorId] = useState<string | undefined>(undefined);
  const [hasToken, setHasToken] = useState<boolean>(false);

  const { control, handleSubmit, setValue, watch, getValues, reset, formState: { errors, isSubmitting } } = useZodForm(zForm, {
    defaultValues: {
      patientId,
      notes: specialtyFromParams ? `Especialidad: ${specialtyFromParams}\n` : "",
      vitals: { o2: false, acvpu: "A", o2Device: "roomAir" },
      admin: {
        unitId: unitIdFromParams,
        shiftStart: toLocalISO(new Date()),
        shiftEnd: toLocalISO(new Date(Date.now() + 4 * 3600 * 1000)),
        staff: { nurseIn: "nurse-entrante", nurseOut: "nurse-saliente" },
        census: { total: 0, occupied: 0, admissions: 0, discharges: 0 },
        incidents: "",
      },
      close: { signedBy: [], signedAt: undefined, bedsideChecklist: { idWristband: true, linesChecked: true, bedrails: true, devicesOk: true }, summary: "" },
    },
  });

  // Estado UI
  const [tab, setTab] = useState<(typeof TABS)[number]>("Censo");
  const scrollRef = useRef<ScrollView>(null);
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const s = Keyboard.addListener("keyboardDidShow", (e) => setKbHeight(e.endCoordinates.height));
    const h = Keyboard.addListener("keyboardDidHide", () => setKbHeight(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  const notesAudioUriLocal = watch("notesAudioUri");
  const incidentsAudioUriLocal = watch("incidentsAudioUri");
  const checklistAudioUriLocal = watch("checklistAudioUri");
  const closeAudioUriLocal = watch("close.audioUri");

  // Sesión mock (si no tienes Auth todavía)
  useEffect(() => {
    (async () => {
      try {
        const s = await (Auth.getSession?.() ?? Promise.resolve(null));
        setAuthorId(s?.user?.id ?? s?.sub ?? undefined);
        setHasToken(Boolean(s?.accessToken));
      } catch { setAuthorId(undefined); setHasToken(false); }
    })();
  }, []);

  // Autosave + prefill
  const draft = useLocalDraft<Form>(`handover-${patientId}`);
  useEffect(() => {
    (async () => {
      const data = await draft.load();
      if (data) reset({ ...getValues(), ...data });
      const pf = await prefillFromFHIR({ fhirBase: ENV.FHIR_BASE_URL ?? FHIR_BASE_URL, patientId, token: hasToken ? "mock-token" : undefined });
      const current = getValues();
      reset({ ...current, notes: pf.dxText ? `${pf.dxText}\n\n${current.notes ?? ""}` : current.notes, vitals: { ...(current.vitals ?? {}), ...(pf.vitals ?? {}) } });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, hasToken]);
  const watchAll = watch();
  useEffect(() => { const id = setTimeout(() => draft.save(getValues()), 700); return () => clearTimeout(id); }, [watchAll]); // eslint-disable-line

  // NEWS2/alertas
  const rr = watch("vitals.rr"); const hr = watch("vitals.hr"); const sbp = watch("vitals.sbp"); const dbp = watch("vitals.dbp");
  const temp = watch("vitals.temp"); const spo2 = watch("vitals.spo2"); const o2 = watch("vitals.o2");
  const o2Device = watch("vitals.o2Device"); const o2FlowLpm = watch("vitals.o2FlowLpm"); const fio2 = watch("vitals.fio2");
  const acvpu = watch("vitals.acvpu"); const checklist = watch("close.bedsideChecklist"); const census = watch("admin.census");
  const score = useMemo(() => news2Score({ rr, hr, sbp, temp, spo2, o2, acvpu }), [rr, hr, sbp, temp, spo2, o2, acvpu]);
  const alerts = useMemo(() => alertsFrom({ vitals: { rr, hr, sbp, dbp, temp, spo2, o2, acvpu, o2Device, o2FlowLpm, fio2 }, checklist, census }),
    [rr, hr, sbp, dbp, temp, spo2, o2, acvpu, o2Device, o2FlowLpm, fio2, checklist, census]);
  const { level, color } = news2PriorityTag(score);

  // Envío (directo a FHIR o vía backend si ENV.API_BASE está definido)
  async function postBundleSmart(bundle: any): Promise<Response | { ok: boolean; status: number }> {
    if (ENV.API_BASE) {
      const r = await fetch(`${ENV.API_BASE}/fhir/transaction`, {
        method: "POST",
        headers: {
          "Content-Type": "application/fhir+json",
          Authorization: ENV.API_TOKEN ? `Bearer ${ENV.API_TOKEN}` : "",
          "X-User-Id": authorId ?? "anonymous",            // 👈 para AuditEvent
          "X-Unit-Id": getValues().admin.unitId ?? "",     // 👈 para AuditEvent
        },
        body: JSON.stringify(bundle),
      });
      if (!r.ok) throw new Error(`Backend ${r.status}`);
      return r;
    }
    return await postTransactionBundle({
      fhirBase: ENV.FHIR_BASE_URL ?? FHIR_BASE_URL,
      bundle,
      token: hasToken ? "mock-token" : undefined,
    });
  }

  const onSubmit = handleSubmit(async (values) => {
    const normalized = normalizeUnitId(values.admin.unitId);
    if (normalized && normalized !== values.admin.unitId) { setValue("admin.unitId", normalized, { shouldValidate: true }); values.admin.unitId = normalized; }
    if (!(await hasUnitAccess(values.admin.unitId))) { Alert.alert("Alert", "No tienes acceso a esta unidad."); return; }
    if ((values.close.signedBy?.length ?? 0) > 0 && !values.close.signedAt) values.close.signedAt = new Date().toISOString();

    mark("handover.save.start", { unit: values.admin.unitId, patient: values.patientId });

    let bundle = buildHandoverBundle(values as unknown as HandoverValues, { authorId });
    bundle = await addAudioUriToBundle(bundle, values.notesAudioUri, values.patientId, "Notas/Evolución");
    bundle = await addAudioUriToBundle(bundle, values.incidentsAudioUri, values.patientId, "Incidencias");
    bundle = await addAudioUriToBundle(bundle, values.checklistAudioUri, values.patientId, "Notas de checklist");
    bundle = await addAudioUriToBundle(bundle, values.close.audioUri, values.patientId, "Handover (Firmas)");

    await enqueueTx({ type: "handover.save", key: `handover-${values.patientId}-${Date.now()}`, payload: { fhirBase: ENV.FHIR_BASE_URL ?? FHIR_BASE_URL, bundle } });

    Alert.alert("OK", "Entrega guardada. Si hay conexión se enviará en segundo plano.");
    flushQueue(async (tx) => {
      const { bundle } = tx.payload ?? {};
      if (!bundle) {
        return { ok: false, status: 400 };
      }
      return await postBundleSmart(bundle);
    })
      .then(() => draft.clear().catch(() => {}))
      .catch((e) => mark("handover.flush.err", { patient: values.patientId, err: String(e) }));
  });

  const errorsCount = Object.keys(errors ?? {}).length + [errors?.admin, errors?.vitals, errors?.close].filter(Boolean).length;
  const isDark = useColorScheme() === "dark";
  const tabTokens = { bg: isDark ? "#0B1220" : "#FFFFFF", border: isDark ? "#2C3655" : "#E5E7EB",
    activeText: isDark ? "#FFFFFF" : "#0F172A", inactiveText: isDark ? "#B6C2DE" : "#475569", indicator: isDark ? "#60A5FA" : "#1D4ED8" };
  const labelColor = { color: isDark ? "#E6EAF2" : "#111827" };

  return (
    <>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={tabTokens.bg} />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: tabTokens.bg }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}>
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <Text style={[{ fontSize: 20, fontWeight: "600", marginBottom: 8 }, labelColor]}>Entrega de turno</Text>
            <View style={{ backgroundColor: color, padding: 8, borderRadius: 8, marginBottom: 8 }}>
              <Text style={{ color: "white", fontWeight: "700" }}>Prioridad: {level} — NEWS2: {score}</Text>
              {errorsCount > 0 && <Text style={{ color: "#fee2e2", marginTop: 4 }}>Tienes {errorsCount} errores de validación</Text>}
            </View>
          </View>

          <Tabs
            tabs={TABS as unknown as string[]}
            current={tab}
            /* ✅ Wrapper para evitar el error de tipo al pasar setTab directamente */
            onChange={(t: string) => setTab(t as typeof tab)}
            tokens={tabTokens}
          />

          <ScrollView
            ref={scrollRef}
            style={{ flex: 1, backgroundColor: tabTokens.bg }}
            contentContainerStyle={{ padding: 16, paddingBottom: 24 + kbHeight }}
            keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets
          >
            {tab === "Censo" && (
              <>
                <SectionTitle text="Paciente / Administración" labelColor={labelColor} />
                <Field label="ID Paciente" error={errors.patientId?.message as string} labelColor={labelColor}>
                  <Controller control={control} name="patientId" render={({ field: { value, onChange } }) => (
                    <TextInput placeholder="pat-001" value={value} onChangeText={onChange} style={styles.input} returnKeyType="next" />
                  )} />
                </Field>

                <Field label="Unidad (id o nombre)" error={errors.admin?.unitId?.message as string} labelColor={labelColor}>
                  <Controller control={control} name="admin.unitId" render={({ field: { value, onChange } }) => (
                    <TextInput placeholder="icu-adulto" value={value} onChangeText={onChange} style={styles.input} returnKeyType="next" />
                  )} />
                </Field>

                <GridTwo>
                  <Field mini label="Inicio de turno (local ISO)" labelColor={labelColor}>
                    <Controller control={control} name="admin.shiftStart" render={({ field: { value, onChange } }) => (
                      <TextInput value={value} onChangeText={onChange} style={styles.input} />
                    )} />
                    <NowBtn onPress={() => setValue("admin.shiftStart", toLocalISO(new Date()))} />
                  </Field>
                  <Field mini label="Fin de turno (local ISO)" labelColor={labelColor}>
                    <Controller control={control} name="admin.shiftEnd" render={({ field: { value, onChange } }) => (
                      <TextInput value={value} onChangeText={onChange} style={styles.input} />
                    )} />
                    <NowBtn onPress={() => setValue("admin.shiftEnd", toLocalISO(new Date()))} />
                  </Field>
                </GridTwo>

                <Field label="Staff entrante" labelColor={labelColor}>
                  <Controller control={control} name="admin.staff.nurseIn" render={({ field: { value, onChange } }) => (
                    <TextInput value={value} onChangeText={onChange} style={styles.input} />
                  )} />
                </Field>

                <Field label="Staff saliente" labelColor={labelColor}>
                  <Controller control={control} name="admin.staff.nurseOut" render={({ field: { value, onChange } }) => (
                    <TextInput value={value} onChangeText={onChange} style={styles.input} />
                  )} />
                </Field>

                <SectionSubtitle text="Censo" labelColor={labelColor} />
                <FieldRow>
                  <Field mini label="Total" labelColor={labelColor}>
                    <Controller control={control} name="admin.census.total" render={({ field: { value, onChange } }) => (
                      <TextInput value={String(value ?? 0)} onChangeText={(t) => onChange(Number(t) || 0)} keyboardType="numeric" style={styles.input} />
                    )} />
                  </Field>
                  <Field mini label="Ocupados" labelColor={labelColor}>
                    <Controller control={control} name="admin.census.occupied" render={({ field: { value, onChange } }) => (
                      <TextInput value={String(value ?? 0)} onChangeText={(t) => onChange(Number(t) || 0)} keyboardType="numeric" style={styles.input} />
                    )} />
                  </Field>
                </FieldRow>

                <FieldRow>
                  <Field mini label="Ingresos" labelColor={labelColor}>
                    <Controller control={control} name="admin.census.admissions" render={({ field: { value, onChange } }) => (
                      <TextInput value={String(value ?? 0)} onChangeText={(t) => onChange(Number(t) || 0)} keyboardType="numeric" style={styles.input} />
                    )} />
                  </Field>
                  <Field mini label="Egresos" labelColor={labelColor}>
                    <Controller control={control} name="admin.census.discharges" render={({ field: { value, onChange } }) => (
                      <TextInput value={String(value ?? 0)} onChangeText={(t) => onChange(Number(t) || 0)} keyboardType="numeric" style={styles.input} />
                    )} />
                  </Field>
                </FieldRow>

                <Field label="Incidencias (texto)" labelColor={labelColor}>
                  <Controller control={control} name="admin.incidents" render={({ field: { value, onChange } }) => (
                    <TextInput multiline numberOfLines={3} value={value ?? ""} onChangeText={onChange} style={[styles.input, { textAlignVertical: "top" }]} />
                  )} />
                </Field>

                <SectionSubtitle text="Adjuntar audio de incidencias (opcional)" labelColor={labelColor} />
                <AudioAttach onRecorded={(uri) => setValue("incidentsAudioUri", uri)} />
                {!!incidentsAudioUriLocal && <AudioRow uri={incidentsAudioUriLocal} />}
              </>
            )}

            {tab === "Signos" && (
              <>
                <SectionTitle text="Signos Vitales" labelColor={labelColor} />
                <GridTwo>
                  <Field mini label="FR (rpm)" labelColor={labelColor}>
                    <Controller control={control} name="vitals.rr" render={({ field: { value, onChange } }) => (
                      <TextInput value={value?.toString() ?? ""} onChangeText={(t) => onChange(t === "" ? undefined : Number(t))} keyboardType="numeric" style={styles.input} />
                    )} />
                  </Field>
                  <Field mini label="FC (lpm)" labelColor={labelColor}>
                    <Controller control={control} name="vitals.hr" render={({ field: { value, onChange } }) => (
                      <TextInput value={value?.toString() ?? ""} onChangeText={(t) => onChange(t === "" ? undefined : Number(t))} keyboardType="numeric" style={styles.input} />
                    )} />
                  </Field>
                </GridTwo>

                <GridTwo>
                  <Field mini label="TAS (mmHg)" labelColor={labelColor}>
                    <Controller control={control} name="vitals.sbp" render={({ field: { value, onChange } }) => (
                      <TextInput value={value?.toString() ?? ""} onChangeText={(t) => onChange(t === "" ? undefined : Number(t))} keyboardType="numeric" style={styles.input} />
                    )} />
                  </Field>
                  <Field mini label="TAD (mmHg)" labelColor={labelColor}>
                    <Controller control={control} name="vitals.dbp" render={({ field: { value, onChange } }) => (
                      <TextInput value={value?.toString() ?? ""} onChangeText={(t) => onChange(t === "" ? undefined : Number(t))} keyboardType="numeric" style={styles.input} />
                    )} />
                  </Field>
                </GridTwo>

                <GridTwo>
                  <Field mini label="Saturación O₂ (%)" labelColor={labelColor}>
                    <Controller control={control} name="vitals.spo2" render={({ field: { value, onChange } }) => (
                      <TextInput value={value?.toString() ?? ""} onChangeText={(t) => onChange(t === "" ? undefined : Number(t))} keyboardType="numeric" style={styles.input} />
                    )} />
                  </Field>
                  <Field mini label="Temperatura (°C)" labelColor={labelColor}>
                    <Controller control={control} name="vitals.temp" render={({ field: { value, onChange } }) => (
                      <TextInput value={value?.toString() ?? ""} onChangeText={(t) => onChange(t === "" ? undefined : Number(t))} keyboardType="numeric" style={styles.input} />
                    )} />
                  </Field>
                </GridTwo>

                <GridTwo>
                  <Field mini label="NEWS2 (auto)" labelColor={labelColor}>
                    <View style={[styles.input, { justifyContent: "center" }]}><Text style={{ fontWeight: "700" }}>{score}</Text></View>
                  </Field>
                  <View style={{ flex: 1 }} />
                </GridTwo>

                <RowToggle label="Oxígeno suplementario" value={o2} onChange={(v) => {
                  setValue("vitals.o2", v);
                  if (!v) { setValue("vitals.o2Device", "roomAir"); setValue("vitals.o2FlowLpm", undefined); setValue("vitals.fio2", undefined); }
                }} />

                <SectionSubtitle text="Dispositivo de O₂" labelColor={labelColor} />
                <Chips options={OXYGEN_DEVICES as any} value={(o2Device ?? "roomAir") as string} onChange={(code) => setValue("vitals.o2Device", code as any)} />

                {(o2 || (o2Device && o2Device !== "roomAir")) && (
                  <GridTwo>
                    <Field mini label="Flujo (L/min)" labelColor={labelColor}>
                      <Controller control={control} name="vitals.o2FlowLpm" render={({ field: { value, onChange } }) => (
                        <TextInput value={value?.toString() ?? ""} onChangeText={(t) => onChange(t === "" ? undefined : Number(t))} keyboardType="numeric" style={styles.input} />
                      )} />
                    </Field>
                    <Field mini label="FiO₂ (%)" labelColor={labelColor}>
                      <Controller control={control} name="vitals.fio2" render={({ field: { value, onChange } }) => (
                        <TextInput value={value?.toString() ?? ""} onChangeText={(t) => onChange(t === "" ? undefined : Number(t))} keyboardType="numeric" style={styles.input} />
                      )} />
                    </Field>
                  </GridTwo>
                )}

                <Field label="ACVPU (Nivel de conciencia)" labelColor={labelColor}>
                  <ACVPUChips value={acvpu || "A"} onChange={(code) => setValue("vitals.acvpu", code)} />
                  <Text style={{ color: "#9fb3d9", marginTop: 6, fontSize: 12 }}>
                    A: Alerta · C: Confuso · V: Respuesta a Voz · P: Respuesta al Dolor · U: Inconsciente
                  </Text>
                </Field>

                {alerts.map((a, i) => (
                  <View key={i} style={{ backgroundColor: a.kind === "danger" ? "#fee2e2" : "#fef3c7", padding: 8, borderRadius: 8, marginBottom: 8 }}>
                    <Text style={{ color: "#111827" }}>{a.message}</Text>
                  </View>
                ))}
              </>
            )}

            {tab === "Notas" && (
              <>
                <SectionTitle text="Notas y Evolución" labelColor={labelColor} />
                <Field label="Evolución (texto)" labelColor={labelColor}>
                  <Controller control={control} name="notes" render={({ field: { value, onChange } }) => (
                    <TextInput multiline numberOfLines={5} value={value ?? ""} onChangeText={onChange}
                      style={[styles.input, { textAlignVertical: "top", minHeight: 120 }]} />
                  )} />
                </Field>

                <SectionSubtitle text="Adjuntar audio (opcional)" labelColor={labelColor} />
                <AudioAttach onRecorded={(uri) => setValue("notesAudioUri", uri)} />
                {!!notesAudioUriLocal && <AudioRow uri={notesAudioUriLocal} />}
              </>
            )}

            {tab === "Checklist" && (
              <>
                <SectionTitle text="Checklist de cabecera" labelColor={labelColor} />
                <RowToggle label="Pulsera de identificación verificada" value={watch("close.bedsideChecklist.idWristband")} onChange={(v) => setValue("close.bedsideChecklist.idWristband", v)} />
                <RowToggle label="Líneas/catéteres verificados" value={watch("close.bedsideChecklist.linesChecked")} onChange={(v) => setValue("close.bedsideChecklist.linesChecked", v)} />
                <RowToggle label="Barandas elevadas" value={watch("close.bedsideChecklist.bedrails")} onChange={(v) => setValue("close.bedsideChecklist.bedrails", v)} />
                <RowToggle label="Dispositivos OK" value={watch("close.bedsideChecklist.devicesOk")} onChange={(v) => setValue("close.bedsideChecklist.devicesOk", v)} />

                <SectionSubtitle text="Notas de checklist: audio (opcional)" labelColor={labelColor} />
                <AudioAttach onRecorded={(uri) => setValue("checklistAudioUri", uri)} />
                {!!checklistAudioUriLocal && <AudioRow uri={checklistAudioUriLocal} />}
              </>
            )}

            {tab === "Firmas" && (
              <>
                <SectionTitle text="Firmas y adjuntos" labelColor={labelColor} />
                <Field label="Firmas (IDs separados por coma)" labelColor={labelColor}>
                  <Controller control={control} name="close.signedBy" render={({ field: { value, onChange } }) => (
                    <TextInput placeholder="nurse-1, supervisor-2" value={Array.isArray(value) ? value.join(", ") : ""}
                      onChangeText={(t) => onChange(t.split(",").map((s) => s.trim()).filter(Boolean))}
                      style={styles.input} returnKeyType="done"
                      onSubmitEditing={() => { if (getValues().close.signedBy?.length) setValue("close.signedAt", new Date().toISOString()); Keyboard.dismiss(); }}
                    />
                  )} />
                </Field>
                {!!watch("close.signedAt") && <Text style={{ marginBottom: 8, color: "#64748b" }}>Firmado: {toLocalISO(new Date(watch("close.signedAt")!))}</Text>}

                <SectionSubtitle text="Audio de cierre (opcional)" labelColor={labelColor} />
                <AudioAttach onRecorded={(uri) => setValue("close.audioUri", uri)} />
                {!!closeAudioUriLocal && <AudioRow uri={closeAudioUriLocal} />}
              </>
            )}

            <View style={{ height: 24 }} />
          </ScrollView>

          <View style={{ padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tabTokens.border }}>
            <Button title={isSubmitting ? "Guardando..." : "GUARDAR"} onPress={onSubmit} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

/* --------------------------------- UI helpers ------------------------------ */
function Tabs({ tabs, current, onChange, tokens }: { tabs: string[]; current: string; onChange: (t: string) => void; tokens: { bg: string; border: string; activeText: string; inactiveText: string; indicator: string } }) {
  return (
    <View style={[styles.tabs, { backgroundColor: tokens.bg, borderBottomColor: tokens.border }]}>
      {tabs.map((t) => {
        const selected = current === t;
        return (
          <TouchableOpacity key={t} style={[styles.tab, selected && { borderBottomColor: tokens.indicator, borderBottomWidth: 3 }]} onPress={() => onChange(t)} accessibilityRole="tab" accessibilityState={{ selected }}>
            <Text style={[styles.tabText, { color: selected ? tokens.activeText : tokens.inactiveText }]}>{t}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
function SectionTitle({ text, labelColor }: { text: string; labelColor: { color: string } }) { return <Text style={[{ fontSize: 16, fontWeight: "700", marginBottom: 8 }, labelColor]}>{text}</Text>; }
function SectionSubtitle({ text, labelColor }: { text: string; labelColor: { color: string } }) { return <Text style={[{ fontSize: 14, fontWeight: "600", marginTop: 8, marginBottom: 4 }, labelColor]}>{text}</Text>; }
function FieldRow({ children }: { children: React.ReactNode }) { return <View style={{ flexDirection: "row", gap: 8 }}>{children}</View>; }
function GridTwo({ children }: { children: React.ReactNode }) { return <View style={{ flexDirection: "row", gap: 8 }}>{children}</View>; }
function Field({ label, children, error, mini, labelColor }: { label: string; children: React.ReactNode; error?: string; mini?: boolean; labelColor: { color: string } }) {
  return (
    <View style={{ marginBottom: 8, flex: mini ? 1 : undefined }}>
      <Text style={[styles.label, labelColor]}>{label}</Text>
      <View>{children}</View>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}
function RowToggle({ label, value, onChange }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.rowToggle}>
      <Text style={styles.rowToggleLabel}>{label}</Text>
      <Switch value={!!value} onValueChange={onChange} />
    </View>
  );
}
function Chips({ options, value, onChange }: { options: readonly { code: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {options.map((opt) => (
        <Pressable key={opt.code} onPress={() => onChange(opt.code)} style={({ pressed }) => [styles.pill, value === opt.code && styles.pillActive, pressed && { opacity: 0.9 }]}>
          <Text style={[styles.pillText, value === opt.code && styles.pillTextActive]}>{opt.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
function AudioRow({ uri }: { uri: string }) {
  const player = useAudioPlayer(null);
  const handlePlay = useCallback(() => {
    try {
      player.replace({ uri });
      player.play();
    } catch {}
  }, [player, uri]);
  const name = uri.split("/").pop() ?? "audio.m4a";
  return (
    <View style={{ marginTop: 6, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text style={{ color: "#64748b", flex: 1 }} numberOfLines={1}>Archivo: {name}</Text>
      <TouchableOpacity onPress={handlePlay} style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: "#e5e7eb", borderRadius: 6 }}>
        <Text style={{ fontWeight: "700" }}>▶ Reproducir</Text>
      </TouchableOpacity>
    </View>
  );
}
// ✅ Ahora sí: botón “Ahora”
function NowBtn({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ marginTop: 6, alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: 10, backgroundColor: "#e5e7eb", borderRadius: 6 }}>
      <Text style={{ fontWeight: "700" }}>Ahora</Text>
    </TouchableOpacity>
  );
}

const ACVPU_OPTIONS = [
  { code: "A", label: "Alerta" }, { code: "C", label: "Confuso" }, { code: "V", label: "Respuesta a Voz" },
  { code: "P", label: "Respuesta al Dolor" }, { code: "U", label: "Inconsciente" },
] as const;
function ACVPUChips({ value, onChange }: { value: "A" | "C" | "V" | "P" | "U"; onChange: (v: "A" | "C" | "V" | "P" | "U") => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {ACVPU_OPTIONS.map((opt) => (
        <Pressable key={opt.code} onPress={() => onChange(opt.code)} accessibilityRole="button" accessibilityLabel={`${opt.label} (${opt.code})`}
          style={({ pressed }) => [styles.pill, value === opt.code && styles.pillActive, pressed && { opacity: 0.9 }]}>
          <Text style={[styles.pillText, value === opt.code && styles.pillTextActive]}>{opt.code} · {opt.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/* ---------------------------------- Styles --------------------------------- */
const styles = StyleSheet.create({
  label: { marginBottom: 6, fontWeight: "600" },
  rowToggle: { paddingVertical: 8, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: StyleSheet.hairlineWidth, borderColor: "#CBD5E1", borderRadius: 8, marginBottom: 8 },
  rowToggleLabel: { color: "#111827" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, backgroundColor: "#fff" },
  tabs: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { paddingVertical: 10, paddingHorizontal: 12, borderBottomColor: "transparent" },
  tabText: { fontSize: 14, fontWeight: "700", letterSpacing: 0.2 },
  error: { color: "#b00020", marginTop: 4 },
  pill: { paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: "#ccc", borderRadius: 999 },
  pillActive: { borderColor: "#000", backgroundColor: "#00000010" },
  pillText: { color: "#444" }, pillTextActive: { color: "#000", fontWeight: "700" },
});

/* --------------------------------- helpers --------------------------------- */
const LOCAL_ONLY_DEFAULT = false;
const firstUnitId = UNITS?.[0]?.id ?? "icu-adulto";
function resolveUnitId(s?: string) { if (!s) return undefined; const hit = UNITS.find((u) => u.id === s || u.name?.toLowerCase() === s.toLowerCase()); return hit?.id ?? s; }
const Auth = { getSession: async () => null as any };
function toLocalISO(d: Date) { const p = (n: number) => `${n}`.padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
