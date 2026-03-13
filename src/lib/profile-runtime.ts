import { DEFAULT_BEDSIDE_CHECKLIST_ITEMS } from '../config/bedsideChecklist';
import {
  getSpecialtyOverlayDefinition,
  getUnitProfileDefinition,
  resolveProfileContext,
} from '../config/profiles';
import { SPECIALTY_OVERLAY_RUNTIME_PACKS } from '../config/profiles/overlays';
import { HANDOVER_CORE_RUNTIME_PACK, UNIT_PROFILE_RUNTIME_PACKS } from '../config/profiles/units';
import { UNITS_BY_ID } from '../config/units';
import { getDefaultUnitConfig, getUnitConfig } from './unitConfig';
import { resolveUnitFeatureFlags, type UnitFeatureFlags } from '../config/unitsConfig';
import { isOn } from '../config/flags';
import type { BedsideChecklistItem } from '../config/bedsideChecklist';
import type {
  HandoverSectionKey,
  ProfileContext,
  ProfileRuntimeFieldId,
  ProfileRuntimeMergeKey,
  ProfileRuntimeMergeTraceEntry,
  ProfileRuntimeMedicationQuickPick,
  ProfileRuntimeTreatmentQuickPick,
  SpecialtyOverlayId,
  SpecialtyOverlayRuntimePack,
  UnitProfileId,
  UnitProfileRuntimePack,
} from '../types/profile';

export const HANDOVER_SECTIONS_INFO = [
  { key: 'turno', title: 'Datos del turno' },
  { key: 'paciente', title: 'Paciente' },
  { key: 'sbar', title: 'SBAR' },
  { key: 'signos', title: 'Signos vitales' },
  { key: 'oxigenoterapia', title: 'Oxigenoterapia' },
  { key: 'dispositivos', title: 'Dispositivos médicos' },
  { key: 'seguridad', title: 'Seguridad y riesgos' },
  { key: 'alertas', title: 'Alertas' },
  { key: 'nutrition', title: 'Nutrición' },
  { key: 'elimination', title: 'Eliminación' },
  { key: 'fluidBalance', title: 'Balance hídrico' },
  { key: 'mobilitySkin', title: 'Movilidad y piel' },
  { key: 'psychosocial', title: 'Psicosocial' },
  { key: 'escalas', title: 'Escalas clínicas' },
  { key: 'examenes', title: 'Exámenes y procedimientos' },
  { key: 'medicacion', title: 'Medicación y tratamientos' },
  { key: 'adjuntos', title: 'Adjuntos' },
  { key: 'diagnosticos', title: 'Diagnósticos médicos/enfermería' },
  { key: 'outcomes', title: 'Resultados esperados (NOC)' },
  { key: 'evolucion', title: 'Evolución' },
  { key: 'resumen', title: 'Resumen / cierre de turno' },
  { key: 'bedsideChecklist', title: 'Bedside Checklist' },
  { key: 'firmas', title: 'Firmas' },
] as const;

export type HandoverSectionInfo = (typeof HANDOVER_SECTIONS_INFO)[number];
export type HandoverSectionVisibility = Record<HandoverSectionKey, boolean>;
export type HandoverFieldVisibility = Record<ProfileRuntimeFieldId, boolean>;

export const PROFILE_RUNTIME_ADDITIVE_KEYS = [
  'enabledSections',
  'requiredExtraFields',
  'optionalExtraFields',
  'focusAreas',
  'explanations',
  'scales',
  'sentinelEvents',
  'quickPicks',
  'visibleOutputs',
  'notes',
] as const satisfies readonly ProfileRuntimeMergeKey[];

export const PROFILE_RUNTIME_OVERRIDE_KEYS = ['hiddenSections', 'visibility'] as const satisfies readonly ProfileRuntimeMergeKey[];

export interface ActiveSpecialtyOverlayRuntime {
  id: SpecialtyOverlayId;
  label: string;
  source: 'unit-config' | 'specialty';
  isHumanOverride: boolean;
  explanations: readonly string[];
}

