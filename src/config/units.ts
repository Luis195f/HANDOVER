import type { UnitProfileId } from '../types/profile';

export type Unit = {
  id: string;
  name: string;
  specialtyId: string;
  profileId?: UnitProfileId;
  aliases?: readonly string[];
};

export const UNITS: Unit[] = [
  {
    id: 'icu-a',
    name: 'UCI Adulto · Ala A',
    specialtyId: 'icu',
    profileId: 'critical-care',
    aliases: ['uci-adulto-a', 'icu-adulto-a', 'uci-a'],
  },
  {
    id: 'icu-b',
    name: 'UCI Adulto · Ala B',
    specialtyId: 'icu',
    profileId: 'critical-care',
    aliases: ['uci-adulto-b', 'icu-adulto-b', 'uci-b'],
  },
  {
    id: 'ed-main',
    name: 'Urgencias Central',
    specialtyId: 'ed',
    profileId: 'emergency',
    aliases: ['urgencias', 'emergencias', 'ed-main'],
  },
  {
    id: 'ed-obs',
    name: 'Urgencias Observacion',
    specialtyId: 'ed',
    profileId: 'emergency',
    aliases: ['observacion-urgencias', 'resucitacion', 'ed-observation'],
  },
  {
    id: 'onc-ward',
    name: 'Hospital de Dia Oncologia',
    specialtyId: 'onc',
    profileId: 'ambulatory',
    aliases: ['oncologia', 'hospital-de-dia-oncologico', 'day-hospital-oncology'],
  },
  {
    id: 'neph-hd',
    name: 'Hemodialisis',
    specialtyId: 'neph',
    profileId: 'ambulatory',
    aliases: ['dialisis', 'hemodialysis', 'renal-unit'],
  },
  {
    id: 'ped-ward',
    name: 'Pediatria Piso',
    specialtyId: 'ped',
    profileId: 'general-inpatient',
    aliases: ['pediatria', 'hospitalizacion-pediatrica', 'ped-floor'],
  },
  {
    id: 'ob-labor',
    name: 'Sala de Parto',
    specialtyId: 'ob',
    profileId: 'maternal-perinatal',
    aliases: ['obstetricia', 'labor-delivery', 'materno-perinatal'],
  },
  {
    id: 'neuroicu-1',
    name: 'Neuro UCI · Sala 1',
    specialtyId: 'neuroicu',
    profileId: 'specialized-critical-care',
    aliases: ['neuro-icu', 'stroke-unit-1', 'neurocritical-care-1'],
  },
  {
    id: 'cvicu-1',
    name: 'Cardio UCI · Sala 1',
    specialtyId: 'cvicu',
    profileId: 'specialized-critical-care',
    aliases: ['cardio-icu', 'cvicu', 'hemodinamia-1'],
  },
  {
    id: 'psych-adult-a',
    name: 'Psiquiatria adulto · Unidad A',
    specialtyId: 'psych',
    profileId: 'behavioral-health',
    aliases: ['psiquiatria-adulto-a'],
  },
  {
    id: 'psych-adult-b',
    name: 'Psiquiatria adulto · Unidad B',
    specialtyId: 'psych',
    profileId: 'behavioral-health',
    aliases: ['psiquiatria-adulto-b'],
  },
  {
    id: 'psych-child-adolescent',
    name: 'Psiquiatria infanto-adolescente',
    specialtyId: 'psych',
    profileId: 'behavioral-health',
    aliases: ['infanto-adolescente', 'psiquiatria-infanto', 'salud-mental-infanto'],
  },
  {
    id: 'psychogeriatrics',
    name: 'Psicogeriatria',
    specialtyId: 'psych',
    profileId: 'behavioral-health',
    aliases: ['psicogeriatria', 'deterioro-cognitivo-conductual'],
  },
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

function getUnitMatchers(unit: Unit): string[] {
  return [unit.id, unit.name, ...(unit.aliases ?? [])].map((value) => normalize(value)).filter(Boolean);
}

export function matchLocationToUnit(locationText?: string): string | null {
  const loc = normalize(locationText);
  if (!loc) return null;

  let bestMatch: { unitId: string; length: number } | null = null;

  for (const unit of UNITS) {
    for (const candidate of getUnitMatchers(unit)) {
      if (!loc.includes(candidate)) continue;
      if (!bestMatch || candidate.length > bestMatch.length) {
        bestMatch = { unitId: unit.id, length: candidate.length };
      }
    }
  }

  return bestMatch?.unitId ?? null;
}

export function guessSpecialtyFromLocation(locationText?: string): string | null {
  const unitId = matchLocationToUnit(locationText);
  if (!unitId) return null;
  return UNITS_BY_ID[unitId]?.specialtyId ?? null;
}
