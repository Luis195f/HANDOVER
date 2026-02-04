import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import type { AdministrativeData } from '../types/administrative';
import type {
  EliminationInfo,
  FluidBalanceInfo,
  HandoverBedsideChecklist,
  HandoverSignature,
  MedicationItem,
  MobilityInfo,
  NutritionInfo,
  PainAssessment,
  BradenScale,
  GlasgowScale,
  SkinInfo,
  TreatmentItem,
  ExamItem,
  ProcedureItem,
  RiskFlags,
  RiskItem,
  DeviceItem,
  PsychosocialCare,
} from '../types/handover';
import { zHandover } from '../validation/schemas';
import { CATEGORY, FHIR_CODES, LOINC, SNOMED, TERMINOLOGY_SYSTEMS, type TerminologyCode } from './codes';
import { hashHex, fhirId } from './crypto';
import { FHIR_PROFILE_URLS_BY_RESOURCE_TYPE } from './fhir-profiles';
import { validateResourceWithZod as validateFhirResource } from './fhir-validation';

export type HandoverData = z.infer<typeof zHandover>;

const DEFAULT_OPTS = { now: () => new Date().toISOString() } as const;

type HandoverBuildOptionExtras = {
  normalizeGlucoseToMgdl?: boolean;
  normalizeGlucoseToMgDl?: boolean;
  glucoseDecimals?: number;
  emitPanel?: (resource: unknown) => void;
  emitHasMember?: (resource: unknown) => void;
  emitBpPanel?: (resource: unknown) => void;
  emitIndividuals?: (resource: unknown) => void;
  profileUrls?: Record<string, unknown>;
};

export type BuildOptions = Partial<Omit<typeof DEFAULT_OPTS, 'now'>> &
  Partial<HandoverBuildOptionExtras> & {
    now?: (() => string) | Date | string;
  };

type ResolvedBuildOptions = (typeof DEFAULT_OPTS & BuildOptions) & { now: () => string };

const resolveOptions = (options?: BuildOptions): ResolvedBuildOptions => {
  const merged = { ...DEFAULT_OPTS, ...(options ?? {}) };
  const normalizeNow =
    typeof merged.now === 'function'
      ? merged.now
      : () => {
          if (merged.now instanceof Date) return merged.now.toISOString();
          if (typeof merged.now === 'string') return merged.now;
          return DEFAULT_OPTS.now();
        };
  return { ...merged, now: normalizeNow };
};

const mergeProfileUrls = <T extends FhirResource>(
  resource: T,
  options: ResolvedBuildOptions,
): T => {
  const customProfiles = options.profileUrls?.[resource.resourceType];
  if (!Array.isArray(customProfiles)) {
    return resource;
  }

  const filteredProfiles = customProfiles.filter(
    (url): url is string => typeof url === 'string' && url.trim().length > 0,
  );
  if (filteredProfiles.length === 0) {
    return resource;
  }

  const existingProfiles = Array.isArray((resource as ResourceWithMeta).meta?.profile)
    ? Array.from((resource as ResourceWithMeta).meta?.profile ?? [])
    : [];
  const mergedProfiles = Array.from(new Set([...existingProfiles, ...filteredProfiles]));
  const meta = { ...(resource as ResourceWithMeta).meta, profile: mergedProfiles } satisfies Meta;
  return { ...(resource as ResourceWithMeta), meta } as unknown as T;
};

const applyProfileUrls = <T extends FhirResource>(
  resource: T,
  options: ResolvedBuildOptions,
): T => {
  const defaultProfiles = FHIR_PROFILE_URLS_BY_RESOURCE_TYPE[resource.resourceType] ?? [];
  if (defaultProfiles.length === 0) {
    return mergeProfileUrls(resource, options);
  }

  const existingProfiles = Array.isArray((resource as ResourceWithMeta).meta?.profile)
    ? Array.from((resource as ResourceWithMeta).meta?.profile ?? [])
    : [];

  const mergedProfiles = Array.from(new Set([...existingProfiles, ...defaultProfiles]));
  const meta: Meta = { ...(resource as ResourceWithMeta).meta, profile: mergedProfiles };

  // TS a veces no puede probar que el spread mantiene el genérico T → cast intencional vía unknown
  const resourceWithProfiles = { ...(resource as ResourceWithMeta), meta } as unknown as T;

  return mergeProfileUrls(resourceWithProfiles, options);
};

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
  identifier?: { system: string; value: string };
};

type Meta = {
  profile: readonly string[];
};

type Annotation = {
  text: string;
};

type Signature = {
  type: Coding[];
  when: string;
  who: Reference;
  onBehalfOf?: Reference;
  sigFormat?: string;
  data?: string;
};

type MedicationDosage = {
  text?: string;
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
  status: 'final' | 'registered' | 'preliminary';
  category: CodeableConcept[];
  code: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  effectiveDateTime: string;
  issued?: string;
  hasMember?: Reference[];
  valueQuantity?: Quantity;
  valueCodeableConcept?: CodeableConcept;
  valueString?: string;
  valueInteger?: number;
  component?: ObservationComponent[];
  note?: Annotation[];
};

type MedicationStatement = {
  resourceType: 'MedicationStatement';
  identifier?: Array<{ system: string; value: string }>;
  id?: string;
  status: 'active' | 'completed' | 'intended';
  medicationCodeableConcept: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  effectivePeriod?: Period;
  dateAsserted: string;
  note?: Annotation[];
  dosage?: MedicationDosage[];
};

type Procedure = {
  resourceType: 'Procedure';
  identifier?: Array<{ system: string; value: string }>;
  id?: string;
  status: 'in-progress' | 'completed' | 'preparation';
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
  context?: Reference;
  device: Reference;
  timingPeriod?: Period;
  reasonCode?: CodeableConcept[];
  note?: Annotation[];
};

type Device = {
  resourceType: 'Device';
  id?: string;
  status?: 'active' | 'inactive';
  deviceName?: Array<{ name: string; type?: 'user-friendly' | 'udi-label-name' | 'patient-reported-name' }>;
  patient?: Reference;
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

type Patient = {
  resourceType: 'Patient';
  id?: string;
  identifier?: Array<{ system: string; value: string }>;
  name?: Array<{ use?: string; text?: string }>;
  gender?: string;
  birthDate?: string;
};

type Practitioner = {
  resourceType: 'Practitioner';
  id?: string;
  identifier?: Array<{ system: string; value: string }>;
  name?: Array<{ text?: string }>;
};

type Encounter = {
  resourceType: 'Encounter';
  id?: string;
  status: 'planned' | 'in-progress' | 'finished' | 'unknown';
  class: {
    system: string;
    code: string;
    display?: string;
  };
  subject?: Reference;
  period?: Period;
};

type DetectedIssue = {
  resourceType: 'DetectedIssue';
  id?: string;
  status: 'final' | 'registered' | 'preliminary';
  code?: CodeableConcept;
  severity?: 'high' | 'moderate' | 'low';
  detail?: string;
  subject: Reference;
  identifiedDateTime?: string;
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

type CompositionEvent = {
  period?: Period;
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
  event?: CompositionEvent[];
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
  | Device
  | Condition
  | Patient
  | Practitioner
  | Encounter
  | DetectedIssue;

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
  signature?: Signature[];
};

type ResourceWithMeta = FhirResource & { meta?: Meta };

export interface FhirBundleTransaction {
  resourceType: 'Bundle';
  type: 'transaction';
  entry: Array<{
    fullUrl: string;
    resource: FhirResource;
    request: { method: 'POST'; url: string };
  }>;
  signature?: Signature[];
}

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
  FIO2: LOINC.fio2,
  O2_FLOW: LOINC.o2Flow,
} as const;

const PROFILE_VITAL_SIGNS = 'http://hl7.org/fhir/StructureDefinition/vitalsigns';
const PROFILE_BLOOD_PRESSURE = 'http://hl7.org/fhir/StructureDefinition/bp';
const PROFILE_OBSERVATION = 'http://hl7.org/fhir/StructureDefinition/Observation';
const DEFAULT_COMPOSITION_TYPE: CodeableConcept = {
  coding: [
    {
      system: 'urn:handover-pro:composition-type',
      code: 'handover-shift',
      display: 'Nursing shift handover',
    },
  ],
  text: 'Clinical handover',
};

const COMPOSITION_SECTION_CODES = {
  administrative: {
    system: 'urn:handover-pro:composition-section',
    code: 'administrative',
    display: 'Administrative',
  },
  vitals: {
    system: TERMINOLOGY_SYSTEMS.LOINC,
    code: LOINC.vitalSignsPanel,
    display: 'Vital signs',
  },
  care: {
    system: 'urn:handover-pro:composition-section',
    code: 'care-treatments',
    display: 'Care / Treatments',
  },
  sbar: {
    system: 'urn:handover-pro:composition-section',
    code: 'sbar',
    display: 'SBAR',
  },
  bedsideChecklist: {
    system: 'urn:handover-pro:composition-section',
    code: 'bedside-checklist',
    display: 'Bedside checklist',
  },
  notes: {
    system: 'urn:handover-pro:composition-section',
    code: 'notes-summary',
    display: 'Notes / Summary',
  },
} as const;

// ---------------------------------------------------------------------------
// Terminology systems (local URNs)
// ---------------------------------------------------------------------------
// En algunos typings de FHIR, Coding.system es string. Si en tu repo no existe
// un tipo "TerminologySystem" explícito, definimos uno local y no rompemos nada.
type TerminologySystem = string;

const HANDOVER_OBSERVATION_SYSTEM: TerminologySystem = 'urn:handover-pro:observation';
const HANDOVER_COMPOSITION_SECTION_SYSTEM: TerminologySystem =
  'urn:handover-pro:composition-section';

const HANDOVER_OBSERVATION_CODES = {
  administrative: {
    system: HANDOVER_OBSERVATION_SYSTEM,
    code: 'administrative',
    display: 'Administrative overview',
  },
  sbar: {
    system: HANDOVER_OBSERVATION_SYSTEM,
    code: 'sbar',
    display: 'SBAR summary',
  },
  bedsideChecklist: {
    system: HANDOVER_OBSERVATION_SYSTEM,
    code: 'bedside-checklist',
    display: 'Bedside checklist',
  },
  notes: {
    system: HANDOVER_OBSERVATION_SYSTEM,
    code: 'handover-notes',
    display: 'Handover notes',
  },
} as const;

const compositionSectionConcept = (code: string, display: string): CodeableConcept =>
  codeableConceptFromCode(
    {
      system: HANDOVER_COMPOSITION_SECTION_SYSTEM,
      code,
      display,
    },
    display,
  );

const vitalCategoryConcept: CodeableConcept = {
  coding: [
    {
      system: CATEGORY.vitalSigns.system,
      code: CATEGORY.vitalSigns.code,
      display: 'Vital Signs',
    },
  ],
};

const laboratoryCategoryConcept: CodeableConcept = {
  coding: [
    {
      system: CATEGORY.laboratory.system,
      code: CATEGORY.laboratory.code,
      display: 'Laboratory',
    },
  ],
  text: 'Laboratory',
};

const surveyCategoryConcept: CodeableConcept = {
  coding: [
    {
      system: TERMINOLOGY_SYSTEMS.OBSERVATION_CATEGORY,
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

const normalizeIsoDateTimeValue = (value?: string): string | undefined => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString();
};

const ObservationVitalsSchema = z.object({
  patientId: z.string().min(1),
  encounterId: z.string().min(1).optional(),
  recordedAt: isoDateTime.optional(),
  issuedAt: isoDateTime.optional(),
  hr: z.coerce.number().min(30).max(220).optional(),
  rr: z.coerce.number().min(5).max(60).optional(),
  tempC: z.coerce.number().min(30).max(45).optional(),
  spo2: z.coerce.number().min(50).max(100).optional(),
  sbp: z.coerce.number().min(60).max(260).optional(),
  dbp: z.coerce.number().min(30).max(160).optional(),
  glucoseMgDl: z.coerce.number().min(20).max(1000).optional(),
  glucoseMmolL: z.coerce.number().min(1).max(55).optional(),
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
  partyIdentifier: z
    .object({
      system: z.string(),
      value: z.string(),
    })
    .optional(),
});

type ObservationVitalsInput = z.infer<typeof ObservationVitalsSchema>;
type MedicationStatementInput = z.infer<typeof MedicationStatementSchema>;
type OxygenTherapyInput = z.infer<typeof OxygenTherapySchema>;
type AudioAttachmentInput = z.infer<typeof AudioAttachmentSchema>;
type AttesterInput = z.infer<typeof AttesterSchema>;
type AttachmentInput = {
  uri: string;
  contentType: string;
  name?: string;
  data: string;
};

type MedicationValues = {
  patientId: string;
  encounterId?: string;
  medications?: Array<MedicationStatementInput | MedicationItem>;
  meds?: string | string[] | null;
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
  attachments?: AttachmentInput[] | null;
};

type CompositionValues = {
  patientId: string;
  encounterId?: string;
  author?: AuthorInput;
  composition?: CompositionInput;
  closingSummary?: string | null;
  sbar?: SbarValues;
  administrativeData?: AdministrativeData;
  psychosocial?: PsychosocialCare;
  signatures?: HandoverSignatures;
  sectionSources?: Partial<Record<'exams' | 'procedures', number>>;
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
  treatments: string[];
  oxygen: string[];
  devices: string[];
  attachments: string[];
  administrative: string[];
  care: string[];
  sbar: string[];
  bedsideChecklist: string[];
  notes: string[];
  nutrition: string[];
  elimination: string[];
  mobilitySkin: string[];
  fluidBalance: string[];
  pain: string[];
  braden: string[];
  glasgow: string[];
  exams: string[];
  procedures: string[];
  risks: string[];
  detectedIssues?: string[];
  diagnoses?: string[];
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

export type HandoverSignatures = {
  outgoing?: HandoverSignature;
  incoming?: HandoverSignature;
};

export type HandoverValues = {
  patientId: string;
  encounterId?: string;
  author?: AuthorInput;
  administrativeData?: AdministrativeData;
  status?: 'draft' | 'final';
  vitals?: VitalsValues;
  medications?: Array<MedicationStatementInput | MedicationItem>;
  oxygenTherapy?: OxygenTherapyInput | null;
  audioAttachment?: AudioAttachmentInput | null;
  attachments?: AttachmentInput[];
  composition?: CompositionInput;
  closingSummary?: string | null;
  sbar?: SbarValues;
  signatures?: HandoverSignatures;
  nutrition?: NutritionInfo;
  elimination?: EliminationInfo;
  mobility?: MobilityInfo;
  skin?: SkinInfo;
  devices?: DeviceItem[];
  psychosocial?: PsychosocialCare;
  fluidBalance?: FluidBalanceInfo;
  painAssessment?: PainAssessment;
  exams?: ExamItem[];
  procedures?: ProcedureItem[];
  braden?: BradenScale;
  glasgow?: GlasgowScale;
  // BEGIN HANDOVER D1 – BedsideChecklist types
  bedsideChecklist: HandoverBedsideChecklist;
  // END HANDOVER D1 – BedsideChecklist types
  risks?: RiskFlags;
  risksStructured?: RiskItem[];
  treatments?: TreatmentItem[];
  meds?: string | string[] | null;
};

export type HandoverInput = HandoverValues | { values: HandoverValues };


type MappingContext = {
  subject: Reference;
  encounter?: Reference;
  effectiveDateTime: string;
};

const UCUM = 'http://unitsofmeasure.org';

const normalizeId = (value: string | undefined, fallback: string): string => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed) return trimmed;
  return fallback;
};

const normalizePatientId = (patientId: string): string => {
  const normalized = normalizeId(patientId, 'unknown');
  return normalized;
};

function patientReference(patientId: string): Reference {
  const normalized = normalizePatientId(patientId);
  return {
    reference: `Patient/${normalized}`,
    type: 'Patient',
    identifier: { system: 'urn:handover-pro:patient-id', value: normalized },
  };
}

function encounterReference(encounterId?: string): Reference | undefined {
  const normalized = normalizeId(encounterId, '');
  if (!normalized) return undefined;
  return {
    reference: `Encounter/${normalized}`,
    type: 'Encounter',
    identifier: { system: 'urn:handover-pro:encounter-id', value: normalized },
  };
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
    identifier: { system: 'urn:handover-pro:practitioner-id', value: id },
  };
}

function resolveReferenceId(reference: string | undefined, resourceType: string): string | undefined {
  if (!reference) return undefined;
  const [type, id] = reference.split('/');
  if (type === resourceType && id) return id;
  return undefined;
}

function assertAttachmentData(input: AttachmentInput): void {
  if (!input.data || typeof input.data !== 'string') {
    throw new Error('Attachment data is required');
  }
}

function resolveAttachmentContentType(input: AttachmentInput): string {
  const contentType = input.contentType?.trim();
  if (contentType) return contentType;
  return 'application/octet-stream';
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
    if (attester.partyReference || attester.partyDisplay || attester.partyIdentifier) {
      const resolvedReference =
        attester.partyReference?.trim() ||
        (attester.partyIdentifier?.value
          ? `Practitioner/${encodeURIComponent(attester.partyIdentifier.value)}`
          : undefined);
      if (resolvedReference) {
        base.party = {
          reference: resolvedReference,
          display: attester.partyDisplay,
          identifier: attester.partyIdentifier,
        };
      }
    }
    return base;
  });
}

