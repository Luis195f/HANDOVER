import React, { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import Chip from "@/src/components/Chip";
import { DEFAULT_SPECIALTY_ID, SPECIALTIES, type Specialty } from "@/src/config/specialties";
import { UNITS, UNITS_BY_ID, type Unit } from "@/src/config/units";
import { PATIENTS_MOCK, type PatientListItem } from "@/src/data/mockPatients";
import type { RootStackParamList } from "@/src/navigation/types";
import { ensureUnitAccess } from "@/src/security/acl";
import { useAuth } from "@/src/security/auth";
import { mark } from "@/src/lib/otel";
import { computePriority, computePriorityList, type PriorityInput, type PrioritizedPatient } from "@/src/lib/priority";
import {
  ALL_UNITS_OPTION,
  setSelectedUnitId,
  useSelectedUnitId,
} from "@/src/state/filterStore";

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

function PickerSelect({ label, value, options, onValueChange, disabled }: PickerProps) {
  const [visible, setVisible] = useState(false);
  const selectedOption = options.find((option) => option.value === value);

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
        style={[styles.pickerButton, disabled && styles.pickerButtonDisabled]}
        onPress={handleOpen}
        disabled={disabled}
      >
        <Text style={styles.pickerButtonText}>
          {selectedOption?.label ?? "Seleccionar"}
        </Text>
      </Pressable>
      <Modal transparent visible={visible} animationType="fade" onRequestClose={handleClose}>
        <Pressable style={styles.modalBackdrop} onPress={handleClose}>
          <View style={styles.modalContent}>
            {options.map((option) => (
              <Pressable
                key={option.value}
                style={styles.modalOption}
                onPress={() => handleSelect(option.value)}
                accessibilityRole="button"
              >
                <Text style={styles.modalOptionText}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export default function PatientList({ navigation }: Props) {
  const [selectedSpecialtyId, setSelectedSpecialtyId] = useState<string>(DEFAULT_SPECIALTY_ID);
  const selectedUnitId = useSelectedUnitId();
  const [sortByPriority, setSortByPriority] = useState(false);

  const onSpecialtyChange = useCallback((value: string) => {
    setSelectedSpecialtyId(value);
    setSelectedUnitId(ALL_UNITS_OPTION);
  }, []);

  const onUnitChange = useCallback((value: string) => {
    setSelectedUnitId(value);
  }, []);

  useEffect(() => {
    mark("patientlist.filter.change", {
      specialtyId: selectedSpecialtyId === ALL_SPECIALTIES_OPTION ? undefined : selectedSpecialtyId,
      unitId: selectedUnitId === ALL_UNITS_OPTION ? undefined : selectedUnitId,
    });
  }, [selectedSpecialtyId, selectedUnitId]);

  const specialtyOptions = useMemo<PickerOption[]>(() => {
    const base: PickerOption[] = [
      { label: "Todas las especialidades", value: ALL_SPECIALTIES_OPTION },
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
      { label: "Todas las unidades", value: ALL_UNITS_OPTION },
      ...availableUnits.map((unit) => ({ label: unit.name, value: unit.id })),
    ];
    return options;
  }, [availableUnits]);

  const specialtyChips = useMemo<ChipItem[]>(() => {
    return [
      {
        id: ALL_SPECIALTIES_OPTION,
        label: "Todas las especialidades",
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
  }, [onSpecialtyChange, selectedSpecialtyId]);

  const unitChips = useMemo<ChipItem[]>(() => {
    return [
      {
        id: ALL_UNITS_OPTION,
        label: "Todas las unidades",
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
  }, [availableUnits, onUnitChange, selectedUnitId]);

  const patients = useMemo(
    () => filterPatients(PATIENTS_MOCK, UNITS_BY_ID, selectedSpecialtyId, selectedUnitId),
    [selectedSpecialtyId, selectedUnitId]
  );

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
  const patientsForList = sortByPriority ? sortedByPriority : prioritizedPatients;

  const patientById = useMemo(() => new Map(patients.map(p => [p.id, p])), [patients]);
  const { session } = useAuth();

  const onOpenPatient = useCallback(
    (patientId: string) => {
      const basePatient = patientById.get(patientId);
      if (!basePatient) {
        Alert.alert("Paciente no encontrado", "No se pudo abrir el registro del paciente.");
        return;
      }

      const unit = UNITS_BY_ID[basePatient.unitId];
      if (!unit) {
        Alert.alert("Unidad desconocida", "No se encontró la unidad del paciente.");
        return;
      }

      try {
        ensureUnitAccess(session, unit.id);
      } catch {
        Alert.alert("Sin acceso", "No tienes acceso a esta unidad.");
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
    [navigation, patientById, selectedUnitId]
  );

  const renderPriorityBadge = useCallback((level: PrioritizedPatient['level']) => {
    const labelMap: Record<PrioritizedPatient['level'], string> = {
      critical: "CRÍTICO",
      high: "ALTO",
      medium: "MEDIO",
      low: "BAJO",
    };
    const colorMap: Record<PrioritizedPatient['level'], string> = {
      critical: "#b91c1c",
      high: "#ea580c",
      medium: "#ca8a04",
      low: "#16a34a",
    };
    return (
      <View style={[styles.priorityBadge, { backgroundColor: colorMap[level] }]}> 
        <Text style={styles.priorityBadgeText}>{labelMap[level]}</Text>
      </View>
    );
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.filters}>
        <PickerSelect
          label="Especialidad"
          value={selectedSpecialtyId}
          options={specialtyOptions}
          onValueChange={onSpecialtyChange}
        />
        <PickerSelect
          label="Unidad"
          value={selectedUnitId}
          options={unitOptions}
          onValueChange={onUnitChange}
          disabled={availableUnits.length === 0 && selectedSpecialtyId !== ALL_SPECIALTIES_OPTION}
        />
        <View style={styles.chipSection}>
          <Text style={styles.chipLabel}>Especialidades</Text>
          <View style={styles.chipGroup}>
            {specialtyChips.map((chip) => (
              <FilterChip key={chip.id} label={chip.label} selected={chip.selected} onPress={chip.onPress} />
            ))}
          </View>
        </View>
        <View style={styles.chipSection}>
          <Text style={styles.chipLabel}>Unidades</Text>
          <View style={styles.chipGroup}>
            {unitChips.map((chip) => (
              <FilterChip key={chip.id} label={chip.label} selected={chip.selected} onPress={chip.onPress} />
            ))}
          </View>
        </View>
        <View style={styles.priorityToggle}>
          <Text style={styles.priorityToggleLabel}>Ordenar por prioridad clínica</Text>
          <Switch value={sortByPriority} onValueChange={setSortByPriority} />
        </View>
        <Pressable
          accessibilityRole="button"
          style={styles.supervisorButton}
          onPress={() => navigation.navigate("SupervisorDashboard")}
        >
          <Text style={styles.supervisorButtonTitle}>Ver dashboard de turno</Text>
          <Text style={styles.supervisorButtonSubtitle}>
            Resumen para supervisores y jefaturas de unidad.
          </Text>
        </Pressable>
      </View>

      <FlatList
        data={patientsForList}
        keyExtractor={(item) => item.patientId}
        contentContainerStyle={patients.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={<Text style={styles.emptyText}>No hay pacientes para la selección.</Text>}
        renderItem={({ item }) => {
          const basePatient = patientById.get(item.patientId);
          const unit = basePatient ? UNITS_BY_ID[basePatient.unitId] : undefined;
          return (
            <Pressable onPress={() => onOpenPatient(item.patientId)} style={styles.patientCard}>
              <Text style={styles.patientName}>{item.displayName}</Text>
              <Text style={styles.patientMeta}>{unit?.name ?? basePatient?.unitId ?? "Unidad desconocida"}</Text>
              <View style={styles.priorityRow}>
                {renderPriorityBadge(item.level)}
                <Text style={styles.reasonText}>{item.reasonSummary}</Text>
              </View>
              <Pressable
                style={styles.handoverButton}
                onPress={(event) => {
                  event.stopPropagation();
                  navigation.navigate('HandoverMain', { patientId: item.patientId });
                }}
                accessibilityRole="button"
              >
                <Text style={styles.handoverButtonText}>Dashboard clínico</Text>
              </Pressable>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f7fb",
  },
  filters: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
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
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
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
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
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
  emptyContainer: {
    flexGrow: 1,
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
  },
  handoverButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
