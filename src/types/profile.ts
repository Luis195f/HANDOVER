export const HANDOVER_CORE_PROFILE_ID = 'handover-core' as const;

export const UNIT_PROFILE_IDS = [
  'critical-care',
  'emergency',
  'general-inpatient',
  'oncology',
  'pediatrics',
  'maternal-perinatal',
] as const;

export const SPECIALTY_OVERLAY_IDS = [
  'onc',
  'neph',
  'ped',
  'ob',
  'neuroicu',
  'cvicu',
] as const;

const UNIT_PROFILE_ID_SET = new Set<string>(UNIT_PROFILE_IDS);
const SPECIALTY_OVERLAY_ID_SET = new Set<string>(SPECIALTY_OVERLAY_IDS);

export type HandoverCoreProfileId = typeof HANDOVER_CORE_PROFILE_ID;
export type UnitProfileId = (typeof UNIT_PROFILE_IDS)[number];
export type SpecialtyOverlayId = (typeof SPECIALTY_OVERLAY_IDS)[number];
export type ProfileSelectorId = HandoverCoreProfileId | UnitProfileId | SpecialtyOverlayId;

export type ContextualPriorityDimension =
  | 'instability'
  | 'deterioration-risk'
  | 'dependency'
  | 'therapeutic-load'
  | 'time-critical'
  | 'omission-risk'
  | 'coordination'
  | 'unit-modifier'
  | 'specialty-modifier';

export interface ContextualPrioritySignal {
  id: string;
  label: string;
  dimension: ContextualPriorityDimension;
  source: 'core' | 'unit-profile' | 'specialty-overlay';
  profileId?: UnitProfileId | SpecialtyOverlayId;
  weight?: number;
  explanation?: string;
}

export interface IceaContextVector {
  baselineComplexity?: number;
  surveillanceIntensity?: number;
  therapeuticLoad?: number;
  temporalCriticality?: number;
  continuityRisk?: number;
  dependencyLoad?: number;
  coordinationComplexity?: number;
  caseMixHints?: readonly string[];
}

export interface ProfileActivation {
  enabledByDefault: boolean;
  stage: 'catalog' | 'pilot' | 'active';
}

export interface CoreProfileDefinition {
  id: HandoverCoreProfileId;
  kind: 'core';
  label: string;
  description: string;
  enabledSections: readonly string[];
  prioritySignals: readonly ContextualPrioritySignal[];
  iceaContextDefaults: Readonly<Partial<IceaContextVector>>;
}

export interface UnitProfileDefinition {
  id: UnitProfileId;
  kind: 'unit-profile';
  label: string;
  description: string;
  activation: ProfileActivation;
  enabledSections?: readonly string[];
  visibilityRules?: readonly string[];
  prioritySignals?: readonly ContextualPrioritySignal[];
  iceaContextDefaults?: Readonly<Partial<IceaContextVector>>;
}

export interface SpecialtyOverlayDefinition {
  id: SpecialtyOverlayId;
  kind: 'specialty-overlay';
  label: string;
  description: string;
  activation: ProfileActivation;
  allowedUnitProfiles?: readonly UnitProfileId[];
  prioritySignals?: readonly ContextualPrioritySignal[];
  iceaContextDefaults?: Readonly<Partial<IceaContextVector>>;
}

export interface ProfileRegistry {
  core: CoreProfileDefinition;
  unitProfiles: Readonly<Record<UnitProfileId, UnitProfileDefinition>>;
  specialtyOverlays: Readonly<Record<SpecialtyOverlayId, SpecialtyOverlayDefinition>>;
}

export interface ProfileRegistryActivation {
  unitProfiles: readonly UnitProfileId[];
  specialtyOverlays: readonly SpecialtyOverlayId[];
}

export interface ProfileContext {
  coreProfileId: HandoverCoreProfileId;
  unitId?: string;
  specialtyId?: string;
  catalogUnitProfileId: UnitProfileId | null;
  unitProfileId: UnitProfileId | null;
  catalogSpecialtyOverlayIds: readonly SpecialtyOverlayId[];
  specialtyOverlayIds: readonly SpecialtyOverlayId[];
  activeProfileIds: readonly ProfileSelectorId[];
  usesCoreFallback: boolean;
  prioritySignals: readonly ContextualPrioritySignal[];
  iceaContext: Readonly<Partial<IceaContextVector>>;
}

export interface ProfileContextInput {
  unitId?: string | null;
  specialtyId?: string | null;
}

export const isUnitProfileId = (value: unknown): value is UnitProfileId =>
  typeof value === 'string' && UNIT_PROFILE_ID_SET.has(value);

export const isSpecialtyOverlayId = (value: unknown): value is SpecialtyOverlayId =>
  typeof value === 'string' && SPECIALTY_OVERLAY_ID_SET.has(value);