function attestersFromSignatures(signatures?: HandoverSignatures): AttesterInput[] {
  if (!signatures) return [];

  const mapSingle = (signature?: HandoverSignature | null): AttesterInput | null => {
    if (!signature) return null;
    return {
      mode: 'professional',
      time: signature.signedAt,
      partyDisplay: signature.fullName,
      partyIdentifier: { system: 'urn:handover:user-id', value: signature.userId },
    };
  };

  return [mapSingle(signatures.outgoing), mapSingle(signatures.incoming)].filter(
    (value): value is AttesterInput => value != null,
  );
}

function buildSignatureResource(signature?: HandoverSignature | null): Signature | undefined {
  if (!signature?.imageBase64) return undefined;

  // El tipo Reference del proyecto exige `reference` (además de identifier/display/type).
  // Usamos un reference estable y "local" (no depende de que exista un Practitioner real en servidor).
  const who: Reference = {
    reference: `Practitioner/${encodeURIComponent(signature.userId)}`,
    identifier: { system: 'urn:handover:user-id', value: signature.userId },
    display: signature.fullName,
    type: 'Practitioner',
  };

  const onBehalfOf: Reference | undefined = signature.unitId
    ? {
        reference: `Organization/${encodeURIComponent(signature.unitId)}`,
        identifier: { system: 'urn:handover:unit-id', value: signature.unitId },
        display: signature.unitId,
        type: 'Organization',
      }
    : undefined;

  return {
    type: [{ system: 'urn:handover:signature-type', code: 'signature', display: 'Signature' }],
    when: signature.signedAt,
    who,
    onBehalfOf,
    sigFormat: 'image/png',
    data: signature.imageBase64,
  };
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

function administrativeSummaryText(data: AdministrativeData): string {
  const staffIn = data.staffIn?.filter(Boolean) ?? [];
  const staffOut = data.staffOut?.filter(Boolean) ?? [];
  const incidents = data.incidents?.filter(Boolean) ?? [];
  const lines = [
    `Unit: ${data.unit}`,
    `Census: ${data.census}`,
    `Shift: ${data.shiftStart} → ${data.shiftEnd}`,
    `Shift type: ${data.shiftType}`,
    `Incoming staff: ${staffIn.length > 0 ? staffIn.join(', ') : 'N/D'}`,
    `Outgoing staff: ${staffOut.length > 0 ? staffOut.join(', ') : 'N/D'}`,
  ];
  if (data.generalNotes) {
    lines.push(`Notes: ${data.generalNotes}`);
  }
  if (incidents.length > 0) {
    lines.push(`Incidents: ${incidents.join('; ')}`);
  }
  return lines.join('\n');
}

function administrativeNarrative(data: AdministrativeData): Narrative {
  return narrativeFromText(administrativeSummaryText(data));
}

const FHIR_ID_PREFIX: Record<FhirResource['resourceType'], string> = {
  Observation: 'obs-',
  MedicationStatement: 'ms-',
  Procedure: 'proc-',
  DeviceUseStatement: 'dus-',
  Device: 'device',
  DocumentReference: 'doc-',
  Composition: 'comp-',
  Condition: 'cond-',
  Patient: 'pat-',
  Practitioner: 'prac-',
  Encounter: 'enc-',
  DetectedIssue: 'di-',
};

function assignStableIds<T extends FhirResource>(
  resource: T,
  patientId: string,
): { resource: T; fullUrl: string } {
  const normalizedPatientId = normalizePatientId(patientId);
  const existingId = typeof resource.id === 'string' && resource.id.trim().length > 0
    ? resource.id.trim()
    : undefined;
  const { id: _ignored, ...rest } = resource;
  const key = `${resource.resourceType}|${normalizedPatientId}|${stableStringify(rest)}`;
  const prefix = FHIR_ID_PREFIX[resource.resourceType] ?? '';
  const id = existingId ?? fhirId(prefix, key);
  const urn = `urn:uuid:${hashHex(`${resource.resourceType}|${normalizedPatientId}|${id}`, 32)}`;
  const withId = { ...resource, id } as T;
  return { resource: withId, fullUrl: urn };
}

function referenceFromResource(resource: Pick<FhirResource, 'resourceType' | 'id'>): Reference {
  if (!resource.id) {
    throw new Error(`Missing id for ${resource.resourceType} reference`);
  }
  return { reference: `${resource.resourceType}/${resource.id}`, type: resource.resourceType };
}

function referenceStringFromResource(resource: Pick<FhirResource, 'resourceType' | 'id'>): string {
  return referenceFromResource(resource).reference;
}

function replaceSubjectReference<T extends FhirResource>(resource: T, subject: Reference): T {
  if ('subject' in resource) {
    return { ...resource, subject } as T;
  }
  return resource;
}

function ensureEffectiveDate(
  parsed: ObservationVitalsInput,
  optionsMerged: ResolvedBuildOptions,
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
    values.glucoseMmolL !== undefined ||
    values.avpu !== undefined;

  if (!hasMeasurement) {
    return [];
  }

  const optionsMerged = resolveOptions(options);
  const parsed = ObservationVitalsSchema.parse(values);
  const { effective, issued } = ensureEffectiveDate(parsed, optionsMerged);
  const subject = patientReference(parsed.patientId);
  const encounter = encounterReference(parsed.encounterId);
  const normalizeGlucoseToMgDl =
    optionsMerged.normalizeGlucoseToMgDl ??
    optionsMerged.normalizeGlucoseToMgdl ??
    true;
  const glucoseDecimals = optionsMerged.glucoseDecimals ?? 0;

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
      meta: { profile: [PROFILE_BLOOD_PRESSURE, PROFILE_VITAL_SIGNS] },
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
      valueQuantity: quantity(parsed.hr, '/min', '/min'),
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
      valueQuantity: quantity(parsed.rr, '/min', '/min'),
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
      meta: { profile: [PROFILE_OBSERVATION] },
      status: 'final',
      category: [laboratoryCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.VITALS.GLUCOSE_MASS_BLD),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(parsed.glucoseMgDl, 'mg/dL', 'mg/dL'),
    });
  } else if (parsed.glucoseMmolL !== undefined) {
    if (normalizeGlucoseToMgDl) {
      const factor = 18.0182;
      const converted = Number((parsed.glucoseMmolL * factor).toFixed(glucoseDecimals));
      observations.push({
        resourceType: 'Observation',
        meta: { profile: [PROFILE_OBSERVATION] },
        status: 'final',
        category: [laboratoryCategoryConcept],
        code: codeableConceptFromCode(FHIR_CODES.VITALS.GLUCOSE_MASS_BLD),
        subject,
        encounter,
        effectiveDateTime: effective,
        issued,
        valueQuantity: quantity(converted, 'mg/dL', 'mg/dL'),
        note: [
          {
            text: `Convertido desde ${parsed.glucoseMmolL} mmol/L (factor ${factor}).`,
          },
        ],
      });
    } else {
      observations.push({
        resourceType: 'Observation',
        meta: { profile: [PROFILE_OBSERVATION] },
        status: 'final',
        category: [laboratoryCategoryConcept],
        code: codeableConceptFromCode(FHIR_CODES.VITALS.GLUCOSE_MOLES_BLD),
        subject,
        encounter,
        effectiveDateTime: effective,
        issued,
        valueQuantity: quantity(parsed.glucoseMmolL, 'mmol/L', 'mmol/L'),
      });
    }
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
            system: TERMINOLOGY_SYSTEMS.SNOMED,
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

export function mapVitalsToObservations(
  input: { patientId: string; encounterId?: string; vitals?: VitalsValues },
  options?: BuildOptions,
): Observation[] {
  if (!input.vitals) {
    return [];
  }

  const sanitizeNumber = (value: unknown, min: number, max: number) =>
    Number.isFinite(value) && Number(value) >= min && Number(value) <= max
      ? Number(value)
      : undefined;
  const rawVitals = input.vitals as VitalsValues & {
    bgMgDl?: number;
    bgMmolL?: number;
    temp?: number;
    acvpu?: ObservationVitalsInput['avpu'];
  };
  const legacyBgMgDl = (input.vitals as { bgMgDl?: number }).bgMgDl;
  const legacyBgMmolL = (input.vitals as { bgMmolL?: number }).bgMmolL;
  const glucoseMgDl = Number.isFinite(input.vitals.glucoseMgDl)
    ? input.vitals.glucoseMgDl
    : undefined;
  const glucoseMmolL = Number.isFinite(input.vitals.glucoseMmolL)
    ? input.vitals.glucoseMmolL
    : undefined;
  const tempValue = Number.isFinite(rawVitals.tempC)
    ? rawVitals.tempC
    : Number.isFinite(rawVitals.temp)
      ? rawVitals.temp
      : undefined;
  const rawAvpu = rawVitals.avpu ?? rawVitals.acvpu;
  const avpuValue =
    typeof rawAvpu === 'string' && rawAvpu in AVPU_MAP
      ? rawAvpu
      : undefined;
  const recordedAt = typeof rawVitals.recordedAt === 'string' ? rawVitals.recordedAt : undefined;
  const issuedAt = typeof rawVitals.issuedAt === 'string' ? rawVitals.issuedAt : undefined;

  const normalizedVitals: VitalsValues = {
    hr: sanitizeNumber(rawVitals.hr, 30, 220),
    rr: sanitizeNumber(rawVitals.rr, 5, 60),
    tempC: sanitizeNumber(tempValue, 30, 45),
    spo2: sanitizeNumber(rawVitals.spo2, 50, 100),
    sbp: sanitizeNumber(rawVitals.sbp, 60, 260),
    dbp: sanitizeNumber(rawVitals.dbp, 30, 160),
    glucoseMgDl: sanitizeNumber(
      glucoseMgDl ?? (Number.isFinite(legacyBgMgDl) ? legacyBgMgDl : undefined),
      20,
      1000,
    ),
    glucoseMmolL: sanitizeNumber(
      glucoseMmolL ?? (Number.isFinite(legacyBgMmolL) ? legacyBgMmolL : undefined),
      1,
      55,
    ),
    avpu: avpuValue,
    recordedAt,
    issuedAt,
  };

  const baseObservations = mapObservationVitals(
    {
      patientId: input.patientId,
      encounterId: input.encounterId,
      ...normalizedVitals,
    },
    options,
  );

  const filteredObservations = baseObservations.filter(
    (observation) =>
      !observation.code?.coding?.some(
        (coding) =>
          coding.system === TERMINOLOGY_SYSTEMS.LOINC &&
          coding.code === FHIR_CODES.VITALS.BP_PANEL.code,
      ),
  );

  if (normalizedVitals.sbp === undefined && normalizedVitals.dbp === undefined) {
    return filteredObservations;
  }

  const optionsMerged = resolveOptions(options);
  const normalizedRecordedAt = normalizeIsoDateTimeValue(normalizedVitals.recordedAt);
  const normalizedIssuedAt = normalizeIsoDateTimeValue(normalizedVitals.issuedAt);
  const effective = normalizedRecordedAt ?? optionsMerged.now();
  const issued = normalizedIssuedAt ?? effective;
  const subject = patientReference(input.patientId);
  const encounter = encounterReference(input.encounterId);

  const bpIndividuals: Observation[] = [];
  if (normalizedVitals.sbp !== undefined) {
    bpIndividuals.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.VITALS.BP_SYSTOLIC),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(normalizedVitals.sbp, 'mm[Hg]', 'mm[Hg]'),
    });
  }
  if (normalizedVitals.dbp !== undefined) {
    bpIndividuals.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codeableConceptFromCode(FHIR_CODES.VITALS.BP_DIASTOLIC),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(normalizedVitals.dbp, 'mm[Hg]', 'mm[Hg]'),
    });
  }

  return [...filteredObservations, ...bpIndividuals];
}

