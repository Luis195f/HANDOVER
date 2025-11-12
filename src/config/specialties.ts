// src/config/specialties.ts
export type SpecialtyId = "onc" | "icu" | "mi" | "surg";
export type Specialty = { id: SpecialtyId; name: string };

export const SPECIALTIES: Specialty[] = [
  { id: "onc", name: "Oncología" },
  { id: "icu", name: "UCI" },
  { id: "mi",  name: "Medicina Interna" },
  { id: "surg", name: "Cirugía" }
];

export const DEFAULT_SPECIALTY_ID: SpecialtyId = "onc";

export const UNITS_BY_SPECIALTY: Record<SpecialtyId, { id: string; name: string }[]> = {
  onc:  [{ id: "ONC-HOSP",  name: "Oncología Hospitalaria" }],
  icu:  [{ id: "ICU-ADUL",  name: "UCI Adultos" }],
  mi:   [{ id: "MI-GEN",    name: "Medicina Interna General" }],
  surg: [{ id: "SURG-GEN",  name: "Cirugía General" }]
};