export interface HandoverProfileRuntime {
  context: ProfileContext;
  pack: UnitProfileRuntimePack;
  basePack: UnitProfileRuntimePack;
  overlayPacks: readonly SpecialtyOverlayRuntimePack[];
  activeOverlays: readonly ActiveSpecialtyOverlayRuntime[];
  mergeTrace: readonly ProfileRuntimeMergeTraceEntry[];
  sectionVisibility: HandoverSectionVisibility;
  fieldVisibility: HandoverFieldVisibility;
  features: UnitFeatureFlags;
  checklistItems: BedsideChecklistItem[];
  requiredExtraFields: readonly string[];
  optionalExtraFields: readonly string[];
  focusAreas: readonly string[];
  explanations: readonly string[];
  suggestedScales: readonly string[];
  sentinelEvents: readonly string[];
  visibleOutputs: readonly string[];
  notes: readonly string[];
  medicationQuickPicks: readonly ProfileRuntimeMedicationQuickPick[];
  treatmentQuickPicks: readonly ProfileRuntimeTreatmentQuickPick[];
}

const FIELD_IDS: readonly ProfileRuntimeFieldId[] = [
  'legacy-sbar-narrative',
  'legacy-medication-text',
  'legacy-nursing-diagnosis-text',
  'nic-coding-hint',
  'handover-timing-hint',
  'noc-outcomes',
];

const unique = <T,>(values: readonly T[]): T[] => Array.from(new Set(values));

const mergeText = (...values: ReadonlyArray<readonly string[] | undefined>): string[] =>
  unique(values.flatMap((value) => value ?? []).filter((value) => value.trim().length > 0));

const mergeQuickPickList = <T extends { id: string }>(
  ...values: ReadonlyArray<readonly T[] | undefined>
): T[] => {
  const merged = new Map<string, T>();

  for (const value of values) {
    for (const item of value ?? []) {
      if (merged.has(item.id)) {
        merged.delete(item.id);
      }
      merged.set(item.id, item);
    }
  }

  return Array.from(merged.values());
};

const normalizeUnitId = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const hasRuntimeKey = (
  pack: Pick<UnitProfileRuntimePack | SpecialtyOverlayRuntimePack, ProfileRuntimeMergeKey>,
  key: ProfileRuntimeMergeKey,
): boolean => {
  switch (key) {
    case 'hiddenSections':
      return pack.hiddenSections !== undefined;
    case 'quickPicks':
      return Boolean(pack.quickPicks?.medications?.length || pack.quickPicks?.treatments?.length);
    case 'visibility':
      return Boolean(pack.visibility && Object.keys(pack.visibility).length > 0);
    default: {
      const value = pack[key as keyof typeof pack];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    }
  }
};

const buildMergeTraceEntry = (
  source: ProfileRuntimeMergeTraceEntry['source'],
  pack: UnitProfileRuntimePack | SpecialtyOverlayRuntimePack,
): ProfileRuntimeMergeTraceEntry => ({
  source,
  profileId: pack.id,
  label: pack.label,
  additiveKeys: PROFILE_RUNTIME_ADDITIVE_KEYS.filter((key) => hasRuntimeKey(pack, key)),
  overrideKeys: PROFILE_RUNTIME_OVERRIDE_KEYS.filter((key) => hasRuntimeKey(pack, key)),
});

const mergeIntoRuntimePack = (
  basePack: UnitProfileRuntimePack,
  layer: UnitProfileRuntimePack | SpecialtyOverlayRuntimePack,
): UnitProfileRuntimePack => ({
  ...basePack,
  enabledSections: unique([...(basePack.enabledSections ?? []), ...(layer.enabledSections ?? [])]),
  hiddenSections:
    layer.hiddenSections !== undefined
      ? unique(layer.hiddenSections)
      : basePack.hiddenSections,
  requiredExtraFields: mergeText(basePack.requiredExtraFields, layer.requiredExtraFields),
  optionalExtraFields: mergeText(basePack.optionalExtraFields, layer.optionalExtraFields),
  focusAreas: mergeText(basePack.focusAreas, layer.focusAreas),
  explanations: mergeText(basePack.explanations, layer.explanations),
  scales: mergeText(basePack.scales, layer.scales),
  sentinelEvents: mergeText(basePack.sentinelEvents, layer.sentinelEvents),
  visibleOutputs: mergeText(basePack.visibleOutputs, layer.visibleOutputs),
  notes: mergeText(basePack.notes, layer.notes),
  visibility: {
    ...(basePack.visibility ?? {}),
    ...(layer.visibility ?? {}),
  },
  quickPicks: {
    medications: mergeQuickPickList(basePack.quickPicks?.medications, layer.quickPicks?.medications),
    treatments: mergeQuickPickList(basePack.quickPicks?.treatments, layer.quickPicks?.treatments),
  },
});

