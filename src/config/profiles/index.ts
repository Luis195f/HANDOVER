import { getAppConfigExtra } from '../app-config';
import { SPECIALTIES_BY_ID } from '../specialties';
import { UNITS_BY_ID } from '../units';
import { UNITS_CONFIG } from '../unitsConfig';
import {
  SPECIALTY_OVERLAY_CATALOG_BY_ID,
  UNIT_PROFILE_CATALOG_BY_ID,
} from '../profile-catalog';
import {
  HANDOVER_CORE_PROFILE_ID,
  expandUnitProfileIdsForActivation,
  normalizeSpecialtyOverlayId,
  normalizeUnitProfileId,
  type ContextualPrioritySignal,
  type IceaContextVector,
  type ProfileCatalogReadiness,
  type ProfileContext,
  type ProfileContextInput,
  type ProfileRegistry,
  type ProfileOverlaySelection,
  type ProfileRegistryActivation,
  type SpecialtyOverlayDefinition,
  type SpecialtyOverlayId,
  type UnitProfileDefinition,
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
  extra?: Pick<ContextualPrioritySignal, 'weight' | 'explanation'>,
): ContextualPrioritySignal => ({
  id,
  label,
  dimension,
  source: 'unit-profile',
  profileId,
  weight: extra?.weight ?? 1,
  explanation: extra?.explanation,
});

const overlaySignal = (
  profileId: SpecialtyOverlayId,
  id: string,
  label: string,
  dimension: ContextualPrioritySignal['dimension'],
  extra?: Pick<ContextualPrioritySignal, 'weight' | 'explanation'>,
): ContextualPrioritySignal => ({
  id,
  label,
  dimension,
  source: 'specialty-overlay',
  profileId,
  weight: extra?.weight ?? 1,
  explanation: extra?.explanation,
});

const activationStageForReadiness = (readiness: ProfileCatalogReadiness): 'catalog' | 'pilot' =>
  readiness === 'wave-1' ? 'pilot' : 'catalog';

const createUnitProfileDefinition = (
  profileId: UnitProfileId,
  config: Omit<UnitProfileDefinition, 'id' | 'kind' | 'label' | 'description' | 'aliases' | 'readiness' | 'activation'>,
): UnitProfileDefinition => {
  const meta = UNIT_PROFILE_CATALOG_BY_ID[profileId];

  return {
    id: profileId,
    kind: 'unit-profile',
    label: meta.label,
    description: meta.clinicalFocus,
    aliases: meta.aliases,
    readiness: meta.readiness,
    activation: {
      enabledByDefault: false,
      stage: activationStageForReadiness(meta.readiness),
    },
    ...config,
  };
};

