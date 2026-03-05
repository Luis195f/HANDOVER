import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import Chip from "@/src/components/Chip";
import { DEFAULT_SPECIALTY_ID, SPECIALTIES, type Specialty } from "@/src/config/specialties";
import { UNITS, UNITS_BY_ID, type Unit } from "@/src/config/units";
import { type PatientListItem } from "@/src/data/mockPatients";
import { SNOMED_SYSTEM } from "@/src/data/snomed-dict";
import type { RootStackParamList } from "@/src/navigation/types";
import { ensureUnitAccess, hasRole } from "@/src/security/acl";
import { useAuth } from "@/src/security/auth";
import { mark } from "@/src/lib/otel";
import { listOfflineQueue, summarizePatientQueueState, type SyncStatus } from "@/src/lib/queue";
import { computePriority, computePriorityList, type PriorityInput, type PrioritizedPatient } from "@/src/lib/priority";
import {
  ALL_UNITS_OPTION,
  setSelectedUnitId,
  useSelectedUnitId,
} from "@/src/state/filterStore";
import type { Handover } from "@/src/types/handover";
import { computeAlerts } from "@/src/lib/alerts";
import { setOnboardingCompleted } from "@/src/lib/onboarding-storage";
import { useThemeTokens } from "../theme";
import { t, useTranslation } from "@/src/i18n";
import { apiGet } from "@/src/lib/api";
import { createPatient } from "@/src/lib/patients";

export { ALL_UNITS_OPTION } from "@/src/state/filterStore";
export type { PatientListItem } from "@/src/data/mockPatients";

export const ALL_SPECIALTIES_OPTION = "all";
export function filterPatients(
  patients: PatientListItem[],
  unitsById: Record<string, Unit>,
  selectedSpecialtyId: string,
  selectedUnitId: string
): PatientListItem[] {
  const isAllSpecialties = selectedSpecialtyId === ALL_SPECIALTIES_OPTION;
  const isAllUnits = selectedUnitId === ALL_UNITS_OPTION;

  return patients.filter((patient) => {
    const unit = unitsById[patient.unitId];
    if (!unit) return false;
    if (!isAllSpecialties && unit.specialtyId !== selectedSpecialtyId) return false;
    if (!isAllUnits && patient.unitId !== selectedUnitId) return false;
    return true;
  });
}

type Props = NativeStackScreenProps<RootStackParamList, "PatientList">;

type PickerOption = { label: string; value: string };

type ChipItem = {
  id: string;
  label: string;
  selected: boolean;
  onPress: () => void;
};

const FilterChip = Chip as unknown as ComponentType<any>;

type PickerProps = {
  label: string;
  value: string;
  options: PickerOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
};

type NewPatientFormState = {
  firstName: string;
  lastName: string;
  nhc: string;
  unit: string;
  service: string;
  room: string;
};

const NEW_PATIENT_INITIAL_STATE: NewPatientFormState = {
  firstName: "",
  lastName: "",
  nhc: "",
  unit: "",
  service: "",
  room: "",
};

