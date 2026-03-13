import { describe, expect, it } from 'vitest';

import {
  SPECIALTY_OVERLAY_CATALOG,
  UNIT_PROFILE_CATALOG,
  WAVE_1_SPECIALTY_OVERLAY_IDS,
  WAVE_1_UNIT_PROFILE_IDS,
} from '../../profile-catalog';
import { PROFILE_REGISTRY } from '../index';
import { SPECIALTIES } from '../../specialties';
import { matchLocationToUnit } from '../../units';
import {
  LEGACY_CONTEXTUAL_UNIT_PROFILE_ALIASES,
  LEGACY_SPECIALTY_OVERLAY_ALIASES,
  LEGACY_UNIT_PROFILE_ALIASES,
  expandUnitProfileIdsForActivation,
  normalizeSpecialtyOverlayId,
  normalizeUnitProfileId,
} from '../../../types/profile';

const DOCUMENTED_UPP_IDS = [
  'emergency',
  'general-inpatient',
  'critical-care',
  'pediatric-critical-care',
  'specialized-critical-care',
  'maternal-perinatal',
  'perioperative',
  'ambulatory',
  'rehabilitation',
  'long-term-care',
  'behavioral-health',
  'home-care',
] as const;

const DOCUMENTED_UPP_LABELS = [
  'Urgencias y emergencias',
  'Hospitalizacion general',
  'UCI adulto',
  'UCI neonatal y pediatrica',
  'UCI especializada',
  'Materno-perinatal',
  'Quirofano y recuperacion',
  'Consulta externa y ambulatoria',
  'Rehabilitacion y terapias',
  'Residencias y larga estadia',
  'Salud mental',
  'Atencion domiciliaria',
] as const;

const DOCUMENTED_SOP_IDS = [
  'cvicu',
  'neuroicu',
  'onc',
  'trauma',
  'neph',
  'gastro',
  'endo',
  'pulm',
  'infect',
  'ped',
  'ob',
  'ent',
  'burns',
  'critical-emergency',
  'transplant',
] as const;

const DOCUMENTED_SOP_LABELS = [
  'Cardiologia y cirugia cardiovascular',
  'Neurologia y neurocirugia',
  'Oncologia y hematologia',
  'Traumatologia y ortopedia',
  'Nefrologia y urologia',
  'Gastroenterologia y hepatologia',
  'Endocrinologia',
  'Neumologia',
  'Infectologia',
  'Pediatria y subespecialidades',
  'Ginecologia y obstetricia',
  'Oftalmologia y otorrinolaringologia',
  'Cirugia plastica y quemados',
  'Medicina critica y emergencias',
  'Trasplante de organos solidos',
] as const;

const unique = <T,>(values: readonly T[]) => new Set(values).size;

