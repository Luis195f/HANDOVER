// src/screens/PatientList.tsx
// FHIR + RBAC + Forzar sync + Chips de Unidades (OR real) + Dark accesible + DEMO compatible

import React, { useEffect, useMemo, useState, useLayoutEffect } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  ScrollView,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Switch,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

// NEWS2 / prioridad
import { news2Score, priorityLabel } from "@/src/lib/priority";

// Catálogos
import { SPECIALTIES, DEFAULT_SPECIALTY_ID } from "@/src/config/specialties";
import { UNITS_BY_SPECIALTY, UNITS_BY_ID } from "@/src/config/units";
import { ThemeToggle } from "@/src/theme";

// FHIR (real)
import {
  fetchPatientsFromFHIR,
  getPatientsBySpecialty,
  getPatientsByUnit,
  type PatientBasic,
} from "@/src/lib/fhir-client";

// RBAC + cola
import { getSession, scopeByUnits } from "@/src/security/auth";
import { flushNow } from "@/src/lib/queueBootstrap";

// Filtros + orden
import {
  applyPatientFilters,
  sortPatientsByNEWS2Desc,
} from "@/src/lib/patient-filters";

// Chip accesible (contraste AA en dark)
import Chip from "@/src/components/Chip";

// slug util
import { toSlug } from "@/src/utils/slug";

// ENV robusto
import * as EnvMod from "@/src/config/env";
const ENV: any = (EnvMod as any)?.ENV ?? EnvMod;
const FHIR_BASE_URL: string =
  ((EnvMod as any)?.FHIR_BASE ?? (ENV && (ENV as any)?.FHIR_BASE) ?? "") as string;

export type RootStackParamList = {
  PatientList: undefined;
  HandoverForm: {
    patientId: string;
    specialty?: string;
    unit?: string;
    shift?: Shift | undefined;
  };
  Handover: { patientId: string } | undefined;
  AudioNote: { onDoneRoute?: string } | undefined;
  QRScan: undefined;
};

type Props = NativeStackScreenProps<RootStackParamList, "PatientList">;
type Shift = "morning" | "evening" | "night";
type PatientRow = PatientBasic & { unitId?: string; shift?: Shift; pending?: number };

/* ---------------- DEMO de respaldo ---------------- */
const DEMO: PatientRow[] = [
  {
    id: "pat-001",
    name: "Juan Pérez",
    bed: "Cama 3",
    location: "uci-cardio-3",
    specialtyId: "cardiologia",
    unitId: "uci-3",
    shift: "morning",
    vitals: { rr: 24, spo2: 91, temp: 38.4, sbp: 95, hr: 118, o2: true },
  },
  {
    id: "pat-003",
    name: "Carlos Ruiz",
    bed: "Cama 5",
    location: "quirofano-5",
    specialtyId: "quirofanos",
    unitId: "quirofanos",
    shift: "evening",
    vitals: { rr: 12, spo2: 95, temp: 37.0, sbp: 105, hr: 70 },
  },
  {
    id: "pat-002",
    name: "María López",
    bed: "Cama 12",
    location: "medicina-interna-12",
    specialtyId: "hospitalizacion",
    unitId: "hospitalizacion",
    shift: "night",
    vitals: { rr: 16, spo2: 97, temp: 36.8, sbp: 128, hr: 86 },
  },
];

