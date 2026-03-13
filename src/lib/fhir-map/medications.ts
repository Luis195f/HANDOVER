import type { MedicationItem } from '../../types/handover';
import { MEDICATION_ROUTE_CODES, TERMINOLOGY_SYSTEMS } from '../codes';
import type {
  BuildOptions,
  MedicationAdministration,
  MedicationResource,
  MedicationStatement,
  MedicationStatementInput,
  MedicationValues,
  Reference,
} from '../fhir-map';

export type MedicationsMapperDependencies = {
  resolveOptions: (options?: BuildOptions) => { now: () => string } & BuildOptions;
  patientReference: (patientId: string) => Reference;
  encounterReference: (encounterId?: string) => Reference | undefined;
  normalizeIsoDateTimeValue: (value?: string) => string | undefined;
  medicationStatementSchema: {
    safeParse: (value: MedicationStatementInput) =>
      | { success: true; data: MedicationStatementInput }
      | { success: false };
  };
};

type MedicationDosage = NonNullable<MedicationStatement['dosage']>[number];
type MedicationTiming = MedicationDosage['timing'];
type MedicationDoseQuantity = NonNullable<MedicationAdministration['dosage']>['dose'];

const MEDICATION_ROUTE_LABELS: Partial<Record<NonNullable<MedicationItem['route']>, string>> = {
  oral: 'Oral',
  iv: 'IV',
  im: 'IM',
  sc: 'SC',
  inhaled: 'Inhalada',
  topical: 'Tópica',
  other: 'Otra vía',
};

const MEDICATION_HIGH_ALERT_EXTENSION_URL = 'urn:handover-pro:medication-high-alert';

const MEDICATION_ROUTE_CONCEPTS: Partial<Record<NonNullable<MedicationItem['route']>, MedicationStatement['medicationCodeableConcept']>> = {
  oral: {
    coding: [MEDICATION_ROUTE_CODES.oral],
    text: 'Oral',
  },
  iv: {
    coding: [MEDICATION_ROUTE_CODES.iv],
    text: 'IV',
  },
  im: {
    coding: [MEDICATION_ROUTE_CODES.im],
    text: 'IM',
  },
  sc: {
    coding: [MEDICATION_ROUTE_CODES.sc],
    text: 'SC',
  },
  inhaled: {
    coding: [MEDICATION_ROUTE_CODES.inhaled],
    text: 'Inhalada',
  },
  topical: {
    coding: [MEDICATION_ROUTE_CODES.topical],
    text: 'Tópica',
  },
  other: {
    coding: [MEDICATION_ROUTE_CODES.other],
    text: 'Otra vía',
  },
};

function structuredDosageText(medication: MedicationItem): string | undefined {
  const parts = [
    medication.dose,
    medication.route ? MEDICATION_ROUTE_LABELS[medication.route] : null,
    medication.frequency,
  ]
    .filter(Boolean)
    .join(' ');
  return parts || undefined;
}

const frequencyPatterns = [
  {
    regex: /(\d+)\s*(?:x|veces)\s*(?:\/|por)\s*d[ií]a/i,
    builder: (match: RegExpMatchArray) => ({ frequency: Number(match[1]), period: 1, periodUnit: 'd' as const }),
  },
  {
    regex: /cada\s*(\d+)\s*(h|horas?|hora)/i,
    builder: (match: RegExpMatchArray) => ({ frequency: 1, period: Number(match[1]), periodUnit: 'h' as const }),
  },
  {
    regex: /cada\s*(\d+)\s*(d|d[ií]as?|día)/i,
    builder: (match: RegExpMatchArray) => ({ frequency: 1, period: Number(match[1]), periodUnit: 'd' as const }),
  },
  {
    regex: /^q(\d+)h$/i,
    builder: (match: RegExpMatchArray) => ({ frequency: 1, period: Number(match[1]), periodUnit: 'h' as const }),
  },
] as const;

function parseFrequencyToTiming(frequency?: string): MedicationTiming | undefined {
  if (!frequency) return undefined;
  const trimmed = frequency.trim();
  if (!trimmed) return undefined;
  for (const pattern of frequencyPatterns) {
    const match = trimmed.match(pattern.regex);
    if (match) {
      return { repeat: pattern.builder(match) };
    }
  }
  return undefined;
}

function parseDoseQuantity(dose?: string): MedicationDoseQuantity | undefined {
  if (!dose) return undefined;
  const match = dose.trim().match(/^(\d+(?:[.,]\d+)?)\s*([^\d\s]+)?/);
  if (!match) return undefined;
  const value = Number(match[1].replace(',', '.'));
  if (Number.isNaN(value)) return undefined;
  const unit = match[2]?.trim();
  return {
    value,
    unit,
    system: unit ? TERMINOLOGY_SYSTEMS.UCUM : undefined,
    code: unit || undefined,
  };
}

function buildMedicationDosage(medication: MedicationItem): MedicationDosage | undefined {
  const timing = parseFrequencyToTiming(medication.frequency);
  const doseQuantity = parseDoseQuantity(medication.dose);
  const route = medication.route ? MEDICATION_ROUTE_CONCEPTS[medication.route] : undefined;
  const text = structuredDosageText(medication);
  if (!timing && !doseQuantity && !route && !text) return undefined;
  return {
    text,
    timing,
    route,
    doseAndRate: doseQuantity ? [{ doseQuantity }] : undefined,
  };
}

