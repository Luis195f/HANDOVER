import type { AdministrativeData } from '@/src/types/administrative';
import type {
  HandoverProfileTraceInput,
  HandoverValues as FhirHandoverValues,
} from '@/src/lib/fhir-map';
import type { HandoverProfileRuntime } from '@/src/lib/profile-runtime';
import type { HandoverValues as FormHandoverValues } from '@/src/validation/schemas';

export function normalizeUnitSelection(
  value: string | null | undefined,
  allUnitsOption: string,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === allUnitsOption) return undefined;
  return trimmed;
}

export function normalizeOxygenTherapyInput(value: unknown) {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  if ('status' in (value as Record<string, unknown>)) {
    return value;
  }
  return {
    status: 'in-progress',
    ...(value as Record<string, unknown>),
  };
}

export function buildProfileTraceInput(
  profileRuntime: Pick<HandoverProfileRuntime, 'context' | 'mergeTrace'>,
): HandoverProfileTraceInput {
  return {
    unitId: profileRuntime.context.unitId,
    requestedSpecialtyId: profileRuntime.context.requestedSpecialtyId,
    specialtyId: profileRuntime.context.specialtyId,
    specialtySource: profileRuntime.context.specialtySource,
    catalogUnitProfileId: profileRuntime.context.catalogUnitProfileId,
    unitProfileId: profileRuntime.context.unitProfileId,
    overlaySelections: profileRuntime.context.overlaySelections,
    catalogSpecialtyOverlayIds: profileRuntime.context.catalogSpecialtyOverlayIds,
    specialtyOverlayIds: profileRuntime.context.specialtyOverlayIds,
    activeProfileIds: profileRuntime.context.activeProfileIds,
    hasHumanSpecialtyOverride: profileRuntime.context.hasHumanSpecialtyOverride,
    mergeTrace: profileRuntime.mergeTrace.map(({ source, profileId, label }) => ({
      source,
      profileId,
      label,
    })),
  };
}

export function buildHandoverInputPayload(
  values: FormHandoverValues,
  overrides: Partial<FhirHandoverValues>,
  profileTrace?: HandoverProfileTraceInput,
): FhirHandoverValues {
  const normalizedValues: FhirHandoverValues = {
    ...(values as unknown as FhirHandoverValues),
    oxygenTherapy: normalizeOxygenTherapyInput(
      (values as { oxygenTherapy?: unknown }).oxygenTherapy,
    ) as FhirHandoverValues['oxygenTherapy'],
    ...overrides,
  };

  if (!profileTrace) {
    return normalizedValues;
  }

  return {
    ...normalizedValues,
    profileTrace,
  };
}

export function buildSubmissionAdministrativeData(
  values: FormHandoverValues,
  unitEffective: string | undefined,
): AdministrativeData {
  return {
    unit: unitEffective ?? values.administrativeData.unit,
    census: values.administrativeData.census ?? 0,
    staffIn: (values.administrativeData.staffIn ?? []).filter(Boolean),
    staffOut: (values.administrativeData.staffOut ?? []).filter(Boolean),
    shiftStart: values.administrativeData.shiftStart,
    shiftEnd: values.administrativeData.shiftEnd,
    shiftType: values.administrativeData.shiftType,
    generalNotes: values.administrativeData.generalNotes,
    incidents: values.administrativeData.incidents?.filter(Boolean),
  };
}

export function buildSubmissionOxygenTherapy(
  oxygenTherapyInput: FormHandoverValues['oxygenTherapy'] | undefined,
) {
  const safeInput = oxygenTherapyInput ?? {};
  const hasOxygenValues = Boolean(
    safeInput.device ||
    safeInput.flowLMin != null ||
    safeInput.fio2 != null,
  );

  return {
    hasOxygenValues,
    oxygenTherapy: hasOxygenValues
      ? {
          status: 'in-progress' as const,
          device: safeInput.device,
          deviceDisplay: safeInput.device,
          flowLMin: safeInput.flowLMin,
          fio2: safeInput.fio2,
        }
      : null,
  };
}