const MEDICATION_ROUTE_LABELS: Partial<Record<NonNullable<MedicationItem['route']>, string>> = {
  oral: 'Oral',
  iv: 'IV',
  im: 'IM',
  sc: 'SC',
  inhaled: 'Inhalada',
  topical: 'Tópica',
  other: 'Otra vía',
};

function structuredDosageText(medication: MedicationItem): string | undefined {
  const parts = [medication.dose, medication.route ? MEDICATION_ROUTE_LABELS[medication.route] : null, medication.frequency]
    .filter(Boolean)
    .join(' ');
  return parts || undefined;
}

// BEGIN HANDOVER D7 – Medication FHIR mapping (pendiente)
// Pendiente: mapear cada MedicationItem a un recurso FHIR:
// - MedicationStatement o MedicationAdministration según isContinuous.
// - name → medicationCodeableConcept
// - dose, route, frequency → Dosage.elements
// - startTime, endTime → effectiveDateTime o effectivePeriod
// - isHighAlert → extensiones de riesgo.
// - notes → note.text
// END HANDOVER D7 – Medication FHIR mapping (pendiente)

function isStructuredMedication(
  input: MedicationStatementInput | MedicationItem,
): input is MedicationItem {
  return (input as MedicationItem).name !== undefined;
}

function mapStructuredMedicationStatement(
  medication: MedicationItem,
  subject: Reference,
  encounter: Reference | undefined,
  assertedAt: string,
): MedicationStatement {
  // Pendiente HANDOVER D7 – soportar isContinuous/startTime/endTime para elegir entre
  // MedicationStatement y MedicationAdministration, agregar extensiones de alto riesgo y reflejar
  // firmas específicas de medicación si están presentes.
  const concept: CodeableConcept = medication.code
    ? {
        coding: [medication.code],
        text: medication.name,
      }
    : {
        coding: [],
        text: medication.name,
      };

  const notes: Annotation[] = [];
  if (medication.isHighAlert) {
    notes.push({ text: 'High alert medication' });
  }
  if (medication.notes) {
    notes.push({ text: medication.notes });
  }

  const dosageText = structuredDosageText(medication);

  return {
    resourceType: 'MedicationStatement',
    identifier: [{ system: 'urn:handover-pro:medication-item', value: medication.id }],
    status: 'active',
    medicationCodeableConcept: concept,
    subject,
    encounter,
    dateAsserted: assertedAt,
    note: notes.length > 0 ? notes : undefined,
    dosage: dosageText ? [{ text: dosageText }] : undefined,
  };
}

function mapLegacyMedicationStatement(
  input: MedicationStatementInput,
  subject: Reference,
  encounter: Reference | undefined,
  assertedAt: string,
): MedicationStatement | null {
  const parsedResult = MedicationStatementSchema.safeParse(input);
  if (!parsedResult.success) return null;
  const parsed = parsedResult.data;
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

export function mapMedicationStatements(
  values: MedicationValues,
  options?: BuildOptions,
): MedicationStatement[] {
  const inputs = values.medications ?? [];
  const optionsMerged = resolveOptions(options);
  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);
  const assertedAt = optionsMerged.now();

  const structuredInputs = inputs.filter(isStructuredMedication);
  const legacyInputs = inputs.filter((item): item is MedicationStatementInput => !isStructuredMedication(item));

  const structuredStatements = structuredInputs.map((item) =>
    mapStructuredMedicationStatement(item, subject, encounter, assertedAt),
  );

  const legacyStatements = legacyInputs
    .map((item) => mapLegacyMedicationStatement(item, subject, encounter, assertedAt))
    .filter((value): value is MedicationStatement => value != null);

  const hasStatements = structuredStatements.length > 0 || legacyStatements.length > 0;
  const medsText = Array.isArray(values.meds) ? values.meds.join(', ') : values.meds;
  const trimmedText = typeof medsText === 'string' ? medsText.trim() : '';

  const textFallback: MedicationStatement[] = !hasStatements && trimmedText
    ? [
        {
          resourceType: 'MedicationStatement',
          status: 'active',
          medicationCodeableConcept: { coding: [], text: trimmedText },
          subject,
          encounter,
          dateAsserted: assertedAt,
          note: [{ text: 'Texto libre de medicación transcrito desde handover' }],
        },
      ]
    : [];

  return [...structuredStatements, ...legacyStatements, ...textFallback];
}

export function mapDeviceUse(
  values: OxygenValues,
  options?: BuildOptions,
): Array<Procedure | DeviceUseStatement | Device> {
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
          system: TERMINOLOGY_SYSTEMS.SNOMED,
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
            system: TERMINOLOGY_SYSTEMS.SNOMED,
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
            system: TERMINOLOGY_SYSTEMS.SNOMED,
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

  const resources: Array<Procedure | DeviceUseStatement | Device> = [procedure];

  if (parsed.deviceDisplay || parsed.deviceId || parsed.device) {
    const deviceDisplay = parsed.deviceDisplay ?? parsed.device ?? 'Oxygen delivery device';
    const deviceId = parsed.deviceId ?? fhirId('device-', `${values.patientId}|${deviceDisplay}`);
    resources.push({
      resourceType: 'Device',
      id: deviceId,
      status: 'active',
      deviceName: [{ name: deviceDisplay, type: 'user-friendly' }],
      patient: subject,
    });
    resources.push({
      resourceType: 'DeviceUseStatement',
      status: parsed.end ? 'completed' : 'active',
      subject,
      encounter,
      device: {
        reference: `Device/${deviceId}`,
        display: deviceDisplay,
      },
      timingPeriod: parsed.end ? { start, end: parsed.end } : { start },
    });
  }

  return resources;
}

export function mapDevices(
  values: { patientId: string; encounterId?: string; devices?: Array<DeviceItem | unknown> },
  options?: BuildOptions,
): Array<Device | DeviceUseStatement> {
  const devices = Array.isArray(values.devices) ? values.devices : [];
  if (devices.length === 0) return [];
  const optionsMerged = resolveOptions(options);
  const subject = patientReference(values.patientId);
  const context = encounterReference(values.encounterId);
  const timestamp = optionsMerged.now();

  return devices.flatMap((device, index) => {
    if (!device || typeof device !== 'object') {
      warnDevicesItemSkipped({
        code: 'HANDOVER_DEVICES_ITEM_SKIPPED',
        reason: 'invalid_shape',
        item: device,
      });
      return [];
    }

    const nameRaw = (device as DeviceItem).name;
    const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
    if (!name) {
      warnDevicesItemSkipped({
        code: 'HANDOVER_DEVICES_ITEM_SKIPPED',
        reason: 'missing_name',
        item: device,
      });
      return [];
    }

    const isActive = (device as DeviceItem).active === true;
    const baseKey = `${values.patientId}|${values.encounterId ?? ''}|${name}|${index}`;
    const deviceId = fhirId('device-', baseKey);
    const deviceUseId = fhirId('dus-', `${baseKey}|${isActive ? 'active' : 'inactive'}`);

    const deviceResource: Device = {
      resourceType: 'Device',
      id: deviceId,
      status: isActive ? 'active' : 'inactive',
      deviceName: [{ name, type: 'user-friendly' }],
      patient: subject,
    };

    const deviceUseStatement: DeviceUseStatement = {
      resourceType: 'DeviceUseStatement',
      id: deviceUseId,
      status: isActive ? 'active' : 'completed',
      subject,
      context,
      device: { reference: `Device/${deviceId}`, display: name },
      timingPeriod: isActive ? { start: timestamp } : { start: timestamp, end: timestamp },
    };

    return [deviceResource, deviceUseStatement];
  });
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
type TreatmentValues = CareValues & { treatments?: TreatmentItem[] };

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

type NormalizedExamInput = {
  items: Array<ExamItem | unknown>;
  legacyFields: string[];
  legacyCount: number;
  inputCount: number;
};

const warnExamsItemSkipped = (payload: {
  code: 'HANDOVER_EXAMS_ITEM_SKIPPED';
  reason: 'invalid_shape' | 'empty_description' | 'unknown_type' | 'unknown_state';
  examType?: string;
  examState?: string;
  len?: number;
}) => {
  void payload;
};

const warnProceduresItemSkipped = (payload: {
  code: 'HANDOVER_PROCEDURES_ITEM_SKIPPED';
  reason: 'invalid_shape' | 'empty_description';
  done?: boolean;
  len?: number;
}) => {
  void payload;
};

const warnDevicesItemSkipped = (payload: {
  code: 'HANDOVER_DEVICES_ITEM_SKIPPED';
  reason: 'missing_name' | 'invalid_shape';
  item?: unknown;
}) => {
  console.warn('[HNDV][WARN][DEVICES_ITEM_SKIPPED]', payload);
};

const warnCompositionSectionOmitted = (section: 'exams' | 'procedures') => {
  void section;
};

const normalizeExamInputs = (values: { exams?: unknown; examsPending?: unknown }): NormalizedExamInput => {
  const items: Array<ExamItem | unknown> = [];
  const legacyFields = new Set<string>();
  let legacyCount = 0;

  const pushLegacyStrings = (input: unknown, state: ExamItem['state'], field: string) => {
    if (input === undefined || input === null) return;
    legacyFields.add(field);
    const list = Array.isArray(input) ? input : [input];
    list.forEach((entry) => {
      if (typeof entry !== 'string') return;
      const trimmed = entry.trim();
      if (!trimmed) return;
      items.push({ type: 'other', state, description: trimmed });
      legacyCount += 1;
    });
  };

  if (Array.isArray(values.exams)) {
    values.exams.forEach((entry) => {
      if (typeof entry === 'string') {
        legacyFields.add('exams');
        const trimmed = entry.trim();
        if (trimmed) {
          items.push({ type: 'other', state: 'result', description: trimmed });
          legacyCount += 1;
        }
        return;
      }
      items.push(entry);
    });
  } else if (values.exams && typeof values.exams === 'object') {
    items.push(values.exams as ExamItem);
  } else {
    pushLegacyStrings(values.exams, 'result', 'exams');
  }

  pushLegacyStrings((values as { examsPending?: unknown }).examsPending, 'pending', 'examsPending');

  return { items, legacyFields: Array.from(legacyFields), legacyCount, inputCount: items.length };
};

const isExamType = (value: unknown): value is ExamItem['type'] =>
  value === 'laboratory' || value === 'imaging' || value === 'other';

const isExamState = (value: unknown): value is ExamItem['state'] =>
  value === 'result' || value === 'pending';

const TREATMENT_TYPE_LABELS: Record<TreatmentItem['type'], string> = {
  woundCare: 'Curación de heridas',
  respiratory: 'Respiratorio',
  mobilization: 'Movilización',
  education: 'Educación',
  other: 'Otro',
};

const OBSERVATION_CATEGORY_SYSTEM = 'http://terminology.hl7.org/CodeSystem/observation-category';

export function mapTreatments(
  values: TreatmentValues,
  _options?: BuildOptions,
): Procedure[] {
  if (!values.treatments || values.treatments.length === 0) return [];
  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);

  return values.treatments.map((treatment) => {
    const status: Procedure['status'] = treatment.done ? 'completed' : 'in-progress';
    const display = TREATMENT_TYPE_LABELS[treatment.type];
    const procedure: Procedure = {
      resourceType: 'Procedure',
      identifier: [{ system: 'urn:handover-pro:treatment-item', value: treatment.id }],
      status,
      code: {
        coding: [
          {
            system: TERMINOLOGY_SYSTEMS.HANDOVER_TREATMENT_TYPE,
            code: treatment.type,
            display,
          },
        ],
        text: display,
      },
      subject,
      encounter,
      note: treatment.description ? [{ text: treatment.description }] : undefined,
    };

    if (treatment.done && treatment.scheduledAt) {
      procedure.performedDateTime = treatment.scheduledAt;
    } else if (treatment.scheduledAt) {
      procedure.performedPeriod = { start: treatment.scheduledAt };
    }

    return procedure;
  });
}

