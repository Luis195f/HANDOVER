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
    overlayId: 'critical-emergency',
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
    name: 'Nefrologia/Dialisis',
    aliases: SPECIALTY_OVERLAY_CATALOG_BY_ID.neph.aliases,
    readiness: SPECIALTY_OVERLAY_CATALOG_BY_ID.neph.readiness,
    defaultUnitProfileId: 'general-inpatient',
    overlayId: 'neph',
  },
  {
    id: 'ped',
    name: 'Pediatria',
    aliases: SPECIALTY_OVERLAY_CATALOG_BY_ID.ped.aliases,
    readiness: SPECIALTY_OVERLAY_CATALOG_BY_ID.ped.readiness,
    defaultUnitProfileId: 'general-inpatient',
    overlayId: 'ped',
  },
  {
    id: 'ob',
    name: 'Obstetricia',
    aliases: SPECIALTY_OVERLAY_CATALOG_BY_ID.ob.aliases,
    readiness: SPECIALTY_OVERLAY_CATALOG_BY_ID.ob.readiness,
    defaultUnitProfileId: 'maternal-perinatal',
    overlayId: 'ob',
  },
  {
    id: 'neuroicu',
    name: 'Neuro UCI',
    aliases: SPECIALTY_OVERLAY_CATALOG_BY_ID.neuroicu.aliases,
    readiness: SPECIALTY_OVERLAY_CATALOG_BY_ID.neuroicu.readiness,
    defaultUnitProfileId: 'specialized-critical-care',
    overlayId: 'neuroicu',
  },
  {
    id: 'cvicu',
    name: 'Cardio UCI',
    aliases: SPECIALTY_OVERLAY_CATALOG_BY_ID.cvicu.aliases,
    readiness: SPECIALTY_OVERLAY_CATALOG_BY_ID.cvicu.readiness,
    defaultUnitProfileId: 'specialized-critical-care',
    overlayId: 'cvicu',
  },
];

export const SPECIALTIES_BY_ID: Record<string, Specialty> = SPECIALTIES.reduce(
  (acc, specialty) => ({ ...acc, [specialty.id]: specialty }),
  {} as Record<string, Specialty>
);

export const DEFAULT_SPECIALTY_ID = 'icu';
