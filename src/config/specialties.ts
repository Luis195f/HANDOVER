import type { SpecialtyOverlayId, UnitProfileId } from '../types/profile';

export type Specialty = {
  id: string;
  name: string;
  defaultUnitProfileId?: UnitProfileId;
  overlayId?: SpecialtyOverlayId;
};

export const SPECIALTIES: Specialty[] = [
  { id: 'icu', name: 'UCI Adulto', defaultUnitProfileId: 'critical-care' },
  { id: 'ed', name: 'Urgencias', defaultUnitProfileId: 'emergency' },
  { id: 'onc', name: 'Oncología', defaultUnitProfileId: 'oncology', overlayId: 'onc' },
  { id: 'neph', name: 'Nefrología/Diálisis', defaultUnitProfileId: 'general-inpatient', overlayId: 'neph' },
  { id: 'ped', name: 'Pediatría', defaultUnitProfileId: 'pediatrics', overlayId: 'ped' },
  { id: 'ob', name: 'Obstetricia', defaultUnitProfileId: 'maternal-perinatal', overlayId: 'ob' },
  { id: 'neuroicu', name: 'Neuro UCI', defaultUnitProfileId: 'critical-care', overlayId: 'neuroicu' },
  { id: 'cvicu', name: 'Cardio UCI', defaultUnitProfileId: 'critical-care', overlayId: 'cvicu' },
];

export const SPECIALTIES_BY_ID: Record<string, Specialty> = SPECIALTIES.reduce(
  (acc, specialty) => ({ ...acc, [specialty.id]: specialty }),
  {} as Record<string, Specialty>
);

export const DEFAULT_SPECIALTY_ID = 'icu';