export function mapExamObservations(
  values: CareValues & { exams?: ExamItem[]; examsPending?: unknown },
  options?: BuildOptions,
  normalizedInput?: NormalizedExamInput,
): Observation[] {
  const normalizedExams = normalizedInput ?? normalizeExamInputs(values);

  if (normalizedExams.inputCount === 0) return [];
  const optionsMerged = resolveOptions(options);
  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);
  const effectiveDateTime = optionsMerged.now();

  const categoryByType: Record<ExamItem['type'], CodeableConcept | undefined> = {
    laboratory: {
      coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: 'laboratory', display: 'Laboratory' }],
      text: 'Laboratory',
    },
    imaging: {
      coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: 'imaging', display: 'Imaging' }],
      text: 'Imaging',
    },
    other: {
      coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: 'survey', display: 'Survey' }],
      text: 'Survey',
    },
  };

  const statusByState: Record<ExamItem['state'], Observation['status']> = {
    result: 'final',
    pending: 'registered',
  };
const EXAM_CODE_SYSTEM = 'https://handover.app/fhir/CodeSystem/handover-exam';
  const codeByType: Record<ExamItem['type'], CodeableConcept> = {
    laboratory: { coding: [{ system: EXAM_CODE_SYSTEM, code: 'lab' }], text: 'Laboratory result' },
    imaging: { coding: [{ system: EXAM_CODE_SYSTEM, code: 'imaging' }], text: 'Imaging result' },
    other: { coding: [{ system: EXAM_CODE_SYSTEM, code: 'other' }], text: 'Diagnostic result' },
  };
  return normalizedExams.items.flatMap((exam) => {
    const descriptionRaw = (exam as ExamItem | Record<string, unknown>)?.description;
    const description =
      typeof descriptionRaw === 'string' ? descriptionRaw.trim() : typeof descriptionRaw === 'number' ? String(descriptionRaw) : '';
    const len = typeof descriptionRaw === 'string' ? description.length : undefined;
    const examType = (exam as ExamItem | Record<string, unknown>)?.type as ExamItem['type'] | undefined;
    const examState = (exam as ExamItem | Record<string, unknown>)?.state as ExamItem['state'] | undefined;

    if (!exam || typeof exam !== 'object' || examType === undefined || examState === undefined) {
      warnExamsItemSkipped({
        code: 'HANDOVER_EXAMS_ITEM_SKIPPED',
        reason: 'invalid_shape',
        examType: typeof examType === 'string' ? examType : undefined,
        examState: typeof examState === 'string' ? examState : undefined,
        len,
      });
      return [];
    }

    if (!description) {
      warnExamsItemSkipped({
        code: 'HANDOVER_EXAMS_ITEM_SKIPPED',
        reason: 'empty_description',
        examType: typeof examType === 'string' ? examType : undefined,
        examState: typeof examState === 'string' ? examState : undefined,
        len: len ?? 0,
      });
      return [];
    }

    if (!isExamType(examType)) {
      warnExamsItemSkipped({
        code: 'HANDOVER_EXAMS_ITEM_SKIPPED',
        reason: 'unknown_type',
        examType: typeof examType === 'string' ? examType : undefined,
        examState: typeof examState === 'string' ? examState : undefined,
        len,
      });
      return [];
    }

    if (!isExamState(examState)) {
      warnExamsItemSkipped({
        code: 'HANDOVER_EXAMS_ITEM_SKIPPED',
        reason: 'unknown_state',
        examType,
        examState: typeof examState === 'string' ? examState : undefined,
        len,
      });
      return [];
    }

    return [
      {
        resourceType: 'Observation',
        status: statusByState[examState],
        category: categoryByType[examType] ? [categoryByType[examType] as CodeableConcept] : [],
        code: codeByType[examType],
        valueString: description,
        subject,
        encounter,
        effectiveDateTime,
      },
    ];
  });
}

export function mapProcedures(
  values: CareValues & { procedures?: ProcedureItem[] },
  options?: BuildOptions,
): Procedure[] {
  const procedures = Array.isArray(values.procedures)
    ? values.procedures
    : values.procedures !== undefined && values.procedures !== null
      ? ([values.procedures] as Array<ProcedureItem | unknown>)
      : [];
  if (procedures.length === 0) return [];
  const optionsMerged = resolveOptions(options);
  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);
  const performedDateTime = optionsMerged.now();

  return procedures.flatMap((procedure) => {
    if (!procedure || typeof procedure !== 'object') {
      warnProceduresItemSkipped({
        code: 'HANDOVER_PROCEDURES_ITEM_SKIPPED',
        reason: 'invalid_shape',
        done: undefined,
      });
      return [];
    }

    const descriptionRaw = (procedure as ProcedureItem | Record<string, unknown>).description;
    const description =
      typeof descriptionRaw === 'string' ? descriptionRaw.trim() : typeof descriptionRaw === 'number' ? String(descriptionRaw) : '';
    const len = typeof descriptionRaw === 'string' ? description.length : undefined;
    const doneRaw = (procedure as ProcedureItem | Record<string, unknown>).done;

    if (doneRaw !== undefined && typeof doneRaw !== 'boolean') {
      warnProceduresItemSkipped({
        code: 'HANDOVER_PROCEDURES_ITEM_SKIPPED',
        reason: 'invalid_shape',
        done: undefined,
        len,
      });
      return [];
    }

    if (!description) {
      warnProceduresItemSkipped({
        code: 'HANDOVER_PROCEDURES_ITEM_SKIPPED',
        reason: 'empty_description',
        done: typeof doneRaw === 'boolean' ? doneRaw : undefined,
        len: len ?? 0,
      });
      return [];
    }

    const done = doneRaw === true;
    return [
      {
        resourceType: 'Procedure',
        status: done ? 'completed' : 'preparation',
        code: {
          coding: [
            {
              system: 'urn:handover-pro:procedure',
              code: done ? 'completed' : 'planned',
              display: 'Procedure',
            },
          ],
          text: description,
        },
        subject,
        encounter,
        performedDateTime: done ? performedDateTime : undefined,
      },
    ];
  });
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
    valueQuantity: {
      value: glasgow.total,
      unit: 'score',
    },
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

function mapDocumentReferenceAttachments(
  values: DocumentValues,
  options?: BuildOptions,
): DocumentReference[] {
  const attachments = values.attachments ?? [];
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  const optionsMerged = resolveOptions(options);
  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);
  const authorRef = ensureAuthorReference(values);

  return attachments.map((input) => {
    assertAttachmentData(input);
    const contentType = resolveAttachmentContentType(input);
    const attachment: Attachment = {
      contentType,
      data: input.data,
      title: input.name,
    };

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
              display: 'Attachment',
            },
          ],
          text: 'Attachment',
        },
      ],
    };
  });
}

function mapAdministrativeObservation(
  values: CompositionValues,
  context: MappingContext,
): Observation | null {
  if (!values.administrativeData) return null;
  return {
    resourceType: 'Observation',
    status: 'final',
    category: [surveyCategoryConcept],
    code: codeableConceptFromCode(HANDOVER_OBSERVATION_CODES.administrative),
    subject: context.subject,
    encounter: context.encounter,
    effectiveDateTime: context.effectiveDateTime,
    issued: context.effectiveDateTime,
    valueString: administrativeSummaryText(values.administrativeData),
  };
}

function mapSbarObservations(
  values: CompositionValues,
  context: MappingContext,
): Observation[] {
  const sbar = values.sbar;
  if (!sbar) return [];

  const components: ObservationComponent[] = [];
const addComponent = (code: string, display: string, value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return;

  components.push({
    code: {
      coding: [
        {
          system: 'urn:handover-pro:sbar' as TerminologySystem,
          code,
          display,
        },
      ],
      text: display,
    },
    valueString: trimmed,
  });
};

  addComponent('situation', 'Situation', sbar.situation);
  addComponent('background', 'Background', sbar.background);
  addComponent('assessment', 'Assessment', sbar.assessment);
  addComponent('recommendation', 'Recommendation', sbar.recommendation);

  if (components.length === 0) return [];

  return [
    {
      resourceType: 'Observation',
      status: 'final',
      category: [surveyCategoryConcept],
      code: codeableConceptFromCode(HANDOVER_OBSERVATION_CODES.sbar),
      subject: context.subject,
      encounter: context.encounter,
      effectiveDateTime: context.effectiveDateTime,
      issued: context.effectiveDateTime,
      component: components,
    },
  ];
}

function mapBedsideChecklistObservation(
  checklist: HandoverBedsideChecklist,
  context: MappingContext,
): Observation | null {
  if (!checklist) return null;

  const components: ObservationComponent[] = [];
  const notes: Annotation[] = [];

  Object.entries(checklist).forEach(([key, value]) => {
    if (key === 'bedsideNotes' && typeof value === 'string' && value.trim()) {
      notes.push({ text: value.trim() });
      return;
    }

    if (typeof value === 'boolean') {
      components.push({
        code: {
          coding: [
            {
              system: 'urn:handover-pro:bedside-checklist' as TerminologySystem,
              code: key,
              display: key,
            },
          ],
          text: key,
        },
        valueCodeableConcept: {
          coding: [
            {
              system: 'urn:handover-pro:boolean' as TerminologySystem,
              code: value ? 'yes' : 'no',
              display: value ? 'Yes' : 'No',
            },
          ],
          text: value ? 'Yes' : 'No',
        },
      });
    }
  }); 

  if (components.length === 0 && notes.length === 0) return null;

  return {
    resourceType: 'Observation',
    status: 'final',
    category: [surveyCategoryConcept],
    code: codeableConceptFromCode(HANDOVER_OBSERVATION_CODES.bedsideChecklist),
    subject: context.subject,
    encounter: context.encounter,
    effectiveDateTime: context.effectiveDateTime,
    issued: context.effectiveDateTime,
    component: components.length > 0 ? components : undefined,
    note: notes.length > 0 ? notes : undefined,
  };
}


function mapSummaryObservation(
  summary: string | null | undefined,
  context: MappingContext,
): Observation | null {
  const trimmed = summary?.trim();
  if (!trimmed) return null;

  return {
    resourceType: 'Observation',
    status: 'final',
    category: [surveyCategoryConcept],
    code: codeableConceptFromCode(HANDOVER_OBSERVATION_CODES.notes),
    subject: context.subject,
    encounter: context.encounter,
    effectiveDateTime: context.effectiveDateTime,
    issued: context.effectiveDateTime,
    valueString: trimmed,
  };
}