function buildAdministrationDosage(medication: MedicationItem): MedicationAdministration['dosage'] | undefined {
  const route = medication.route ? MEDICATION_ROUTE_CONCEPTS[medication.route] : undefined;
  const dose = parseDoseQuantity(medication.dose);
  const text = structuredDosageText(medication);
  if (!route && !dose && !text) return undefined;
  return {
    text,
    route,
    dose,
  };
}

function buildHighAlertExtension(isHighAlert?: boolean): MedicationStatement['extension'] | undefined {
  if (!isHighAlert) return undefined;
  return [{ url: MEDICATION_HIGH_ALERT_EXTENSION_URL, valueBoolean: true }];
}

function buildMedicationNotes(medication: MedicationItem): MedicationStatement['note'] | undefined {
  const notes: NonNullable<MedicationStatement['note']> = [];
  if (medication.isHighAlert) {
    notes.push({ text: 'High alert medication' });
  }
  if (medication.notes) {
    notes.push({ text: medication.notes });
  }
  if (medication.signature) {
    const role = medication.signature.role ?? 'nurse';
    notes.push({
      text: `Signed by ${medication.signature.fullName} (${role}) at ${medication.signature.signedAt}`,
    });
  }
  return notes.length > 0 ? notes : undefined;
}

function isStructuredMedication(input: MedicationStatementInput | MedicationItem): input is MedicationItem {
  return (input as MedicationItem).name !== undefined;
}

function mapStructuredMedicationResource(
  deps: MedicationsMapperDependencies,
  medication: MedicationItem,
  subject: Reference,
  encounter: Reference | undefined,
  assertedAt: string,
): MedicationResource {
  const concept: MedicationStatement['medicationCodeableConcept'] = medication.code
    ? {
        coding: [medication.code],
        text: medication.name,
      }
    : {
        coding: [],
        text: medication.name,
      };
  const notes = buildMedicationNotes(medication);
  const extension = buildHighAlertExtension(medication.isHighAlert);
  const normalizedStart = deps.normalizeIsoDateTimeValue(medication.startTime) ?? assertedAt;
  const normalizedEnd = deps.normalizeIsoDateTimeValue(medication.endTime);
  const isContinuous = medication.isContinuous === true;

  if (!isContinuous && medication.isContinuous === false) {
    const effectivePeriod = normalizedEnd ? { start: normalizedStart, end: normalizedEnd } : undefined;
    return {
      resourceType: 'MedicationAdministration',
      identifier: [{ system: 'urn:handover-pro:medication-item', value: medication.id }],
      status: normalizedEnd ? 'completed' : 'in-progress',
      medicationCodeableConcept: concept,
      subject,
      encounter,
      effectiveDateTime: effectivePeriod ? undefined : normalizedStart,
      effectivePeriod,
      note: notes,
      dosage: buildAdministrationDosage(medication),
      extension,
    };
  }

  const effectivePeriod = normalizedStart || normalizedEnd
    ? {
        start: normalizedStart,
        end: normalizedEnd ?? undefined,
      }
    : undefined;

  return {
    resourceType: 'MedicationStatement',
    identifier: [{ system: 'urn:handover-pro:medication-item', value: medication.id }],
    status: normalizedEnd ? 'completed' : 'active',
    medicationCodeableConcept: concept,
    subject,
    encounter,
    effectivePeriod,
    effectiveDateTime: effectivePeriod ? undefined : normalizedStart,
    dateAsserted: assertedAt,
    note: notes,
    dosage: (() => {
      const dosage = buildMedicationDosage(medication);
      return dosage ? [dosage] : undefined;
    })(),
    extension,
  };
}

function mapLegacyMedicationStatement(
  deps: MedicationsMapperDependencies,
  input: MedicationStatementInput,
  subject: Reference,
  encounter: Reference | undefined,
  assertedAt: string,
): MedicationStatement | null {
  const parsedResult = deps.medicationStatementSchema.safeParse(input);
  if (!parsedResult.success) return null;
  const parsed = parsedResult.data;
  const concept: MedicationStatement['medicationCodeableConcept'] = parsed.code
    ? {
        coding: [parsed.code],
        text: parsed.display ?? parsed.code.display,
      }
    : {
        coding: [],
        text: parsed.display ?? 'Medication',
      };

  const period: MedicationStatement['effectivePeriod'] = parsed.start || parsed.end
    ? {
        start: parsed.start ?? assertedAt,
        end: parsed.end ?? undefined,
      }
    : undefined;

  const note = parsed.note ? [{ text: parsed.note }] : undefined;

  return {
    resourceType: 'MedicationStatement',
    status: parsed.status,
    medicationCodeableConcept: concept,
    subject,
    encounter,
    effectivePeriod: period,
    dateAsserted: assertedAt,
    note,
  };
}

export function mapMedicationStatementsImpl(
  deps: MedicationsMapperDependencies,
  values: MedicationValues,
  options?: BuildOptions,
): MedicationResource[] {
  const inputs = values.medications ?? [];
  const optionsMerged = deps.resolveOptions(options);
  const subject = deps.patientReference(values.patientId);
  const encounter = deps.encounterReference(values.encounterId);
  const assertedAt = optionsMerged.now();

  const structuredInputs = inputs.filter(isStructuredMedication);
  const legacyInputs = inputs.filter((item): item is MedicationStatementInput => !isStructuredMedication(item));

  const structuredStatements = structuredInputs.map((item) =>
    mapStructuredMedicationResource(deps, item, subject, encounter, assertedAt),
  );

  const legacyStatements = legacyInputs
    .map((item) => mapLegacyMedicationStatement(deps, item, subject, encounter, assertedAt))
    .filter((value): value is MedicationStatement => value != null);

  return [...structuredStatements, ...legacyStatements];
}

