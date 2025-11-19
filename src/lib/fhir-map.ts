import { z } from 'zod';

import type { AdministrativeData } from '../types/administrative';
import type {
  EliminationInfo,
  FluidBalanceInfo,
  MobilityInfo,
  NutritionInfo,
  PainAssessment,
  BradenScale,
  GlasgowScale,
  SkinInfo,
  RiskFlags,
} from '../types/handover';
import { CATEGORY, FHIR_CODES, LOINC, SNOMED, type TerminologyCode } from './codes';
import { hashHex, fhirId } from './crypto';

const DEFAULT_OPTS = { now: () => new Date().toISOString() } as const;
const resolveOptions = (options?: Partial<typeof DEFAULT_OPTS>) =>
  ({ ...DEFAULT_OPTS, ...options }) as typeof DEFAULT_OPTS;

type ISODateTimeString = `${number}-${number}-${number}T${string}`;

type Coding = {
  system: string;
  code: string;
  display?: string;
};

type CodeableConcept = {
  coding: Coding[];
  text?: string;
};

type Quantity = {
  value: number;
  unit?: string;
  system?: string;
  code?: string;
};

type Reference = {
  reference: string;
  type?: string;
  display?: string;
};

type Meta = {
  profile: readonly string[];
};

type Annotation = {
  text: string;
};

type Period = {
  start: string;
  end?: string;
};

type ObservationComponent = {
  code: CodeableConcept;
  valueQuantity?: Quantity;
  valueCodeableConcept?: CodeableConcept;
  valueString?: string;
  valueInteger?: number;
};

type Observation = {
  resourceType: 'Observation';
  id?: string;
  meta?: Meta;
  status: 'final';
  category: CodeableConcept[];
  code: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  effectiveDateTime: string;
  issued?: string;
  valueQuantity?: Quantity;
  valueCodeableConcept?: CodeableConcept;
  valueString?: string;
  valueInteger?: number;
  component?: ObservationComponent[];
  note?: Annotation[];
};

type MedicationStatement = {
  resourceType: 'MedicationStatement';
  id?: string;
  status: 'active' | 'completed' | 'intended';
  medicationCodeableConcept: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  effectivePeriod?: Period;
  dateAsserted: string;
  note?: Annotation[];
};

type Procedure = {
  resourceType: 'Procedure';
  id?: string;
  status: 'in-progress' | 'completed';
  code: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  performedDateTime?: string;
  performedPeriod?: Period;
  reasonCode?: CodeableConcept[];
  bodySite?: CodeableConcept[];
  note?: Annotation[];
};

type DeviceUseStatement = {
  resourceType: 'DeviceUseStatement';
  id?: string;
  status: 'active' | 'completed';
  subject: Reference;
  encounter?: Reference;
  device: Reference;
  timingPeriod?: Period;
  reasonCode?: CodeableConcept[];
  note?: Annotation[];
};

type Attachment = {
  contentType: string;
  url?: string;
  data?: string;
  size?: number;
  hash?: string;
  title?: string;
};

type DocumentReferenceContent = {
  attachment: Attachment;
};

type DocumentReference = {
  resourceType: 'DocumentReference';
  id?: string;
  status: 'current';
  type?: CodeableConcept;
  category?: CodeableConcept[];
  subject: Reference;
  encounter?: Reference;
  author?: Reference[];
  date: string;
  content: DocumentReferenceContent[];
};

type Condition = {
  resourceType: 'Condition';
  id?: string;
  clinicalStatus: CodeableConcept;
  verificationStatus: CodeableConcept;
  category?: CodeableConcept[];
  code: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  onsetDateTime?: string;
  recordedDate?: string;
};

type CompositionAttester = {
  mode: 'professional' | 'legal' | 'official' | 'personal';
  time?: string;
  party?: Reference;
};

type CompositionSection = {
  title: string;
  code?: CodeableConcept;
  entry?: Reference[];
  text?: Narrative;
};

type Composition = {
  resourceType: 'Composition';
  id?: string;
  status: 'final' | 'amended';
  type: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  date: string;
  author: Reference[];
  title: string;
  attester?: CompositionAttester[];
  section?: CompositionSection[];
};

type Narrative = {
  status: 'generated' | 'additional' | 'extensions';
  div: string;
};

type FhirResource =
  | Observation
  | MedicationStatement
  | Procedure
  | DeviceUseStatement
  | DocumentReference
  | Composition
  | Condition;

type BundleEntry = {
  fullUrl: string;
  resource: FhirResource;
  request: {
    method: 'POST';
    url: string;
  };
};

type Bundle = {
  resourceType: 'Bundle';
  type: 'transaction';
  entry: BundleEntry[];
};

const TEST_LOINC = {
  ...LOINC,
  BP_PANEL: LOINC.bpPanel,
  SBP: LOINC.sbp,
  DBP: LOINC.dbp,
  RR: LOINC.rr,
  SPO2: LOINC.spo2,
  TEMP: LOINC.temp,
  HR: LOINC.hr,
  GLUCOSE_MGDL: LOINC.glucoseMgDl,
  GLUCOSE_MMOLL: LOINC.glucoseMmolL,
  FIO2: '3151-8',
  O2_FLOW: '3150-0',
} as const;

const PROFILE_VITAL_SIGNS = 'http://hl7.org/fhir/StructureDefinition/vitalsigns';
const PROFILE_BLOOD_PRESSURE = 'http://hl7.org/fhir/StructureDefinition/bp';
const DEFAULT_COMPOSITION_TYPE: CodeableConcept = {
  coding: [
    {
      system: 'http://loinc.org',
      code: '11503-0',
      display: 'Discharge summary',
    },
  ],
  text: 'Clinical handover',
};

const vitalCategoryConcept: CodeableConcept = {
  coding: [
    {
      system: CATEGORY.vitalSigns.system,
      code: CATEGORY.vitalSigns.code,
      display: 'Vital Signs',
    },
  ],
};

const surveyCategoryConcept: CodeableConcept = {
  coding: [
    {
      system: 'http://terminology.hl7.org/CodeSystem/observation-category',
      code: 'survey',
      display: 'Survey',
    },
  ],
  text: 'Nursing care',
};