function mapPsychosocialObservation(
  psychosocial: PsychosocialCare | undefined,
  context: MappingContext,
): Observation | null {
  if (!psychosocial) return null;

  const emotionalStatus = psychosocial.emotionalStatus?.trim() || 'Sin novedad';
  const familyVisits = psychosocial.familyVisits ? 'Sí' : 'No';
  const familyNotes = psychosocial.familyNotes?.trim();
  const notes = familyNotes ? ` (${familyNotes})` : '';
  const narrative = `Estado emocional: ${emotionalStatus}. Visitas familiares: ${familyVisits}${notes}.`;

  return {
    resourceType: 'Observation',
    status: 'final',
    category: [surveyCategoryConcept],
    code: codeableConceptFromCode(HANDOVER_OBSERVATION_CODES.notes, 'Psychosocial notes'),
    subject: context.subject,
    encounter: context.encounter,
    effectiveDateTime: context.effectiveDateTime,
    issued: context.effectiveDateTime,
    valueString: narrative,
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
  const attesters = [
    ...(values.composition?.attesters ?? []),
    ...attestersFromSignatures(values.signatures),
  ];

  if (refs.administrative.length > 0) {
    sections.push({
      title: 'Administrative',
      code: codeableConceptFromCode(COMPOSITION_SECTION_CODES.administrative, 'Administrative'),
      entry: refs.administrative.map((reference) => ({ reference })),
    });
  }

  if (refs.vitals.length > 0) {
    sections.push({
      title: 'Vital signs',
      code: codeableConceptFromCode(COMPOSITION_SECTION_CODES.vitals, 'Vital signs'),
      entry: refs.vitals.map((reference) => ({ reference })),
    });
  }

  if (refs.care.length > 0) {
    sections.push({
      title: 'Care / Treatments',
      code: codeableConceptFromCode(COMPOSITION_SECTION_CODES.care, 'Care / Treatments'),
      entry: refs.care.map((reference) => ({ reference })),
    });
  }

  if (refs.sbar.length > 0) {
    sections.push({
      title: 'SBAR',
      code: codeableConceptFromCode(COMPOSITION_SECTION_CODES.sbar, 'SBAR'),
      entry: refs.sbar.map((reference) => ({ reference })),
    });
  }

  if (refs.bedsideChecklist.length > 0) {
    sections.push({
      title: 'Bedside checklist',
      code: codeableConceptFromCode(COMPOSITION_SECTION_CODES.bedsideChecklist, 'Bedside checklist'),
      entry: refs.bedsideChecklist.map((reference) => ({ reference })),
    });
  }

  if (refs.notes.length > 0) {
    sections.push({
      title: 'Notes / Summary',
      code: codeableConceptFromCode(COMPOSITION_SECTION_CODES.notes, 'Notes / Summary'),
      entry: refs.notes.map((reference) => ({ reference })),
    });
  }

  if (refs.medications.length > 0) {
    sections.push({
      title: 'Medications',
      code: compositionSectionConcept('medications', 'Medications'),
      entry: refs.medications.map((reference) => ({ reference })),
    });
  }

  if (refs.treatments.length > 0) {
    sections.push({
      title: 'Tratamientos no farmacológicos',
      code: compositionSectionConcept('treatments', 'Non-pharmacological treatments'),
      entry: refs.treatments.map((reference) => ({ reference })),
    });
  }

  if (refs.exams.length > 0) {
    sections.push({
      title: 'Exámenes',
      code: compositionSectionConcept('exams', 'Exámenes'),
      entry: refs.exams.map((reference) => ({ reference })),
    });
  } else if ((values.sectionSources?.exams ?? 0) > 0) {
    warnCompositionSectionOmitted('exams');
  }

  if (refs.procedures.length > 0) {
    sections.push({
      title: 'Procedimientos',
      code: compositionSectionConcept('procedures', 'Procedimientos'),
      entry: refs.procedures.map((reference) => ({ reference })),
    });
  } else if ((values.sectionSources?.procedures ?? 0) > 0) {
    warnCompositionSectionOmitted('procedures');
  }

  if (refs.oxygen.length > 0) {
    sections.push({
      title: 'Oxygen therapy',
      code: compositionSectionConcept('oxygen', 'Oxygen therapy'),
      entry: refs.oxygen.map((reference) => ({ reference })),
    });
  }

  if (refs.devices.length > 0) {
    sections.push({
      title: 'Devices',
      code: compositionSectionConcept('devices', 'Devices'),
      entry: refs.devices.map((reference) => ({ reference })),
    });
  }

  if (refs.nutrition.length > 0) {
    sections.push({
      title: 'Nutrition',
      code: compositionSectionConcept('nutrition', 'Nutrition'),
      entry: refs.nutrition.map((reference) => ({ reference })),
    });
  }

  if (refs.elimination.length > 0) {
    sections.push({
      title: 'Elimination',
      code: compositionSectionConcept('elimination', 'Elimination'),
      entry: refs.elimination.map((reference) => ({ reference })),
    });
  }

  if (refs.mobilitySkin.length > 0) {
    sections.push({
      title: 'Mobility and Skin',
      code: compositionSectionConcept('mobility-skin', 'Mobility and Skin'),
      entry: refs.mobilitySkin.map((reference) => ({ reference })),
    });
  }

  if (refs.risks.length > 0) {
    sections.push({
      title: 'Risks',
      code: compositionSectionConcept('risks', 'Risks'),
      entry: refs.risks.map((reference) => ({ reference })),
    });
  }

  if (refs.detectedIssues && refs.detectedIssues.length > 0) {
    sections.push({
      title: 'Detected issues',
      code: compositionSectionConcept('detected-issues', 'Detected issues'),
      entry: refs.detectedIssues.map((reference) => ({ reference })),
    });
  }

  if (refs.diagnoses && refs.diagnoses.length > 0) {
    sections.push({
      title: 'Diagnoses',
      code: compositionSectionConcept('diagnoses', 'Diagnoses'),
      entry: refs.diagnoses.map((reference) => ({ reference })),
    });
  }

  if (refs.fluidBalance.length > 0) {
    sections.push({
      title: 'Fluid balance',
      code: compositionSectionConcept('fluid-balance', 'Fluid balance'),
      entry: refs.fluidBalance.map((reference) => ({ reference })),
    });
  }

  if (refs.pain.length > 0) {
    sections.push({
      title: 'Pain assessment',
      code: compositionSectionConcept('pain', 'Pain assessment'),
      entry: refs.pain.map((reference) => ({ reference })),
    });
  }

  if (refs.braden.length > 0) {
    sections.push({
      title: 'Braden scale',
      code: compositionSectionConcept('braden', 'Braden scale'),
      entry: refs.braden.map((reference) => ({ reference })),
    });
  }

  if (refs.glasgow.length > 0) {
    sections.push({
      title: 'Glasgow scale',
      code: compositionSectionConcept('glasgow', 'Glasgow scale'),
      entry: refs.glasgow.map((reference) => ({ reference })),
    });
  }

  if (refs.attachments.length > 0) {
    sections.push({
      title: 'Attachments',
      code: compositionSectionConcept('attachments', 'Attachments'),
      entry: refs.attachments.map((reference) => ({ reference })),
    });
  }

  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);
  const shiftPeriod =
    values.administrativeData?.shiftStart && values.administrativeData?.shiftEnd
      ? {
          start: values.administrativeData.shiftStart,
          end: values.administrativeData.shiftEnd,
        }
      : undefined;

  return {
    resourceType: 'Composition',
    status,
    type,
    subject: ensureSubjectReference(values),
    encounter: ensureEncounterReference(values),
    author: [authorRef],
    title,
    date: values.composition?.date ?? optionsMerged.effectiveDateTime,
    section: sections.length > 0 ? sections : undefined,
    attester: attesters.length > 0 ? attesters : undefined,
  };
}

