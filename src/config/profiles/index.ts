import { getAppConfigExtra } from '../app-config';
import { SPECIALTIES_BY_ID } from '../specialties';
import { UNITS_BY_ID } from '../units';
import { UNITS_CONFIG } from '../unitsConfig';
import {
  HANDOVER_CORE_PROFILE_ID,
  isSpecialtyOverlayId,
  isUnitProfileId,
  type ContextualPrioritySignal,
  type IceaContextVector,
  type ProfileContext,
  type ProfileContextInput,
  type ProfileRegistry,
  type ProfileRegistryActivation,
  type SpecialtyOverlayId,
  type UnitProfileId,
} from '../../types/profile';

const extra = getAppConfigExtra();

const CORE_SECTIONS = [
  'turno',
  'paciente',
  'sbar',
  'signos',
  'seguridad',
  'medicacion',
  'dispositivos',
  'resumen',
] as const;

const coreSignal = (
  id: string,
  label: string,
  dimension: ContextualPrioritySignal['dimension'],
): ContextualPrioritySignal => ({
  id,
  label,
  dimension,
  source: 'core',
  weight: 1,
});

const unitSignal = (
  profileId: UnitProfileId,
  id: string,
  label: string,
  dimension: ContextualPrioritySignal['dimension'],
): ContextualPrioritySignal => ({
  id,
  label,
  dimension,
  source: 'unit-profile',
  profileId,
  weight: 1,
});

const overlaySignal = (
  profileId: SpecialtyOverlayId,
  id: string,
  label: string,
  dimension: ContextualPrioritySignal['dimension'],
): ContextualPrioritySignal => ({
  id,
  label,
  dimension,
  source: 'specialty-overlay',
  profileId,
  weight: 1,
});