const conditionClinicalStatusActive: CodeableConcept = {
  coding: [
    {
      system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
      code: 'active',
      display: 'Active',
    },
  ],
};

const conditionVerificationStatusUnconfirmed: CodeableConcept = {
  coding: [
    {
      system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
      code: 'unconfirmed',
      display: 'Unconfirmed',
    },
  ],
};

const conditionProblemListCategory: CodeableConcept = {
  coding: [
    {
      system: 'http://terminology.hl7.org/CodeSystem/condition-category',
      code: 'problem-list-item',
      display: 'Problem list item',
    },
  ],
  text: 'Problem list item',
};

const AVPU_MAP = {
  A: { code: SNOMED.avpuAlert, display: 'Alert' },
  C: { code: SNOMED.avpuConfusion, display: 'New confusion' },
  V: { code: SNOMED.avpuVoice, display: 'Responds to voice' },
  P: { code: SNOMED.avpuPain, display: 'Responds to pain' },
  U: { code: SNOMED.avpuUnresponsive, display: 'Unresponsive' },
} as const;

const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

const ObservationVitalsSchema = z.object({
  patientId: z.string().min(1),
  encounterId: z.string().min(1).optional(),
  recordedAt: isoDateTime.optional(),
  issuedAt: isoDateTime.optional(),
  hr: z.number().min(30).max(220).optional(),
  rr: z.number().min(5).max(60).optional(),
  tempC: z.number().min(30).max(45).optional(),
  spo2: z.number().min(50).max(100).optional(),
  sbp: z.number().min(60).max(260).optional(),
  dbp: z.number().min(30).max(160).optional(),
  glucoseMgDl: z.number().min(20).max(1000).optional(),
  glucoseMmolL: z.number().min(1).max(55).optional(),
  avpu: z.enum(['A', 'C', 'V', 'P', 'U']).optional(),
});

const MedicationCodingSchema = z.object({
  system: z.string().min(1),
  code: z.string().min(1),
  display: z.string().optional(),
});

const MedicationStatementSchema = z
  .object({
    status: z.enum(['active', 'completed', 'intended']).default('active'),
    code: MedicationCodingSchema.optional(),
    display: z.string().optional(),
    note: z.string().optional(),
    start: isoDateTime.optional(),
    end: isoDateTime.optional(),
  })
  .refine((value) => value.code !== undefined || value.display !== undefined, {
    message: 'Medication requires a coded concept or display text',
    path: ['code'],
  })
  .refine((value) => {
    if (!value.start || !value.end) return true;
    return value.start <= value.end;
  }, {
    message: 'Medication end must be after start',
    path: ['end'],
  });

const OxygenTherapySchema = z
  .object({
    status: z.enum(['in-progress', 'completed']).default('in-progress'),
    start: isoDateTime.optional(),
    end: isoDateTime.optional(),
    reason: z.string().optional(),
    bodySite: z.string().optional(),
    note: z.string().optional(),
    deviceId: z.string().optional(),
    deviceDisplay: z.string().optional(),
    device: z.string().optional(),
    flowLMin: z.number().min(0).max(80).optional(),
    fio2: z.number().min(0).max(100).optional(),
  })
  .refine((value) => {
    if (!value.start && !value.end) return true;
    if (value.start && value.end) {
      return value.start <= value.end;
    }
    return true;
  }, {
    message: 'Oxygen therapy end must be after start',
    path: ['end'],
  });

const SecureUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith('https://'), {
    message: 'Attachment URL must be secure (https)',
  });

const AudioAttachmentSchema = z
  .object({
    url: SecureUrlSchema.optional(),
    dataBase64: z
      .string()
      .regex(/^[A-Za-z0-9+/=]+$/)
      .optional(),
    size: z.number().int().positive().optional(),
    hash: z.string().optional(),
    contentType: z.string().min(1).default('audio/m4a'),
    title: z.string().optional(),
  })
  .refine((value) => value.url !== undefined || value.dataBase64 !== undefined, {
    message: 'Audio attachment requires a secure URL or base64 data',
    path: ['url'],
  })
  .refine((value) => {
    if (value.dataBase64) {
      return value.size !== undefined && value.hash !== undefined;
    }
    return true;
  }, {
    message: 'Base64 audio requires size and hash',
    path: ['size'],
  });

const AttesterSchema = z.object({
  mode: z.enum(['professional', 'legal', 'official', 'personal']),
  time: isoDateTime.optional(),
  partyReference: z.string().optional(),
  partyDisplay: z.string().optional(),
});

type ObservationVitalsInput = z.infer<typeof ObservationVitalsSchema>;
type MedicationStatementInput = z.infer<typeof MedicationStatementSchema>;
type OxygenTherapyInput = z.infer<typeof OxygenTherapySchema>;
type AudioAttachmentInput = z.infer<typeof AudioAttachmentSchema>;
type AttesterInput = z.infer<typeof AttesterSchema>;

type MedicationValues = {
  patientId: string;
  encounterId?: string;
  medications?: MedicationStatementInput[];
};

type OxygenValues = {
  patientId: string;
  encounterId?: string;
  oxygenTherapy?: OxygenTherapyInput | null;
};

type DocumentValues = {
  patientId: string;
  encounterId?: string;
  author?: AuthorInput;
  audioAttachment?: AudioAttachmentInput | null;
};

type CompositionValues = {
  patientId: string;
  encounterId?: string;
  author?: AuthorInput;
  composition?: CompositionInput;
  closingSummary?: string | null;
  sbar?: SbarValues;
  administrativeData?: AdministrativeData;
};

type SbarValues = {
  situation?: string;
  background?: string;
  assessment?: string;
  recommendation?: string;
};

type BundleReferenceIndex = {
  vitals: string[];
  medications: string[];
  oxygen: string[];
  attachments: string[];
  nutrition: string[];
  elimination: string[];
  mobilitySkin: string[];
  fluidBalance: string[];
  pain: string[];
  braden: string[];
  glasgow: string[];
  risks: string[];
};

export type AuthorInput = {
  reference?: string;
  type?: string;
  id?: string;
  display?: string;
};

export type CompositionInput = {
  status?: 'final' | 'amended';
  title?: string;
  type?: CodeableConcept;
  attesters?: AttesterInput[];
};