export function buildHandoverBundle(
  input: HandoverInput,
  options?: BuildOptions,
): Bundle {
  const values = 'values' in input ? input.values : input;
  const optionsMerged: ResolvedBuildOptions = resolveOptions(options);
  const nowIso = optionsMerged.now();
  const sharedOptions: BuildOptions = { ...optionsMerged, now: () => nowIso };
  const applyProfiles = <T extends FhirResource>(resource: T) =>
    applyProfileUrls(resource, optionsMerged);
  const normalizedPatientId = normalizePatientId(values.patientId);

  const patient: Patient = {
    resourceType: 'Patient',
    id: normalizedPatientId,
    identifier: [{ system: 'urn:handover-pro:patient-id', value: normalizedPatientId }],
  };

  const { resource: patientWithId, fullUrl: patientFullUrl } = assignStableIds(
    applyProfiles(patient),
    normalizedPatientId,
  );
  const patientSubjectReference: Reference = {
    reference: `Patient/${patientWithId.id ?? normalizedPatientId}`,
    type: 'Patient',
    identifier: { system: 'urn:handover-pro:patient-id', value: normalizedPatientId },
  };
  const practitionerId =
    resolveReferenceId(values.author?.reference, 'Practitioner') ?? values.author?.id ?? 'handover-app';
  const practitioner: Practitioner = {
    resourceType: 'Practitioner',
    id: practitionerId,
    identifier: [{ system: 'urn:handover-pro:practitioner-id', value: practitionerId }],
    name: [{ text: values.author?.display ?? 'Handover Practitioner' }],
  };
  const encounterId = normalizeId(values.encounterId, fhirId('enc-', normalizedPatientId));
  const encounterPeriod =
    values.administrativeData?.shiftStart && values.administrativeData?.shiftEnd
      ? {
          start: values.administrativeData.shiftStart,
          end: values.administrativeData.shiftEnd,
        }
      : undefined;
  const encounter: Encounter | undefined = encounterId
    ? {
        resourceType: 'Encounter',
        id: encounterId,
        status: 'finished',
        class: {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: 'IMP',
          display: 'inpatient encounter',
        },
        subject: patientSubjectReference,
        period: encounterPeriod,
      }
    : undefined;

  const mappingContext: MappingContext = {
    subject: patientSubjectReference,
    encounter: encounterId
      ? {
          reference: `Encounter/${encounterId}`,
          type: 'Encounter',
          identifier: { system: 'urn:handover-pro:encounter-id', value: encounterId },
        }
      : undefined,
    effectiveDateTime: nowIso,
  };

  const diagnoses = mapDiagnoses(values as HandoverData, mappingContext);
  const detectedIssues = mapDetectedIssuesFromRisks(values.risksStructured, mappingContext);
  const administrativeObservation = mapAdministrativeObservation(
    { administrativeData: values.administrativeData } as CompositionValues,
    mappingContext,
  );
  const sbarObservations = mapSbarObservations(
    { sbar: values.sbar } as CompositionValues,
    mappingContext,
  );
  const bedsideChecklistObservation = mapBedsideChecklistObservation(
    values.bedsideChecklist,
    mappingContext,
  );
  const summaryObservation = mapSummaryObservation(values.closingSummary, mappingContext);
  const psychosocialObservation = mapPsychosocialObservation(values.psychosocial, mappingContext);

  const normalizedVitals = values.vitals
    ? (() => {
        const rawVitals = values.vitals as VitalsValues & {
          temp?: unknown;
          avcpu?: ObservationVitalsInput['avpu'];
          acvpu?: ObservationVitalsInput['avpu'];
          bgMgDl?: unknown;
          bgMmolL?: unknown;
        };

        const normalizeNumeric = (value: unknown): number | undefined => {
          if (value === undefined || value === null) return undefined;
          if (typeof value === 'string') {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : undefined;
          }
          return Number.isFinite(value as number) ? Number(value) : undefined;
        };

        const tempValue = normalizeNumeric(rawVitals.tempC) ?? normalizeNumeric(rawVitals.temp);

        const glucoseMgDl = normalizeNumeric(rawVitals.glucoseMgDl) ?? normalizeNumeric(rawVitals.bgMgDl);
        const glucoseMmolL = normalizeNumeric(rawVitals.glucoseMmolL) ?? normalizeNumeric(rawVitals.bgMmolL);

        const vitals: Record<string, unknown> = {
          ...rawVitals,
          hr: normalizeNumeric(rawVitals.hr),
          rr: normalizeNumeric(rawVitals.rr),
          spo2: normalizeNumeric(rawVitals.spo2),
          sbp: normalizeNumeric(rawVitals.sbp),
          dbp: normalizeNumeric(rawVitals.dbp),
          tempC: tempValue,
          temp: tempValue,
          avpu: rawVitals.avpu ?? rawVitals.avcpu ?? rawVitals.acvpu,
          glucoseMgDl,
          glucoseMmolL,
        };

        // 🔑 eliminar keys undefined para no provocar Number(undefined)=>NaN
        for (const k of Object.keys(vitals)) {
          const value = vitals[k];
          if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
            delete vitals[k];
          }
        }

        return vitals as typeof rawVitals;
      })()
    : undefined;

  const useIndividuals = Boolean(optionsMerged.emitIndividuals);
  const vitalObservations = normalizedVitals
    ? (useIndividuals
        ? mapVitalsToObservations(
            {
              patientId: values.patientId,
              encounterId,
              vitals: normalizedVitals,
            },
            sharedOptions,
          )
        : mapObservationVitals(
            {
              patientId: values.patientId,
              encounterId,
              ...(normalizedVitals as VitalsValues),
            },
            sharedOptions,
          )
      ).map((observation) => replaceSubjectReference(observation, patientSubjectReference))
    : [];

  if (!useIndividuals && normalizedVitals) {
    const normalizedRecordedAt = normalizeIsoDateTimeValue(normalizedVitals.recordedAt);
    const normalizedIssuedAt = normalizeIsoDateTimeValue(normalizedVitals.issuedAt);
    const effective = normalizedRecordedAt ?? nowIso;
    const issued = normalizedIssuedAt ?? effective;
    if (normalizedVitals.sbp !== undefined) {
      vitalObservations.push(
        replaceSubjectReference(
          {
            resourceType: 'Observation',
            meta: { profile: [PROFILE_VITAL_SIGNS] },
            status: 'final',
            category: [vitalCategoryConcept],
            code: codeableConceptFromCode(FHIR_CODES.VITALS.BP_SYSTOLIC),
            subject: patientReference(values.patientId),
            encounter: mappingContext.encounter,
            effectiveDateTime: effective,
            issued,
            valueQuantity: quantity(normalizedVitals.sbp, 'mm[Hg]', 'mm[Hg]'),
          },
          patientSubjectReference,
        ),
      );
    }
    if (normalizedVitals.dbp !== undefined) {
      vitalObservations.push(
        replaceSubjectReference(
          {
            resourceType: 'Observation',
            meta: { profile: [PROFILE_VITAL_SIGNS] },
            status: 'final',
            category: [vitalCategoryConcept],
            code: codeableConceptFromCode(FHIR_CODES.VITALS.BP_DIASTOLIC),
            subject: patientReference(values.patientId),
            encounter: mappingContext.encounter,
            effectiveDateTime: effective,
            issued,
            valueQuantity: quantity(normalizedVitals.dbp, 'mm[Hg]', 'mm[Hg]'),
          },
          patientSubjectReference,
        ),
      );
    }
  }

  const oxygenObservations = mapOxygenObservations(
    {
      patientId: values.patientId,
      encounterId,
      oxygenTherapy: values.oxygenTherapy,
    },
    sharedOptions,
  ).map((observation) => replaceSubjectReference(observation, patientSubjectReference));

  const nutritionObservations = mapNutritionCare(
    { patientId: values.patientId, encounterId, nutrition: values.nutrition },
    sharedOptions,
  ).map((observation) => replaceSubjectReference(observation, patientSubjectReference));

  const eliminationObservations = mapEliminationCare(
    { patientId: values.patientId, encounterId, elimination: values.elimination },
    sharedOptions,
  ).map((observation) => replaceSubjectReference(observation, patientSubjectReference));

  const mobilitySkinObservations = mapMobilitySkinCare(
    {
      patientId: values.patientId,
      encounterId,
      mobility: values.mobility,
      skin: values.skin,
    },
    sharedOptions,
  ).map((observation) => replaceSubjectReference(observation, patientSubjectReference));

  const fluidBalanceObservations = mapFluidBalanceCare(
    { patientId: values.patientId, encounterId, fluidBalance: values.fluidBalance },
    sharedOptions,
  ).map((observation) => replaceSubjectReference(observation, patientSubjectReference));

  const normalizedExams = normalizeExamInputs({
    exams: values.exams,
    examsPending: (values as { examsPending?: unknown }).examsPending,
  });
  const examInputCount = normalizedExams.inputCount;
  const procedureInputCount = Array.isArray(values.procedures)
    ? values.procedures.length
    : values.procedures
      ? 1
      : 0;

  const examObservations = mapExamObservations(
    {
      patientId: values.patientId,
      encounterId,
      exams: values.exams,
      examsPending: (values as { examsPending?: unknown }).examsPending,
    },
    sharedOptions,
    normalizedExams,
  ).map((observation) => replaceSubjectReference(observation, patientSubjectReference));

  const procedureResources = mapProcedures(
    { patientId: values.patientId, encounterId, procedures: values.procedures },
    sharedOptions,
  ).map((procedure) => replaceSubjectReference(procedure, patientSubjectReference));

  const evaObservation = mapEvaObservation(values.painAssessment, mappingContext);
  const bradenObservation = mapBradenObservation(values.braden, mappingContext);
  const glasgowObservation = mapGlasgowObservation(values.glasgow, mappingContext);
  const riskConditions = mapRiskConditions(values.risks, mappingContext);

  const medications = mapMedicationStatements(
    {
      patientId: values.patientId,
      encounterId,
      medications: values.medications,
      meds: values.meds,
    },
    sharedOptions,
  ).map((medication) => replaceSubjectReference(medication, patientSubjectReference));

  const treatmentProcedures = mapTreatments(
    { patientId: values.patientId, encounterId, treatments: values.treatments },
    sharedOptions,
  ).map((procedure) => replaceSubjectReference(procedure, patientSubjectReference));

  const oxygenResources = mapDeviceUse(
    {
      patientId: values.patientId,
      encounterId,
      oxygenTherapy: values.oxygenTherapy,
    },
    sharedOptions,
  ).map((resource) => replaceSubjectReference(resource, patientSubjectReference));

  const deviceResources = mapDevices(
    {
      patientId: values.patientId,
      encounterId,
      devices: values.devices,
    },
    sharedOptions,
  ).map((resource) => {
    if (resource.resourceType === 'DeviceUseStatement') {
      return replaceSubjectReference(resource, patientSubjectReference);
    }
    if (resource.resourceType === 'Device') {
      return { ...resource, patient: patientSubjectReference };
    }
    return resource;
  });

  const document = mapDocumentReferenceAudio(
    {
      patientId: values.patientId,
      encounterId,
      author: values.author,
      audioAttachment: values.audioAttachment,
    },
    sharedOptions,
  );
  const attachmentDocuments = mapDocumentReferenceAttachments(
    {
      patientId: values.patientId,
      encounterId,
      author: values.author,
      attachments: values.attachments ?? [],
    },
    sharedOptions,
  ).map((doc) => replaceSubjectReference(doc, patientSubjectReference));
  const documentWithPatientReference = document
    ? replaceSubjectReference(document, patientSubjectReference)
    : undefined;

  const patientEntry: BundleEntry = {
    fullUrl: patientFullUrl,
    resource: patientWithId,
    request: { method: 'POST', url: 'Patient' },
  };
  const practitionerEntry: BundleEntry = createTransactionEntry(
    applyProfiles(practitioner),
    practitioner.id,
  ) as BundleEntry;
  const signaturePractitionerIds = new Set(
    [values.signatures?.outgoing?.userId, values.signatures?.incoming?.userId].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ),
  );
  signaturePractitionerIds.delete(practitionerId);
  const extraPractitionerEntries = Array.from(signaturePractitionerIds).map((id) =>
    createTransactionEntry(
      applyProfiles({
        resourceType: 'Practitioner',
        id,
        identifier: [{ system: 'urn:handover-pro:practitioner-id', value: id }],
        name: [{ text: id }],
      }),
      id,
    ) as BundleEntry,
  );
  const encounterEntry: BundleEntry | undefined = encounter
    ? (createTransactionEntry(applyProfiles(encounter), encounter.id) as BundleEntry)
    : undefined;
  const resourceEntries: BundleEntry[] = [];
  const vitalObservationByCode = new Map<string, Observation>();
  const vitalReferenceByCode = new Map<string, string>();
  const vitalsRefs: string[] = [];
  const medicationRefs: string[] = [];
  const treatmentRefs: string[] = [];
  const oxygenRefs: string[] = [];
  const deviceRefs: string[] = [];
  const attachmentRefs: string[] = [];
  const administrativeRefs: string[] = [];
  const careRefs: string[] = [];
  const sbarRefs: string[] = [];
  const bedsideChecklistRefs: string[] = [];
  const notesRefs: string[] = [];
  const nutritionRefs: string[] = [];
  const eliminationRefs: string[] = [];
  const mobilitySkinRefs: string[] = [];
  const fluidBalanceRefs: string[] = [];
  const painRefs: string[] = [];
  const bradenRefs: string[] = [];
  const glasgowRefs: string[] = [];
  const examRefs: string[] = [];
  const procedureRefs: string[] = [];
  const riskRefs: string[] = [];
  const issueRefs: string[] = [];
  const diagnosisRefs: string[] = [];

  const pushObservationEntry = (
    observation: Observation | null | undefined,
    refBucket: string[],
  ) => {
    if (!observation) return;
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(observation),
      values.patientId,
    );
    resourceEntries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Observation' },
    });
    refBucket.push(referenceStringFromResource(resource));
  };

  pushObservationEntry(administrativeObservation, administrativeRefs);
  sbarObservations.forEach((observation) => pushObservationEntry(observation, sbarRefs));
  pushObservationEntry(bedsideChecklistObservation, bedsideChecklistRefs);
  pushObservationEntry(summaryObservation, notesRefs);
  pushObservationEntry(psychosocialObservation, careRefs);

  vitalObservations.forEach((observation) => {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(observation),
      values.patientId,
    );
    resourceEntries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Observation' },
    });
    vitalsRefs.push(referenceStringFromResource(resource));
    const loincCode = resource.code?.coding?.find(
      (coding) => coding.system === TERMINOLOGY_SYSTEMS.LOINC,
    )?.code;
    if (loincCode) {
      vitalObservationByCode.set(loincCode, resource);
      vitalReferenceByCode.set(loincCode, referenceStringFromResource(resource));
    }
  });

  if (optionsMerged.emitHasMember) {
    const bpPanelResource = vitalObservationByCode.get(FHIR_CODES.VITALS.BP_PANEL.code);
    if (bpPanelResource) {
      const bpMembers: Reference[] = [];
      const addBpMember = (code: string) => {
        const ref = vitalReferenceByCode.get(code);
        if (ref) {
          bpMembers.push({ reference: ref });
        }
      };
      addBpMember(FHIR_CODES.VITALS.BP_SYSTOLIC.code);
      addBpMember(FHIR_CODES.VITALS.BP_DIASTOLIC.code);
      if (bpMembers.length > 0) {
        bpPanelResource.hasMember = bpMembers;
      }
    }
  }

  const shouldEmitVitalsPanel = Boolean(optionsMerged.emitPanel) && !useIndividuals && normalizedVitals;
  if (shouldEmitVitalsPanel && normalizedVitals) {
    const components: ObservationComponent[] = [];
    const addComponent = (
      code: TerminologyCode<string>,
      value: number | undefined,
      unit: string,
      ucumCode: string,
    ) => {
      if (value === undefined) return;
      components.push({
        code: codeableConceptFromCode(code),
        valueQuantity: quantity(value, unit, ucumCode),
      });
    };

    addComponent(FHIR_CODES.VITALS.HEART_RATE, normalizedVitals.hr, '/min', '/min');
    addComponent(FHIR_CODES.VITALS.RESP_RATE, normalizedVitals.rr, '/min', '/min');
    addComponent(FHIR_CODES.VITALS.TEMPERATURE, normalizedVitals.tempC, '°C', 'Cel');
    addComponent(FHIR_CODES.VITALS.SPO2, normalizedVitals.spo2, '%', '%');
    addComponent(FHIR_CODES.VITALS.BP_SYSTOLIC, normalizedVitals.sbp, 'mm[Hg]', 'mm[Hg]');
    addComponent(FHIR_CODES.VITALS.BP_DIASTOLIC, normalizedVitals.dbp, 'mm[Hg]', 'mm[Hg]');

    if (components.length > 0) {
      const panel: Observation = {
        resourceType: 'Observation',
        meta: { profile: [PROFILE_VITAL_SIGNS] },
        status: 'final',
        category: [vitalCategoryConcept],
        code: codeableConceptFromCode(FHIR_CODES.VITALS.VITAL_SIGNS_PANEL, 'Vital signs'),
        subject: patientSubjectReference,
        encounter: mappingContext.encounter,
        effectiveDateTime: nowIso,
        issued: nowIso,
        component: components,
      };

      if (optionsMerged.emitHasMember) {
        const members: Reference[] = [];
        const addMemberByCode = (code: string) => {
          const ref = vitalReferenceByCode.get(code);
          if (ref) {
            members.push({ reference: ref });
          }
        };
        addMemberByCode(FHIR_CODES.VITALS.HEART_RATE.code);
        addMemberByCode(FHIR_CODES.VITALS.RESP_RATE.code);
        addMemberByCode(FHIR_CODES.VITALS.TEMPERATURE.code);
        addMemberByCode(FHIR_CODES.VITALS.SPO2.code);
        addMemberByCode(FHIR_CODES.VITALS.BP_SYSTOLIC.code);
        addMemberByCode(FHIR_CODES.VITALS.BP_DIASTOLIC.code);
        addMemberByCode(FHIR_CODES.VITALS.GLUCOSE_MASS_BLD.code);
        addMemberByCode(FHIR_CODES.VITALS.GLUCOSE_MOLES_BLD.code);
        addMemberByCode(FHIR_CODES.VITALS.ACVPU.code);
        if (members.length > 0) {
          panel.hasMember = members;
        }
      }

      const { resource, fullUrl } = assignStableIds(applyProfiles(panel), values.patientId);
      resourceEntries.push({
        fullUrl,
        resource,
        request: { method: 'POST', url: 'Observation' },
      });
      vitalsRefs.push(referenceStringFromResource(resource));
    }
  }

  oxygenObservations.forEach((observation) => {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(observation),
      values.patientId,
    );
    resourceEntries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Observation' },
    });
    oxygenRefs.push(referenceStringFromResource(resource));
  });

  nutritionObservations.forEach((observation) => {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(observation),
      values.patientId,
    );
    resourceEntries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Observation' },
    });
    nutritionRefs.push(referenceStringFromResource(resource));
  });

  eliminationObservations.forEach((observation) => {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(observation),
      values.patientId,
    );
    resourceEntries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Observation' },
    });
    eliminationRefs.push(referenceStringFromResource(resource));
  });

  mobilitySkinObservations.forEach((observation) => {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(observation),
      values.patientId,
    );
    resourceEntries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Observation' },
    });
    mobilitySkinRefs.push(referenceStringFromResource(resource));
  });

  fluidBalanceObservations.forEach((observation) => {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(observation),
      values.patientId,
    );
    resourceEntries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Observation' },
    });
    fluidBalanceRefs.push(referenceStringFromResource(resource));
  });

  examObservations.forEach((observation) => {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(observation),
      values.patientId,
    );
    resourceEntries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Observation' },
    });
    examRefs.push(referenceStringFromResource(resource));
  });

  if (evaObservation) {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(evaObservation),
      values.patientId,
    );
    resourceEntries.push({ fullUrl, resource, request: { method: 'POST', url: 'Observation' } });
    painRefs.push(referenceStringFromResource(resource));
  }

  if (bradenObservation) {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(bradenObservation),
      values.patientId,
    );
    resourceEntries.push({ fullUrl, resource, request: { method: 'POST', url: 'Observation' } });
    bradenRefs.push(referenceStringFromResource(resource));
  }

  if (glasgowObservation) {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(glasgowObservation),
      values.patientId,
    );
    resourceEntries.push({ fullUrl, resource, request: { method: 'POST', url: 'Observation' } });
    glasgowRefs.push(referenceStringFromResource(resource));
  }

  riskConditions.forEach((condition) => {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(condition),
      values.patientId,
    );
    resourceEntries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Condition' },
    });
    riskRefs.push(referenceStringFromResource(resource));
  });

  detectedIssues.forEach((issue) => {
    const { resource, fullUrl } = assignStableIds(applyProfiles(issue), values.patientId);
    resourceEntries.push({ fullUrl, resource, request: { method: 'POST', url: 'DetectedIssue' } });
    issueRefs.push(referenceStringFromResource(resource));
  });

  diagnoses.forEach((condition) => {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(condition),
      values.patientId,
    );
    resourceEntries.push({ fullUrl, resource, request: { method: 'POST', url: 'Condition' } });
    diagnosisRefs.push(referenceStringFromResource(resource));
  });

  medications.forEach((medication) => {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(medication),
      values.patientId,
    );
    resourceEntries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'MedicationStatement' },
    });
    medicationRefs.push(referenceStringFromResource(resource));
  });

  treatmentProcedures.forEach((procedure) => {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(procedure),
      values.patientId,
    );
    resourceEntries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Procedure' },
    });
    treatmentRefs.push(referenceStringFromResource(resource));
  });

  procedureResources.forEach((procedure) => {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(procedure),
      values.patientId,
    );
    resourceEntries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Procedure' },
    });
    procedureRefs.push(referenceStringFromResource(resource));
  });

  oxygenResources.forEach((resource) => {
    const { resource: withId, fullUrl } = assignStableIds(
      applyProfiles(resource),
      values.patientId,
    );
    resourceEntries.push({
      fullUrl,
      resource: withId,
      request: { method: 'POST', url: resource.resourceType },
    });
    oxygenRefs.push(referenceStringFromResource(withId));
  });

  deviceResources.forEach((resource) => {
    const entry = createTransactionEntry(applyProfiles(resource), resource.id);
    resourceEntries.push(entry as BundleEntry);
    if (resource.resourceType === 'DeviceUseStatement') {
      deviceRefs.push(referenceStringFromResource(entry.resource as FhirResource));
    }
  });

  if (documentWithPatientReference) {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(documentWithPatientReference),
      values.patientId,
    );
    resourceEntries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'DocumentReference' },
    });
    attachmentRefs.push(referenceStringFromResource(resource));
  }

  attachmentDocuments.forEach((attachmentDoc) => {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(attachmentDoc),
      values.patientId,
    );
    resourceEntries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'DocumentReference' },
    });
    attachmentRefs.push(referenceStringFromResource(resource));
  });

  careRefs.push(
    ...nutritionRefs,
    ...eliminationRefs,
    ...mobilitySkinRefs,
    ...fluidBalanceRefs,
    ...treatmentRefs,
    ...oxygenRefs,
    ...deviceRefs,
  );

  const composition = replaceSubjectReference(
    buildComposition(
      {
        patientId: values.patientId,
        encounterId: values.encounterId,
        author: values.author,
        composition: values.composition,
        closingSummary: values.closingSummary,
        administrativeData: values.administrativeData,
        sbar: values.sbar,
        psychosocial: values.psychosocial,
        signatures: values.signatures,
        sectionSources: { exams: examInputCount, procedures: procedureInputCount },
      },
      {
        vitals: vitalsRefs,
        medications: medicationRefs,
        treatments: treatmentRefs,
        oxygen: oxygenRefs,
        devices: deviceRefs,
        attachments: attachmentRefs,
        administrative: administrativeRefs,
        care: careRefs,
        sbar: sbarRefs,
        bedsideChecklist: bedsideChecklistRefs,
        notes: notesRefs,
        nutrition: nutritionRefs,
        elimination: eliminationRefs,
        mobilitySkin: mobilitySkinRefs,
        fluidBalance: fluidBalanceRefs,
        pain: painRefs,
        braden: bradenRefs,
        glasgow: glasgowRefs,
        exams: examRefs,
        procedures: procedureRefs,
        risks: riskRefs,
        detectedIssues: issueRefs,
        diagnoses: diagnosisRefs,
      },
      sharedOptions,
    ),
    patientSubjectReference,
  );

  const { resource: compositionWithId, fullUrl: compositionFullUrl } = assignStableIds(
    applyProfiles(composition),
    values.patientId,
  );
  const compositionEntry: BundleEntry = {
    fullUrl: compositionFullUrl,
    resource: compositionWithId,
    request: { method: 'POST', url: 'Composition' },
  };

  const bundleSignature = buildSignatureResource(values.signatures?.outgoing);

  const rollbackPlan = {
    criticalEntryTypes: ['Patient', 'Practitioner', 'Encounter', 'Composition'],
    dependentEntryTypes: [
      'Observation',
      'Condition',
      'Procedure',
      'MedicationStatement',
      'DeviceUseStatement',
      'DocumentReference',
      'DetectedIssue',
      'Device',
    ],
    note: 'Rollback should preserve patient/practitioner/encounter/composition while replaying dependent entries.',
  };
  void rollbackPlan;

  const entries: BundleEntry[] = [
    patientEntry,
    practitionerEntry,
    ...extraPractitionerEntries,
    ...(encounterEntry ? [encounterEntry] : []),
    compositionEntry,
    ...resourceEntries,
  ];

  const bundle: Bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: entries,
    signature: bundleSignature ? [bundleSignature] : undefined,
  };

  // BEGIN HANDOVER_FHIR_VALIDATION
  const validation = validateFhirResource(bundle);
  if (!validation.isValid) {
    const messages = validation.errors.map((err) => `${err.path}: ${err.message}`);
    const error = new Error(messages.join('; '));
    (error as Error & { details: string[] }).details = messages;
    throw error;
  }
  // END HANDOVER_FHIR_VALIDATION

  return bundle;
}