function PickerSelect({ label, value, options, onValueChange, disabled }: PickerProps) {
  const [visible, setVisible] = useState(false);
  const selectedOption = options.find((option) => option.value === value);
  const { colors, radius, spacing } = useThemeTokens();

  const handleOpen = useCallback(() => {
    if (!disabled) {
      setVisible(true);
    }
  }, [disabled]);

  const handleClose = useCallback(() => {
    setVisible(false);
  }, []);

  const handleSelect = useCallback(
    (optionValue: string) => {
      onValueChange(optionValue);
      setVisible(false);
    },
    [onValueChange]
  );

  return (
    <View style={styles.pickerContainer}>
      <Text style={styles.pickerLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        style={[
          styles.pickerButton,
          {
            borderColor: colors.border,
            backgroundColor: colors.background,
            borderRadius: radius.sm,
            minHeight: 44,
            paddingVertical: spacing.sm,
          },
          disabled && styles.pickerButtonDisabled,
        ]}
        onPress={handleOpen}
        disabled={disabled}
      >
        <Text style={[styles.pickerButtonText, { color: colors.text }]}>
          {selectedOption?.label ?? t("patientList.selectPlaceholder")}
        </Text>
      </Pressable>
      <Modal transparent visible={visible} animationType="fade" onRequestClose={handleClose}>
        <Pressable style={styles.modalBackdrop} onPress={handleClose}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            {options.map((option) => (
              <Pressable
                key={option.value}
                style={[styles.modalOption, { minHeight: 44, paddingVertical: spacing.sm }]}
                onPress={() => handleSelect(option.value)}
                accessibilityRole="button"
              >
                <Text style={[styles.modalOptionText, { color: colors.text }]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export default function PatientList({ navigation }: Props) {
  const { colors } = useThemeTokens();
  const { i18n } = useTranslation();
  const [selectedSpecialtyId, setSelectedSpecialtyId] = useState<string>(DEFAULT_SPECIALTY_ID);
  const selectedUnitId = useSelectedUnitId();
  const [sortByPriority, setSortByPriority] = useState(false);
  const [patientSyncStatuses, setPatientSyncStatuses] = useState<Record<string, SyncStatus>>({});
  const [patients, setPatients] = useState<PatientListItem[]>([]);
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  const [isNewPatientModalOpen, setIsNewPatientModalOpen] = useState(false);
  const [isSubmittingNewPatient, setIsSubmittingNewPatient] = useState(false);
  const [newPatientForm, setNewPatientForm] = useState<NewPatientFormState>(NEW_PATIENT_INITIAL_STATE);
  const loadPatientsRequestRef = useRef(0);

  const refreshSyncStatuses = useCallback(async () => {
    const queue = await listOfflineQueue();
    const groupedItems = queue.reduce<Record<string, typeof queue>>((acc, item) => {
      if (!acc[item.patientId]) acc[item.patientId] = [];
      acc[item.patientId]?.push(item);
      return acc;
    }, {});

    const nextStatuses = Object.entries(groupedItems).reduce<Record<string, SyncStatus>>((acc, [patientId, items]) => {
      acc[patientId] = summarizePatientQueueState(items);
      return acc;
    }, {});

    setPatientSyncStatuses(nextStatuses);
  }, []);

  const loadPatients = useCallback(async () => {
    if (!selectedUnitId) {
      setPatients([]);
      return;
    }

    const requestId = ++loadPatientsRequestRef.current;
    setIsLoadingPatients(true);
    try {
      const path = selectedUnitId === ALL_UNITS_OPTION
        ? '/api/patients'
        : `/api/patients?unit=${encodeURIComponent(String(selectedUnitId))}`;
      const data = await apiGet(path);
      const items = Array.isArray(data) ? data : (data?.results ?? data?.entry?.map((entry: any) => entry?.resource) ?? []);
      if (requestId !== loadPatientsRequestRef.current) {
        return;
      }
      setPatients(items.map((p: any) => ({
        id: String(p.id ?? p.patientId ?? ""),
        name: String(p.name ?? p.displayName ?? p.fullName ?? [p.first_name, p.last_name].filter(Boolean).join(' ') ?? "Paciente"),
        unitId: String(p.unitId ?? p.unit_id ?? p.unit ?? (selectedUnitId !== ALL_UNITS_OPTION ? selectedUnitId : "") ?? ""),
        bedLabel: p.bedLabel ?? p.bed ?? p.room ?? "",
        vitals: p.vitals ?? {},
        devices: p.devices ?? [],
        risks: p.risks ?? {},
      })));
    } catch {
      if (requestId !== loadPatientsRequestRef.current) {
        return;
      }
      setPatients([]);
    } finally {
      if (requestId === loadPatientsRequestRef.current) {
        setIsLoadingPatients(false);
      }
    }
  }, [selectedUnitId, selectedSpecialtyId]);

  const resetNewPatientForm = useCallback(() => {
    setNewPatientForm({
      ...NEW_PATIENT_INITIAL_STATE,
      unit: selectedUnitId !== ALL_UNITS_OPTION ? selectedUnitId : "",
    });
  }, [selectedUnitId]);

  const openNewPatientForm = useCallback(() => {
    resetNewPatientForm();
    setIsNewPatientModalOpen(true);
  }, [resetNewPatientForm]);

  const closeNewPatientForm = useCallback(() => {
    if (isSubmittingNewPatient) {
      return;
    }
    setIsNewPatientModalOpen(false);
  }, [isSubmittingNewPatient]);

  const onSpecialtyChange = useCallback((value: string) => {
    setSelectedSpecialtyId(value);
    setSelectedUnitId(ALL_UNITS_OPTION);
  }, []);

  const onUnitChange = useCallback((value: string) => {
    setSelectedUnitId(value);
  }, []);

  const handleNewPatientFormChange = useCallback((field: keyof NewPatientFormState, value: string) => {
    setNewPatientForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmitNewPatient = useCallback(async () => {
    const payload = {
      firstName: newPatientForm.firstName.trim(),
      lastName: newPatientForm.lastName.trim(),
      nhc: newPatientForm.nhc.trim(),
      unit: newPatientForm.unit.trim(),
      service: newPatientForm.service.trim(),
      room: newPatientForm.room.trim(),
    };

    if (!payload.firstName || !payload.lastName || !payload.nhc || !payload.unit || !payload.service || !payload.room) {
      Alert.alert("Campos obligatorios", "Completa todos los datos del paciente.");
      return;
    }

    try {
      setIsSubmittingNewPatient(true);
      await createPatient(payload);
      setIsNewPatientModalOpen(false);
      await loadPatients();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Revisa los datos e inténtalo de nuevo.";
      const description = __DEV__
        ? `No se pudo crear el paciente. ${message}`
        : "Revisa los datos e inténtalo de nuevo.";
      Alert.alert("No se pudo crear", description);
    } finally {
      setIsSubmittingNewPatient(false);
    }
  }, [loadPatients, newPatientForm]);

  // BEGIN HANDOVER: ONBOARDING
  const handleShowOnboarding = useCallback(async () => {
    await setOnboardingCompleted(false);
    navigation.navigate("Onboarding");
  }, [navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("patientList.viewOnboardingAccessibility")}
          onPress={handleShowOnboarding}
        >
          <Text style={[styles.headerLink, { color: colors.info }]}>{t("patientList.viewOnboarding")}</Text>
        </Pressable>
      ),
    });
  }, [colors.info, handleShowOnboarding, navigation]);
  // END HANDOVER: ONBOARDING

  useEffect(() => {
    mark("patientlist.filter.change", {
      specialtyId: selectedSpecialtyId === ALL_SPECIALTIES_OPTION ? undefined : selectedSpecialtyId,
      unitId: selectedUnitId === ALL_UNITS_OPTION ? undefined : selectedUnitId,
    });
  }, [selectedSpecialtyId, selectedUnitId]);

  useEffect(() => {
    void refreshSyncStatuses();
    const interval = setInterval(refreshSyncStatuses, 15_000);
    return () => clearInterval(interval);
  }, [refreshSyncStatuses]);

  useEffect(() => {
    void loadPatients();
    return () => {
      loadPatientsRequestRef.current += 1;
    };
  }, [loadPatients]);

  const specialtyOptions = useMemo<PickerOption[]>(() => {
    const base: PickerOption[] = [
      { label: t("patientList.allSpecialties"), value: ALL_SPECIALTIES_OPTION },
      ...SPECIALTIES.map((specialty: Specialty) => ({
        label: specialty.name,
        value: specialty.id,
      })),
    ];
    return base;
  }, []);

  const availableUnits = useMemo(() => {
    if (selectedSpecialtyId === ALL_SPECIALTIES_OPTION) {
      return UNITS;
    }
    return UNITS.filter((unit) => unit.specialtyId === selectedSpecialtyId);
  }, [selectedSpecialtyId]);

  const unitOptions = useMemo<PickerOption[]>(() => {
    const options: PickerOption[] = [
      { label: t("patientList.allUnits"), value: ALL_UNITS_OPTION },
      ...availableUnits.map((unit) => ({ label: unit.name, value: unit.id })),
    ];
    return options;
  }, [availableUnits, i18n.language]);

  const specialtyChips = useMemo<ChipItem[]>(() => {
    return [
      {
        id: ALL_SPECIALTIES_OPTION,
        label: t("patientList.allSpecialties"),
        selected: selectedSpecialtyId === ALL_SPECIALTIES_OPTION,
        onPress: () => onSpecialtyChange(ALL_SPECIALTIES_OPTION),
      },
      ...SPECIALTIES.map((specialty: Specialty) => ({
        id: specialty.id,
        label: specialty.name,
        selected: selectedSpecialtyId === specialty.id,
        onPress: () => onSpecialtyChange(specialty.id),
      })),
    ];
  }, [i18n.language, onSpecialtyChange, selectedSpecialtyId]);

  const unitChips = useMemo<ChipItem[]>(() => {
    return [
      {
        id: ALL_UNITS_OPTION,
        label: t("patientList.allUnits"),
        selected: selectedUnitId === ALL_UNITS_OPTION,
        onPress: () => onUnitChange(ALL_UNITS_OPTION),
      },
      ...availableUnits.map((unit) => ({
        id: unit.id,
        label: unit.name,
        selected: selectedUnitId === unit.id,
        onPress: () => onUnitChange(unit.id),
      })),
    ];
  }, [availableUnits, i18n.language, onUnitChange, selectedUnitId]);

  const priorityInputs = useMemo<PriorityInput[]>(
    () =>
      patients.map(patient => ({
        patientId: patient.id,
        displayName: patient.name,
        bedLabel: patient.bedLabel,
        vitals: patient.vitals ?? {},
        devices: patient.devices ?? [],
        risks: patient.risks ?? {},
        pendingTasks: patient.pendingTasks ?? [],
        lastIncidentAt: patient.lastIncidentAt ?? null,
        recentIncidentFlag: patient.recentIncidentFlag,
      })),
    [patients],
  );

  const prioritizedPatients = useMemo<PrioritizedPatient[]>(() => priorityInputs.map(computePriority), [priorityInputs]);
  const sortedByPriority = useMemo<PrioritizedPatient[]>(() => computePriorityList(priorityInputs), [priorityInputs]);
  const alertsByPatient = useMemo(() => {
    return patients.reduce<Record<string, ReturnType<typeof computeAlerts>>>((acc, patient) => {
      const handoverLike: Handover = {
        administrativeData: {
          unit: patient.unitId,
          census: 0,
          staffIn: [],
          staffOut: [],
          shiftStart: new Date().toISOString(),
          shiftEnd: new Date().toISOString(),
          shiftType: 'Mañana',
          incidents: [],
        },
        patientId: patient.id,
        status: 'draft',
        dxMedical: { system: SNOMED_SYSTEM, code: '', display: '' },
        dxNursing: { system: SNOMED_SYSTEM, code: '', display: '' },
        attachments: [],
        medications: [],
        treatments: [],
        bedsideChecklist: {
          patientIdentityConfirmed: false,
          allergiesReviewed: false,
          linesAndDevicesChecked: false,
          medicationPlanReviewed: false,
          safetyMeasuresApplied: false,
          questionsAnswered: false,
        },
        vitals: patient.vitals,
        risks: patient.risks,
        risksStructured: [],
      };
      acc[patient.id] = computeAlerts(handoverLike);
      return acc;
    }, {});
  }, [patients]);
  const patientsForList = sortByPriority ? sortedByPriority : prioritizedPatients;

  const patientById = useMemo(() => new Map(patients.map(p => [p.id, p])), [patients]);
  const { session } = useAuth();
  const canViewSupervisorDashboard = hasRole(session, ["supervisor", "admin"]);

  const onOpenPatient = useCallback(
    (patientId: string) => {
      const basePatient = patientById.get(patientId);
      if (!basePatient) {
        Alert.alert(t("patientList.notFoundTitle"), t("patientList.notFoundMessage"));
        return;
      }

      const unit = UNITS_BY_ID[basePatient.unitId];
      if (!unit) {
        Alert.alert(t("patientList.unknownUnitTitle"), t("patientList.unknownUnitMessage"));
        return;
      }

      try {
        ensureUnitAccess(session, unit.id);
      } catch {
        Alert.alert(t("patientList.noAccessTitle"), t("patientList.noAccessMessage"));
        return;
      }

      mark("patientlist.navigate", { patientId: basePatient.id, unitId: unit.id });
      navigation.navigate("HandoverForm", {
        patientIdParam: basePatient.id,
        unitIdParam: unit.id,
        specialtyId: unit.specialtyId,
        patientId: basePatient.id,
        unitId: selectedUnitId === ALL_UNITS_OPTION ? undefined : selectedUnitId,
      });
    },
    [navigation, patientById, selectedUnitId, session]
  );

  const renderPriorityBadge = useCallback((level: PrioritizedPatient['level']) => {
    const labelMap: Record<PrioritizedPatient['level'], string> = {
      critical: t("patientList.priorityCritical"),
      high: t("patientList.priorityHigh"),
      medium: t("patientList.priorityMedium"),
      low: t("patientList.priorityLow"),
    };
    const colorMap: Record<PrioritizedPatient['level'], string> = {
      critical: colors.danger,
      high: colors.warning,
      medium: "#ca8a04",
      low: colors.success,
    };
    return (
      <View style={[styles.priorityBadge, { backgroundColor: colorMap[level] }]}> 
        <Text style={styles.priorityBadgeText}>{labelMap[level]}</Text>
      </View>
    );
  }, [colors.danger, colors.success, colors.warning, i18n.language]);

  const listHeader = useMemo(
    () => (
      <View style={styles.filters}>
        <Pressable
          accessibilityRole="button"
          style={[styles.newPatientButton, { backgroundColor: colors.primary }]}
          onPress={openNewPatientForm}
          testID="new-patient-button"
        >
          <Text style={styles.newPatientButtonText}>+ Nuevo paciente</Text>
        </Pressable>
        <PickerSelect
          label={t("patientList.specialtyLabel")}
          value={selectedSpecialtyId}
          options={specialtyOptions}
          onValueChange={onSpecialtyChange}
        />
        <PickerSelect
          label={t("patientList.unitLabel")}
          value={selectedUnitId}
          options={unitOptions}
          onValueChange={onUnitChange}
          disabled={availableUnits.length === 0 && selectedSpecialtyId !== ALL_SPECIALTIES_OPTION}
        />

        <View style={styles.chipSection}>
          <Text style={[styles.chipLabel, { color: colors.text }]}>{t("patientList.specialtyLabel")}</Text>
          <View style={styles.chipGroup}>
            {specialtyChips.map((chip) => (
              <FilterChip
                key={chip.id}
                label={chip.label}
                selected={chip.selected}
                onPress={chip.onPress}
              />
            ))}
          </View>
        </View>

        <View style={styles.chipSection}>
          <Text style={[styles.chipLabel, { color: colors.text }]}>{t("patientList.unitLabel")}</Text>
          <View style={styles.chipGroup}>
            {unitChips.map((chip) => (
              <FilterChip
                key={chip.id}
                label={chip.label}
                selected={chip.selected}
                onPress={chip.onPress}
              />
            ))}
          </View>
        </View>

        <View style={styles.priorityToggle}>
          <Text style={styles.priorityToggleLabel}>{t("patientList.sortByPriority")}</Text>
          <Switch value={sortByPriority} onValueChange={setSortByPriority} />
        </View>

        {canViewSupervisorDashboard ? (
          <Pressable
            accessibilityRole="button"
            style={[styles.supervisorButton, { backgroundColor: colors.primary }]}
            onPress={() => navigation.navigate("SupervisorDashboard")}
          >
            <Text style={styles.supervisorButtonTitle}>{t("patientList.supervisorDashboardTitle")}</Text>
            <Text style={styles.supervisorButtonSubtitle}>
              {t("patientList.supervisorDashboardSubtitle")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    ),
    [
      availableUnits.length,
      canViewSupervisorDashboard,
      colors.primary,
      colors.text,
      navigation,
      onSpecialtyChange,
      onUnitChange,
      openNewPatientForm,
      selectedSpecialtyId,
      selectedUnitId,
      sortByPriority,
      specialtyChips,
      specialtyOptions,
      t,
      unitChips,
      unitOptions,
    ]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}> 
      <FlatList
        data={patientsForList}
        keyExtractor={(item) => item.patientId}
        ListHeaderComponent={listHeader}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {isLoadingPatients ? "Cargando pacientes…" : t("patientList.emptyList")}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const basePatient = patientById.get(item.patientId);
          const unit = basePatient ? UNITS_BY_ID[basePatient.unitId] : undefined;
          const syncState = patientSyncStatuses[item.patientId] ?? "synced";
          const alerts = alertsByPatient[item.patientId] ?? [];
          const hasCriticalAlert = alerts.some(alert => alert.severity === 'critical');
          const hasWarningAlert = alerts.some(alert => alert.severity === 'warning');
          return (
            <Pressable
              onPress={() => onOpenPatient(item.patientId)}
              style={[
                styles.patientCard,
                { backgroundColor: colors.background, borderColor: colors.border },
              ]}
              testID={`patient-card-${item.patientId}`}
            >
              <Text style={[styles.patientName, { color: colors.text }]}>{item.displayName}</Text>
              <Text style={[styles.patientMeta, { color: colors.muted }]}> 
                {unit?.name ?? basePatient?.unitId ?? t("patientList.unknownUnitFallback")}
              </Text>
              <View style={styles.syncRow}>
                <Text
                  style={[
                    styles.syncBadge,
                    syncState === "error"
                      ? { backgroundColor: `${colors.danger}22`, color: colors.danger }
                      : syncState === "pending"
                      ? { backgroundColor: colors.warning, color: colors.text }
                      : { backgroundColor: "#DCFCE7", color: colors.success },
                  ]}
                >
                  {syncState === "error"
                    ? t("patientList.syncError")
                    : syncState === "pending"
                    ? t("patientList.syncQueued")
                    : t("patientList.syncSynced")}
                </Text>
                {syncState !== "synced" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("patientList.syncDetailsAccessibility")}
                    onPress={() => navigation.navigate("SyncCenter")}
                    style={styles.syncLink}
                  >
                    <Text style={[styles.syncLinkText, { color: colors.info }]}> 
                      {t("patientList.syncDetails")}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.priorityRow}>
                {renderPriorityBadge(item.level)}
                <Text style={styles.reasonText}>{item.reasonSummary}</Text>
              </View>
              {alerts.length > 0 ? (
                <View style={styles.alertChipRow}>
                  {hasCriticalAlert ? (
                    <View style={[styles.alertChip, { backgroundColor: "#FEE2E2", borderColor: colors.danger }]}> 
                      <Text style={[styles.alertChipText, { color: colors.danger }]}>{t("patientList.alertCritical")}</Text>
                    </View>
                  ) : null}
                  {hasWarningAlert ? (
                    <View style={[styles.alertChip, { backgroundColor: colors.surface, borderColor: colors.warning }]}> 
                      <Text style={[styles.alertChipText, { color: colors.warning }]}>{t("patientList.alertWarning")}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
              <Pressable
                style={[styles.handoverButton, { backgroundColor: colors.info }]}
                onPress={(event) => {
                  event.stopPropagation();
                  onOpenPatient(item.patientId);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.handoverButtonText}>{t("patientList.clinicalDashboard")}</Text>
              </Pressable>
            </Pressable>
          );
        }}
      />

      <Modal visible={isNewPatientModalOpen} animationType="slide" transparent onRequestClose={closeNewPatientForm}>
        <View style={styles.newPatientModalBackdrop}>
          <View style={[styles.newPatientModalCard, { backgroundColor: colors.background }]}> 
            <Text style={[styles.newPatientModalTitle, { color: colors.text }]}>Nuevo paciente</Text>
            <TextInput
              style={[styles.newPatientInput, { borderColor: colors.border, color: colors.text }]}
              placeholder="Nombre"
              value={newPatientForm.firstName}
              onChangeText={(value) => handleNewPatientFormChange("firstName", value)}
            />
            <TextInput
              style={[styles.newPatientInput, { borderColor: colors.border, color: colors.text }]}
              placeholder="Apellidos"
              value={newPatientForm.lastName}
              onChangeText={(value) => handleNewPatientFormChange("lastName", value)}
            />
            <TextInput
              style={[styles.newPatientInput, { borderColor: colors.border, color: colors.text }]}
              placeholder="NHC"
              value={newPatientForm.nhc}
              onChangeText={(value) => handleNewPatientFormChange("nhc", value)}
            />
            <PickerSelect
              label="Unidad"
              value={newPatientForm.unit}
              options={availableUnits.map((unit) => ({ label: unit.name, value: unit.id }))}
              onValueChange={(value) => handleNewPatientFormChange("unit", value)}
            />
            <TextInput
              style={[styles.newPatientInput, { borderColor: colors.border, color: colors.text }]}
              placeholder="Servicio"
              value={newPatientForm.service}
              onChangeText={(value) => handleNewPatientFormChange("service", value)}
            />
            <TextInput
              style={[styles.newPatientInput, { borderColor: colors.border, color: colors.text }]}
              placeholder="Habitación"
              value={newPatientForm.room}
              onChangeText={(value) => handleNewPatientFormChange("room", value)}
            />
            <View style={styles.newPatientActions}>
              <Pressable
                accessibilityRole="button"
                style={[styles.newPatientCancelButton, { borderColor: colors.border }]}
                onPress={closeNewPatientForm}
                disabled={isSubmittingNewPatient}
              >
                <Text style={[styles.newPatientCancelButtonText, { color: colors.text }]}>Cancelar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={[styles.newPatientSubmitButton, { backgroundColor: colors.primary }]}
                onPress={handleSubmitNewPatient}
                disabled={isSubmittingNewPatient}
              >
                <Text style={styles.newPatientSubmitButtonText}>
                  {isSubmittingNewPatient ? "Guardando..." : "Guardar"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f7fb",
  },
  headerLink: {
    color: "#2563EB",
    fontWeight: "700",
    paddingHorizontal: 8,
  },
  filters: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  newPatientButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
  },
  newPatientButtonText: {
    color: "#fff",
    fontWeight: "700",
  },
  chipSection: {
    gap: 8,
  },
  chipLabel: {
    fontWeight: "600",
    color: "#1f2a44",
  },
  chipGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 0,
  },
  pickerContainer: {
    gap: 6,
  },
  pickerLabel: {
    fontWeight: "600",
    color: "#1f2a44",
  },
  pickerButton: {
    borderWidth: 1,
    borderColor: "#d0d7e6",
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    minHeight: 44,
  },
  pickerButtonDisabled: {
    opacity: 0.5,
  },
  pickerButtonText: {
    color: "#1f2a44",
  },
  priorityToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  priorityToggleLabel: {
    fontWeight: "600",
    color: "#111827",
  },
  supervisorButton: {
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    minHeight: 44,
  },
  supervisorButtonTitle: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  supervisorButtonSubtitle: {
    color: '#e5e7eb',
    marginTop: 2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 12,
  },
  modalOption: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
  },
  modalOptionText: {
    fontSize: 16,
    color: "#1f2a44",
  },
  patientCard: {
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  patientName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  patientMeta: {
    marginTop: 4,
    color: "#4b5563",
  },
  syncRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  syncBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    fontWeight: "600",
    fontSize: 12,
  },
  syncLink: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  syncLinkText: {
    fontSize: 12,
    fontWeight: "600",
  },
  priorityRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  priorityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  priorityBadgeText: {
    color: "#fff",
    fontWeight: "700",
  },
  reasonText: {
    flex: 1,
    marginLeft: 8,
    color: "#374151",
  },
  alertChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  alertChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  alertChipText: {
    fontWeight: '700',
    color: '#1f2937',
  },
  listContainer: {
    paddingBottom: 32,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  emptyText: {
    color: "#4b5563",
  },
  handoverButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    minHeight: 44,
    justifyContent: 'center',
  },
  handoverButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  newPatientModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 16,
  },
  newPatientModalCard: {
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  newPatientModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  newPatientInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  newPatientActions: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  newPatientCancelButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    minHeight: 40,
    justifyContent: 'center',
  },
  newPatientCancelButtonText: {
    fontWeight: '600',
  },
  newPatientSubmitButton: {
    borderRadius: 8,
    paddingHorizontal: 14,
    minHeight: 40,
    justifyContent: 'center',
  },
  newPatientSubmitButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
});
