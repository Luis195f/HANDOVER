import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import Chip from "@/src/components/Chip";
import { DEFAULT_SPECIALTY_ID, SPECIALTIES, type Specialty } from "@/src/config/specialties";
import { UNITS, UNITS_BY_ID, type Unit } from "@/src/config/units";
import type { RootStackParamList } from "@/src/navigation/types";
import { currentUser, hasUnitAccess } from "@/src/security/acl";
import { mark } from "@/src/lib/otel";
import { logout } from "@/src/lib/auth";
import {
  ALL_UNITS_OPTION,
  setSelectedUnitId,
  useSelectedUnitId,
} from "@/src/state/filterStore";

export { ALL_UNITS_OPTION } from "@/src/state/filterStore";

export type PatientListItem = {
  id: string;
  name: string;
  unitId: string;
};

const PATIENTS_MOCK: PatientListItem[] = [
  { id: "pat-001", name: "Juan Pérez", unitId: "icu-a" },
  { id: "pat-002", name: "María López", unitId: "icu-b" },
  { id: "pat-003", name: "Laura Torres", unitId: "ed-main" },
  { id: "pat-004", name: "Carlos Ruiz", unitId: "ed-obs" },
  { id: "pat-005", name: "Ana Rivas", unitId: "onc-ward" },
  { id: "pat-006", name: "Miguel Soto", unitId: "neph-hd" },
  { id: "pat-007", name: "Sofía Álvarez", unitId: "ped-ward" },
  { id: "pat-008", name: "Paula Fernández", unitId: "ob-labor" },
  { id: "pat-009", name: "Raúl Herrera", unitId: "neuroicu-1" },
  { id: "pat-010", name: "Lucía Romero", unitId: "cvicu-1" },
];

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
  const handleLogout = useCallback(async () => {
    await logout();
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }, [navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={handleLogout} accessibilityRole="button">
          <Text style={styles.logoutText}>Cerrar sesión</Text>
        </Pressable>
      ),
    });
  }, [handleLogout, navigation]);

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

  const onOpenPatient = useCallback(
    (patient: PatientListItem) => {
      const unit = UNITS_BY_ID[patient.unitId];
      if (!unit) {
        Alert.alert("Unidad desconocida", "No se encontró la unidad del paciente.");
        return;
      }

      const user = currentUser();
      if (!hasUnitAccess(unit.id, user)) {
        Alert.alert("Sin acceso", "No tienes acceso a esta unidad.");
        return;
      }

      mark("patientlist.navigate", { patientId: patient.id, unitId: unit.id });
      navigation.navigate("Handover", {
        patientIdParam: patient.id,
        unitIdParam: unit.id,
        specialtyId: unit.specialtyId,
        patientId: patient.id,
        unitId: selectedUnitId === ALL_UNITS_OPTION ? undefined : selectedUnitId,
      });
    },
    [navigation, selectedUnitId]
  );

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
      </View>

      <FlatList
        data={patients}
        keyExtractor={(item) => item.id}
        contentContainerStyle={patients.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={<Text style={styles.emptyText}>No hay pacientes para la selección.</Text>}
        renderItem={({ item }) => {
          const unit = UNITS_BY_ID[item.unitId];
          return (
            <Pressable onPress={() => onOpenPatient(item)} style={styles.patientCard}>
              <Text style={styles.patientName}>{item.name}</Text>
              <Text style={styles.patientMeta}>{unit?.name ?? item.unitId}</Text>
              <Pressable
                style={styles.handoverButton}
                onPress={(event) => {
                  event.stopPropagation();
                  navigation.navigate('HandoverMain', { patientId: item.id });
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
  logoutText: {
    color: "#1f2a44",
    fontWeight: "600",
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