const createOverlayDefinition = (
  overlayId: SpecialtyOverlayId,
  config: Omit<
    SpecialtyOverlayDefinition,
    'id' | 'kind' | 'label' | 'description' | 'aliases' | 'readiness' | 'activation' | 'allowedUnitProfiles'
  > & {
    allowedUnitProfiles?: readonly UnitProfileId[];
  },
): SpecialtyOverlayDefinition => {
  const meta = SPECIALTY_OVERLAY_CATALOG_BY_ID[overlayId];

  return {
    id: overlayId,
    kind: 'specialty-overlay',
    label: meta.label,
    description: meta.clinicalFocus,
    aliases: meta.aliases,
    readiness: meta.readiness,
    activation: {
      enabledByDefault: false,
      stage: activationStageForReadiness(meta.readiness),
    },
    allowedUnitProfiles: config.allowedUnitProfiles ?? meta.allowedUnitProfiles,
    ...config,
  };
};

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
    emergency: createUnitProfileDefinition('emergency', {
      enabledSections: ['signos', 'seguridad', 'alertas', 'medicacion', 'resumen'],
      prioritySignals: [
        unitSignal('emergency', 'emergency-triage', 'Triage y prioridad sindromica', 'time-critical', {
          weight: 1.25,
          explanation: 'Triage, motivo sindromico y prioridad inicial sostienen la ventana de respuesta del relevo.',
        }),
        unitSignal('emergency', 'emergency-arrival-window', 'Ventana desde la llegada', 'deterioration-risk', {
          weight: 1.1,
          explanation: 'El tiempo desde la llegada o la ultima reevaluacion modula el riesgo de empeorar en espera.',
        }),
        unitSignal('emergency', 'emergency-reevaluation', 'Reevaluacion obligatoria', 'time-critical', {
          weight: 1.3,
          explanation: 'El pack exige hacer visible la siguiente reevaluacion clinica no delegable.',
        }),
        unitSignal('emergency', 'emergency-isolation', 'Aislamiento y seguridad de flujo', 'omission-risk', {
          weight: 1,
          explanation: 'Las precauciones y alertas de transmision no deben omitirse durante el relevo de urgencias.',
        }),
        unitSignal('emergency', 'emergency-destination', 'Destino probable y coordinacion inmediata', 'coordination', {
          weight: 1.1,
          explanation: 'El destino probable cambia prioridades, recursos y forma de escalar en el siguiente turno.',
        }),
      ],
      iceaContextDefaults: {
        surveillanceIntensity: 1,
        temporalCriticality: 2,
        continuityRisk: 1,
        coordinationComplexity: 2,
        caseMixHints: ['emergency', 'triage', 'reevaluation'],
      },
    }),
    'general-inpatient': createUnitProfileDefinition('general-inpatient', {
      enabledSections: ['seguridad', 'medicacion', 'mobilitySkin', 'psychosocial', 'escalas', 'resumen'],
      prioritySignals: [
        unitSignal('general-inpatient', 'general-inpatient-fragility', 'Fragilidad y reserva funcional', 'dependency', {
          weight: 1.2,
          explanation: 'La fragilidad y la dependencia aumentan la carga de vigilancia y movilizacion segura del turno.',
        }),
        unitSignal('general-inpatient', 'general-inpatient-delirium', 'Delirium y deterioro insidioso', 'deterioration-risk', {
          weight: 1.1,
          explanation: 'El pack hace visible delirium, desorientacion y cambios sutiles que suelen omitirse en planta.',
        }),
        unitSignal('general-inpatient', 'general-inpatient-reconciliation', 'Conciliacion terapeutica', 'omission-risk', {
          weight: 1.15,
          explanation: 'La conciliacion y los cambios del ingreso sostienen riesgo real de omision terapeutica.',
        }),
        unitSignal('general-inpatient', 'general-inpatient-dependency', 'Dependencia funcional', 'dependency', {
          weight: 1,
          explanation: 'Necesita ayuda para ABVD, movilizacion y prevencion de caidas o UPP.',
        }),
        unitSignal('general-inpatient', 'general-inpatient-discharge', 'Alta compleja y continuidad', 'coordination', {
          weight: 1.2,
          explanation: 'Alta compleja, soporte familiar y coordinacion externa condicionan el cierre seguro del turno.',
        }),
      ],
      iceaContextDefaults: {
        baselineComplexity: 1,
        continuityRisk: 2,
        dependencyLoad: 2,
        coordinationComplexity: 2,
        caseMixHints: ['general-inpatient', 'fragility', 'complex-discharge'],
      },
    }),
    'critical-care': createUnitProfileDefinition('critical-care', {
      enabledSections: ['signos', 'dispositivos', 'seguridad', 'escalas', 'medicacion', 'fluidBalance'],
      prioritySignals: [
        unitSignal('critical-care', 'critical-care-ventilation', 'Ventilacion y microvigilancia respiratoria', 'instability', {
          weight: 1.25,
          explanation: 'Ventilacion mecanica, intercambio gaseoso y secreciones sostienen la prioridad clinica del turno.',
        }),
        unitSignal('critical-care', 'critical-care-sedation', 'Sedacion y ventana neurologica', 'dependency', {
          weight: 1.1,
          explanation: 'Sedacion, analgesia y reevaluacion neurologica cambian la dependencia de vigilancia.',
        }),
        unitSignal('critical-care', 'critical-care-vasoactive', 'Perfusion y vasoactivos', 'time-critical', {
          weight: 1.3,
          explanation: 'Vasoactivos y objetivos hemodinamicos exigen continuidad minuto a minuto sin omisiones.',
        }),
        unitSignal('critical-care', 'critical-care-balance', 'Balance hidrico fino', 'therapeutic-load', {
          weight: 1.1,
          explanation: 'El cierre de balance y diuresis condiciona decisiones inmediatas del siguiente relevo.',
        }),
        unitSignal('critical-care', 'critical-care-devices', 'Dispositivos invasivos y checklist critica', 'dependency', {
          weight: 1.15,
          explanation: 'La seguridad de accesos, drenajes y vigilancia critica agrega carga de dependencia y dano potencial.',
        }),
      ],
      iceaContextDefaults: {
        baselineComplexity: 1,
        surveillanceIntensity: 2,
        therapeuticLoad: 2,
        temporalCriticality: 2,
        dependencyLoad: 2,
        caseMixHints: ['critical-care', 'ventilation', 'vasoactive'],
      },
    }),
    'pediatric-critical-care': createUnitProfileDefinition('pediatric-critical-care', {
      enabledSections: ['signos', 'seguridad', 'escalas', 'medicacion', 'resumen'],
      prioritySignals: [
        unitSignal('pediatric-critical-care', 'pediatric-critical-care-age-weight', 'Variabilidad por edad, peso y termorregulacion', 'dependency'),
        unitSignal('pediatric-critical-care', 'pediatric-critical-care-family', 'Necesidad de soporte y coordinacion familiar', 'coordination'),
      ],
      iceaContextDefaults: {
        surveillanceIntensity: 1,
        dependencyLoad: 1,
        caseMixHints: ['pediatric-critical-care'],
      },
    }),
    'specialized-critical-care': createUnitProfileDefinition('specialized-critical-care', {
      enabledSections: ['signos', 'dispositivos', 'seguridad', 'escalas', 'medicacion', 'resumen'],
      prioritySignals: [
        unitSignal('specialized-critical-care', 'specialized-critical-care-support', 'Soporte critico especifico dominante', 'unit-modifier'),
        unitSignal('specialized-critical-care', 'specialized-critical-care-sentinel', 'Eventos centinela de subunidad critica', 'time-critical'),
      ],
      iceaContextDefaults: {
        surveillanceIntensity: 1,
        therapeuticLoad: 1,
        caseMixHints: ['specialized-critical-care'],
      },
    }),
    'maternal-perinatal': createUnitProfileDefinition('maternal-perinatal', {
      enabledSections: ['signos', 'seguridad', 'resumen'],
      prioritySignals: [
        unitSignal(
          'maternal-perinatal',
          'maternal-perinatal-time',
          'Eventos de vigilancia tiempo-dependientes',
          'time-critical',
        ),
        unitSignal(
          'maternal-perinatal',
          'maternal-perinatal-coordination',
          'Continuidad materno-fetal',
          'coordination',
        ),
      ],
      iceaContextDefaults: {
        temporalCriticality: 1,
        continuityRisk: 1,
        caseMixHints: ['maternal-perinatal'],
      },
    }),
    perioperative: createUnitProfileDefinition('perioperative', {
      enabledSections: ['seguridad', 'signos', 'dispositivos', 'medicacion', 'resumen'],
      prioritySignals: [
        unitSignal('perioperative', 'perioperative-bleeding', 'Vigilancia postoperatoria de sangrado y via aerea', 'time-critical'),
        unitSignal('perioperative', 'perioperative-transition', 'Seguridad de traslado y alta de recuperacion', 'coordination'),
      ],
      iceaContextDefaults: {
        temporalCriticality: 1,
        therapeuticLoad: 1,
        caseMixHints: ['perioperative'],
      },
    }),
    ambulatory: createUnitProfileDefinition('ambulatory', {
      enabledSections: ['medicacion', 'seguridad', 'resumen'],
      prioritySignals: [
        unitSignal('ambulatory', 'ambulatory-adherence', 'Adherencia y autocuidado fuera del ingreso', 'omission-risk'),
        unitSignal('ambulatory', 'ambulatory-education', 'Educacion critica antes del egreso ambulatorio', 'coordination'),
      ],
      iceaContextDefaults: {
        continuityRisk: 1,
        coordinationComplexity: 1,
        caseMixHints: ['ambulatory'],
      },
    }),
    rehabilitation: createUnitProfileDefinition('rehabilitation', {
      enabledSections: ['mobilitySkin', 'seguridad', 'resumen'],
      prioritySignals: [
        unitSignal('rehabilitation', 'rehabilitation-function', 'Tolerancia funcional y metas de autonomia', 'dependency'),
        unitSignal('rehabilitation', 'rehabilitation-fall-risk', 'Seguridad de movilizacion y caidas', 'omission-risk'),
      ],
      iceaContextDefaults: {
        dependencyLoad: 1,
        continuityRisk: 1,
        caseMixHints: ['rehabilitation'],
      },
    }),
    'long-term-care': createUnitProfileDefinition('long-term-care', {
      enabledSections: ['seguridad', 'mobilitySkin', 'resumen'],
      prioritySignals: [
        unitSignal('long-term-care', 'long-term-care-fragility', 'Fragilidad, piel y nutricion longitudinal', 'dependency'),
        unitSignal('long-term-care', 'long-term-care-continuity', 'Cambios respecto al basal y continuidad familiar', 'coordination'),
      ],
      iceaContextDefaults: {
        baselineComplexity: 1,
        dependencyLoad: 1,
        caseMixHints: ['long-term-care'],
      },
    }),
    'behavioral-health': createUnitProfileDefinition('behavioral-health', {
      enabledSections: ['seguridad', 'alertas', 'resumen'],
      prioritySignals: [
        unitSignal('behavioral-health', 'behavioral-health-observation', 'Necesidad de observacion conductual intensiva', 'dependency'),
        unitSignal('behavioral-health', 'behavioral-health-alliance', 'Riesgo de ruptura terapeutica u omision relacional', 'coordination'),
      ],
      iceaContextDefaults: {
        surveillanceIntensity: 1,
        coordinationComplexity: 1,
        caseMixHints: ['behavioral-health'],
      },
    }),
    'home-care': createUnitProfileDefinition('home-care', {
      enabledSections: ['seguridad', 'medicacion', 'resumen'],
      prioritySignals: [
        unitSignal('home-care', 'home-care-support', 'Riesgo por cuidador, insumos y soporte social', 'coordination'),
        unitSignal('home-care', 'home-care-rehospitalization', 'Riesgo de deterioro no detectado en domicilio', 'deterioration-risk'),
      ],
      iceaContextDefaults: {
        continuityRisk: 1,
        coordinationComplexity: 1,
        caseMixHints: ['home-care'],
      },
    }),
  },
  specialtyOverlays: {
    cvicu: createOverlayDefinition('cvicu', {
      prioritySignals: [
        overlaySignal('cvicu', 'overlay-cvicu-perfusion', 'Perfusion y soporte hemodinamico', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        surveillanceIntensity: 1,
        therapeuticLoad: 1,
        caseMixHints: ['specialty-cvicu'],
      },
    }),
    neuroicu: createOverlayDefinition('neuroicu', {
      prioritySignals: [
        overlaySignal('neuroicu', 'overlay-neuroicu-change', 'Cambio neurologico nuevo', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        surveillanceIntensity: 1,
        caseMixHints: ['specialty-neurocritical'],
      },
    }),
    onc: createOverlayDefinition('onc', {
      prioritySignals: [
        overlaySignal(
          'onc',
          'overlay-onc-neutropenia',
          'Neutropenia febril y sepsis oculta',
          'deterioration-risk',
          {
            weight: 1.35,
            explanation:
              'EOPROP-IA prioriza fiebre, inmunosupresion y deterioro infeccioso precoz como riesgo no delegable del relevo.',
          },
        ),
        overlaySignal(
          'onc',
          'overlay-onc-sepsis-window',
          'Sepsis, antimicrobianos y reevaluacion del CVC',
          'time-critical',
          {
            weight: 1.25,
            explanation:
              'La ventana de sepsis y la seguridad del acceso vascular exigen seguimiento visible en el siguiente turno.',
          },
        ),
        overlaySignal(
          'onc',
          'overlay-onc-extravasation',
          'Extravasacion y continuidad segura de terapia sistemica',
          'time-critical',
          {
            weight: 1.2,
            explanation:
              'Extravasacion, infusiones activas y cambios de acceso deben anticiparse sin abrir un flujo paralelo.',
          },
        ),
        overlaySignal(
          'onc',
          'overlay-onc-symptoms',
          'Dolor no controlado, mucositis o deshidratacion',
          'therapeutic-load',
          {
            weight: 1.2,
            explanation:
              'La carga sintomatica dominante cambia la prioridad enfermera aunque no exista un evento hemodinamico mayor.',
          },
        ),
        overlaySignal(
          'onc',
          'overlay-onc-systemic-treatment',
          'Complicaciones de tratamiento sistemico y soporte hematologico',
          'specialty-modifier',
          {
            weight: 1.15,
            explanation:
              'Quimioterapia, inmunoterapia, transfusion y soporte hematologico elevan complejidad dinamica contextual.',
          },
        ),
        overlaySignal(
          'onc',
          'overlay-onc-palliation',
          'Paliacion activa y objetivos de cuidado',
          'coordination',
          {
            weight: 1.05,
            explanation:
              'Cuando hay paliacion activa, los objetivos y limites del plan no deben perderse durante el relevo.',
          },
        ),
      ],
      iceaContextDefaults: {
        baselineComplexity: 1,
        surveillanceIntensity: 1,
        therapeuticLoad: 1,
        temporalCriticality: 1,
        continuityRisk: 1,
        dependencyLoad: 1,
        coordinationComplexity: 1,
        caseMixHints: ['specialty-onc', 'eoprop-ia', 'oncology-hematology'],
      },
    }),
    trauma: createOverlayDefinition('trauma', {
      prioritySignals: [
        overlaySignal('trauma', 'overlay-trauma-neurovascular', 'Movilizacion segura y control neurovascular distal', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        dependencyLoad: 1,
        caseMixHints: ['specialty-trauma'],
      },
    }),
    neph: createOverlayDefinition('neph', {
      prioritySignals: [
        overlaySignal('neph', 'overlay-neph-balance', 'Balance y acceso vascular', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        therapeuticLoad: 1,
        caseMixHints: ['specialty-neph'],
      },
    }),
    gastro: createOverlayDefinition('gastro', {
      prioritySignals: [
        overlaySignal('gastro', 'overlay-gastro-bleeding', 'Sangrado digestivo y encefalopatia', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        therapeuticLoad: 1,
        caseMixHints: ['specialty-gastro'],
      },
    }),
    endo: createOverlayDefinition('endo', {
      prioritySignals: [
        overlaySignal('endo', 'overlay-endo-metabolic', 'Seguridad metabolica y dosificacion de insulina', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        temporalCriticality: 1,
        caseMixHints: ['specialty-endo'],
      },
    }),
    pulm: createOverlayDefinition('pulm', {
      prioritySignals: [
        overlaySignal('pulm', 'overlay-pulm-respiratory', 'Deterioro respiratorio y soporte activo', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        surveillanceIntensity: 1,
        caseMixHints: ['specialty-pulm'],
      },
    }),
    infect: createOverlayDefinition('infect', {
      prioritySignals: [
        overlaySignal('infect', 'overlay-infect-isolation', 'Aislamiento, sepsis y reevaluacion infecciosa', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        baselineComplexity: 1,
        caseMixHints: ['specialty-infect'],
      },
    }),
    ped: createOverlayDefinition('ped', {
      prioritySignals: [
        overlaySignal('ped', 'overlay-ped-safety', 'Seguridad por edad, peso y dosificacion', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        surveillanceIntensity: 1,
        caseMixHints: ['specialty-ped'],
      },
    }),
    ob: createOverlayDefinition('ob', {
      prioritySignals: [
        overlaySignal('ob', 'overlay-ob-bleeding', 'Sangrado, vigilancia gineco-obstetrica y continuidad perinatal', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        temporalCriticality: 1,
        caseMixHints: ['specialty-gyn-ob'],
      },
    }),
    ent: createOverlayDefinition('ent', {
      prioritySignals: [
        overlaySignal('ent', 'overlay-ent-airway', 'Complicaciones precoces de via aerea, dolor y sangrado localizado', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        continuityRisk: 1,
        caseMixHints: ['specialty-ent'],
      },
    }),
    burns: createOverlayDefinition('burns', {
      prioritySignals: [
        overlaySignal('burns', 'overlay-burns-fluid', 'Balance, injertos y dolor en quemados', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        therapeuticLoad: 1,
        caseMixHints: ['specialty-burns'],
      },
    }),
    'critical-emergency': createOverlayDefinition('critical-emergency', {
      prioritySignals: [
        overlaySignal('critical-emergency', 'overlay-critical-emergency-abcde', 'ABCDE, soporte avanzado y reevaluacion inmediata', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        surveillanceIntensity: 1,
        temporalCriticality: 1,
        caseMixHints: ['specialty-critical-emergency'],
      },
    }),
    transplant: createOverlayDefinition('transplant', {
      prioritySignals: [
        overlaySignal('transplant', 'overlay-transplant-graft', 'Vigilancia de rechazo, injerto e inmunosupresion', 'specialty-modifier'),
      ],
      iceaContextDefaults: {
        baselineComplexity: 1,
        continuityRisk: 1,
        caseMixHints: ['specialty-transplant'],
      },
    }),
  },
};

const normalizeIdList = <T extends string>(
  value: unknown,
  normalizer: (candidate: unknown) => readonly T[],
): T[] => {
  const resolved: T[] = [];

  const appendNormalized = (candidate: unknown) => {
    resolved.push(...normalizer(candidate));
  };

  if (Array.isArray(value)) {
    for (const candidate of value) {
      appendNormalized(candidate);
    }
    return resolved;
  }

  if (value && typeof value === 'object') {
    for (const [candidate, enabled] of Object.entries(value as Record<string, unknown>)) {
      if (enabled !== true) continue;
      appendNormalized(candidate);
    }
  }

  return resolved;
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
      unitProfiles: unique(normalizeIdList(parsed.unitProfiles, expandUnitProfileIdsForActivation)),
      specialtyOverlays: unique(
        normalizeIdList(parsed.specialtyOverlays, (candidate) => {
          const normalized = normalizeSpecialtyOverlayId(candidate);
          return normalized ? [normalized] : [];
        }),
      ),
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

const resolveCatalogOverlaySelections = (
  specialtyId: string | undefined,
  unitId: string | undefined,
  specialtySource: ProfileContext['specialtySource'],
): ProfileOverlaySelection[] => {
  const configuredUnit = unitId ? UNITS_CONFIG.find((entry) => entry.id === unitId) : undefined;
  const knownSpecialty = specialtyId ? SPECIALTIES_BY_ID[specialtyId] : undefined;
  const selections: ProfileOverlaySelection[] = [];

  const appendSelection = (
    candidate: unknown,
    source: ProfileOverlaySelection['source'],
  ) => {
    const normalized = normalizeSpecialtyOverlayId(candidate);
    if (!normalized) {
      return;
    }

    const nextSelection: ProfileOverlaySelection = {
      overlayId: normalized,
      source,
      specialtyId: source === 'specialty' ? specialtyId : undefined,
      isHumanOverride: source === 'specialty' && specialtySource === 'explicit',
    };
    const existingIndex = selections.findIndex((selection) => selection.overlayId === normalized);

    if (existingIndex === -1) {
      selections.push(nextSelection);
      return;
    }

    if (nextSelection.isHumanOverride && !selections[existingIndex].isHumanOverride) {
      selections[existingIndex] = nextSelection;
    }
  };

  for (const overlayId of configuredUnit?.specialtyOverlayIds ?? []) {
    appendSelection(overlayId, 'unit-config');
  }
  if (knownSpecialty?.overlayId) {
    appendSelection(knownSpecialty.overlayId, 'specialty');
  }

  return selections;
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
  const requestedSpecialtyId = normalizeId(specialtyId);
  const inferredSpecialtyId = normalizedUnitId ? UNITS_BY_ID[normalizedUnitId]?.specialtyId : undefined;
  const configuredUnitSpecialty = normalizedUnitId
    ? UNITS_CONFIG.find((entry) => entry.id === normalizedUnitId)?.specialty
    : undefined;
  const specialtySource: ProfileContext['specialtySource'] = requestedSpecialtyId
    ? 'explicit'
    : inferredSpecialtyId
      ? 'unit'
      : configuredUnitSpecialty
        ? 'unit-config'
        : 'none';
  const normalizedSpecialtyId = requestedSpecialtyId ?? inferredSpecialtyId ?? configuredUnitSpecialty;
  const catalogUnitProfileId = resolveCatalogUnitProfileId(normalizedUnitId, normalizedSpecialtyId);
  const overlaySelections = resolveCatalogOverlaySelections(normalizedSpecialtyId, normalizedUnitId, specialtySource);
  const catalogSpecialtyOverlayIds = overlaySelections.map((selection) => selection.overlayId);
  const unitProfileId =
    catalogUnitProfileId && isUnitProfileActive(catalogUnitProfileId) ? catalogUnitProfileId : null;
  const specialtyOverlayIds = unitProfileId
    ? overlaySelections
        .map((selection) => selection.overlayId)
        .filter(
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
    requestedSpecialtyId,
    specialtyId: normalizedSpecialtyId,
    specialtySource,
    catalogUnitProfileId,
    unitProfileId,
    overlaySelections,
    catalogSpecialtyOverlayIds,
    specialtyOverlayIds,
    activeProfileIds,
    hasHumanSpecialtyOverride: specialtySource === 'explicit',
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