export type VitalsValues = Omit<ObservationVitalsInput, 'patientId' | 'encounterId'>;

export type HandoverValues = {
  patientId: string;
  encounterId?: string;
  author?: AuthorInput;
  administrativeData?: AdministrativeData;
  vitals?: VitalsValues;
  medications?: MedicationStatementInput[];
  oxygenTherapy?: OxygenTherapyInput | null;
  audioAttachment?: AudioAttachmentInput | null;
  composition?: CompositionInput;
  closingSummary?: string | null;
  sbar?: SbarValues;
  nutrition?: NutritionInfo;
  elimination?: EliminationInfo;
  mobility?: MobilityInfo;
  skin?: SkinInfo;
  fluidBalance?: FluidBalanceInfo;
  painAssessment?: PainAssessment;
  braden?: BradenScale;
  glasgow?: GlasgowScale;
  risks?: RiskFlags;
};

export type HandoverInput = HandoverValues | { values: HandoverValues };

export type BuildOptions = Partial<typeof DEFAULT_OPTS>;

type MappingContext = {
  subject: Reference;
  encounter?: Reference;
  effectiveDateTime: string;
};

const UCUM = 'http://unitsofmeasure.org';

function patientReference(patientId: string): Reference {
  return { reference: `Patient/${patientId}`, type: 'Patient' };
}

function encounterReference(encounterId?: string): Reference | undefined {
  if (!encounterId) return undefined;
  return { reference: `Encounter/${encounterId}`, type: 'Encounter' };
}

function codeableConceptFromCode(
  code: TerminologyCode<string>,
  overrideText?: string,
): CodeableConcept {
  const text = overrideText ?? code.display;
  const concept: CodeableConcept = {
    coding: [
      {
        system: code.system,
        code: code.code,
        display: code.display,
      },
    ],
  };
  if (text) {
    concept.text = text;
  }
  return concept;
}

function quantity(value: number, unit: string, code: string): Quantity {
  return {
    value,
    unit,
    system: UCUM,
    code,
  };
}

function ensureAuthorReference(values: { author?: AuthorInput }): Reference {
  const author = values.author;
  if (author?.reference) {
    return {
      reference: author.reference,
      type: author.type,
      display: author.display,
    };
  }
  const id = author?.id ?? 'handover-app';
  return {
    reference: `Practitioner/${id}`,
    type: 'Practitioner',
    display: author?.display ?? 'Handover Practitioner',
  };
}

function mapAttesters(inputs?: CompositionInput['attesters']): CompositionAttester[] | undefined {
  if (!inputs || inputs.length === 0) return undefined;
  return inputs.map((attester) => {
    const base: CompositionAttester = {
      mode: attester.mode,
    };
    if (attester.time) {
      base.time = attester.time;
    }
    if (attester.partyReference || attester.partyDisplay) {
      base.party = {
        reference: attester.partyReference ?? '',
        display: attester.partyDisplay,
      };
    }
    return base;
  });
}

function stableHash(...parts: string[]): string {
  return hashHex(parts.join('|'), 32);
}

const stableUrn = (...parts: string[]) => `urn:uuid:${stableHash(...parts)}`;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
    .join(',')}}`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function narrativeFromText(text: string): Narrative {
  const escaped = escapeHtml(text).replace(/\r?\n/g, '<br/>');
  return {
    status: 'generated',
    div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escaped}</p></div>`,
  };
}

function administrativeNarrative(data: AdministrativeData): Narrative {
  const staffIn = data.staffIn?.filter(Boolean) ?? [];
  const staffOut = data.staffOut?.filter(Boolean) ?? [];
  const incidents = data.incidents?.filter(Boolean) ?? [];
  const lines = [
    `Unit: ${data.unit}`,
    `Census: ${data.census}`,
    `Shift: ${data.shiftStart} → ${data.shiftEnd}`,
    `Incoming staff: ${staffIn.length > 0 ? staffIn.join(', ') : 'N/D'}`,
    `Outgoing staff: ${staffOut.length > 0 ? staffOut.join(', ') : 'N/D'}`,
  ];
  if (incidents.length > 0) {
    lines.push(`Incidents: ${incidents.join('; ')}`);
  }
  return narrativeFromText(lines.join('\n'));
}

const FHIR_ID_PREFIX: Record<FhirResource['resourceType'], string> = {
  Observation: 'obs-',
  MedicationStatement: 'ms-',
  Procedure: 'proc-',
  DeviceUseStatement: 'dus-',
  DocumentReference: 'doc-',
  Composition: 'comp-',
  Condition: 'cond-',
};

function assignStableIds(
  resource: FhirResource,
  patientId: string,
): { resource: FhirResource; fullUrl: string } {
  const { id: _ignored, ...rest } = resource;
  const key = `${resource.resourceType}|${patientId}|${stableStringify(rest)}`;
  const prefix = FHIR_ID_PREFIX[resource.resourceType] ?? '';
  const id = fhirId(prefix, key);
  const urn = `urn:uuid:${hashHex(key, 32)}`;
  const withId = { ...resource, id } as FhirResource;
  return { resource: withId, fullUrl: urn };
}

function ensureEffectiveDate(
  parsed: ObservationVitalsInput,
  optionsMerged: typeof DEFAULT_OPTS,
): { effective: string; issued: string } {
  const effective = parsed.recordedAt ?? optionsMerged.now();
  const issued = parsed.issuedAt ?? effective;
  return { effective, issued };
}

