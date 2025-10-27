import { describe, expect, it } from 'vitest';

import { ALL_SPECIALTIES_OPTION, ALL_UNITS_OPTION, filterPatients, type PatientListItem } from '@/src/screens/PatientList';
import type { Unit } from '@/src/config/units';

const unitsById: Record<string, Unit> = {
  'icu-a': { id: 'icu-a', name: 'UCI Adulto · Ala A', specialtyId: 'icu' },
  'icu-b': { id: 'icu-b', name: 'UCI Adulto · Ala B', specialtyId: 'icu' },
  'ed-main': { id: 'ed-main', name: 'Urgencias Central', specialtyId: 'ed' },
};

const patients: PatientListItem[] = [
  { id: 'p-1', name: 'Paciente 1', unitId: 'icu-a' },
  { id: 'p-2', name: 'Paciente 2', unitId: 'icu-b' },
  { id: 'p-3', name: 'Paciente 3', unitId: 'ed-main' },
];

describe('filterPatients', () => {
  it('devuelve todos los pacientes cuando ambos filtros están en "Todas"', () => {
    const result = filterPatients(patients, unitsById, ALL_SPECIALTIES_OPTION, ALL_UNITS_OPTION);
    expect(result).toHaveLength(3);
  });

  it('filtra por especialidad manteniendo todas las unidades de esa especialidad', () => {
    const result = filterPatients(patients, unitsById, 'icu', ALL_UNITS_OPTION);
    expect(result).toEqual([
      { id: 'p-1', name: 'Paciente 1', unitId: 'icu-a' },
      { id: 'p-2', name: 'Paciente 2', unitId: 'icu-b' },
    ]);
  });

  it('filtra por unidad específica', () => {
    const result = filterPatients(patients, unitsById, 'icu', 'icu-b');
    expect(result).toEqual([{ id: 'p-2', name: 'Paciente 2', unitId: 'icu-b' }]);
  });
});
