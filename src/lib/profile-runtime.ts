import { DEFAULT_BEDSIDE_CHECKLIST_ITEMS } from '../config/bedsideChecklist';
import { getUnitProfileDefinition, resolveProfileContext } from '../config/profiles';
import { HANDOVER_CORE_RUNTIME_PACK, UNIT_PROFILE_RUNTIME_PACKS } from '../config/profiles/units';
import { getUnitConfig } from './unitConfig';
import { resolveUnitFeatureFlags, type UnitFeatureFlags } from '../config/unitsConfig';
import { isOn } from '../config/flags';
import type { BedsideChecklistItem } from '../config/bedsideChecklist';
import type {
  HandoverSectionKey,
  ProfileContext,
  ProfileRuntimeFieldId,
  ProfileRuntimeMedicationQuickPick,
  ProfileRuntimeTreatmentQuickPick,
  UnitProfileRuntimePack,
} from '../types/profile';

export const HANDOVER_SECTIONS_INFO = [
  { key: 'turno', title: 'Datos del turno' },
  { key: 'paciente', title: 'Paciente' },
  { key: 'sbar', title: 'SBAR' },
  { key: 'signos', title: 'Signos vitales' },
  { key: 'oxigenoterapia', title: 'Oxigenoterapia' },
  { key: 'dispositivos', title: 'Dispositivos Medicos' },
  { key: 'seguridad', title: 'Seguridad y riesgos' },
  { key: 'alertas', title: 'Alertas' },
  { key: 'nutrition', title: 'Nutricion' },
  { key: 'elimination', title: 'Eliminacion' },
  { key: 'fluidBalance', title: 'Balance hidrico' },
  { key: 'mobilitySkin', title: 'Movilidad y piel' },
  { key: 'psychosocial', title: 'Psicosocial' },
  { key: 'escalas', title: 'Escalas clinicas' },
  { key: 'examenes', title: 'Examenes y procedimientos' },
  { key: 'medicacion', title: 'Medicacion y tratamientos' },
  { key: 'adjuntos', title: 'Adjuntos' },
  { key: 'diagnosticos', title: 'Diagnosticos medicos/enfermeria' },
  { key: 'outcomes', title: 'Resultados esperados (NOC)' },
  { key: 'evolucion', title: 'Evolucion' },
  { key: 'resumen', title: 'Resumen / cierre de turno' },
  { key: 'bedsideChecklist', title: 'Bedside Checklist' },
  { key: 'firmas', title: 'Firmas' },
] as const;

export type HandoverSectionInfo = (typeof HANDOVER_SECTIONS_INFO)[number];
export type HandoverSectionVisibility = Record<HandoverSectionKey, boolean>;
export type HandoverFieldVisibility = Record<ProfileRuntimeFieldId, boolean>;

export interface HandoverProfileRuntime {
  context: ProfileContext;
  pack: UnitProfileRuntimePack;
  sectionVisibility: HandoverSectionVisibility;
  fieldVisibility: HandoverFieldVisibility;
  features: UnitFeatureFlags;
  checklistItems: BedsideChecklistItem[];
  requiredExtraFields: readonly string[];
  optionalExtraFields: readonly string[];
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

const mergeRuntimePack = (pack: UnitProfileRuntimePack): UnitProfileRuntimePack => ({
  ...HANDOVER_CORE_RUNTIME_PACK,
  ...pack,
  enabledSections: unique([
    ...(HANDOVER_CORE_RUNTIME_PACK.enabledSections ?? []),
    ...(pack.enabledSections ?? []),
  ]),
  requiredExtraFields: mergeText(HANDOVER_CORE_RUNTIME_PACK.requiredExtraFields, pack.requiredExtraFields),
  optionalExtraFields: mergeText(HANDOVER_CORE_RUNTIME_PACK.optionalExtraFields, pack.optionalExtraFields),
  scales: mergeText(HANDOVER_CORE_RUNTIME_PACK.scales, pack.scales),
  sentinelEvents: mergeText(HANDOVER_CORE_RUNTIME_PACK.sentinelEvents, pack.sentinelEvents),
  visibleOutputs: mergeText(HANDOVER_CORE_RUNTIME_PACK.visibleOutputs, pack.visibleOutputs),
  notes: mergeText(HANDOVER_CORE_RUNTIME_PACK.notes, pack.notes),
  visibility: {
    ...(HANDOVER_CORE_RUNTIME_PACK.visibility ?? {}),
    ...(pack.visibility ?? {}),
  },
  quickPicks: {
    medications: pack.quickPicks?.medications ?? [],
    treatments: pack.quickPicks?.treatments ?? [],
  },
});

const resolvePack = (context: ProfileContext): UnitProfileRuntimePack => {
  if (!context.unitProfileId) {
    return HANDOVER_CORE_RUNTIME_PACK;
  }

  const pack = UNIT_PROFILE_RUNTIME_PACKS[context.unitProfileId];
  const definition = getUnitProfileDefinition(context.unitProfileId);
  if (!pack) {
    return {
      ...HANDOVER_CORE_RUNTIME_PACK,
      label: definition?.label ?? HANDOVER_CORE_RUNTIME_PACK.label,
    };
  }

  return mergeRuntimePack({
    ...pack,
    label: definition?.label ?? pack.label,
  });
};

const resolveNotes = (pack: UnitProfileRuntimePack, features: UnitFeatureFlags): string[] => {
  const notes = [...(pack.notes ?? [])];

  if (features.enablePediatricScales) {
    notes.push('Escalas pediatricas proximamente.');
  }
  if (features.enableOncoFields) {
    notes.push('Campos oncologicos adicionales proximamente.');
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
  const unitConfig = getUnitConfig(unitId);
  const context = resolveProfileContext({
    unitId,
    specialtyId: specialtyId ?? unitConfig?.specialty,
  });
  const features = resolveUnitFeatureFlags(unitId);
  const pack = resolvePack(context);
  const fieldVisibility = resolveFieldVisibility(pack, features);
  const notes = resolveNotes(pack, features);
  const sectionVisibility = resolveSectionVisibility(pack, fieldVisibility);

  return {
    context,
    pack,
    sectionVisibility,
    fieldVisibility,
    features,
    checklistItems: features.checklistItems ?? DEFAULT_BEDSIDE_CHECKLIST_ITEMS,
    requiredExtraFields: pack.requiredExtraFields ?? [],
    optionalExtraFields: pack.optionalExtraFields ?? [],
    suggestedScales: pack.scales ?? [],
    sentinelEvents: pack.sentinelEvents ?? [],
    visibleOutputs: pack.visibleOutputs ?? [],
    notes,
    medicationQuickPicks: pack.quickPicks?.medications ?? [],
    treatmentQuickPicks: pack.quickPicks?.treatments ?? [],
  };
};