export function mapObservationVitals(
  values: ObservationVitalsInput,
  options?: BuildOptions,
): Observation[] {
  const hasMeasurement =
    values.hr !== undefined ||
    values.rr !== undefined ||
    values.tempC !== undefined ||
    values.spo2 !== undefined ||
    values.sbp !== undefined ||
    values.dbp !== undefined ||
    values.glucoseMgDl !== undefined ||
    values.glucoseMmolL !== undefined;

  if (!hasMeasurement) {
    return [];
  }

  const optionsMerged = resolveOptions(options);
  const parsed = ObservationVitalsSchema.parse(values);
  const { effective, issued } = ensureEffectiveDate(parsed, optionsMerged);
  const subject = patientReference(parsed.patientId);
  const encounter = encounterReference(parsed.encounterId);

  const observations: Observation[] = [];

  if (parsed.sbp !== undefined || parsed.dbp !== undefined) {
    const components: ObservationComponent[] = [];
    if (parsed.sbp !== undefined) {
      components.push({
        code: codeableConceptFromCode(FHIR_CODES.VITALS.BP_SYSTOLIC),
        valueQuantity: quantity(parsed.sbp, 'mm[Hg]', 'mm[Hg]'),
      });
    }
    if (parsed.dbp !== undefined) {
      components.push({
        code: codeableConceptFromCode(FHIR_CODES.VITALS.BP_DIASTOLIC),
        valueQuantity: quantity(parsed.dbp, 'mm[Hg]', 'mm[Hg]'),
      });
    }
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_BLOOD_PRESSURE] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.VITALS.BP_PANEL),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      component: components,
    });
  }

  if (parsed.hr !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.VITALS.HEART_RATE),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(parsed.hr, 'beats/minute', '/min'),
    });
  }

  if (parsed.rr !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.VITALS.RESP_RATE),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(parsed.rr, 'breaths/minute', '/min'),
    });
  }

  if (parsed.tempC !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.VITALS.TEMPERATURE),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(parsed.tempC, '°C', 'Cel'),
    });
  }

  if (parsed.spo2 !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.VITALS.SPO2),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(parsed.spo2, '%', '%'),
    });
  }

  if (parsed.glucoseMgDl !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.VITALS.GLUCOSE_MASS_BLD),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(parsed.glucoseMgDl, 'mg/dL', 'mg/dL'),
    });
  }

  if (parsed.glucoseMmolL !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.VITALS.GLUCOSE_MOLES_BLD),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(parsed.glucoseMmolL, 'mmol/L', 'mmol/L'),
    });
  }

  if (parsed.avpu !== undefined) {
    const details = AVPU_MAP[parsed.avpu];
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.VITALS.ACVPU, 'AVPU scale'),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueCodeableConcept: {
        coding: [
          {
            system: 'http://snomed.info/sct',
            code: details.code,
            display: details.display,
          },
        ],
        text: details.display,
      },
    });
  }

  return observations;
}

export function mapMedicationStatements(
  values: MedicationValues,
  options?: BuildOptions,
): MedicationStatement[] {
  const optionsMerged = resolveOptions(options);
  if (!values.medications || values.medications.length === 0) {
    return [];
  }
  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);
  const nowIso = optionsMerged.now();

  return values.medications.map((input) => {
    const parsed = MedicationStatementSchema.parse(input);
    const concept: CodeableConcept = parsed.code
      ? {
          coding: [parsed.code],
          text: parsed.display ?? parsed.code.display,
        }
      : {
          coding: [],
          text: parsed.display ?? 'Medication',
        };

    const period: Period | undefined = parsed.start || parsed.end
      ? {
          start: parsed.start ?? nowIso,
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
      dateAsserted: nowIso,
      note,
    };
  });
}

export function mapDeviceUse(
  values: OxygenValues,
  options?: BuildOptions,
): Array<Procedure | DeviceUseStatement> {
  const optionsMerged = resolveOptions(options);
  if (!values.oxygenTherapy) return [];
  const parsed = OxygenTherapySchema.parse(values.oxygenTherapy);
  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);

  const start = parsed.start ?? optionsMerged.now();
  const procedure: Procedure = {
    resourceType: 'Procedure',
    status: parsed.status,
    code: {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: SNOMED.oxygenTherapy,
          display: 'Administration of oxygen therapy',
        },
      ],
      text: 'Oxygen therapy',
    },
    subject,
    encounter,
  };

  if (parsed.end) {
    procedure.performedPeriod = { start, end: parsed.end };
  } else {
    procedure.performedDateTime = start;
  }

  if (parsed.reason) {
    procedure.reasonCode = [
      {
        coding: [
          {
            system: 'http://snomed.info/sct',
            code: parsed.reason,
          },
        ],
        text: parsed.reason,
      },
    ];
  }

  if (parsed.bodySite) {
    procedure.bodySite = [
      {
        coding: [
          {
            system: 'http://snomed.info/sct',
            code: parsed.bodySite,
            display: parsed.bodySite,
          },
        ],
        text: parsed.bodySite,
      },
    ];
  }

  if (parsed.note) {
    procedure.note = [{ text: parsed.note }];
  }

  const resources: Array<Procedure | DeviceUseStatement> = [procedure];

  if (parsed.deviceDisplay || parsed.deviceId || parsed.device) {
    const deviceDisplay = parsed.deviceDisplay ?? parsed.device ?? 'Oxygen delivery device';
    resources.push({
      resourceType: 'DeviceUseStatement',
      status: parsed.end ? 'completed' : 'active',
      subject,
      encounter,
      device: {
        reference: parsed.deviceId ? `Device/${parsed.deviceId}` : 'Device/oxygen-source',
        display: deviceDisplay,
      },
      timingPeriod: parsed.end ? { start, end: parsed.end } : { start },
    });
  }

  return resources;
}

export function mapOxygenObservations(
  values: OxygenValues,
  options?: BuildOptions,
): Observation[] {
  if (!values.oxygenTherapy) return [];
  const optionsMerged = resolveOptions(options);
  const parsed = OxygenTherapySchema.parse(values.oxygenTherapy);
  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);
  const effective = parsed.start ?? optionsMerged.now();
  const issued = optionsMerged.now();

  const observations: Observation[] = [];

  if (parsed.fio2 !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.VITALS.FIO2),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(parsed.fio2, '%', '%'),
    });
  }

  if (parsed.flowLMin !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.VITALS.O2_FLOW),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(parsed.flowLMin, 'L/min', 'L/min'),
    });
  }

  return observations;
}

type CareValues = { patientId: string; encounterId?: string };