const mergeBasePackWithCore = (pack: UnitProfileRuntimePack): UnitProfileRuntimePack =>
  mergeIntoRuntimePack(
    {
      ...HANDOVER_CORE_RUNTIME_PACK,
      id: pack.id,
      label: pack.label,
      quickPicks: {
        medications: HANDOVER_CORE_RUNTIME_PACK.quickPicks?.medications ?? [],
        treatments: HANDOVER_CORE_RUNTIME_PACK.quickPicks?.treatments ?? [],
      },
    },
    pack,
  );

const resolveUnitRuntimePack = (profileId?: UnitProfileId | null): UnitProfileRuntimePack | null => {
  if (!profileId) {
    return null;
  }

  const pack = UNIT_PROFILE_RUNTIME_PACKS[profileId];
  const definition = getUnitProfileDefinition(profileId);
  if (!pack) {
    return definition
      ? {
          ...HANDOVER_CORE_RUNTIME_PACK,
          id: profileId,
          label: definition.label,
        }
      : null;
  }

  return {
    ...pack,
    label: definition?.label ?? pack.label,
  };
};

const resolveOverlayRuntimePack = (overlayId?: SpecialtyOverlayId | null): SpecialtyOverlayRuntimePack | null => {
  if (!overlayId) {
    return null;
  }

  const pack = SPECIALTY_OVERLAY_RUNTIME_PACKS[overlayId];
  const definition = getSpecialtyOverlayDefinition(overlayId);
  if (!pack) {
    return definition
      ? {
          id: overlayId,
          label: definition.label,
        }
      : null;
  }

  return {
    ...pack,
    label: definition?.label ?? pack.label,
  };
};

const resolveBasePack = (
  context: ProfileContext,
  compatibilityProfileId?: UnitProfileId | null,
): UnitProfileRuntimePack => {
  const activePack = resolveUnitRuntimePack(context.unitProfileId);
  if (activePack) {
    return mergeBasePackWithCore(activePack);
  }

  const compatibilityPack = resolveUnitRuntimePack(compatibilityProfileId);
  if (compatibilityPack) {
    return mergeBasePackWithCore(compatibilityPack);
  }

  return HANDOVER_CORE_RUNTIME_PACK;
};

const resolveNotes = (pack: UnitProfileRuntimePack, features: UnitFeatureFlags): string[] => {
  const notes = [...(pack.notes ?? [])];

  if (features.enablePediatricScales) {
    notes.push('Escalas pediátricas próximamente.');
  }
  if (features.enableOncoFields) {
    notes.push('Campos oncológicos adicionales próximamente.');
  }

  return unique(notes);
};

const resolveFieldVisibility = (pack: UnitProfileRuntimePack, features: UnitFeatureFlags): HandoverFieldVisibility => {
  const base: HandoverFieldVisibility = {
    'legacy-sbar-narrative': !features.hideLegacyFields,
    'legacy-medication-text': !features.hideLegacyFields,
    'legacy-nursing-diagnosis-text': true,
    'nic-coding-hint': Boolean(features.showNicCoding),
    'handover-timing-hint': Boolean(features.showHandoverTimingMetrics),
    'noc-outcomes': Boolean(features.showNocOutcomes),
  };

  for (const fieldId of FIELD_IDS) {
    const override = pack.visibility?.[fieldId];
    if (typeof override === 'boolean') {
      base[fieldId] = override;
    }
  }

  base['nic-coding-hint'] = base['nic-coding-hint'] && Boolean(features.showNicCoding);
  base['handover-timing-hint'] = base['handover-timing-hint'] && Boolean(features.showHandoverTimingMetrics);
  base['noc-outcomes'] = base['noc-outcomes'] && Boolean(features.showNocOutcomes);

  return base;
};

const isSectionEnabledByGlobalFlags = (key: HandoverSectionKey): boolean => {
  switch (key) {
    case 'sbar':
      return isOn('SHOW_SBAR');
    case 'signos':
      return isOn('SHOW_VITALS');
    case 'oxigenoterapia':
      return isOn('SHOW_OXY');
    case 'medicacion':
      return isOn('SHOW_MEDS');
    case 'adjuntos':
      return isOn('SHOW_ATTACH');
    default:
      return true;
  }
};

const resolveSectionVisibility = (
  pack: UnitProfileRuntimePack,
  fieldVisibility: HandoverFieldVisibility,
): HandoverSectionVisibility => {
  const enabled = new Set(pack.enabledSections ?? []);
  const hidden = new Set(pack.hiddenSections ?? []);
  const visibility = {} as HandoverSectionVisibility;

  for (const section of HANDOVER_SECTIONS_INFO) {
    const key = section.key;
    let isVisible = enabled.has(key) && !hidden.has(key);

    if (key === 'outcomes') {
      isVisible = isVisible && fieldVisibility['noc-outcomes'];
    }

    visibility[key] = isVisible && isSectionEnabledByGlobalFlags(key);
  }

  return visibility;
};