export const PROFILE_REGISTRY: ProfileRegistry = {
  core: {
    id: HANDOVER_CORE_PROFILE_ID,
    kind: 'core',
    label: 'HANDOVER Core',
    description:
      'Base comun y siempre disponible para la entrega de turno cuando no hay un pack contextual activo.',
    enabledSections: CORE_SECTIONS,
    prioritySignals: [
      coreSignal('core-instability', 'Inestabilidad actual', 'instability'),
      coreSignal('core-deterioration', 'Riesgo de deterioro proximo', 'deterioration-risk'),
      coreSignal('core-dependency', 'Dependencia y vigilancia requerida', 'dependency'),
      coreSignal('core-therapeutic-load', 'Carga terapeutica', 'therapeutic-load'),
      coreSignal('core-time-critical', 'Pendientes tiempo-dependientes', 'time-critical'),
      coreSignal('core-omission-risk', 'Riesgo de omision', 'omission-risk'),
      coreSignal('core-coordination', 'Complejidad de coordinacion', 'coordination'),
    ],
    iceaContextDefaults: {
      baselineComplexity: 0,
      surveillanceIntensity: 0,
      therapeuticLoad: 0,
      temporalCriticality: 0,
      continuityRisk: 0,
      dependencyLoad: 0,
      coordinationComplexity: 0,
      caseMixHints: ['handover-core'],
    },
  },
  unitProfiles: {
    'critical-care': {
      id: 'critical-care',
      kind: 'unit-profile',
      label: 'Cuidados criticos',
      description: 'Perfil base para UCI y otras camas de vigilancia intensiva.',
      activation: { enabledByDefault: false, stage: 'catalog' },
      enabledSections: ['signos', 'dispositivos', 'seguridad', 'escalas', 'medicacion'],
      prioritySignals: [
        unitSignal('critical-care', 'critical-care-instability', 'Microvigilancia fisiologica', 'instability'),
        unitSignal('critical-care', 'critical-care-time', 'Criticidad temporal continua', 'time-critical'),
      ],
      iceaContextDefaults: {
        surveillanceIntensity: 1,
        temporalCriticality: 1,
        caseMixHints: ['critical-care'],
      },
    },
    emergency: {
      id: 'emergency',
      kind: 'unit-profile',
      label: 'Urgencias',
      description: 'Perfil base para flujos de triage, boxes y observacion.',
      activation: { enabledByDefault: false, stage: 'catalog' },
      enabledSections: ['signos', 'seguridad', 'alertas', 'medicacion', 'resumen'],
      prioritySignals: [
        unitSignal('emergency', 'emergency-time', 'Reevaluacion obligatoria', 'time-critical'),
        unitSignal('emergency', 'emergency-deterioration', 'Riesgo de empeorar en espera', 'deterioration-risk'),
      ],
      iceaContextDefaults: {
        temporalCriticality: 1,
        coordinationComplexity: 1,
        caseMixHints: ['emergency'],
      },
    },
    'general-inpatient': {
      id: 'general-inpatient',
      kind: 'unit-profile',
      label: 'Hospitalizacion general',
      description: 'Perfil base para plantas y continuidad de cuidados no criticos.',
      activation: { enabledByDefault: false, stage: 'catalog' },
      enabledSections: ['seguridad', 'medicacion', 'mobilitySkin', 'resumen'],
      prioritySignals: [
        unitSignal('general-inpatient', 'general-inpatient-dependency', 'Dependencia funcional', 'dependency'),
        unitSignal('general-inpatient', 'general-inpatient-continuity', 'Riesgo de continuidad', 'coordination'),
      ],
      iceaContextDefaults: {
        continuityRisk: 1,
        dependencyLoad: 1,
        caseMixHints: ['general-inpatient'],
      },
    },
    oncology: {
      id: 'oncology',
      kind: 'unit-profile',
      label: 'Oncologia',
      description: 'Perfil base para hospital de dia y hospitalizacion oncologica.',
      activation: { enabledByDefault: false, stage: 'catalog' },
      enabledSections: ['signos', 'medicacion', 'seguridad', 'resumen'],
      prioritySignals: [
        unitSignal('oncology', 'oncology-symptom-load', 'Carga sintomatica y terapeutica', 'therapeutic-load'),
        unitSignal('oncology', 'oncology-deterioration', 'Riesgo infeccioso y deterioro', 'deterioration-risk'),
      ],
      iceaContextDefaults: {
        baselineComplexity: 1,
        therapeuticLoad: 1,
        caseMixHints: ['oncology'],
      },
    },
    pediatrics: {
      id: 'pediatrics',
      kind: 'unit-profile',
      label: 'Pediatria',
      description: 'Perfil base para pacientes pediatricos y apoyo a cuidadores.',
      activation: { enabledByDefault: false, stage: 'catalog' },
      enabledSections: ['signos', 'seguridad', 'escalas', 'resumen'],
      prioritySignals: [
        unitSignal('pediatrics', 'pediatrics-surveillance', 'Variabilidad por edad y peso', 'dependency'),
        unitSignal('pediatrics', 'pediatrics-coordination', 'Necesidad de coordinacion con cuidadores', 'coordination'),
      ],
      iceaContextDefaults: {
        surveillanceIntensity: 1,
        coordinationComplexity: 1,
        caseMixHints: ['pediatrics'],
      },
    },
    'maternal-perinatal': {
      id: 'maternal-perinatal',
      kind: 'unit-profile',
      label: 'Materno-perinatal',
      description: 'Perfil base para obstetricia, parto y continuidad madre-hijo.',
      activation: { enabledByDefault: false, stage: 'catalog' },
      enabledSections: ['signos', 'seguridad', 'resumen'],
      prioritySignals: [
        unitSignal('maternal-perinatal', 'maternal-perinatal-time', 'Eventos de vigilancia tiempo-dependientes', 'time-critical'),
        unitSignal('maternal-perinatal', 'maternal-perinatal-coordination', 'Continuidad materno-fetal', 'coordination'),
      ],
      iceaContextDefaults: {
        temporalCriticality: 1,
        continuityRisk: 1,
        caseMixHints: ['maternal-perinatal'],
      },
    },
  },
  specialtyOverlays: {
    onc: {
      id: 'onc',
      kind: 'specialty-overlay',
      label: 'Overlay oncologico',
      description: 'Ajusta foco a toxicidad, neutropenia y carga sintomatica.',
      activation: { enabledByDefault: false, stage: 'catalog' },
      allowedUnitProfiles: ['general-inpatient', 'oncology'],
      prioritySignals: [
        overlaySignal('onc', 'overlay-onc-infection', 'Riesgo infeccioso', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        baselineComplexity: 1,
        caseMixHints: ['specialty-onc'],
      },
    },
    neph: {
      id: 'neph',
      kind: 'specialty-overlay',
      label: 'Overlay nefrologia',
      description: 'Ajusta foco a balance, accesos y vigilancia renal.',
      activation: { enabledByDefault: false, stage: 'catalog' },
      allowedUnitProfiles: ['general-inpatient'],
      prioritySignals: [
        overlaySignal('neph', 'overlay-neph-balance', 'Balance y acceso vascular', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        therapeuticLoad: 1,
        caseMixHints: ['specialty-neph'],
      },
    },
    ped: {
      id: 'ped',
      kind: 'specialty-overlay',
      label: 'Overlay pediatrico',
      description: 'Ajusta foco a subespecialidades pediatricas sin romper el perfil base.',
      activation: { enabledByDefault: false, stage: 'catalog' },
      allowedUnitProfiles: ['pediatrics'],
      prioritySignals: [
        overlaySignal('ped', 'overlay-ped-safety', 'Seguridad por edad y dosificacion', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        surveillanceIntensity: 1,
        caseMixHints: ['specialty-ped'],
      },
    },
    ob: {
      id: 'ob',
      kind: 'specialty-overlay',
      label: 'Overlay obstetrico',
      description: 'Ajusta foco a sangrado, binomio madre-hijo y eventos perinatales.',
      activation: { enabledByDefault: false, stage: 'catalog' },
      allowedUnitProfiles: ['maternal-perinatal'],
      prioritySignals: [
        overlaySignal('ob', 'overlay-ob-bleeding', 'Vigilancia de sangrado y bienestar perinatal', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        temporalCriticality: 1,
        caseMixHints: ['specialty-ob'],
      },
    },
    neuroicu: {
      id: 'neuroicu',
      kind: 'specialty-overlay',
      label: 'Overlay neurocritico',
      description: 'Ajusta foco a cambios neurologicos y deterioro subito.',
      activation: { enabledByDefault: false, stage: 'catalog' },
      allowedUnitProfiles: ['critical-care'],
      prioritySignals: [
        overlaySignal('neuroicu', 'overlay-neuroicu-change', 'Cambio neurologico nuevo', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        surveillanceIntensity: 1,
        caseMixHints: ['specialty-neurocritical'],
      },
    },
    cvicu: {
      id: 'cvicu',
      kind: 'specialty-overlay',
      label: 'Overlay cardio-critico',
      description: 'Ajusta foco a perfusion, ritmo y dispositivos cardiovasculares.',
      activation: { enabledByDefault: false, stage: 'catalog' },
      allowedUnitProfiles: ['critical-care'],
      prioritySignals: [
        overlaySignal('cvicu', 'overlay-cvicu-perfusion', 'Perfusion y soporte hemodinamico', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        surveillanceIntensity: 1,
        therapeuticLoad: 1,
        caseMixHints: ['specialty-cvicu'],
      },
    },
  },
};

const normalizeIdList = <T extends string>(
  value: unknown,
  guard: (candidate: unknown) => candidate is T,
): T[] => {
  if (Array.isArray(value)) {
    return value.filter(guard);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => enabled === true)
      .map(([candidate]) => candidate)
      .filter(guard);
  }

  return [];
};

const unique = <T extends string>(values: readonly T[]): T[] => Array.from(new Set(values));

const resolveProfileActivationConfig = (): ProfileRegistryActivation => {
  const extraValue = (extra as Record<string, unknown>).HANDOVER_PROFILE_ACTIVATION_JSON;
  const raw =
    (typeof extraValue === 'string' ? extraValue : undefined) ??
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON ??
    process.env.HANDOVER_PROFILE_ACTIVATION_JSON ??
    '';

  if (!raw.trim()) {
    return {
      unitProfiles: [],
      specialtyOverlays: [],
    };
  }

  try {
    const parsed = JSON.parse(raw) as {
      unitProfiles?: unknown;
      specialtyOverlays?: unknown;
    };
    return {
      unitProfiles: unique(normalizeIdList(parsed.unitProfiles, isUnitProfileId)),
      specialtyOverlays: unique(normalizeIdList(parsed.specialtyOverlays, isSpecialtyOverlayId)),
    };
  } catch {
    return {
      unitProfiles: [],
      specialtyOverlays: [],
    };
  }
};

export const PROFILE_REGISTRY_ACTIVATION = resolveProfileActivationConfig();

export const isUnitProfileActive = (profileId: UnitProfileId): boolean =>
  PROFILE_REGISTRY_ACTIVATION.unitProfiles.includes(profileId);

export const isSpecialtyOverlayActive = (overlayId: SpecialtyOverlayId): boolean =>
  PROFILE_REGISTRY_ACTIVATION.specialtyOverlays.includes(overlayId);

const normalizeId = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const mergeIceaContext = (
  ...vectors: ReadonlyArray<Readonly<Partial<IceaContextVector>> | undefined>
): Readonly<Partial<IceaContextVector>> => {
  const result: Partial<IceaContextVector> = {};
  const hints: string[] = [];

  for (const vector of vectors) {
    if (!vector) continue;
    const nextHints = vector.caseMixHints ?? [];
    hints.push(...nextHints);
    Object.assign(result, { ...vector, caseMixHints: undefined });
  }

  if (hints.length > 0) {
    result.caseMixHints = unique(hints);
  }

  return result;
};

const resolveCatalogUnitProfileId = (
  unitId: string | undefined,
  specialtyId: string | undefined,
): UnitProfileId | null => {
  const knownUnit = unitId ? UNITS_BY_ID[unitId] : undefined;
  if (knownUnit?.profileId) {
    return knownUnit.profileId;
  }

  const configuredUnit = unitId ? UNITS_CONFIG.find((entry) => entry.id === unitId) : undefined;
  if (configuredUnit?.profileId) {
    return configuredUnit.profileId;
  }

  const knownSpecialty = specialtyId ? SPECIALTIES_BY_ID[specialtyId] : undefined;
  return knownSpecialty?.defaultUnitProfileId ?? null;
};

const resolveCatalogOverlayIds = (
  specialtyId: string | undefined,
  unitId: string | undefined,
): SpecialtyOverlayId[] => {
  const configuredUnit = unitId ? UNITS_CONFIG.find((entry) => entry.id === unitId) : undefined;
  const knownSpecialty = specialtyId ? SPECIALTIES_BY_ID[specialtyId] : undefined;
  const overlays = [
    ...(configuredUnit?.specialtyOverlayIds ?? []),
    ...(knownSpecialty?.overlayId ? [knownSpecialty.overlayId] : []),
  ].filter(isSpecialtyOverlayId);

  return unique(overlays);
};

const isOverlayCompatibleWithUnitProfile = (
  overlayId: SpecialtyOverlayId,
  unitProfileId: UnitProfileId | null,
): boolean => {
  if (!unitProfileId) return false;

  const allowedUnitProfiles = PROFILE_REGISTRY.specialtyOverlays[overlayId]?.allowedUnitProfiles;
  if (!allowedUnitProfiles || allowedUnitProfiles.length === 0) {
    return false;
  }

  return allowedUnitProfiles.includes(unitProfileId);
};

export const resolveProfileContext = ({ unitId, specialtyId }: ProfileContextInput): ProfileContext => {
  const normalizedUnitId = normalizeId(unitId);
  const inferredSpecialtyId = normalizedUnitId ? UNITS_BY_ID[normalizedUnitId]?.specialtyId : undefined;
  const configuredUnitSpecialty = normalizedUnitId
    ? UNITS_CONFIG.find((entry) => entry.id === normalizedUnitId)?.specialty
    : undefined;
  const normalizedSpecialtyId = normalizeId(specialtyId) ?? inferredSpecialtyId ?? configuredUnitSpecialty;
  const catalogUnitProfileId = resolveCatalogUnitProfileId(normalizedUnitId, normalizedSpecialtyId);
  const catalogSpecialtyOverlayIds = resolveCatalogOverlayIds(normalizedSpecialtyId, normalizedUnitId);
  const unitProfileId =
    catalogUnitProfileId && isUnitProfileActive(catalogUnitProfileId) ? catalogUnitProfileId : null;
  const specialtyOverlayIds = unitProfileId
    ? catalogSpecialtyOverlayIds.filter(
        (overlayId) =>
          isSpecialtyOverlayActive(overlayId) &&
          isOverlayCompatibleWithUnitProfile(overlayId, unitProfileId),
      )
    : [];

  const prioritySignals = [
    ...PROFILE_REGISTRY.core.prioritySignals,
    ...(unitProfileId ? PROFILE_REGISTRY.unitProfiles[unitProfileId].prioritySignals ?? [] : []),
    ...specialtyOverlayIds.flatMap((overlayId) => PROFILE_REGISTRY.specialtyOverlays[overlayId].prioritySignals ?? []),
  ];

  const iceaContext = mergeIceaContext(
    PROFILE_REGISTRY.core.iceaContextDefaults,
    unitProfileId ? PROFILE_REGISTRY.unitProfiles[unitProfileId].iceaContextDefaults : undefined,
    ...specialtyOverlayIds.map((overlayId) => PROFILE_REGISTRY.specialtyOverlays[overlayId].iceaContextDefaults),
  );

  const activeProfileIds = [
    HANDOVER_CORE_PROFILE_ID,
    ...(unitProfileId ? [unitProfileId] : []),
    ...specialtyOverlayIds,
  ] as const;

  return {
    coreProfileId: HANDOVER_CORE_PROFILE_ID,
    unitId: normalizedUnitId,
    specialtyId: normalizedSpecialtyId,
    catalogUnitProfileId,
    unitProfileId,
    catalogSpecialtyOverlayIds,
    specialtyOverlayIds,
    activeProfileIds,
    usesCoreFallback: unitProfileId == null,
    prioritySignals,
    iceaContext,
  };
};

export const getUnitProfileDefinition = (profileId?: UnitProfileId | null) =>
  profileId ? PROFILE_REGISTRY.unitProfiles[profileId] : null;

export const getSpecialtyOverlayDefinition = (overlayId?: SpecialtyOverlayId | null) =>
  overlayId ? PROFILE_REGISTRY.specialtyOverlays[overlayId] : null;

export type {
  ProfileContextInput,
  ProfileRegistryActivation,
} from '../../types/profile';