/* ---------------- Utilidades internas (sin crear archivos nuevos) ---------------- */
function unitIdFromDisplay(display?: string): string | undefined {
  if (!display) return;
  let base = display.trim();
  const mBed = base.match(/(Cama|Bed)\s*([A-Za-z0-9\-]+)/i);
  if (mBed?.[0]) base = base.replace(mBed[0], "").trim();
  const seps = ["·", "•", "|", ",", ";", ":"];
  const cut = seps
    .map((s) => base.indexOf(s))
    .filter((i) => i >= 0)
    .reduce((acc, v) => (acc < 0 ? v : Math.min(acc, v)), -1);
  if (cut >= 0) base = base.slice(0, cut).trim();
  return base
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function guessUnitId(p: Partial<PatientRow>) {
  return p.unitId ?? unitIdFromDisplay(p.location || "") ?? unitIdFromDisplay(p.bed || "") ?? undefined;
}

function collectUnitChips(
  allPatientsRaw: Array<{ unitId?: string; location?: string; bed?: string }>,
  knownUnitIds: string[]
) {
  const known = (knownUnitIds ?? []).map(toSlug);
  const fromData = (allPatientsRaw ?? [])
    .map((p) => toSlug(guessUnitId(p) || ""))
    .filter(Boolean);
  return Array.from(new Set([...known, ...fromData])).sort();
}

/* ============================================================================ */

export default function PatientList(_props: Props) {
  const navigation = useNavigation<any>();

  /* --------- Filtros UI --------- */
  const [spec, setSpec] = useState<string>(
    (DEFAULT_SPECIALTY_ID as string) || Object.keys(SPECIALTIES)[0] || "hospitalizacion"
  );
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]); // OR real
  const [shift, setShift] = useState<Shift | "Todos">("Todos");
  const [q, setQ] = useState<string>("");
  const [ignoreFilters, setIgnoreFilters] = useState(false);

  /* --------- Datos (vista) + RAW (para chips) --------- */
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [allPatientsRaw, setAllPatientsRaw] = useState<PatientRow[]>([]); // <- RAW para chips
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [source, setSource] = useState<"FHIR" | "FHIR:fetchAll" | "DEMO">("FHIR");

  /* --------- RBAC --------- */
  const allowedUnitIds = useMemo(() => scopeByUnits(Object.keys(UNITS_BY_ID)), []);
  const allowed = allowedUnitIds.length > 0;

  useEffect(() => {
    if (!allowed || selectedUnits.length === 0) return;
    const allowedSet = new Set(allowedUnitIds);
    const filtered = selectedUnits.filter((u) => allowedSet.has(u));
    if (filtered.length !== selectedUnits.length) setSelectedUnits(filtered);
  }, [allowed, allowedUnitIds, selectedUnits]);

  /* --------- Chips de unidades (TODAS) --------- */
  const KNOWN_UNIT_IDS = useMemo(() => Object.keys(UNITS_BY_ID).map(toSlug), []);
  const unitChips = useMemo(
    () => collectUnitChips(allPatientsRaw, KNOWN_UNIT_IDS),
    [allPatientsRaw, KNOWN_UNIT_IDS]
  );

  /* --------- Fetch helpers --------- */
  const filterBySpecUnits = (
    list: PatientRow[],
    specialtyId: string,
    unitIds: string[],
    permissiveDemo: boolean
  ): PatientRow[] => {
    let out = list;
    if (!permissiveDemo && specialtyId) {
      const s = specialtyId.toLowerCase();
      out = out.filter((p) => (p.specialtyId ?? "").toLowerCase() === s);
    }
    if (unitIds.length > 0) {
      const set = new Set(unitIds);
      out = out.filter((p) => (p.unitId ? set.has(p.unitId) : false));
    }
    return out;
  };

  const scopeOrBypass = async (getRows: () => Promise<PatientRow[]>, bypass: boolean): Promise<PatientRow[]> => {
    const rows = await getRows();
    if (bypass) return rows;
    const setAllowed = new Set(allowedUnitIds);
    return rows.filter((r) => (r.unitId ? setAllowed.has(r.unitId) : true));
  };

  // Estrategia: por especialidad/unidad; multi-unidad => fetchAll y filtro en cliente
  const fetchFromPrimary = async (): Promise<PatientRow[]> => {
    const session = await getSession();
    const token = (session as any)?.token as string | undefined;

    if (selectedUnits.length === 0) {
      const raw = await getPatientsBySpecialty(spec, { fhirBase: FHIR_BASE_URL, token, includeVitals: true });
      return Array.isArray(raw) ? (raw as PatientRow[]) : [];
    }
    if (selectedUnits.length === 1) {
      const raw = await getPatientsByUnit(selectedUnits[0], { fhirBase: FHIR_BASE_URL, token, includeVitals: true });
      return Array.isArray(raw) ? (raw as PatientRow[]) : [];
    }
    return []; // multi-unidad -> fallback
  };

  const fetchFromFallback = async (): Promise<PatientRow[]> => {
    const session = await getSession();
    const token = (session as any)?.token as string | undefined;
    const all = await fetchPatientsFromFHIR({ fhirBase: FHIR_BASE_URL, token, includeVitals: true });
    const enriched = (Array.isArray(all) ? all : []).map((p) => ({
      ...p,
      unitId: (p as any).unitId ?? guessUnitId(p),
    })) as PatientRow[];
    return filterBySpecUnits(enriched, spec, selectedUnits, true);
  };

  /* --------- Carga inicial --------- */
  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const raw = await fetchFromPrimary();
      let original = (raw.length ? raw : DEMO).map((p) => ({
        ...p,
        unitId: (p as any).unitId ?? guessUnitId(p),
      })) as PatientRow[];

      let candidateSource: "FHIR" | "FHIR:fetchAll" | "DEMO" = "FHIR";
      if (!raw.length) {
        const alt = await fetchFromFallback();
        if (alt.length) {
          original = alt;
          candidateSource = "FHIR:fetchAll";
        } else {
          candidateSource = "DEMO";
        }
      }

      // RAW para chips (sin filtrar por spec/units)
      setAllPatientsRaw(original);

      // Vista filtrada actual
      const baseFiltered =
        candidateSource === "DEMO"
          ? filterBySpecUnits(original, spec, selectedUnits, true)
          : filterBySpecUnits(original, spec, selectedUnits, false);

      setSource(candidateSource);
      const bypass = candidateSource !== "FHIR";
      const scoped = await scopeOrBypass(async () => baseFiltered, bypass);
      setPatients(scoped);
    } catch {
      const original = DEMO.map((p) => ({ ...p, unitId: p.unitId ?? guessUnitId(p) })) as PatientRow[];
      setAllPatientsRaw(original);
      const fallback = filterBySpecUnits(original, spec, selectedUnits, true);
      setSource("DEMO");
      setPatients(fallback);
    } finally {
      setLoading(false);
    }
  }, [spec, selectedUnits, allowedUnitIds]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  /* --------- Pull-to-refresh --------- */
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const raw = await fetchFromPrimary();
      let original = (raw.length ? raw : DEMO).map((p) => ({
        ...p,
        unitId: (p as any).unitId ?? guessUnitId(p),
      })) as PatientRow[];

      let candidateSource: "FHIR" | "FHIR:fetchAll" | "DEMO" = "FHIR";
      if (!raw.length) {
        const alt = await fetchFromFallback();
        if (alt.length) {
          original = alt;
          candidateSource = "FHIR:fetchAll";
        } else {
          candidateSource = "DEMO";
        }
      }

      setAllPatientsRaw(original);

      const baseFiltered =
        candidateSource === "DEMO"
          ? filterBySpecUnits(original, spec, selectedUnits, true)
          : filterBySpecUnits(original, spec, selectedUnits, false);

      setSource(candidateSource);
      const bypass = candidateSource !== "FHIR";
      const scoped = await scopeOrBypass(async () => baseFiltered, bypass);
      setPatients(scoped);
    } catch {
      const original = DEMO.map((p) => ({ ...p, unitId: p.unitId ?? guessUnitId(p) })) as PatientRow[];
      setAllPatientsRaw(original);
      const fallback = filterBySpecUnits(original, spec, selectedUnits, true);
      setSource("DEMO");
      setPatients(fallback);
    } finally {
      setRefreshing(false);
    }
  }, [spec, selectedUnits, allowedUnitIds]);

  /* --------- NEWS2 efectivo + orden --------- */
  const withNews2 = useMemo(() => {
    return (patients ?? []).map((p) => {
      const raw =
        (typeof (p as any).news2 === "number" ? (p as any).news2 : undefined) ??
        (typeof (p as any).latestNews2?.score === "number" ? (p as any).latestNews2.score : undefined) ??
        news2Score(p?.vitals ?? {});
      const effective = (raw ?? 0) + ((p as any).pending ?? 0);
      return { ...p, news2: effective } as PatientRow & { news2: number };
    });
  }, [patients]);

  const ordered = useMemo(() => sortPatientsByNEWS2Desc(withNews2 as any), [withNews2]);

  /* --------- Filtros finales: turno + texto + OR por unidades --------- */
  const filtered = useMemo(() => {
    if (ignoreFilters) return ordered;

    // 1) Turno
    let base = ordered;
    if (shift !== "Todos") {
      base = base.filter((p) => ((p as any).shift ? (p as any).shift === shift : true));
    }

    // 2) Texto (id/nombre) con helper
    const pfFilters: { text?: string; unitId?: string; specialty?: string } = { text: q };
    if (source === "FHIR" && selectedUnits.length === 1) pfFilters.unitId = selectedUnits[0];
    if (spec) pfFilters.specialty = spec;

    const byNameId = applyPatientFilters(base as any, pfFilters);

    // 3) Compat: permitir match por cama/ubicación
    const norm = (s?: string) =>
      (s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
    const qn = norm(q || "");
    const idSet = new Set(byNameId.map((p) => p.id));
    const union = base.filter((p) => {
      if (!qn) return true;
      if (idSet.has(p.id)) return true;
      const name = norm(p.name);
      const bed = norm((p as any).bed);
      const loc = norm((p as any).location);
      return name.includes(qn) || bed.includes(qn) || loc.includes(qn);
    });

    // 4) OR por unidades (slug + inferencia si falta unitId)
    const selected = new Set(selectedUnits.map(toSlug));
    const byUnits =
      selected.size === 0
        ? union
        : union.filter((p: any) => selected.has(toSlug(p.unitId ?? guessUnitId(p))));

    return byUnits;
  }, [ordered, shift, q, ignoreFilters, source, selectedUnits, spec]);

  /* --------- Header: Forzar Sync --------- */
  const [syncing, setSyncing] = useState(false);
  const handleForceSync = React.useCallback(async () => {
    try {
      setSyncing(true);
      await flushNow();
      await onRefresh();
      Alert.alert("Sync", "Cola enviada y refrescada correctamente.");
    } catch {
      Alert.alert("Sync", "Hubo un problema al sincronizar.");
    } finally {
      setSyncing(false);
    }
  }, [onRefresh]);

  const headerSupported = !!(navigation && typeof (navigation as any).setOptions === "function");
  useLayoutEffect(() => {
    if (!headerSupported) return;
    (navigation as any).setOptions({
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ThemeToggle />
          <Pressable
            onPress={handleForceSync}
            disabled={syncing}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 9999,
              backgroundColor: syncing ? "#334155" : pressed ? "#223052" : "#1b2746",
              borderWidth: 1,
              borderColor: "#2f3b5c",
            })}
          >
            <Text style={{ color: "#cfe0ff", fontWeight: "700" }}>
              {syncing ? "Sincronizando…" : "Forzar sync"}
            </Text>
          </Pressable>
        </View>
      ),
    });
  }, [headerSupported, handleForceSync, syncing, navigation]);

  /* --------- UI --------- */
  return (
    <View style={{ flex: 1, backgroundColor: "#0f172a" }}>
      {/* Controles */}
      <View style={{ padding: 12 }}>
        {/* Especialidad */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {(Object.keys(SPECIALTIES) as string[]).map((s) => (
            <Chip
              key={s}
              label={(SPECIALTIES as any)[s]?.name ?? s}
              selected={spec === s}
              onPress={() => setSpec(s)}
            />
          ))}
        </ScrollView>

        {/* Unidades — selección múltiple (OR) con TODAS las unidades */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          <Chip
            key="Todos"
            label="Todos"
            selected={selectedUnits.length === 0}
            onPress={() => setSelectedUnits([])}
          />
          {unitChips.map((u) => (
            <Chip
              key={u}
              label={UNITS_BY_ID[u]?.name ?? u}
              selected={selectedUnits.includes(u)}
              onPress={() =>
                setSelectedUnits((prev) =>
                  prev.includes(u) ? prev.filter((x) => x !== u) : [...prev, u]
                )
              }
            />
          ))}
        </ScrollView>

        {/* Turno */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          {(["Todos", "morning", "evening", "night"] as const).map((sh) => (
            <Chip
              key={sh}
              label={sh === "Todos" ? "Todos" : { morning: "Mañana", evening: "Tarde", night: "Noche" }[sh]}
              selected={shift === sh}
              onPress={() => setShift(sh)}
            />
          ))}
        </ScrollView>

        {/* Buscador + Ignorar filtros */}
        <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TextInput
            placeholder="Buscar paciente (id/nombre/cama/ubicación)…"
            placeholderTextColor="#8191b3"
            value={q}
            onChangeText={setQ}
            style={{
              flex: 1,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "#2c3655",
              color: "#eaf2ff",
              backgroundColor: "#0b1226",
            }}
          />
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ color: "#9fb3d9", marginRight: 8 }}>Ignorar filtros</Text>
            <Switch value={ignoreFilters} onValueChange={setIgnoreFilters} thumbColor={ignoreFilters ? "#60a5fa" : "#64748b"} />
          </View>
        </View>
      </View>

      {/* Lista */}
      {loading ? (
        <View style={{ padding: 24 }}>
          <ActivityIndicator />
          <Text style={{ color: "#9fb3d9", marginTop: 8 }}>Cargando pacientes…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={{ padding: 24 }}>
              <Text style={{ color: "#9fb3d9" }}>No hay pacientes visibles para tus unidades asignadas.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const scoreReal = news2Score(item?.vitals ?? {});
            const label = priorityLabel(scoreReal);
            return (
              <Pressable
                onPress={() =>
                  (navigation as any).navigate("HandoverForm", {
                    patientId: item.id,
                    specialty: spec,
                    unit: selectedUnits.length === 1 ? selectedUnits[0] : undefined,
                    shift: shift === "Todos" ? undefined : (shift as Shift),
                  })
                }
                style={({ pressed }) => ({
                  padding: 16,
                  margin: 12,
                  borderRadius: 12,
                  backgroundColor: pressed ? "#1f2a44" : "#172036",
                  borderWidth: 1,
                  borderColor: "#2c3655",
                })}
              >
                <Text style={{ color: "#eaf2ff", fontSize: 18, fontWeight: "700" }}>
                  {item.name ?? item.id}
                </Text>
                <Text style={{ color: "#9fb3d9" }}>
                  {item.location}
                  {item.bed ? ` • ${item.bed}` : ""}
                </Text>
                <Text style={{ color: "#9fb3d9", marginTop: 6 }}>
                  Prioridad: {label} • NEWS2: {scoreReal}
                  {(item as any).shift &&
                    `  •  Turno: ${{
                      morning: "Mañana",
                      evening: "Tarde",
                      night: "Noche",
                    }[(item as any).shift as Shift]}`}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
