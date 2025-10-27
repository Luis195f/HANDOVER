export type Specialty = {
  id: string;
  name: string;
};

export const SPECIALTIES: Specialty[] = [
  { id: 'icu', name: 'UCI Adulto' },
  { id: 'ed', name: 'Urgencias' },
  { id: 'onc', name: 'Oncología' },
  { id: 'neph', name: 'Nefrología/Diálisis' },
  { id: 'ped', name: 'Pediatría' },
  { id: 'ob', name: 'Obstetricia' },
  { id: 'neuroicu', name: 'Neuro UCI' },
  { id: 'cvicu', name: 'Cardio UCI' },
];

export const DEFAULT_SPECIALTY_ID = 'icu';
