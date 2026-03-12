import type { UnitProfileId } from '../types/profile';

export type Unit = {
  id: string;
  name: string;
  specialtyId: string;
  profileId?: UnitProfileId;
};

export const UNITS: Unit[] = [
  { id: 'icu-a', name: 'UCI Adulto · Ala A', specialtyId: 'icu', profileId: 'critical-care' },
  { id: 'icu-b', name: 'UCI Adulto · Ala B', specialtyId: 'icu', profileId: 'critical-care' },
  { id: 'ed-main', name: 'Urgencias Central', specialtyId: 'ed', profileId: 'emergency' },
  { id: 'ed-obs', name: 'Urgencias Observación', specialtyId: 'ed', profileId: 'emergency' },
  { id: 'onc-ward', name: 'Hospital de Día Oncología', specialtyId: 'onc', profileId: 'oncology' },
  { id: 'neph-hd', name: 'Hemodiálisis', specialtyId: 'neph' },
  { id: 'ped-ward', name: 'Pediatría Piso', specialtyId: 'ped', profileId: 'pediatrics' },
  { id: 'ob-labor', name: 'Sala de Parto', specialtyId: 'ob', profileId: 'maternal-perinatal' },
  { id: 'neuroicu-1', name: 'Neuro UCI · Sala 1', specialtyId: 'neuroicu', profileId: 'critical-care' },
  { id: 'cvicu-1', name: 'Cardio UCI · Sala 1', specialtyId: 'cvicu', profileId: 'critical-care' },
];

export const UNITS_BY_SPECIALTY: Record<string, string[]> = UNITS.reduce((acc, unit) => {
  if (!acc[unit.specialtyId]) {
    acc[unit.specialtyId] = [];
  }
  acc[unit.specialtyId].push(unit.id);
  return acc;
}, {} as Record<string, string[]>);

export const UNITS_BY_ID: Record<string, Unit> = UNITS.reduce(
  (acc, unit) => ({ ...acc, [unit.id]: unit }),
  {} as Record<string, Unit>
);

export function getUnitsForSpecialty(specialtyId: string): string[] {
  return UNITS_BY_SPECIALTY[specialtyId] ?? [];
}

export function isUnitOfSpecialty(unitId: string, specialtyId: string): boolean {
  return getUnitsForSpecialty(specialtyId).includes(unitId);
}

function normalize(value?: string): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function matchLocationToUnit(locationText?: string): string | null {
  const loc = normalize(locationText);
  if (!loc) return null;
  for (const unit of UNITS) {
    if (loc.includes(normalize(unit.id))) {
      return unit.id;
    }
  }
  return null;
}

export function guessSpecialtyFromLocation(locationText?: string): string | null {
  const unitId = matchLocationToUnit(locationText);
  if (!unitId) return null;
  return UNITS_BY_ID[unitId]?.specialtyId ?? null;
}

