import type { AdministrativeData } from '@/src/types/administrative';
import type {
  HandoverInput as FhirHandoverInput,
  HandoverValues as FhirHandoverValues,
} from '@/src/lib/fhir-map';
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

export function buildHandoverInputPayload(
  values: FormHandoverValues,
  overrides: Partial<FhirHandoverValues>,
): FhirHandoverValues {
  return {
    ...(values as unknown as FhirHandoverValues),
    oxygenTherapy: normalizeOxygenTherapyInput(
      (values as { oxygenTherapy?: unknown }).oxygenTherapy,
    ) as FhirHandoverValues['oxygenTherapy'],
    ...overrides,
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