export function mapNutritionCare(
  values: CareValues & { nutrition?: NutritionInfo },
  options?: BuildOptions,
): Observation[] {
  if (!values.nutrition) return [];
  const optionsMerged = resolveOptions(options);
  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);
  const effectiveDateTime = optionsMerged.now();

  const components: ObservationComponent[] = [
    {
      code: { coding: [{ system: 'urn:handover-pro:component', code: 'diet-type', display: 'Diet type' }], text: 'Diet type' },
      valueCodeableConcept: {
        coding: [
          {
            system: 'urn:handover-pro:diet',
            code: values.nutrition.dietType,
            display: values.nutrition.dietType,
          },
        ],
        text: values.nutrition.dietType,
      },
    },
  ];

  if (values.nutrition.tolerance) {
    components.push({
      code: {
        coding: [{ system: 'urn:handover-pro:component', code: 'tolerance', display: 'Tolerance' }],
        text: 'Tolerance',
      },
      valueString: values.nutrition.tolerance,
    });
  }

  if (values.nutrition.intakeMl !== undefined) {
    components.push({
      code: {
        coding: [{ system: 'urn:handover-pro:component', code: 'intake', display: 'Intake (mL)' }],
        text: 'Intake (mL)',
      },
      valueQuantity: quantity(values.nutrition.intakeMl, 'mL', 'mL'),
    });
  }

  return [
    {
      resourceType: 'Observation',
      status: 'final',
      category: [surveyCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.CARE.NUTRITION),
      subject,
      encounter,
      effectiveDateTime,
      component: components,
    },
  ];
}

export function mapEliminationCare(
  values: CareValues & { elimination?: EliminationInfo },
  options?: BuildOptions,
): Observation[] {
  if (!values.elimination) return [];
  const optionsMerged = resolveOptions(options);
  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);
  const effectiveDateTime = optionsMerged.now();
  const observations: Observation[] = [];

  if (values.elimination.urineMl !== undefined) {
    observations.push({
      resourceType: 'Observation',
      status: 'final',
      category: [surveyCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.CARE.URINE_OUTPUT),
      subject,
      encounter,
      effectiveDateTime,
      valueQuantity: quantity(values.elimination.urineMl, 'mL', 'mL'),
    });
  }

  if (values.elimination.stoolPattern) {
    const note = values.elimination.hasRectalTube !== undefined
      ? [
          {
            text: values.elimination.hasRectalTube ? 'Rectal tube present' : 'No rectal tube',
          },
        ]
      : undefined;

    observations.push({
      resourceType: 'Observation',
      status: 'final',
      category: [surveyCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.CARE.STOOL_PATTERN),
      subject,
      encounter,
      effectiveDateTime,
      valueCodeableConcept: {
        coding: [
          {
            system: 'urn:handover-pro:stool-pattern',
            code: values.elimination.stoolPattern,
            display: values.elimination.stoolPattern,
          },
        ],
        text: values.elimination.stoolPattern,
      },
      note,
    });
  } else if (values.elimination.hasRectalTube !== undefined) {
    observations.push({
      resourceType: 'Observation',
      status: 'final',
      category: [surveyCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.CARE.RECTAL_TUBE),
      subject,
      encounter,
      effectiveDateTime,
      valueCodeableConcept: {
        coding: [
          {
            system: 'urn:handover-pro:boolean',
            code: values.elimination.hasRectalTube ? 'yes' : 'no',
            display: values.elimination.hasRectalTube ? 'Present' : 'Absent',
          },
        ],
        text: values.elimination.hasRectalTube ? 'Present' : 'Absent',
      },
    });
  }

  return observations;
}

export function mapMobilitySkinCare(
  values: CareValues & { mobility?: MobilityInfo; skin?: SkinInfo },
  options?: BuildOptions,
): Observation[] {
  const optionsMerged = resolveOptions(options);
  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);
  const effectiveDateTime = optionsMerged.now();
  const observations: Observation[] = [];

  if (values.mobility) {
    observations.push({
      resourceType: 'Observation',
      status: 'final',
      category: [surveyCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.CARE.MOBILITY),
      subject,
      encounter,
      effectiveDateTime,
      valueCodeableConcept: {
        coding: [
          {
            system: 'urn:handover-pro:mobility-level',
            code: values.mobility.mobilityLevel,
            display: values.mobility.mobilityLevel,
          },
        ],
        text: values.mobility.mobilityLevel,
      },
      note: values.mobility.repositioningPlan
        ? [{ text: `Repositioning plan: ${values.mobility.repositioningPlan}` }]
        : undefined,
    });
  }

  if (values.skin) {
    const components: ObservationComponent[] = [];
    if (values.skin.hasPressureInjury !== undefined) {
      components.push({
        code: {
          coding: [
            { system: 'urn:handover-pro:component', code: 'pressure-injury', display: 'Pressure injury' },
          ],
          text: 'Pressure injury',
        },
        valueCodeableConcept: {
          coding: [
            {
              system: 'urn:handover-pro:boolean',
              code: values.skin.hasPressureInjury ? 'yes' : 'no',
              display: values.skin.hasPressureInjury ? 'Present' : 'Absent',
            },
          ],
          text: values.skin.hasPressureInjury ? 'Present' : 'Absent',
        },
      });
    }

    observations.push({
      resourceType: 'Observation',
      status: 'final',
      category: [surveyCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.CARE.SKIN),
      subject,
      encounter,
      effectiveDateTime,
      valueString: values.skin.skinStatus,
      component: components.length > 0 ? components : undefined,
    });
  }

  return observations;
}

export function mapFluidBalanceCare(
  values: CareValues & { fluidBalance?: FluidBalanceInfo },
  options?: BuildOptions,
): Observation[] {
  if (!values.fluidBalance) return [];
  const optionsMerged = resolveOptions(options);
  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);
  const effectiveDateTime = optionsMerged.now();

  const components: ObservationComponent[] = [];

  components.push({
    code: { coding: [{ system: 'urn:handover-pro:component', code: 'intake', display: 'Intake' }], text: 'Intake' },
    valueQuantity: quantity(values.fluidBalance.intakeMl, 'mL', 'mL'),
  });

  components.push({
    code: { coding: [{ system: 'urn:handover-pro:component', code: 'output', display: 'Output' }], text: 'Output' },
    valueQuantity: quantity(values.fluidBalance.outputMl, 'mL', 'mL'),
  });

  const net =
    values.fluidBalance.netBalanceMl !== undefined
      ? values.fluidBalance.netBalanceMl
      : values.fluidBalance.intakeMl - values.fluidBalance.outputMl;

  if (Number.isFinite(net)) {
    components.push({
      code: { coding: [{ system: 'urn:handover-pro:component', code: 'net', display: 'Net balance' }], text: 'Net balance' },
      valueQuantity: quantity(net as number, 'mL', 'mL'),
    });
  }

  return [
    {
      resourceType: 'Observation',
      status: 'final',
      category: [surveyCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.CARE.FLUID_BALANCE),
      subject,
      encounter,
      effectiveDateTime,
      component: components,
      note: values.fluidBalance.notes ? [{ text: values.fluidBalance.notes }] : undefined,
    },
  ];
}