type BundleEntryTransaction = FhirBundleTransaction['entry'][number];

function createTransactionEntry(resource: FhirResource, idOverride?: string): BundleEntryTransaction {
  const resourceId = resource.id ?? idOverride ?? uuidv4();
  const fullUrlId = hashHex(`${resource.resourceType}|${resourceId}`, 32);
  const resourceWithId = { ...resource, id: resourceId } as FhirResource;
  return {
    fullUrl: `urn:uuid:${fullUrlId}`,
    resource: resourceWithId,
    request: { method: 'POST', url: resource.resourceType },
  };
}

function mapDiagnoses(
  data: HandoverData,
  context: MappingContext,
): Condition[] {
  const conditions: Condition[] = [];
  const addCondition = (diagnosis: HandoverData['dxMedical'], categoryCode?: TerminologyCode<string>) => {
    const trimmed = diagnosis?.display?.trim();
    if (!trimmed) return;
    const coding = diagnosis?.code
      ? [
          {
            system: diagnosis.system,
            code: diagnosis.code,
            display: diagnosis.display,
          },
        ]
      : [];
    conditions.push({
      resourceType: 'Condition',
      clinicalStatus: conditionClinicalStatusActive,
      verificationStatus: conditionVerificationStatusUnconfirmed,
      category: categoryCode ? [codeableConceptFromCode(categoryCode)] : undefined,
      code: { coding, text: trimmed },
      subject: context.subject,
      encounter: context.encounter,
      onsetDateTime: context.effectiveDateTime,
      recordedDate: context.effectiveDateTime,
    });
  };

  addCondition(data.dxMedical, FHIR_CODES.RISK.FALL);
  addCondition(data.dxNursing, FHIR_CODES.RISK.PRESSURE_ULCER);

  const structured = [...(data.dxMedicalStructured ?? []), ...(data.dxNursingStructured ?? [])];
  structured.forEach((item) => {
    conditions.push({
      resourceType: 'Condition',
      clinicalStatus: conditionClinicalStatusActive,
      verificationStatus: conditionVerificationStatusUnconfirmed,
      code: {
        coding: [
          {
            system: item.system === 'OTHER' ? 'urn:handover-pro:diagnosis' : item.system,
            code: item.code,
            display: item.display,
          },
        ],
        text: item.display,
      },
      subject: context.subject,
      encounter: context.encounter,
      recordedDate: context.effectiveDateTime,
    });
  });

  return conditions;
}

function mapDetectedIssuesFromRisks(
  items: RiskItem[] | undefined,
  context: MappingContext,
): DetectedIssue[] {
  if (!items || items.length === 0) return [];

  const codeMap: Partial<Record<RiskItem['type'], TerminologyCode<string>>> = {
    fall: FHIR_CODES.RISK.FALL,
    pressureUlcer: FHIR_CODES.RISK.PRESSURE_ULCER,
    isolation: FHIR_CODES.RISK.SOCIAL_ISOLATION,
  };

  return items
    .filter((item) => item.present)
    .map((item) => {
      const code = codeMap[item.type];
      return {
        resourceType: 'DetectedIssue',
        status: 'final',
        code: code ? codeableConceptFromCode(code) : undefined,
        severity: 'moderate',
        detail: item.notes,
        subject: context.subject,
        identifiedDateTime: context.effectiveDateTime,
      } satisfies DetectedIssue;
    });
}

