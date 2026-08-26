import { describe, expect, it } from 'vitest';

import {
  REGISTRY_ONLY_SPECIALTY_OVERLAY_IDS,
  SPECIALTY_OVERLAY_CATALOG,
  UNIT_PROFILE_CATALOG,
  WAVE_1_SPECIALTY_OVERLAY_IDS,
  WAVE_1_UNIT_PROFILE_IDS,
} from '../../profile-catalog';
import { PROFILE_REGISTRY } from '../index';
import { SPECIALTY_OVERLAY_RUNTIME_PACKS } from '../overlays';
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
  'cardio',
  'neuro',
  'onc',
  'trauma',
  'infecto',
  'neumo',
  'nefroUro',
  'gastroHepato',
  'endo',
  'gynObs',
  'pedsSubspecialties',
  'ophthalEnt',
  'plasticsBurns',
  'criticalEmergency',
  'transplant',
] as const;

const DOCUMENTED_SOP_LABELS = [
  'Cardiologia y cirugia cardiovascular',
  'Neurologia y neurocirugia',
  'Oncologia y hematologia',
  'Traumatologia y ortopedia',
  'Infectologia',
  'Neumologia',
  'Nefrologia y urologia',
  'Gastroenterologia y hepatologia',
  'Endocrinologia',
  'Ginecologia y obstetricia',
  'Pediatria y subespecialidades',
  'Oftalmologia y otorrinolaringologia',
  'Cirugia plastica y quemados',
  'Medicina critica y emergencias',
  'Trasplante de organos solidos',
] as const;

const EXPECTED_COMPATIBILITY = {
  cardio: ['critical-care', 'specialized-critical-care', 'emergency', 'general-inpatient', 'home-care'],
  neuro: ['critical-care', 'specialized-critical-care', 'emergency', 'general-inpatient', 'rehabilitation'],
  onc: ['general-inpatient', 'ambulatory', 'emergency', 'home-care'],
  trauma: ['emergency', 'critical-care', 'general-inpatient', 'rehabilitation'],
  infecto: ['critical-care', 'general-inpatient', 'ambulatory', 'home-care', 'emergency'],
  neumo: ['critical-care', 'emergency', 'general-inpatient', 'home-care'],
  nefroUro: ['general-inpatient', 'emergency', 'ambulatory', 'home-care'],
  gastroHepato: ['general-inpatient', 'emergency', 'ambulatory', 'home-care'],
  endo: ['general-inpatient', 'emergency', 'ambulatory', 'home-care'],
  gynObs: ['maternal-perinatal', 'general-inpatient', 'emergency', 'ambulatory', 'home-care'],
  pedsSubspecialties: ['general-inpatient', 'pediatric-critical-care'],
  ophthalEnt: ['ambulatory', 'emergency', 'general-inpatient'],
  plasticsBurns: ['emergency', 'general-inpatient', 'home-care'],
  criticalEmergency: ['emergency', 'critical-care'],
  transplant: ['general-inpatient', 'ambulatory', 'home-care', 'critical-care'],
} as const;