function mapEvaObservation(
  pain: PainAssessment | undefined,
  context: MappingContext,
): Observation | null {
  if (!pain) return null;

  const components: ObservationComponent[] = [];
  const note: Annotation[] = [{ text: `Dolor reportado: ${pain.hasPain ? 'Sí' : 'No'}` }];

  if (pain.location) {
    components.push({
      code: {
        coding: [
          { system: 'urn:handover-pro:component', code: 'pain-location', display: 'Pain location' },
        ],
        text: 'Pain location',
      },
      valueString: pain.location,
    });
  }

  if (pain.actionsTaken) {
    components.push({
      code: {
        coding: [
          { system: 'urn:handover-pro:component', code: 'pain-actions', display: 'Actions taken' },
        ],
        text: 'Actions taken',
      },
      valueString: pain.actionsTaken,
    });
  }

  return {
    resourceType: 'Observation',
    status: 'final',
    category: [surveyCategoryConcept],
    code: codeableConceptFromCode(FHIR_CODES.SCALES.EVA, 'Escala EVA del dolor'),
    subject: context.subject,
    encounter: context.encounter,
    effectiveDateTime: context.effectiveDateTime,
    valueInteger: pain.evaScore ?? undefined,
    component: components.length > 0 ? components : undefined,
    note,
  };
}

function mapBradenObservation(
  braden: BradenScale | undefined,
  context: MappingContext,
): Observation | null {
  if (!braden) return null;

  const components: ObservationComponent[] = [
    {
      code: {
        coding: [
          {
            system: 'urn:handover-pro:braden',
            code: 'sensory-perception',
            display: 'Sensory perception',
          },
        ],
        text: 'Sensory perception',
      },
      valueInteger: braden.sensoryPerception,
    },
    {
      code: {
        coding: [
          { system: 'urn:handover-pro:braden', code: 'moisture', display: 'Moisture' },
        ],
        text: 'Moisture',
      },
      valueInteger: braden.moisture,
    },
    {
      code: {
        coding: [
          { system: 'urn:handover-pro:braden', code: 'activity', display: 'Activity' },
        ],
        text: 'Activity',
      },
      valueInteger: braden.activity,
    },
    {
      code: {
        coding: [
          { system: 'urn:handover-pro:braden', code: 'mobility', display: 'Mobility' },
        ],
        text: 'Mobility',
      },
      valueInteger: braden.mobility,
    },
    {
      code: {
        coding: [
          { system: 'urn:handover-pro:braden', code: 'nutrition', display: 'Nutrition' },
        ],
        text: 'Nutrition',
      },
      valueInteger: braden.nutrition,
    },
    {
      code: {
        coding: [
          { system: 'urn:handover-pro:braden', code: 'friction-shear', display: 'Friction/shear' },
        ],
        text: 'Friction/shear',
      },
      valueInteger: braden.frictionShear,
    },
  ];

  return {
    resourceType: 'Observation',
    status: 'final',
    category: [surveyCategoryConcept],
    code: codeableConceptFromCode(FHIR_CODES.SCALES.BRADEN, 'Escala de Braden'),
    subject: context.subject,
    encounter: context.encounter,
    effectiveDateTime: context.effectiveDateTime,
    valueInteger: braden.totalScore,
    component: components,
    note: [{ text: `Nivel de riesgo: ${braden.riskLevel}` }],
  };
}

function mapGlasgowObservation(
  glasgow: GlasgowScale | undefined,
  context: MappingContext,
): Observation | null {
  if (!glasgow) return null;

  const components: ObservationComponent[] = [
    {
      code: {
        coding: [
          { system: 'urn:handover-pro:glasgow', code: 'eye', display: 'Respuesta ocular' },
        ],
        text: 'Respuesta ocular',
      },
      valueInteger: glasgow.eye,
    },
    {
      code: {
        coding: [
          { system: 'urn:handover-pro:glasgow', code: 'verbal', display: 'Respuesta verbal' },
        ],
        text: 'Respuesta verbal',
      },
      valueInteger: glasgow.verbal,
    },
    {
      code: {
        coding: [
          { system: 'urn:handover-pro:glasgow', code: 'motor', display: 'Respuesta motora' },
        ],
        text: 'Respuesta motora',
      },
      valueInteger: glasgow.motor,
    },
  ];

  return {
    resourceType: 'Observation',
    status: 'final',
    category: [surveyCategoryConcept],
    code: codeableConceptFromCode(FHIR_CODES.SCALES.GLASGOW, 'Escala de Glasgow'),
    subject: context.subject,
    encounter: context.encounter,
    effectiveDateTime: context.effectiveDateTime,
    valueInteger: glasgow.total,
    component: components,
    note: [{ text: `Severidad: ${glasgow.severity}` }],
  };
}

function mapRiskConditions(
  risks: RiskFlags | undefined,
  context: MappingContext,
): Condition[] {
  if (!risks) return [];

  const { subject, encounter, effectiveDateTime } = context;
  const definitions = [
    { enabled: risks.fall, code: FHIR_CODES.RISK.FALL },
    { enabled: risks.pressureUlcer, code: FHIR_CODES.RISK.PRESSURE_ULCER },
    { enabled: risks.isolation, code: FHIR_CODES.RISK.SOCIAL_ISOLATION },
  ];

  return definitions
    .filter((definition) => definition.enabled)
    .map((definition) => ({
      resourceType: 'Condition',
      clinicalStatus: conditionClinicalStatusActive,
      verificationStatus: conditionVerificationStatusUnconfirmed,
      category: [conditionProblemListCategory],
      code: codeableConceptFromCode(definition.code),
      subject,
      encounter,
      onsetDateTime: effectiveDateTime,
      recordedDate: effectiveDateTime,
    }));
}