describe('profile master catalog', () => {
  it('covers the documented UPP and SOP inventory exactly, not just by count', () => {
    expect(UNIT_PROFILE_CATALOG.map((entry) => entry.id)).toEqual(DOCUMENTED_UPP_IDS);
    expect(UNIT_PROFILE_CATALOG.map((entry) => entry.label)).toEqual(DOCUMENTED_UPP_LABELS);
    expect(unique(UNIT_PROFILE_CATALOG.map((entry) => entry.id))).toBe(UNIT_PROFILE_CATALOG.length);
    expect(unique(UNIT_PROFILE_CATALOG.map((entry) => entry.label))).toBe(UNIT_PROFILE_CATALOG.length);

    expect(SPECIALTY_OVERLAY_CATALOG.map((entry) => entry.id)).toEqual(DOCUMENTED_SOP_IDS);
    expect(SPECIALTY_OVERLAY_CATALOG.map((entry) => entry.label)).toEqual(DOCUMENTED_SOP_LABELS);
    expect(unique(SPECIALTY_OVERLAY_CATALOG.map((entry) => entry.id))).toBe(SPECIALTY_OVERLAY_CATALOG.length);
    expect(unique(SPECIALTY_OVERLAY_CATALOG.map((entry) => entry.label))).toBe(SPECIALTY_OVERLAY_CATALOG.length);
  });

  it('keeps registry coverage complete while preserving conservative activation defaults', () => {
    expect(Object.keys(PROFILE_REGISTRY.unitProfiles)).toEqual(DOCUMENTED_UPP_IDS);
    expect(Object.keys(PROFILE_REGISTRY.specialtyOverlays)).toEqual(DOCUMENTED_SOP_IDS);

    for (const entry of UNIT_PROFILE_CATALOG) {
      const definition = PROFILE_REGISTRY.unitProfiles[entry.id];
      expect(definition.aliases).toEqual(entry.aliases);
      expect(definition.readiness).toBe(entry.readiness);
      expect(definition.activation.enabledByDefault).toBe(false);
      expect(definition.activation.stage).toBe(entry.readiness === 'wave-1' ? 'pilot' : 'catalog');
    }

    for (const entry of SPECIALTY_OVERLAY_CATALOG) {
      const definition = PROFILE_REGISTRY.specialtyOverlays[entry.id];
      expect(definition.aliases).toEqual(entry.aliases);
      expect(definition.readiness).toBe(entry.readiness);
      expect(definition.activation.enabledByDefault).toBe(false);
      expect(definition.activation.stage).toBe(entry.readiness === 'wave-1' ? 'pilot' : 'catalog');
    }
  });

  it('documents legacy translations and keeps oncology compatibility contextual instead of rigid', () => {
    expect(LEGACY_UNIT_PROFILE_ALIASES).toEqual({
      pediatrics: 'general-inpatient',
    });
    expect(LEGACY_CONTEXTUAL_UNIT_PROFILE_ALIASES).toEqual({
      oncology: ['general-inpatient', 'ambulatory', 'emergency', 'home-care'],
    });
    expect(LEGACY_SPECIALTY_OVERLAY_ALIASES).toEqual({
      gyn: 'ob',
    });

    expect(expandUnitProfileIdsForActivation('oncology')).toEqual([
      'general-inpatient',
      'ambulatory',
      'emergency',
      'home-care',
    ]);
    expect(PROFILE_REGISTRY.specialtyOverlays.onc.allowedUnitProfiles).toEqual(
      LEGACY_CONTEXTUAL_UNIT_PROFILE_ALIASES.oncology,
    );

    expect(normalizeUnitProfileId('oncology')).toBe('general-inpatient');
    expect(normalizeUnitProfileId('oncology', { unitName: 'Hospital de Dia Oncologico' })).toBe('ambulatory');
    expect(normalizeUnitProfileId('oncology', { unitName: 'Oncologia Piso' })).toBe('general-inpatient');
    expect(normalizeUnitProfileId('oncology', { unitName: 'Urgencias Oncologicas' })).toBe('emergency');
    expect(normalizeUnitProfileId('oncology', { unitName: 'Paliativos Domicilio' })).toBe('home-care');
    expect(normalizeUnitProfileId('pediatrics')).toBe('general-inpatient');
    expect(normalizeSpecialtyOverlayId('gyn')).toBe('ob');
  });

  it('keeps operational specialties limited to the visible subset while wave-1 stays coherent', () => {
    expect(SPECIALTIES.map((specialty) => specialty.id)).toEqual(['icu', 'ed', 'onc', 'neph', 'ped', 'ob', 'neuroicu', 'cvicu']);
    expect(WAVE_1_UNIT_PROFILE_IDS).toEqual([
      'emergency',
      'general-inpatient',
      'critical-care',
      'specialized-critical-care',
      'maternal-perinatal',
      'perioperative',
      'ambulatory',
    ]);
    expect(WAVE_1_SPECIALTY_OVERLAY_IDS).toEqual([
      'cvicu',
      'neuroicu',
      'onc',
      'neph',
      'ped',
      'ob',
      'critical-emergency',
    ]);
  });

  it('matches existing locations through ids, names and migration aliases', () => {
    expect(matchLocationToUnit('Paciente trasladado a UCI Adulto Ala A')).toBe('icu-a');
    expect(matchLocationToUnit('Pendiente en resucitacion de urgencias')).toBe('ed-obs');
    expect(matchLocationToUnit('Control post hemodialisis')).toBe('neph-hd');
  });
});
