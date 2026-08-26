import { SPECIALTY_OVERLAY_CATALOG_BY_ID } from './profile-catalog';
import type { ProfileCatalogReadiness, SpecialtyOverlayId, UnitProfileId } from '../types/profile';

export type Specialty = {
  id: string;
  name: string;
  aliases?: readonly string[];
  readiness: ProfileCatalogReadiness;
  defaultUnitProfileId?: UnitProfileId;
  overlayId?: SpecialtyOverlayId;
};

export const SPECIALTIES: Specialty[] = [
  {
    id: 'icu',
    name: 'UCI Adulto',
    aliases: ['uci', 'uci-adulto', 'cuidados-criticos'],
    readiness: 'wave-1',
    defaultUnitProfileId: 'critical-care',
  },
  {
    id: 'ed',
    name: 'Urgencias',
    aliases: ['urgencias', 'emergencias', 'observacion'],
    readiness: 'wave-1',
    defaultUnitProfileId: 'emergency',
    overlayId: 'criticalEmergency',
  },
  {
    id: 'onc',
    name: 'Oncologia',
    aliases: SPECIALTY_OVERLAY_CATALOG_BY_ID.onc.aliases,
    readiness: SPECIALTY_OVERLAY_CATALOG_BY_ID.onc.readiness,
    defaultUnitProfileId: 'general-inpatient',
    overlayId: 'onc',
  },
  {
    id: 'neph',
    name: 'Nefrologia/Urologia',
    aliases: SPECIALTY_OVERLAY_CATALOG_BY_ID.nefroUro.aliases,
    readiness: SPECIALTY_OVERLAY_CATALOG_BY_ID.nefroUro.readiness,
    defaultUnitProfileId: 'general-inpatient',
    overlayId: 'nefroUro',
  },
  {
    id: 'ped',
    name: 'Pediatria',
    aliases: SPECIALTY_OVERLAY_CATALOG_BY_ID.pedsSubspecialties.aliases,
    readiness: SPECIALTY_OVERLAY_CATALOG_BY_ID.pedsSubspecialties.readiness,
    defaultUnitProfileId: 'general-inpatient',
    overlayId: 'pedsSubspecialties',
  },
  {
    id: 'ob',
    name: 'Ginecologia/Obstetricia',
    aliases: SPECIALTY_OVERLAY_CATALOG_BY_ID.gynObs.aliases,
    readiness: SPECIALTY_OVERLAY_CATALOG_BY_ID.gynObs.readiness,
    defaultUnitProfileId: 'maternal-perinatal',
    overlayId: 'gynObs',
  },
  {
    id: 'neuroicu',
    name: 'Neuro UCI',
    aliases: SPECIALTY_OVERLAY_CATALOG_BY_ID.neuro.aliases,
    readiness: SPECIALTY_OVERLAY_CATALOG_BY_ID.neuro.readiness,
    defaultUnitProfileId: 'specialized-critical-care',
    overlayId: 'neuro',
  },
  {
    id: 'cvicu',
    name: 'Cardio UCI',
    aliases: SPECIALTY_OVERLAY_CATALOG_BY_ID.cardio.aliases,
    readiness: SPECIALTY_OVERLAY_CATALOG_BY_ID.cardio.readiness,
    defaultUnitProfileId: 'specialized-critical-care',
    overlayId: 'cardio',
  },
  {
    id: 'psych',
    name: 'Psiquiatria y salud mental',
    aliases: [
      'salud-mental',
      'psiquiatria',
      'psiquiatria-adulto',
      'psiquiatria-infanto-adolescente',
      'psicogeriatria',
      'deterioro-cognitivo-conductual',
    ],
    readiness: 'scaffold',
    defaultUnitProfileId: 'behavioral-health',
  },
];

export const SPECIALTIES_BY_ID: Record<string, Specialty> = SPECIALTIES.reduce(
  (acc, specialty) => ({ ...acc, [specialty.id]: specialty }),
  {} as Record<string, Specialty>
);

export const DEFAULT_SPECIALTY_ID = 'icu';