export function mapDocumentReferenceAudio(
  values: DocumentValues,
  options?: BuildOptions,
): DocumentReference | undefined {
  const optionsMerged = resolveOptions(options);
  if (!values.audioAttachment) return undefined;
  const parsed = AudioAttachmentSchema.parse(values.audioAttachment);
  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);
  const authorRef = ensureAuthorReference(values);

  const attachment: Attachment = {
    contentType: parsed.contentType,
    title: parsed.title,
  };

  if (parsed.url) {
    attachment.url = parsed.url;
  }
  if (parsed.dataBase64) {
    attachment.data = parsed.dataBase64;
    attachment.size = parsed.size;
    attachment.hash = parsed.hash;
  }

  return {
    resourceType: 'DocumentReference',
    status: 'current',
    subject,
    encounter,
    author: [authorRef],
    date: optionsMerged.now(),
    content: [{ attachment }],
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/document-classcodes',
            code: 'LP29684-5',
            display: 'Audio recording',
          },
        ],
        text: 'Audio handover',
      },
    ],
  };
}

export function buildComposition(
  values: CompositionValues,
  refs: BundleReferenceIndex,
  options?: BuildOptions,
): Composition {
  const optionsMerged = resolveOptions(options);
  const authorRef = ensureAuthorReference(values);
  const type = values.composition?.type ?? DEFAULT_COMPOSITION_TYPE;
  const status = values.composition?.status ?? 'final';
  const title = values.composition?.title ?? 'Clinical handover summary';
  const sections: CompositionSection[] = [];

  const addSbarSection = (label: string, content?: string | null) => {
    if (!content) return;
    const trimmed = content.trim();
    if (!trimmed) return;
    sections.push({ title: label, text: narrativeFromText(trimmed) });
  };

  if (typeof values.closingSummary === 'string') {
    const trimmed = values.closingSummary.trim();
    if (trimmed) {
      sections.push({ title: 'Shift summary', text: narrativeFromText(trimmed) });
    }
  }

  if (values.sbar) {
    addSbarSection('SBAR - Situation', values.sbar.situation);
    addSbarSection('SBAR - Background', values.sbar.background);
    addSbarSection('SBAR - Assessment', values.sbar.assessment);
    addSbarSection('SBAR - Recommendation', values.sbar.recommendation);
  }

  if (values.administrativeData) {
    sections.push({ title: 'Administrative data', text: administrativeNarrative(values.administrativeData) });
  }

  if (refs.vitals.length > 0) {
    sections.push({
      title: 'Vital signs',
      code: codeableConceptFromCode(FHIR_CODES.VITALS.VITAL_SIGNS_PANEL, 'Vital signs'),
      entry: refs.vitals.map((reference) => ({ reference })),
    });
  }

  if (refs.medications.length > 0) {
    sections.push({
      title: 'Medications',
      entry: refs.medications.map((reference) => ({ reference })),
    });
  }

  if (refs.oxygen.length > 0) {
    sections.push({
      title: 'Oxygen therapy',
      entry: refs.oxygen.map((reference) => ({ reference })),
    });
  }

  if (refs.nutrition.length > 0) {
    sections.push({
      title: 'Nutrition',
      entry: refs.nutrition.map((reference) => ({ reference })),
    });
  }

  if (refs.elimination.length > 0) {
    sections.push({
      title: 'Elimination',
      entry: refs.elimination.map((reference) => ({ reference })),
    });
  }

  if (refs.mobilitySkin.length > 0) {
    sections.push({
      title: 'Mobility and Skin',
      entry: refs.mobilitySkin.map((reference) => ({ reference })),
    });
  }

  if (refs.risks.length > 0) {
    sections.push({
      title: 'Risks',
      entry: refs.risks.map((reference) => ({ reference })),
    });
  }

  if (refs.fluidBalance.length > 0) {
    sections.push({
      title: 'Fluid balance',
      entry: refs.fluidBalance.map((reference) => ({ reference })),
    });
  }

  if (refs.pain.length > 0) {
    sections.push({ title: 'Pain assessment', entry: refs.pain.map((reference) => ({ reference })) });
  }

  if (refs.braden.length > 0) {
    sections.push({ title: 'Braden scale', entry: refs.braden.map((reference) => ({ reference })) });
  }

  if (refs.glasgow.length > 0) {
    sections.push({ title: 'Glasgow scale', entry: refs.glasgow.map((reference) => ({ reference })) });
  }

  if (refs.attachments.length > 0) {
    sections.push({
      title: 'Attachments',
      entry: refs.attachments.map((reference) => ({ reference })),
    });
  }

  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);

  return {
    resourceType: 'Composition',
    status,
    type,
    subject,
    encounter,
    date: optionsMerged.now(),
    author: [authorRef],
    title,
    attester: mapAttesters(values.composition?.attesters),
    section: sections.length > 0 ? sections : undefined,
  };
}