export function buildFhirBundleFromFormData(data: HandoverData, options?: BuildOptions): FhirBundleTransaction {
  const optionsMerged = resolveOptions(options);
  const timestamp = data.administrativeData.shiftEnd ?? optionsMerged.now();
  const sharedOptions: BuildOptions = { now: () => timestamp };
  const applyProfiles = <T extends FhirResource>(resource: T) =>
    applyProfileUrls(resource, optionsMerged);
  const encounterId = normalizeId((data as { encounterId?: string }).encounterId, fhirId('enc-', data.patientId));
  const mappingContext: MappingContext = {
    subject: patientReference(data.patientId),
    encounter: encounterReference(encounterId),
    effectiveDateTime: timestamp,
  };

    const oxygenTherapyInput: OxygenTherapyInput | undefined = data.oxygenTherapy
      ? ({ status: 'in-progress', ...data.oxygenTherapy } as OxygenTherapyInput)
      : undefined;

  const vitals = data.vitals
    ? mapObservationVitals({ patientId: data.patientId, encounterId, ...data.vitals }, sharedOptions)
    : [];
  const oxygenObservations = mapOxygenObservations(
    { patientId: data.patientId, encounterId, oxygenTherapy: oxygenTherapyInput },
    sharedOptions,
  );
  const nutrition = mapNutritionCare(
    { patientId: data.patientId, encounterId, nutrition: data.nutrition },
    sharedOptions,
  );
  const elimination = mapEliminationCare(
    { patientId: data.patientId, encounterId, elimination: data.elimination },
    sharedOptions,
  );
  const mobilitySkin = mapMobilitySkinCare(
    { patientId: data.patientId, encounterId, mobility: data.mobility, skin: data.skin },
    sharedOptions,
  );
  const fluidBalance = mapFluidBalanceCare(
    { patientId: data.patientId, encounterId, fluidBalance: data.fluidBalance },
    sharedOptions,
  );
  const normalizedExamsForm = normalizeExamInputs({
    exams: data.exams,
    examsPending: (data as { examsPending?: unknown }).examsPending,
  });
  const examInputCount = normalizedExamsForm.inputCount;
  const procedureInputCount = Array.isArray(data.procedures)
    ? data.procedures.length
    : data.procedures
      ? 1
      : 0;
  const examObservations = mapExamObservations(
    {
      patientId: data.patientId,
      encounterId,
      exams: data.exams,
      examsPending: (data as { examsPending?: unknown }).examsPending,
    },
    sharedOptions,
    normalizedExamsForm,
  );
  const procedureResources = mapProcedures(
    { patientId: data.patientId, encounterId, procedures: data.procedures },
    sharedOptions,
  );
  const evaObservation = mapEvaObservation(data.painAssessment, mappingContext);
  const bradenObservation = mapBradenObservation(data.braden, mappingContext);
  const glasgowObservation = mapGlasgowObservation(data.glasgow, mappingContext);
  const riskConditions = mapRiskConditions(data.risks, mappingContext);
  const detectedIssues = mapDetectedIssuesFromRisks(data.risksStructured, mappingContext);
  const administrativeObservation = mapAdministrativeObservation(
    { administrativeData: data.administrativeData } as CompositionValues,
    mappingContext,
  );
  const sbarObservations = mapSbarObservations(
    {
      sbar: {
        situation: data.sbarSituation,
        background: data.sbarBackground,
        assessment: data.sbarAssessment,
        recommendation: data.sbarRecommendation,
      },
    } as CompositionValues,
    mappingContext,
  );
  const bedsideChecklistObservation = mapBedsideChecklistObservation(
    (data as { bedsideChecklist?: HandoverBedsideChecklist }).bedsideChecklist ?? {},
    mappingContext,
  );
  const summaryObservation = mapSummaryObservation(data.closingSummary ?? data.evolution, mappingContext);
  const psychosocialObservation = mapPsychosocialObservation(data.psychosocial, mappingContext);
  const medications = mapMedicationStatements(
    {
      patientId: data.patientId,
      encounterId,
      medications: data.medications,
      meds: data.meds,
    },
    sharedOptions,
  );
  const treatmentProcedures = mapTreatments(
    { patientId: data.patientId, encounterId, treatments: data.treatments },
    sharedOptions,
  );
  const oxygenDevices = mapDeviceUse(
    { patientId: data.patientId, encounterId, oxygenTherapy: oxygenTherapyInput },
    sharedOptions,
  );
  const deviceResources = mapDevices(
    { patientId: data.patientId, encounterId, devices: data.devices },
    sharedOptions,
  );
  const document = data.audioUri
    ? mapDocumentReferenceAudio(
        { patientId: data.patientId, encounterId, audioAttachment: { url: data.audioUri, contentType: 'audio/mpeg' } },
        sharedOptions,
      )
    : undefined;

  const diagnoses = mapDiagnoses(data, mappingContext);

  const patient: Patient = {
    resourceType: 'Patient',
    id: data.patientId,
    identifier: [{ system: 'urn:handover-pro:patient-id', value: data.patientId }],
  };

  const patientEntry = createTransactionEntry(applyProfiles(patient), uuidv4());
  const practitionerId = resolveReferenceId((data as { authorReference?: string }).authorReference, 'Practitioner')
    ?? (data as { authorId?: string }).authorId
    ?? 'handover-app';
  const practitioner: Practitioner = {
    resourceType: 'Practitioner',
    id: practitionerId,
    identifier: [{ system: 'urn:handover-pro:practitioner-id', value: practitionerId }],
    name: [{ text: (data as { authorName?: string }).authorName ?? 'Handover Practitioner' }],
  };
  const encounter: Encounter | undefined = encounterId
    ? {
        resourceType: 'Encounter',
        id: encounterId,
        status: 'finished',
        class: {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: 'IMP',
          display: 'inpatient encounter',
        },
        subject: patientReference(data.patientId),
      }
    : undefined;
  const practitionerEntry = createTransactionEntry(applyProfiles(practitioner), practitioner.id);
  const signaturePractitionerIds = new Set(
    [
      data.signatures?.outgoing?.userId,
      data.signatures?.incoming?.userId,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  signaturePractitionerIds.delete(practitionerId);
  const extraPractitionerEntries = Array.from(signaturePractitionerIds).map((id) =>
    createTransactionEntry(
      applyProfiles({
        resourceType: 'Practitioner',
        id,
        identifier: [{ system: 'urn:handover-pro:practitioner-id', value: id }],
        name: [{ text: id }],
      }),
      id,
    ),
  );
  const encounterEntry = encounter ? createTransactionEntry(applyProfiles(encounter), encounter.id) : undefined;
  const resourceEntries: BundleEntryTransaction[] = [];
  const refs: BundleReferenceIndex & { detectedIssues?: string[]; diagnoses?: string[] } = {
    vitals: [],
    medications: [],
    treatments: [],
    oxygen: [],
    devices: [],
    attachments: [],
    administrative: [],
    care: [],
    sbar: [],
    bedsideChecklist: [],
    notes: [],
    nutrition: [],
    elimination: [],
    mobilitySkin: [],
    fluidBalance: [],
    pain: [],
    braden: [],
    glasgow: [],
    exams: [],
    procedures: [],
    risks: [],
    detectedIssues: [],
    diagnoses: [],
  };

  const pushEntry = (resource: FhirResource | undefined | null) => {
    if (!resource) return;
    const entry = createTransactionEntry(applyProfiles(resource));
    resourceEntries.push(entry);
    const reference = referenceStringFromResource(entry.resource as FhirResource);
    switch (resource.resourceType) {
      case 'Observation':
        if (resource.code?.coding?.[0]?.code === FHIR_CODES.SCALES.EVA.code) refs.pain.push(reference);
        else if (resource.code?.coding?.[0]?.code === FHIR_CODES.SCALES.BRADEN.code) refs.braden.push(reference);
        else if (resource.code?.coding?.[0]?.code === FHIR_CODES.SCALES.GLASGOW.code) refs.glasgow.push(reference);
        else if (resource.category?.some((c) => c.coding?.some((coding) => coding.code === 'vital-signs'))) refs.vitals.push(reference);
        else if (
          !resource.code?.coding?.length &&
          resource.category?.some((c) =>
            c.coding?.some((coding) => coding.system === OBSERVATION_CATEGORY_SYSTEM),
          )
        )
          refs.exams.push(reference);
        else refs.mobilitySkin.push(reference);
        break;
      case 'MedicationStatement':
        refs.medications.push(reference);
        break;
      case 'Procedure': {
        const hasTreatmentCoding = resource.code?.coding?.some(
          (coding) => coding.system === TERMINOLOGY_SYSTEMS.HANDOVER_TREATMENT_TYPE,
        );
        if (hasTreatmentCoding) refs.treatments.push(reference);
        else refs.procedures.push(reference);
        break;
      }
      case 'DeviceUseStatement':
        refs.oxygen.push(reference);
        break;
      case 'DocumentReference':
        refs.attachments.push(reference);
        break;
      case 'Condition':
        refs.risks.push(reference);
        break;
      case 'DetectedIssue':
        refs.detectedIssues?.push(reference);
        break;
      default:
        break;
    }
  };

  const pushObservationWithRefs = (
    observation: Observation | null | undefined,
    refBucket: string[],
  ) => {
    if (!observation) return;
    const entry = createTransactionEntry(applyProfiles(observation));
    resourceEntries.push(entry);
    refBucket.push(referenceStringFromResource(entry.resource as FhirResource));
  };

  pushObservationWithRefs(administrativeObservation, refs.administrative);
  sbarObservations.forEach((observation) => pushObservationWithRefs(observation, refs.sbar));
  pushObservationWithRefs(bedsideChecklistObservation, refs.bedsideChecklist);
  pushObservationWithRefs(summaryObservation, refs.notes);
  pushObservationWithRefs(psychosocialObservation, refs.care);

  vitals.forEach(pushEntry);
  oxygenObservations.forEach(pushEntry);
  nutrition.forEach((obs) => {
    pushEntry(obs);
    const lastEntry = resourceEntries[resourceEntries.length - 1];
    if (lastEntry) {
      refs.nutrition.push(referenceStringFromResource(lastEntry.resource as FhirResource));
    }
  });
  elimination.forEach((obs) => {
    pushEntry(obs);
    const lastEntry = resourceEntries[resourceEntries.length - 1];
    if (lastEntry) {
      refs.elimination.push(referenceStringFromResource(lastEntry.resource as FhirResource));
    }
  });
  mobilitySkin.forEach((obs) => {
    pushEntry(obs);
    const lastEntry = resourceEntries[resourceEntries.length - 1];
    if (lastEntry) {
      refs.mobilitySkin.push(referenceStringFromResource(lastEntry.resource as FhirResource));
    }
  });
  fluidBalance.forEach((obs) => {
    pushEntry(obs);
    const lastEntry = resourceEntries[resourceEntries.length - 1];
    if (lastEntry) {
      refs.fluidBalance.push(referenceStringFromResource(lastEntry.resource as FhirResource));
    }
  });
  examObservations.forEach((obs) => {
    pushEntry(obs);
  });
  pushEntry(evaObservation);
  pushEntry(bradenObservation);
  pushEntry(glasgowObservation);
  riskConditions.forEach(pushEntry);
  detectedIssues.forEach(pushEntry);
  diagnoses.forEach((condition) => {
    const entry = createTransactionEntry(applyProfiles(condition));
    resourceEntries.push(entry);
    refs.diagnoses?.push(referenceStringFromResource(entry.resource as FhirResource));
  });
  medications.forEach(pushEntry);
  treatmentProcedures.forEach(pushEntry);
  procedureResources.forEach((procedure) => {
    pushEntry(procedure);
  });
  oxygenDevices.forEach(pushEntry);
  deviceResources.forEach((resource) => {
    const entry = createTransactionEntry(applyProfiles(resource), resource.id);
    resourceEntries.push(entry);
    if (resource.resourceType === 'DeviceUseStatement') {
      refs.devices.push(referenceStringFromResource(entry.resource as FhirResource));
    }
  });
  if (document) pushEntry(document);

  refs.care.push(
    ...refs.nutrition,
    ...refs.elimination,
    ...refs.mobilitySkin,
    ...refs.fluidBalance,
    ...refs.treatments,
    ...refs.oxygen,
    ...refs.devices,
  );

  const composition = buildComposition(
    {
      patientId: data.patientId,
      encounterId,
      closingSummary: data.closingSummary ?? data.evolution,
      administrativeData: data.administrativeData,
      sbar: {
        situation: data.sbarSituation,
        background: data.sbarBackground,
        assessment: data.sbarAssessment,
        recommendation: data.sbarRecommendation,
      },
      psychosocial: data.psychosocial,
      signatures: data.signatures,
      sectionSources: { exams: examInputCount, procedures: procedureInputCount },
    },
    refs,
    sharedOptions,
  );

  const compositionEntry = createTransactionEntry(applyProfiles(composition));

  const bundleSignature = buildSignatureResource(data.signatures?.outgoing);

  const entries: BundleEntryTransaction[] = [
    patientEntry,
    practitionerEntry,
    ...extraPractitionerEntries,
    ...(encounterEntry ? [encounterEntry] : []),
    compositionEntry,
    ...resourceEntries,
  ];

  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: entries,
    signature: bundleSignature ? [bundleSignature] : undefined,
  } satisfies FhirBundleTransaction;
}

  const transactionBundleSchema = z.object({
  resourceType: z.literal('Bundle'),
  type: z.literal('transaction'),
  entry: z
    .array(
      z.object({
        fullUrl: z.string().url().or(z.string().startsWith('urn:uuid:')),
        resource: z.record(z.any()),
        request: z.object({ method: z.literal('POST'), url: z.string().min(1) }),
      }),
    )
    .min(1),
});

export function validateBundle(bundle: FhirBundleTransaction): { ok: boolean; errors: string[] } {
  const result = transactionBundleSchema.safeParse(bundle);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
    };
  }

  const errors: string[] = [];
  const entries = bundle.entry ?? [];
  const compositionEntry = entries.find((entry) => entry.resource?.resourceType === 'Composition');
  if (!compositionEntry) {
    errors.push('Composition entry is required');
  }

  const referencePattern = /^[A-Za-z]+\/[A-Za-z0-9.\-]{1,64}$/;
  const entryReferenceSet = new Set(
    entries
      .map((entry) => {
        const resource = entry.resource as { resourceType?: string; id?: string };
        return resource?.resourceType && resource?.id ? `${resource.resourceType}/${resource.id}` : null;
      })
      .filter((value): value is string => Boolean(value)),
  );
  const entryResourceTypes = new Set(
    entries
      .map((entry) => (entry.resource as { resourceType?: string }).resourceType)
      .filter((value): value is string => Boolean(value)),
  );

  const collectReferences = (value: unknown, refs: string[] = []): string[] => {
    if (!value || typeof value !== 'object') return refs;
    if (Array.isArray(value)) {
      value.forEach((item) => collectReferences(item, refs));
      return refs;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.reference === 'string') {
      refs.push(record.reference);
    }
    Object.values(record).forEach((item) => collectReferences(item, refs));
    return refs;
  };

  entries.forEach((entry, index) => {
    const resource = entry.resource as { resourceType?: string };
    if (entry.request?.url && resource?.resourceType && entry.request.url !== resource.resourceType) {
      errors.push(`entry[${index}].request.url must match resourceType`);
    }
    const references = collectReferences(entry.resource);
    references.forEach((reference) => {
      if (!referencePattern.test(reference)) {
        errors.push(`entry[${index}].reference "${reference}" is not ResourceType/id`);
        return;
      }
      const [referenceType] = reference.split('/');
      if (entryResourceTypes.has(referenceType) && !entryReferenceSet.has(reference)) {
        errors.push(`entry[${index}].reference "${reference}" does not resolve to bundle entries`);
      }
    });
  });

  if (compositionEntry) {
    const composition = compositionEntry.resource as Composition;
    if (!composition.subject?.reference) {
      errors.push('Composition.subject.reference is required');
    }
    if (!composition.encounter?.reference) {
      errors.push('Composition.encounter.reference is required');
    }
    if (!composition.author?.length || !composition.author[0]?.reference) {
      errors.push('Composition.author.reference is required');
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, errors: [] };
}

export type {
  Observation,
  MedicationStatement,
  Procedure,
  DeviceUseStatement,
  Device,
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