const EXPECTED_ICEA_PLACEHOLDERS = {
  cardio: ['temporalCriticality', 'therapeuticLoad', 'coordinationComplexity'],
  neuro: ['surveillanceIntensity', 'dependencyLoad', 'temporalCriticality'],
  onc: ['surveillanceIntensity', 'therapeuticLoad', 'temporalCriticality', 'continuityRisk', 'dependencyLoad', 'coordinationComplexity'],
  trauma: ['temporalCriticality', 'therapeuticLoad', 'coordinationComplexity'],
  infecto: ['surveillanceIntensity', 'temporalCriticality', 'continuityRisk'],
  neumo: ['surveillanceIntensity', 'therapeuticLoad', 'dependencyLoad'],
  nefroUro: ['therapeuticLoad', 'continuityRisk', 'coordinationComplexity'],
  gastroHepato: ['therapeuticLoad', 'continuityRisk', 'dependencyLoad'],
  endo: ['therapeuticLoad', 'temporalCriticality', 'continuityRisk'],
  gynObs: ['temporalCriticality', 'coordinationComplexity', 'continuityRisk'],
  pedsSubspecialties: ['dependencyLoad', 'surveillanceIntensity', 'coordinationComplexity'],
  ophthalEnt: ['therapeuticLoad', 'continuityRisk'],
  plasticsBurns: ['therapeuticLoad', 'surveillanceIntensity', 'dependencyLoad'],
  criticalEmergency: ['temporalCriticality', 'surveillanceIntensity', 'coordinationComplexity'],
  transplant: ['surveillanceIntensity', 'continuityRisk', 'therapeuticLoad', 'coordinationComplexity'],
} as const;

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

  it('documents legacy translations and keeps wave-1 canon ids backward compatible', () => {
    expect(LEGACY_UNIT_PROFILE_ALIASES).toEqual({
      pediatrics: 'general-inpatient',
    });
    expect(LEGACY_CONTEXTUAL_UNIT_PROFILE_ALIASES).toEqual({
      oncology: ['general-inpatient', 'ambulatory', 'emergency', 'home-care'],
    });
    expect(LEGACY_SPECIALTY_OVERLAY_ALIASES).toEqual({
      cvicu: 'cardio',
      neuroicu: 'neuro',
      neph: 'nefroUro',
      gastro: 'gastroHepato',
      pulm: 'neumo',
      infect: 'infecto',
      ped: 'pedsSubspecialties',
      ob: 'gynObs',
      ent: 'ophthalEnt',
      burns: 'plasticsBurns',
      'critical-emergency': 'criticalEmergency',
      gyn: 'gynObs',
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
    expect(normalizeSpecialtyOverlayId('cvicu')).toBe('cardio');
    expect(normalizeSpecialtyOverlayId('neuroicu')).toBe('neuro');
    expect(normalizeSpecialtyOverlayId('infect')).toBe('infecto');
    expect(normalizeSpecialtyOverlayId('ped')).toBe('pedsSubspecialties');
    expect(normalizeSpecialtyOverlayId('gyn')).toBe('gynObs');
    expect(normalizeSpecialtyOverlayId('critical-emergency')).toBe('criticalEmergency');
  });

  it('keeps operational specialties limited to the visible subset while pilot-ready and registry-only stages stay explicit', () => {
    expect(SPECIALTIES.map((specialty) => specialty.id)).toEqual(['icu', 'ed', 'onc', 'neph', 'ped', 'ob', 'neuroicu', 'cvicu', 'psych']);
    expect(SPECIALTIES.find((specialty) => specialty.id === 'psych')?.aliases).toEqual(
      expect.arrayContaining(['psicogeriatria', 'deterioro-cognitivo-conductual']),
    );
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
      'cardio',
      'neuro',
      'onc',
      'trauma',
      'infecto',
      'neumo',
      'nefroUro',
      'gastroHepato',
      'endo',
      'gynObs',
    ]);
    expect(REGISTRY_ONLY_SPECIALTY_OVERLAY_IDS).toEqual([
      'pedsSubspecialties',
      'ophthalEnt',
      'plasticsBurns',
      'criticalEmergency',
      'transplant',
    ]);
  });

  it('keeps every wave-1 and registry-only overlay fully described in registry and runtime', () => {
    for (const overlayId of DOCUMENTED_SOP_IDS) {
      const definition = PROFILE_REGISTRY.specialtyOverlays[overlayId];
      const runtimePack = SPECIALTY_OVERLAY_RUNTIME_PACKS[overlayId];

      expect(definition.allowedUnitProfiles).toEqual(expect.arrayContaining([...EXPECTED_COMPATIBILITY[overlayId]]));
      expect(definition.prioritySignals?.length ?? 0).toBeGreaterThan(0);
      expect(definition.iceaContextDefaults?.caseMixHints?.length ?? 0).toBeGreaterThan(0);
      expect(definition.iceaContextPlaceholders).toEqual(expect.arrayContaining([...EXPECTED_ICEA_PLACEHOLDERS[overlayId]]));

      expect(runtimePack.enabledSections?.length ?? 0).toBeGreaterThan(0);
      expect(runtimePack.focusAreas?.length ?? 0).toBeGreaterThan(0);
      expect(runtimePack.explanations?.length ?? 0).toBeGreaterThan(0);
      expect(runtimePack.sentinelEvents?.length ?? 0).toBeGreaterThan(0);
      expect(runtimePack.visibleOutputs?.length ?? 0).toBeGreaterThan(0);
      expect(
        (runtimePack.quickPicks?.medications?.length ?? 0) + (runtimePack.quickPicks?.treatments?.length ?? 0),
      ).toBeGreaterThan(0);
    }
  });

  it('matches existing locations through ids, names and generic clinical aliases', () => {
    expect(matchLocationToUnit('Paciente trasladado a UCI Adulto Ala A')).toBe('icu-a');
    expect(matchLocationToUnit('Pendiente en resucitacion de urgencias')).toBe('ed-obs');
    expect(matchLocationToUnit('Control post hemodialisis')).toBe('neph-hd');
    expect(matchLocationToUnit('Observacion especial en Psiquiatria adulto Unidad A')).toBe('psych-adult-a');
    expect(matchLocationToUnit('Continuidad en psiquiatria adulto B')).toBe('psych-adult-b');
    expect(matchLocationToUnit('Seguimiento en salud mental infanto')).toBe('psych-child-adolescent');
    expect(matchLocationToUnit('Revisar continuidad en deterioro cognitivo conductual')).toBe('psychogeriatrics');
  });
});