export const resolveHandoverProfileRuntime = ({
  unitId,
  specialtyId,
}: {
  unitId?: string | null;
  specialtyId?: string | null;
}): HandoverProfileRuntime => {
  const normalizedRequestedUnitId = normalizeUnitId(unitId);
  const requestedUnitConfig = getUnitConfig(normalizedRequestedUnitId);
  const requestedCatalogUnit = normalizedRequestedUnitId ? UNITS_BY_ID[normalizedRequestedUnitId] : undefined;
  const defaultUnitConfig = getDefaultUnitConfig();
  const shouldUseDefaultConfiguredUnit =
    !requestedUnitConfig &&
    Boolean(defaultUnitConfig?.profileId) &&
    (!requestedCatalogUnit ||
      requestedCatalogUnit.profileId === defaultUnitConfig?.profileId ||
      requestedCatalogUnit.specialtyId === defaultUnitConfig?.specialty);
  const effectiveUnitConfig = requestedUnitConfig ?? (shouldUseDefaultConfiguredUnit ? defaultUnitConfig : null);
  const effectiveUnitId =
    requestedUnitConfig || !shouldUseDefaultConfiguredUnit
      ? normalizedRequestedUnitId
      : effectiveUnitConfig?.id ?? normalizedRequestedUnitId;
  const effectiveSpecialtyId =
    specialtyId ??
    requestedUnitConfig?.specialty ??
    (shouldUseDefaultConfiguredUnit ? effectiveUnitConfig?.specialty : undefined);
  const context = resolveProfileContext({
    unitId: effectiveUnitId,
    specialtyId: effectiveSpecialtyId,
  });
  const features = resolveUnitFeatureFlags(effectiveUnitId);
  const compatibilityProfileId =
    context.unitProfileId == null && effectiveUnitConfig?.profileId ? effectiveUnitConfig.profileId : null;
  const basePack = resolveBasePack(context, compatibilityProfileId);
  const overlayPacks = context.specialtyOverlayIds
    .map((overlayId) => resolveOverlayRuntimePack(overlayId))
    .filter((pack): pack is SpecialtyOverlayRuntimePack => Boolean(pack));
  const pack = overlayPacks.reduce((currentPack, overlayPack) => mergeIntoRuntimePack(currentPack, overlayPack), basePack);
  const fieldVisibility = resolveFieldVisibility(pack, features);
  const notes = resolveNotes(pack, features);
  const sectionVisibility = resolveSectionVisibility(pack, fieldVisibility);
  const mergeTrace = [
    buildMergeTraceEntry('core', HANDOVER_CORE_RUNTIME_PACK),
    ...(basePack.id !== HANDOVER_CORE_RUNTIME_PACK.id ? [buildMergeTraceEntry('unit-profile', basePack)] : []),
    ...overlayPacks.map((overlayPack) => buildMergeTraceEntry('specialty-overlay', overlayPack)),
  ];
  const activeOverlays = context.specialtyOverlayIds.map((overlayId) => {
    const overlayPack = overlayPacks.find((candidate) => candidate.id === overlayId);
    const overlaySelection = context.overlaySelections.find((selection) => selection.overlayId === overlayId);

    return {
      id: overlayId,
      label: overlayPack?.label ?? overlayId,
      source: overlaySelection?.source ?? 'specialty',
      isHumanOverride: overlaySelection?.isHumanOverride ?? false,
      explanations: overlayPack?.explanations ?? [],
    };
  });

  return {
    context,
    pack,
    basePack,
    overlayPacks,
    activeOverlays,
    mergeTrace,
    sectionVisibility,
    fieldVisibility,
    features,
    checklistItems: features.checklistItems ?? DEFAULT_BEDSIDE_CHECKLIST_ITEMS,
    requiredExtraFields: pack.requiredExtraFields ?? [],
    optionalExtraFields: pack.optionalExtraFields ?? [],
    focusAreas: pack.focusAreas ?? [],
    explanations: pack.explanations ?? [],
    suggestedScales: pack.scales ?? [],
    sentinelEvents: pack.sentinelEvents ?? [],
    visibleOutputs: pack.visibleOutputs ?? [],
    notes,
    medicationQuickPicks: pack.quickPicks?.medications ?? [],
    treatmentQuickPicks: pack.quickPicks?.treatments ?? [],
  };
};