export function buildHandoverBundle(
  input: HandoverInput,
  options?: BuildOptions,
): Bundle {
  const values = 'values' in input ? input.values : input;
  const optionsMerged = resolveOptions(options);
  const nowIso = optionsMerged.now();
  const sharedOptions: BuildOptions = { now: () => nowIso };

  const mappingContext: MappingContext = {
    subject: patientReference(values.patientId),
    encounter: encounterReference(values.encounterId),
    effectiveDateTime: sharedOptions.now(),
  };

  const vitalObservations = values.vitals
    ? mapObservationVitals(
        {
          patientId: values.patientId,
          encounterId: values.encounterId,
          ...values.vitals,
        },
        sharedOptions,
      )
    : [];

  const oxygenObservations = mapOxygenObservations(
    {
      patientId: values.patientId,
      encounterId: values.encounterId,
      oxygenTherapy: values.oxygenTherapy,
    },
    sharedOptions,
  );

  const nutritionObservations = mapNutritionCare(
    { patientId: values.patientId, encounterId: values.encounterId, nutrition: values.nutrition },
    sharedOptions,
  );

  const eliminationObservations = mapEliminationCare(
    { patientId: values.patientId, encounterId: values.encounterId, elimination: values.elimination },
    sharedOptions,
  );

  const mobilitySkinObservations = mapMobilitySkinCare(
    {
      patientId: values.patientId,
      encounterId: values.encounterId,
      mobility: values.mobility,
      skin: values.skin,
    },
    sharedOptions,
  );

  const fluidBalanceObservations = mapFluidBalanceCare(
    { patientId: values.patientId, encounterId: values.encounterId, fluidBalance: values.fluidBalance },
    sharedOptions,
  );

  const evaObservation = mapEvaObservation(values.painAssessment, mappingContext);
  const bradenObservation = mapBradenObservation(values.braden, mappingContext);
  const glasgowObservation = mapGlasgowObservation(values.glasgow, mappingContext);
  const riskConditions = mapRiskConditions(values.risks, mappingContext);

  const medications = mapMedicationStatements(
    {
      patientId: values.patientId,
      encounterId: values.encounterId,
      medications: values.medications,
    },
    sharedOptions,
  );

  const oxygenResources = mapDeviceUse(
    {
      patientId: values.patientId,
      encounterId: values.encounterId,
      oxygenTherapy: values.oxygenTherapy,
    },
    sharedOptions,
  );

  const document = mapDocumentReferenceAudio(
    {
      patientId: values.patientId,
      encounterId: values.encounterId,
      author: values.author,
      audioAttachment: values.audioAttachment,
    },
    sharedOptions,
  );

  const entries: BundleEntry[] = [];
  const vitalsRefs: string[] = [];
  const medicationRefs: string[] = [];
  const oxygenRefs: string[] = [];
  const attachmentRefs: string[] = [];
  const nutritionRefs: string[] = [];
  const eliminationRefs: string[] = [];
  const mobilitySkinRefs: string[] = [];
  const fluidBalanceRefs: string[] = [];
  const painRefs: string[] = [];
  const bradenRefs: string[] = [];
  const glasgowRefs: string[] = [];
  const riskRefs: string[] = [];

  vitalObservations.forEach((observation) => {
    const { resource, fullUrl } = assignStableIds(observation, values.patientId);
    entries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Observation' },
    });
    vitalsRefs.push(fullUrl);
  });

  oxygenObservations.forEach((observation) => {
    const { resource, fullUrl } = assignStableIds(observation, values.patientId);
    entries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Observation' },
    });
    oxygenRefs.push(fullUrl);
  });

  nutritionObservations.forEach((observation) => {
    const { resource, fullUrl } = assignStableIds(observation, values.patientId);
    entries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Observation' },
    });
    nutritionRefs.push(fullUrl);
  });

  eliminationObservations.forEach((observation) => {
    const { resource, fullUrl } = assignStableIds(observation, values.patientId);
    entries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Observation' },
    });
    eliminationRefs.push(fullUrl);
  });

  mobilitySkinObservations.forEach((observation) => {
    const { resource, fullUrl } = assignStableIds(observation, values.patientId);
    entries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Observation' },
    });
    mobilitySkinRefs.push(fullUrl);
  });

  fluidBalanceObservations.forEach((observation) => {
    const { resource, fullUrl } = assignStableIds(observation, values.patientId);
    entries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Observation' },
    });
    fluidBalanceRefs.push(fullUrl);
  });

  if (evaObservation) {
    const { resource, fullUrl } = assignStableIds(evaObservation, values.patientId);
    entries.push({ fullUrl, resource, request: { method: 'POST', url: 'Observation' } });
    painRefs.push(fullUrl);
  }

  if (bradenObservation) {
    const { resource, fullUrl } = assignStableIds(bradenObservation, values.patientId);
    entries.push({ fullUrl, resource, request: { method: 'POST', url: 'Observation' } });
    bradenRefs.push(fullUrl);
  }

  if (glasgowObservation) {
    const { resource, fullUrl } = assignStableIds(glasgowObservation, values.patientId);
    entries.push({ fullUrl, resource, request: { method: 'POST', url: 'Observation' } });
    glasgowRefs.push(fullUrl);
  }

  riskConditions.forEach((condition) => {
    const { resource, fullUrl } = assignStableIds(condition, values.patientId);
    entries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Condition' },
    });
    riskRefs.push(fullUrl);
  });

  medications.forEach((medication) => {
    const { resource, fullUrl } = assignStableIds(medication, values.patientId);
    entries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'MedicationStatement' },
    });
    medicationRefs.push(fullUrl);
  });

  oxygenResources.forEach((resource) => {
    const { resource: withId, fullUrl } = assignStableIds(resource, values.patientId);
    entries.push({
      fullUrl,
      resource: withId,
      request: { method: 'POST', url: resource.resourceType },
    });
    oxygenRefs.push(fullUrl);
  });

  if (document) {
    const { resource, fullUrl } = assignStableIds(document, values.patientId);
    entries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'DocumentReference' },
    });
    attachmentRefs.push(fullUrl);
  }

  const composition = buildComposition(
    {
      patientId: values.patientId,
      encounterId: values.encounterId,
      author: values.author,
      composition: values.composition,
      closingSummary: values.closingSummary,
      administrativeData: values.administrativeData,
      sbar: values.sbar,
    },
    {
      vitals: vitalsRefs,
      medications: medicationRefs,
      oxygen: oxygenRefs,
      attachments: attachmentRefs,
      nutrition: nutritionRefs,
      elimination: eliminationRefs,
      mobilitySkin: mobilitySkinRefs,
      fluidBalance: fluidBalanceRefs,
      pain: painRefs,
      braden: bradenRefs,
      glasgow: glasgowRefs,
      risks: riskRefs,
    },
    sharedOptions,
  );

  const { resource: compositionWithId, fullUrl: compositionFullUrl } = assignStableIds(
    composition,
    values.patientId,
  );

  entries.push({
    fullUrl: compositionFullUrl,
    resource: compositionWithId,
    request: { method: 'POST', url: 'Composition' },
  });

  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: entries,
  };
}

export type {
  Observation,
  MedicationStatement,
  Procedure,
  DeviceUseStatement,
  DocumentReference,
  Composition,
  Condition,
  Bundle,
};

export const __test__ = {
  stableUrn,
  stableHash,
  stableStringify,
  LOINC: TEST_LOINC,
};
