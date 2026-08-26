import { getAppConfigExtra } from './app-config';
import { resolveProfileContext } from './profiles';

type BooleanLike = boolean | number | string | null | undefined;

export interface PatientIdentificationContext {
  unitId?: string | null;
  specialtyId?: string | null;
}

const extra = getAppConfigExtra();
const QR_DISABLED_SPECIALTY_IDS = new Set([
  'behavioral-health',
  'psych',
]);
const QR_DISABLED_UNIT_IDS = new Set([
  'psych-adult-a',
  'psych-adult-b',
  'psych-child-adolescent',
  'psychogeriatrics',
]);

function isBehavioralHealthQrDisabledContext(
  context: PatientIdentificationContext,
  profileContext: ReturnType<typeof resolveProfileContext>,
): boolean {
  const normalizedUnitId = normalizeContextId(context.unitId);
  if (normalizedUnitId && QR_DISABLED_UNIT_IDS.has(normalizedUnitId)) {
    return true;
  }

  const normalizedSpecialtyId = normalizeContextId(context.specialtyId);
  if (normalizedSpecialtyId && QR_DISABLED_SPECIALTY_IDS.has(normalizedSpecialtyId)) {
    return true;
  }

  const normalizedResolvedSpecialtyId = normalizeContextId(profileContext.specialtyId);
  if (normalizedResolvedSpecialtyId && QR_DISABLED_SPECIALTY_IDS.has(normalizedResolvedSpecialtyId)) {
    return true;
  }

  return (
    normalizeContextId(profileContext.unitProfileId) === 'behavioral-health' ||
    normalizeContextId(profileContext.catalogUnitProfileId) === 'behavioral-health'
  );
}

function normalizeContextId(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function truthy(value: BooleanLike): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function hasExplicitQrFlag(value: BooleanLike): boolean {
  if (typeof value === 'boolean' || typeof value === 'number') return true;
  return typeof value === 'string' && value.trim().length > 0;
}

function getExplicitQrPatientScanFlag(): BooleanLike {
  return (
    (extra as { FEATURES?: { handover?: { enableQrPatientScan?: BooleanLike } } })?.FEATURES?.handover
      ?.enableQrPatientScan ??
    process.env.EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN
  );
}

export function isQrPatientScanEnabled(context: PatientIdentificationContext = {}): boolean {
  const explicitFlag = getExplicitQrPatientScanFlag();
  if (hasExplicitQrFlag(explicitFlag)) {
    return truthy(explicitFlag);
  }

  const profileContext = resolveProfileContext({
    unitId: context.unitId,
    specialtyId: context.specialtyId,
  });

  return !isBehavioralHealthQrDisabledContext(context, profileContext);
}

export function getPatientIdentificationHint(context: PatientIdentificationContext = {}): string {
  if (isQrPatientScanEnabled(context)) {
    return 'Usa el listado o la busqueda manual como flujo principal. El QR queda como apoyo opcional.';
  }

  return 'Usa el listado, la busqueda manual o el identificador institucional. El QR queda desactivado en este contexto.';
}
