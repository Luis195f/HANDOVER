import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import type { AdministrativeData } from '../types/administrative';
import type {
  ContextualPrioritySignal,
  ProfileContext,
  ProfileOverlaySelection,
  ProfileRuntimeMergeTraceEntry,
  ProfileSelectorId,
  SpecialtyOverlayId,
  UnitProfileId,
} from '../types/profile';
import type {
  EliminationInfo,
  FluidBalanceInfo,
  HandoverBedsideChecklist,
  HandoverFhirClinicalContext,
  HandoverSignature,
  MedicationItem,
  MobilityInfo,
  NutritionInfo,
  PainAssessment,
  BradenScale,
  GlasgowScale,
  SkinInfo,
  TreatmentItem,
  NocOutcomeItem,
  ExamItem,
  ProcedureItem,
  RiskFlags,
  TurnContext,
  PendingTask,
  ContingencyPlan,
  RiskItem,
  DeviceItem,
  PsychosocialCare,
} from '../types/handover';
import { zHandover } from '../validation/schemas';
import { getSpecialtyOverlayDefinition, getUnitProfileDefinition } from '../config/profiles';
import { CATEGORY, CONDITION_CODES, DOCUMENT_CLASS_CODES, FHIR_CODES, FHIR_EXTENSION_URLS, LOINC, SNOMED, TERMINOLOGY_SYSTEMS, type TerminologyCode, type TerminologySystem } from './codes';
import {
  FHIR_CORE_PROFILE_URLS,
  FHIR_ENCOUNTER_CLASS_CODES,
  HANDOVER_CLINICAL_CONTEXT_COMPONENT_CODES,
  HANDOVER_COMPOSITION_SECTION_CODES,
  HANDOVER_COMPOSITION_TYPE,
  HANDOVER_IDENTIFIER_SYSTEMS,
  HANDOVER_LOCAL_CODE_SYSTEMS,
  HANDOVER_OBSERVATION_CODES,
  HANDOVER_SIGNATURE_TYPE,
  NOC_OUTCOME_CATEGORY,
} from './fhir-terminology';
import {
  buildNicProcedure,
  buildNocOutcomeObservation,
  mapLegacyNursingCondition,
  mapNandaConditions,
} from './fhir-map/nnn';
import {
  mapObservationVitalsImpl,
  mapOxygenObservationsImpl,
  mapVitalsToObservationsImpl,
  type VitalsMapperDependencies,
} from './fhir-map/vitals.impl';
import {
  mapMedicationStatementsImpl,
  type MedicationsMapperDependencies,
} from './fhir-map/medications';
import {
  mapDevicesImpl,
  mapDeviceUseImpl,
  type DevicesMapperDependencies,
} from './fhir-map/devices';
import {
  mapEliminationCareImpl,
  mapExamObservationsImpl,
  mapFluidBalanceCareImpl,
  mapMobilitySkinCareImpl,
  mapContingencyPlanObservationImpl,
  mapNocOutcomesImpl,
  mapNutritionCareImpl,
  mapPendingTaskObservationsImpl,
  mapProceduresImpl,
  mapTreatmentsImpl,
  mapTurnContextObservationImpl,
  normalizeExamInputs,
  type SpecificCareMapperDependencies,
} from './fhir-map/specific-care';
import {
  attestersFromSignaturesImpl,
  buildSignatureResourceImpl,
  mapAttestersImpl,
} from './fhir-map/signatures';
import {
  buildCompositionImpl,
  mapAdministrativeObservationImpl,
  mapBedsideChecklistObservationImpl,
  mapPsychosocialObservationImpl,
  mapSbarObservationsImpl,
  mapSummaryObservationImpl,
  type CompositionMapperDependencies,
} from './fhir-map/composition';
import {
  mapBradenObservationImpl,
  mapEvaObservationImpl,
  mapGlasgowObservationImpl,
  mapRiskConditionsImpl,
  type ScalesMapperDependencies,
} from './fhir-map/scales';
import { hashHex, fhirId } from './crypto';
import { FHIR_PROFILE_URLS_BY_RESOURCE_TYPE } from './fhir-profiles';
import { validateResourceWithZod as validateFhirResource } from './fhir-validation';
import { resolveSnomedCoding } from '../data/snomed-dict';

export { NANDA_DIAGNOSIS_SYSTEM_URI, NIC_INTERVENTION_SYSTEM_URI, NOC_OUTCOME_SYSTEM_URI } from './fhir-terminology';

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

type Extension = {
  url: string;
  extension?: Extension[];
  valueBoolean?: boolean;
  valueInteger?: number;
  valueString?: string;
};

type Signature = {
  type: Coding[];
  when: string;
  who: Reference;
  onBehalfOf?: Reference;
  sigFormat?: string;
  data?: string;
};

type TimingRepeat = {
  frequency?: number;
  period?: number;
  periodUnit?: 'h' | 'd' | 'wk' | 'mo' | 'a';
};

type Timing = {
  repeat?: TimingRepeat;
};

type DoseAndRate = {
  doseQuantity?: Quantity;
};

type Dosage = {
  text?: string;
  timing?: Timing;
  route?: CodeableConcept;
  doseAndRate?: DoseAndRate[];
  asNeededBoolean?: boolean;
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
  effectiveDateTime?: string;
  dateAsserted: string;
  note?: Annotation[];
  dosage?: Dosage[];
  extension?: Extension[];
};

type MedicationResource = MedicationStatement | MedicationAdministration;

type MedicationAdministration = {
  resourceType: 'MedicationAdministration';
  identifier?: Array<{ system: string; value: string }>;
  id?: string;
  status: 'in-progress' | 'completed' | 'stopped' | 'entered-in-error' | 'on-hold' | 'unknown' | 'not-done';
  medicationCodeableConcept: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  effectivePeriod?: Period;
  effectiveDateTime?: string;
  dosage?: {
    text?: string;
    route?: CodeableConcept;
    dose?: Quantity;
    rateQuantity?: Quantity;
  };
  note?: Annotation[];
  extension?: Extension[];
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
  extension?: Extension[];
  section?: CompositionSection[];
};

type Narrative = {
  status: 'generated' | 'additional' | 'extensions';
  div: string;
};

type FhirResource =
  | Observation
  | MedicationStatement
  | MedicationAdministration
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

const PROFILE_VITAL_SIGNS = FHIR_CORE_PROFILE_URLS.vitalSigns;
const PROFILE_BLOOD_PRESSURE = FHIR_CORE_PROFILE_URLS.bloodPressure;
const PROFILE_OBSERVATION = FHIR_CORE_PROFILE_URLS.observation;
const DEFAULT_COMPOSITION_TYPE: CodeableConcept = {
  coding: [
    HANDOVER_COMPOSITION_TYPE,
  ],
  text: 'Clinical handover',
};

const COMPOSITION_SECTION_CODES = HANDOVER_COMPOSITION_SECTION_CODES;

// ---------------------------------------------------------------------------
// Terminology systems (local URNs)
// ---------------------------------------------------------------------------
// En este repo, codeableConceptFromCode(...) espera system: TerminologySystem.
// Si no existe un TerminologySystem global/importado, lo definimos aquí como string.

const HANDOVER_OBSERVATION_SYSTEM: TerminologySystem =
  TERMINOLOGY_SYSTEMS.HANDOVER_OBSERVATION_CODES;

const HANDOVER_COMPOSITION_SECTION_SYSTEM: TerminologySystem =
  TERMINOLOGY_SYSTEMS.HANDOVER_COMPOSITION_SECTION;

const HANDOVER_SBAR_SYSTEM: TerminologySystem =
  TERMINOLOGY_SYSTEMS.HANDOVER_SBAR;

const HANDOVER_BEDSIDE_CHECKLIST_SYSTEM: TerminologySystem =
  TERMINOLOGY_SYSTEMS.HANDOVER_BEDSIDE_CHECKLIST;

const HANDOVER_BOOLEAN_SYSTEM: TerminologySystem =
  TERMINOLOGY_SYSTEMS.HANDOVER_BOOLEAN;

// Códigos Observation (TIPADOS con TerminologyCode)
// Helper para secciones del Composition
const compositionSectionConcept = (code: string, display: string): CodeableConcept =>
  codeableConceptFromCode(
    {
      system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPOSITION_SECTION,
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
      system: CATEGORY.survey.system,
      code: CATEGORY.survey.code,
      display: CATEGORY.survey.display,
    },
  ],
  text: 'Nursing care',
};

const outcomeCategoryConcept: CodeableConcept = {
  coding: [
    {
      system: NOC_OUTCOME_CATEGORY.system,
      code: NOC_OUTCOME_CATEGORY.code,
      display: NOC_OUTCOME_CATEGORY.display,
    },
  ],
  text: NOC_OUTCOME_CATEGORY.display,
};

const conditionClinicalStatusActive: CodeableConcept = {
  coding: [
    {
      system: CONDITION_CODES.ACTIVE.system,
      code: CONDITION_CODES.ACTIVE.code,
      display: CONDITION_CODES.ACTIVE.display,
    },
  ],
};

const conditionVerificationStatusUnconfirmed: CodeableConcept = {
  coding: [
    {
      system: CONDITION_CODES.UNCONFIRMED.system,
      code: CONDITION_CODES.UNCONFIRMED.code,
      display: CONDITION_CODES.UNCONFIRMED.display,
    },
  ],
};

const conditionProblemListCategory: CodeableConcept = {
  coding: [
    {
      system: CONDITION_CODES.PROBLEM_LIST_ITEM.system,
      code: CONDITION_CODES.PROBLEM_LIST_ITEM.code,
      display: CONDITION_CODES.PROBLEM_LIST_ITEM.display,
    },
  ],
  text: CONDITION_CODES.PROBLEM_LIST_ITEM.display,
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

type FhirCodeDescriptor = Readonly<{
  system: TerminologySystem;
  code: string;
  display?: string;
}>;

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

type OutcomeValues = {
  patientId: string;
  encounterId?: string;
  outcomes?: NocOutcomeItem[];
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
  clinicalContext: string[];
  nutrition: string[];
  elimination: string[];
  mobilitySkin: string[];
  fluidBalance: string[];
  pain: string[];
  braden: string[];
  glasgow: string[];
  exams: string[];
  procedures: string[];
  outcomes: string[];
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
  meds?: string | string[] | null;
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
  turnContext?: TurnContext;
  pendingTasks?: PendingTask[];
  exams?: ExamItem[];
  procedures?: ProcedureItem[];
  contingencyPlan?: ContingencyPlan;
  braden?: BradenScale;
  glasgow?: GlasgowScale;
  // BEGIN HANDOVER D1 – BedsideChecklist types
  bedsideChecklist: HandoverBedsideChecklist;
  // END HANDOVER D1 – BedsideChecklist types
  risks?: RiskFlags;
  risksStructured?: RiskItem[];
  treatments?: TreatmentItem[];
  outcomes?: NocOutcomeItem[];
  profileTrace?: HandoverProfileTraceInput;
};

export interface HandoverProfileTraceInput {
  unitId?: string;
  requestedSpecialtyId?: string;
  specialtyId?: string;
  specialtySource: ProfileContext['specialtySource'];
  catalogUnitProfileId: UnitProfileId | null;
  unitProfileId: UnitProfileId | null;
  overlaySelections: readonly ProfileOverlaySelection[];
  catalogSpecialtyOverlayIds: readonly SpecialtyOverlayId[];
  specialtyOverlayIds: readonly SpecialtyOverlayId[];
  activeProfileIds: readonly ProfileSelectorId[];
  hasHumanSpecialtyOverride: boolean;
  mergeTrace?: readonly Pick<ProfileRuntimeMergeTraceEntry, 'source' | 'profileId' | 'label'>[];
}

export type HandoverInput = HandoverValues | { values: HandoverValues; profileTrace?: HandoverProfileTraceInput };

const FHIR_CONTEXT_EXPORT_VERSION = '1' as const;
const CLINICAL_CONTEXT_SECTION_TITLE = 'Clinical context';

const isPrioritySignalExportable = (
  signal: ContextualPrioritySignal,
): signal is ContextualPrioritySignal & { source: 'unit-profile' | 'specialty-overlay' } =>
  signal.source === 'unit-profile' || signal.source === 'specialty-overlay';

function resolveProfilePrioritySignals(
  profileTrace: HandoverProfileTraceInput,
): HandoverFhirClinicalContext['prioritySignals'] {
  const unitSignals = profileTrace.unitProfileId
    ? (getUnitProfileDefinition(profileTrace.unitProfileId)?.prioritySignals ?? [])
    : [];
  const overlaySignals = profileTrace.specialtyOverlayIds.flatMap(
    (overlayId) => getSpecialtyOverlayDefinition(overlayId)?.prioritySignals ?? [],
  );

  return [...unitSignals, ...overlaySignals]
    .filter(isPrioritySignalExportable)
    .map((signal) => ({
      id: signal.id,
      label: signal.label,
      source: signal.source,
    }));
}

function resolveCriticalPendingTasks(
  pendingTasks: readonly PendingTask[] | undefined,
): HandoverFhirClinicalContext['pendingCriticalTasks'] {
  return (pendingTasks ?? [])
    .filter(
      (task) =>
        task.status !== 'done' &&
        (task.priority === 'critical' || task.category === 'critical-task' || task.category === 'escalation'),
    )
    .map((task) => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      status: task.status,
      dueBy: task.dueBy,
    }));
}

function buildClinicalContextExport(
  profileTrace: HandoverProfileTraceInput | undefined,
  pendingTasks: readonly PendingTask[] | undefined,
): HandoverFhirClinicalContext | null {
  const pendingCriticalTasks = resolveCriticalPendingTasks(pendingTasks);
  if (!profileTrace) {
    return pendingCriticalTasks.length > 0
      ? {
          version: FHIR_CONTEXT_EXPORT_VERSION,
          coreProfile: { id: 'handover-core', label: 'HANDOVER Core', kind: 'core' },
          specialtyOverlays: [],
          prioritySignals: [],
          pendingCriticalTasks,
        }
      : null;
  }

  const unitProfile = profileTrace.unitProfileId
    ? getUnitProfileDefinition(profileTrace.unitProfileId)
    : null;
  const specialtyOverlays = profileTrace.specialtyOverlayIds
    .map((overlayId) => getSpecialtyOverlayDefinition(overlayId))
    .filter(
      (
        overlay,
      ): overlay is NonNullable<ReturnType<typeof getSpecialtyOverlayDefinition>> =>
        Boolean(overlay),
    )
    .map((overlay) => ({
      id: overlay.id,
      label: overlay.label,
      kind: 'specialty-overlay' as const,
    }));
  const prioritySignals = resolveProfilePrioritySignals(profileTrace);
  const hasAdditiveContext = Boolean(unitProfile || specialtyOverlays.length > 0 || pendingCriticalTasks.length > 0);

  if (!hasAdditiveContext) {
    return null;
  }

  return {
    version: FHIR_CONTEXT_EXPORT_VERSION,
    coreProfile: { id: 'handover-core', label: 'HANDOVER Core', kind: 'core' },
    unitProfile: unitProfile
      ? {
          id: unitProfile.id,
          label: unitProfile.label,
          kind: 'unit-profile',
        }
      : undefined,
    specialtyOverlays,
    prioritySignals,
    pendingCriticalTasks,
  };
}

function makeClinicalContextProfileExtension(
  profile: HandoverFhirClinicalContext['coreProfile'] | NonNullable<HandoverFhirClinicalContext['unitProfile']> | HandoverFhirClinicalContext['specialtyOverlays'][number],
): Extension {
  return {
    url: FHIR_EXTENSION_URLS.ACTIVE_PROFILE,
    extension: [
      { url: 'profileId', valueString: profile.id },
      { url: 'profileLabel', valueString: profile.label },
      { url: 'profileKind', valueString: profile.kind },
    ],
  };
}

function buildClinicalContextCompositionExtensions(
  clinicalContext: HandoverFhirClinicalContext | null,
): Extension[] | undefined {
  if (!clinicalContext) return undefined;

  const profileExtensions = [
    makeClinicalContextProfileExtension(clinicalContext.coreProfile),
    ...(clinicalContext.unitProfile ? [makeClinicalContextProfileExtension(clinicalContext.unitProfile)] : []),
    ...clinicalContext.specialtyOverlays.map((profile) => makeClinicalContextProfileExtension(profile)),
  ];

  return [
    { url: FHIR_EXTENSION_URLS.CONTEXT_VERSION, valueString: clinicalContext.version },
    ...profileExtensions,
  ];
}

function buildClinicalContextSummary(clinicalContext: HandoverFhirClinicalContext): string {
  const labels = [
    clinicalContext.coreProfile.label,
    ...(clinicalContext.unitProfile ? [clinicalContext.unitProfile.label] : []),
    ...clinicalContext.specialtyOverlays.map((overlay) => overlay.label),
  ];
  const parts = [`Profiles: ${labels.join(' + ')}`];

  if (clinicalContext.prioritySignals.length > 0) {
    parts.push(
      `Signals: ${clinicalContext.prioritySignals
        .map((signal) => signal.label)
        .join('; ')}`,
    );
  }
  if (clinicalContext.pendingCriticalTasks.length > 0) {
    parts.push(`Pending critical tasks: ${clinicalContext.pendingCriticalTasks.length}`);
  }

  return parts.join('. ');
}

function mapClinicalContextObservation(
  clinicalContext: HandoverFhirClinicalContext | null,
  context: MappingContext,
): Observation | null {
  if (!clinicalContext) return null;

  const components: ObservationComponent[] = [
    {
      code: {
        coding: [HANDOVER_CLINICAL_CONTEXT_COMPONENT_CODES.coreProfile],
        text: HANDOVER_CLINICAL_CONTEXT_COMPONENT_CODES.coreProfile.display,
      },
      valueString: clinicalContext.coreProfile.label,
    },
  ];

  if (clinicalContext.unitProfile) {
    components.push({
      code: {
        coding: [HANDOVER_CLINICAL_CONTEXT_COMPONENT_CODES.unitProfile],
        text: HANDOVER_CLINICAL_CONTEXT_COMPONENT_CODES.unitProfile.display,
      },
      valueString: `${clinicalContext.unitProfile.label} (${clinicalContext.unitProfile.id})`,
    });
  }

  clinicalContext.specialtyOverlays.forEach((overlay) => {
    components.push({
      code: {
        coding: [HANDOVER_CLINICAL_CONTEXT_COMPONENT_CODES.specialtyOverlay],
        text: HANDOVER_CLINICAL_CONTEXT_COMPONENT_CODES.specialtyOverlay.display,
      },
      valueString: `${overlay.label} (${overlay.id})`,
    });
  });

  clinicalContext.prioritySignals.forEach((signal) => {
    components.push({
      code: {
        coding: [HANDOVER_CLINICAL_CONTEXT_COMPONENT_CODES.prioritySignal],
        text: HANDOVER_CLINICAL_CONTEXT_COMPONENT_CODES.prioritySignal.display,
      },
      valueString: signal.label,
    });
  });

  if (clinicalContext.pendingCriticalTasks.length > 0) {
    components.push({
      code: {
        coding: [HANDOVER_CLINICAL_CONTEXT_COMPONENT_CODES.pendingCriticalTaskCount],
        text: HANDOVER_CLINICAL_CONTEXT_COMPONENT_CODES.pendingCriticalTaskCount.display,
      },
      valueInteger: clinicalContext.pendingCriticalTasks.length,
    });
  }

  return {
    resourceType: 'Observation',
    status: 'final',
    category: [surveyCategoryConcept],
    code: codeableConceptFromCode(FHIR_CODES.CONTEXT.CLINICAL_CONTEXT),
    subject: context.subject,
    encounter: context.encounter,
    effectiveDateTime: context.effectiveDateTime,
    issued: context.effectiveDateTime,
    valueString: buildClinicalContextSummary(clinicalContext),
    component: components,
    note:
      clinicalContext.pendingCriticalTasks.length > 0
        ? clinicalContext.pendingCriticalTasks.map((task) => ({
            text: `${task.title}${task.dueBy ? ` (due ${task.dueBy})` : ''}`,
          }))
        : undefined,
  };
}

type MappingContext = {
  subject: Reference;
  encounter?: Reference;
  effectiveDateTime: string;
};

const vitalsMapperDependencies: VitalsMapperDependencies = {
  resolveOptions,
  patientReference,
  encounterReference,
  codeableConceptFromCode,
  quantity,
  normalizeIsoDateTimeValue,
  observationVitalsSchema: ObservationVitalsSchema,
  oxygenTherapySchema: OxygenTherapySchema,
  avpuMap: AVPU_MAP,
  profileVitalSigns: PROFILE_VITAL_SIGNS,
  profileBloodPressure: PROFILE_BLOOD_PRESSURE,
  profileObservation: PROFILE_OBSERVATION,
  vitalCategoryConcept,
  laboratoryCategoryConcept,
};

const medicationsMapperDependencies: MedicationsMapperDependencies = {
  resolveOptions,
  patientReference,
  encounterReference,
  normalizeIsoDateTimeValue,
  medicationStatementSchema: MedicationStatementSchema,
};

const devicesMapperDependencies: DevicesMapperDependencies = {
  resolveOptions,
  patientReference,
  encounterReference,
  fhirId,
  oxygenTherapySchema: OxygenTherapySchema,
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

const warnCompositionSectionOmitted = (section: 'exams' | 'procedures') => {
  void section;
};

const specificCareMapperDependencies: SpecificCareMapperDependencies = {
  resolveOptions,
  patientReference,
  encounterReference,
  codeableConceptFromCode,
  quantity,
  surveyCategoryConcept,
  outcomeCategoryConcept,
  warnExamsItemSkipped,
  warnProceduresItemSkipped,
};

const compositionMapperDependencies: CompositionMapperDependencies = {
  resolveOptions,
  ensureAuthorReference,
  patientReference,
  encounterReference,
  codeableConceptFromCode,
  administrativeSummaryText,
  attestersFromSignatures,
  defaultCompositionType: DEFAULT_COMPOSITION_TYPE,
  compositionSectionCodes: COMPOSITION_SECTION_CODES,
  compositionSectionConcept,
  handoverObservationCodes: HANDOVER_OBSERVATION_CODES,
  surveyCategoryConcept,
  warnCompositionSectionOmitted,
};

const scalesMapperDependencies: ScalesMapperDependencies = {
  codeableConceptFromCode,
  surveyCategoryConcept,
  conditionClinicalStatusActive,
  conditionVerificationStatusUnconfirmed,
  conditionProblemListCategory,
  riskCodeMap: {
    fall: FHIR_CODES.RISK.FALL,
    pressureUlcer: FHIR_CODES.RISK.PRESSURE_ULCER,
    isolation: FHIR_CODES.RISK.SOCIAL_ISOLATION,
  },
};

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
    identifier: { system: HANDOVER_IDENTIFIER_SYSTEMS.patient, value: normalized },
  };
}

function encounterReference(encounterId?: string): Reference | undefined {
  const normalized = normalizeId(encounterId, '');
  if (!normalized) return undefined;
  return {
    reference: `Encounter/${normalized}`,
    type: 'Encounter',
    identifier: { system: HANDOVER_IDENTIFIER_SYSTEMS.encounter, value: normalized },
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
    system: TERMINOLOGY_SYSTEMS.UCUM,
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
    identifier: { system: HANDOVER_IDENTIFIER_SYSTEMS.practitioner, value: id },
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
      partyIdentifier: { system: HANDOVER_IDENTIFIER_SYSTEMS.user, value: signature.userId },
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
    identifier: { system: HANDOVER_IDENTIFIER_SYSTEMS.user, value: signature.userId },
    display: signature.fullName,
    type: 'Practitioner',
  };

  const onBehalfOf: Reference | undefined = signature.unitId
    ? {
        reference: `Organization/${encodeURIComponent(signature.unitId)}`,
        identifier: { system: HANDOVER_IDENTIFIER_SYSTEMS.unit, value: signature.unitId },
        display: signature.unitId,
        type: 'Organization',
      }
    : undefined;

  return {
    type: [HANDOVER_SIGNATURE_TYPE],
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
  MedicationAdministration: 'ma-',
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

export function mapObservationVitals(
  values: ObservationVitalsInput,
  options?: BuildOptions,
): Observation[] {
  return mapObservationVitalsImpl(vitalsMapperDependencies, values, options);
}

export function mapVitalsToObservations(
  input: { patientId: string; encounterId?: string; vitals?: VitalsValues },
  options?: BuildOptions,
): Observation[] {
  return mapVitalsToObservationsImpl(vitalsMapperDependencies, input, options);
}

export function mapMedicationStatements(
  values: MedicationValues,
  options?: BuildOptions,
): MedicationResource[] {
  return mapMedicationStatementsImpl(medicationsMapperDependencies, values, options);
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
  return mapDevicesImpl(devicesMapperDependencies, values, options);
}

export function mapOxygenObservations(
  values: OxygenValues,
  options?: BuildOptions,
): Observation[] {
  return mapOxygenObservationsImpl(vitalsMapperDependencies, values, options);
}

export function mapNutritionCare(
  values: { patientId: string; encounterId?: string; nutrition?: NutritionInfo },
  options?: BuildOptions,
): Observation[] {
  return mapNutritionCareImpl(specificCareMapperDependencies, values, options);
}

export function mapEliminationCare(
  values: { patientId: string; encounterId?: string; elimination?: EliminationInfo },
  options?: BuildOptions,
): Observation[] {
  return mapEliminationCareImpl(specificCareMapperDependencies, values, options);
}

export function mapMobilitySkinCare(
  values: { patientId: string; encounterId?: string; mobility?: MobilityInfo; skin?: SkinInfo },
  options?: BuildOptions,
): Observation[] {
  return mapMobilitySkinCareImpl(specificCareMapperDependencies, values, options);
}

export function mapFluidBalanceCare(
  values: { patientId: string; encounterId?: string; fluidBalance?: FluidBalanceInfo },
  options?: BuildOptions,
): Observation[] {
  return mapFluidBalanceCareImpl(specificCareMapperDependencies, values, options);
}

export function mapTurnContextObservation(
  values: { patientId: string; encounterId?: string; turnContext?: TurnContext },
  options?: BuildOptions,
): Observation[] {
  return mapTurnContextObservationImpl(specificCareMapperDependencies, values, options);
}

export function mapPendingTaskObservations(
  values: { patientId: string; encounterId?: string; pendingTasks?: PendingTask[] },
  options?: BuildOptions,
): Observation[] {
  return mapPendingTaskObservationsImpl(specificCareMapperDependencies, values, options);
}

export function mapContingencyPlanObservation(
  values: { patientId: string; encounterId?: string; contingencyPlan?: ContingencyPlan },
  options?: BuildOptions,
): Observation[] {
  return mapContingencyPlanObservationImpl(specificCareMapperDependencies, values, options);
}

export function mapTreatments(
  values: { patientId: string; encounterId?: string; treatments?: TreatmentItem[] },
  options?: BuildOptions,
): Procedure[] {
  return mapTreatmentsImpl(specificCareMapperDependencies, values, options);
}

export function mapNocOutcomes(values: OutcomeValues, options?: BuildOptions): Observation[] {
  return mapNocOutcomesImpl(specificCareMapperDependencies, values, options);
}

export function mapExamObservations(
  values: { patientId: string; encounterId?: string; exams?: ExamItem[]; examsPending?: unknown },
  options?: BuildOptions,
  normalizedInput?: ReturnType<typeof normalizeExamInputs>,
): Observation[] {
  return mapExamObservationsImpl(specificCareMapperDependencies, values, options, normalizedInput);
}

export function mapProcedures(
  values: { patientId: string; encounterId?: string; procedures?: ProcedureItem[] },
  options?: BuildOptions,
): Procedure[] {
  return mapProceduresImpl(specificCareMapperDependencies, values, options);
}

function mapEvaObservation(
  pain: PainAssessment | undefined,
  context: MappingContext,
): Observation | null {
  return mapEvaObservationImpl(scalesMapperDependencies, pain, context);
}

function mapBradenObservation(
  braden: BradenScale | undefined,
  context: MappingContext,
): Observation | null {
  return mapBradenObservationImpl(scalesMapperDependencies, braden, context);
}

function mapGlasgowObservation(
  glasgow: GlasgowScale | undefined,
  context: MappingContext,
): Observation | null {
  return mapGlasgowObservationImpl(scalesMapperDependencies, glasgow, context);
}

export function mapRiskConditions(
  risksStructured: RiskItem[] | undefined,
  context: MappingContext,
): Condition[] {
  return mapRiskConditionsImpl(scalesMapperDependencies, risksStructured, context);
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
              system: DOCUMENT_CLASS_CODES.AUDIO_RECORDING.system,
              code: DOCUMENT_CLASS_CODES.AUDIO_RECORDING.code,
              display: DOCUMENT_CLASS_CODES.AUDIO_RECORDING.display,
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
              system: DOCUMENT_CLASS_CODES.ATTACHMENT.system,
              code: DOCUMENT_CLASS_CODES.ATTACHMENT.code,
              display: DOCUMENT_CLASS_CODES.ATTACHMENT.display,
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
  return mapAdministrativeObservationImpl(compositionMapperDependencies, values, context);
}

function mapSbarObservations(values: CompositionValues, context: MappingContext): Observation[] {
  return mapSbarObservationsImpl(compositionMapperDependencies, values, context);
}

function mapBedsideChecklistObservation(
  checklist: HandoverBedsideChecklist,
  context: MappingContext,
): Observation | null {
  return mapBedsideChecklistObservationImpl(compositionMapperDependencies, checklist, context);
}

function mapSummaryObservation(summary: string | null | undefined, context: MappingContext): Observation | null {
  return mapSummaryObservationImpl(compositionMapperDependencies, summary, context);
}

function mapPsychosocialObservation(
  psychosocial: PsychosocialCare | undefined,
  context: MappingContext,
): Observation | null {
  return mapPsychosocialObservationImpl(compositionMapperDependencies, psychosocial, context);
}

export function buildComposition(
  values: CompositionValues,
  refs: BundleReferenceIndex,
  options?: BuildOptions,
): Composition {
  return buildCompositionImpl(compositionMapperDependencies, values, refs, options);
}

function addClinicalContextToComposition(
  composition: Composition,
  refs: BundleReferenceIndex,
  clinicalContext: HandoverFhirClinicalContext | null,
): Composition {
  if (!clinicalContext) return composition;

  const extension = buildClinicalContextCompositionExtensions(clinicalContext);
  const section = refs.clinicalContext.length > 0
    ? {
        title: CLINICAL_CONTEXT_SECTION_TITLE,
        code: compositionSectionConcept('clinical-context', CLINICAL_CONTEXT_SECTION_TITLE),
        entry: refs.clinicalContext.map((reference) => ({ reference })),
      }
    : undefined;
  const nextSections = [
    ...(composition.section ?? []),
    ...(section ? [section] : []),
  ];

  return {
    ...composition,
    extension: extension ? [...(composition.extension ?? []), ...extension] : composition.extension,
    section: nextSections.length > 0 ? nextSections : composition.section,
  };
}
export function buildHandoverBundle(
  input: HandoverInput,
  options?: BuildOptions,
): Bundle {
  const values = 'values' in input ? input.values : input;
  const profileTrace = 'values' in input ? input.profileTrace : values.profileTrace;
  const optionsMerged: ResolvedBuildOptions = resolveOptions(options);
  const nowIso = optionsMerged.now();
  const sharedOptions: BuildOptions = { ...optionsMerged, now: () => nowIso };
  const applyProfiles = <T extends FhirResource>(resource: T) =>
    applyProfileUrls(resource, optionsMerged);
  const normalizedPatientId = normalizePatientId(values.patientId);

  const patient: Patient = {
    resourceType: 'Patient',
    id: normalizedPatientId,
    identifier: [{ system: HANDOVER_IDENTIFIER_SYSTEMS.patient, value: normalizedPatientId }],
  };

  const { resource: patientWithId, fullUrl: patientFullUrl } = assignStableIds(
    applyProfiles(patient),
    normalizedPatientId,
  );
  const patientSubjectReference: Reference = {
    reference: `Patient/${patientWithId.id ?? normalizedPatientId}`,
    type: 'Patient',
    identifier: { system: HANDOVER_IDENTIFIER_SYSTEMS.patient, value: normalizedPatientId },
  };
  const practitionerId =
    resolveReferenceId(values.author?.reference, 'Practitioner') ?? values.author?.id ?? 'handover-app';
  const practitioner: Practitioner = {
    resourceType: 'Practitioner',
    id: practitionerId,
    identifier: [{ system: HANDOVER_IDENTIFIER_SYSTEMS.practitioner, value: practitionerId }],
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
        class: FHIR_ENCOUNTER_CLASS_CODES.inpatient,
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
          identifier: { system: HANDOVER_IDENTIFIER_SYSTEMS.encounter, value: encounterId },
        }
      : undefined,
    effectiveDateTime: nowIso,
  };

  const clinicalContext = buildClinicalContextExport(profileTrace, values.pendingTasks);
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
  const clinicalContextObservation = mapClinicalContextObservation(clinicalContext, mappingContext);

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

  const turnContextObservations = mapTurnContextObservation(
    { patientId: values.patientId, encounterId, turnContext: values.turnContext },
    sharedOptions,
  ).map((observation) => replaceSubjectReference(observation, patientSubjectReference));

  const pendingTaskObservations = mapPendingTaskObservations(
    { patientId: values.patientId, encounterId, pendingTasks: values.pendingTasks },
    sharedOptions,
  ).map((observation) => replaceSubjectReference(observation, patientSubjectReference));

  const contingencyPlanObservations = mapContingencyPlanObservation(
    { patientId: values.patientId, encounterId, contingencyPlan: values.contingencyPlan },
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
  const riskConditions = mapRiskConditions(values.risksStructured, mappingContext);

  const medications = mapMedicationStatements(
    {
      patientId: values.patientId,
      encounterId,
      medications: values.medications,
    },
    sharedOptions,
  ).map((medication) => replaceSubjectReference(medication, patientSubjectReference));

  const treatmentProcedures = mapTreatments(
    { patientId: values.patientId, encounterId, treatments: values.treatments },
    sharedOptions,
  ).map((procedure) => replaceSubjectReference(procedure, patientSubjectReference));

  const outcomeObservations = mapNocOutcomes(
    { patientId: values.patientId, encounterId, outcomes: values.outcomes },
    sharedOptions,
  ).map((observation) => replaceSubjectReference(observation, patientSubjectReference));

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
        identifier: [{ system: HANDOVER_IDENTIFIER_SYSTEMS.practitioner, value: id }],
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
  const outcomeRefs: string[] = [];
  const oxygenRefs: string[] = [];
  const deviceRefs: string[] = [];
  const attachmentRefs: string[] = [];
  const administrativeRefs: string[] = [];
  const careRefs: string[] = [];
  const sbarRefs: string[] = [];
  const bedsideChecklistRefs: string[] = [];
  const notesRefs: string[] = [];
  const clinicalContextRefs: string[] = [];
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
  turnContextObservations.forEach((observation) => pushObservationEntry(observation, administrativeRefs));
  sbarObservations.forEach((observation) => pushObservationEntry(observation, sbarRefs));
  pushObservationEntry(bedsideChecklistObservation, bedsideChecklistRefs);
  contingencyPlanObservations.forEach((observation) => pushObservationEntry(observation, notesRefs));
  pushObservationEntry(summaryObservation, notesRefs);
  pushObservationEntry(clinicalContextObservation, clinicalContextRefs);
  pushObservationEntry(psychosocialObservation, careRefs);
  pendingTaskObservations.forEach((observation) => pushObservationEntry(observation, careRefs));

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
      request: { method: 'POST', url: resource.resourceType },
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

  outcomeObservations.forEach((observation) => {
    const { resource, fullUrl } = assignStableIds(
      applyProfiles(observation),
      values.patientId,
    );
    resourceEntries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Observation' },
    });
    outcomeRefs.push(referenceStringFromResource(resource));
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
    ...outcomeRefs,
    ...oxygenRefs,
    ...deviceRefs,
  );

  const compositionRefs: BundleReferenceIndex = {
    vitals: vitalsRefs,
    medications: medicationRefs,
    treatments: treatmentRefs,
    outcomes: outcomeRefs,
    oxygen: oxygenRefs,
    devices: deviceRefs,
    attachments: attachmentRefs,
    administrative: administrativeRefs,
    care: careRefs,
    sbar: sbarRefs,
    bedsideChecklist: bedsideChecklistRefs,
    notes: notesRefs,
    clinicalContext: clinicalContextRefs,
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
  };

  const composition = replaceSubjectReference(
    addClinicalContextToComposition(
      buildComposition(
        {
          patientId: values.patientId,
          encounterId,
          author: values.author,
          composition: values.composition,
          closingSummary: values.closingSummary,
          administrativeData: values.administrativeData,
          sbar: values.sbar,
          psychosocial: values.psychosocial,
          signatures: values.signatures,
          sectionSources: { exams: examInputCount, procedures: procedureInputCount },
        },
        compositionRefs,
        sharedOptions,
      ),
      compositionRefs,
      clinicalContext,
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
      'MedicationAdministration',
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

  const replaceInternalReferencesWithFullUrl = (bundleEntries: BundleEntry[]) => {
    const fullUrlByReference = new Map<string, string>();
    bundleEntries.forEach((entry) => {
      const resource = entry.resource as { resourceType?: string; id?: string };
      if (!resource?.resourceType || !resource.id || !entry.fullUrl) return;
      fullUrlByReference.set(`${resource.resourceType}/${resource.id}`, entry.fullUrl);
    });

    const replaceReferences = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach((item) => replaceReferences(item));
        return;
      }
      const record = value as Record<string, unknown>;
      if (typeof record.reference === 'string') {
        const fullUrl = fullUrlByReference.get(record.reference);
        if (fullUrl) {
          record.reference = fullUrl;
        }
      }
      Object.values(record).forEach((item) => replaceReferences(item));
    };

    bundleEntries.forEach((entry) => replaceReferences(entry.resource));
  };

  replaceInternalReferencesWithFullUrl(entries);

  const bundle: Bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: entries,
    signature: bundleSignature ? [bundleSignature] : undefined,
  };

  // BEGIN HANDOVER_FHIR_VALIDATION
  const shouldValidateBuiltBundle = process.env.NODE_ENV !== 'production';
  if (shouldValidateBuiltBundle) {
    const validation = validateFhirResource(bundle);
    if (!validation.isValid) {
      const messages = validation.errors.map((err) => `${err.path}: ${err.message}`);
      const error = new Error(messages.join('; '));
      (error as Error & { details: string[] }).details = messages;
      throw error;
    }
  }
  // END HANDOVER_FHIR_VALIDATION

  return bundle;
}

const deferBuild = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

export async function buildHandoverBundleAsync(
  input: HandoverInput,
  options?: BuildOptions,
): Promise<Bundle> {
  await deferBuild();
  return buildHandoverBundle(input, options);
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
    const resolved =
      diagnosis?.code?.trim()
        ? diagnosis
        : resolveSnomedCoding(diagnosis?.display ?? '');
    const trimmed = (resolved?.display ?? diagnosis?.display ?? '').trim();
    if (!trimmed) return;
    const coding = resolved?.code
      ? [
          {
            system: resolved.system,
            code: resolved.code,
            display: resolved.display,
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

  addCondition(data.dxMedical);

  const nursingStructured = (data.dxNursingStructured ?? []).filter((item) => item.system === 'NANDA');
  conditions.push(
    ...mapNandaConditions(nursingStructured, {
      subject: context.subject,
      encounter: context.encounter,
      effectiveDateTime: context.effectiveDateTime,
      clinicalStatus: conditionClinicalStatusActive,
      verificationStatus: conditionVerificationStatusUnconfirmed,
      problemListCategory: conditionProblemListCategory,
    }) as Condition[],
  );

  const legacyNursingText =
    typeof data.dxNursing === 'string'
      ? data.dxNursing.trim()
      : data.dxNursing && typeof data.dxNursing === 'object' && 'display' in data.dxNursing
        ? String((data.dxNursing as { display?: unknown }).display ?? '').trim()
        : '';

  if (nursingStructured.length === 0) {
    const legacyCondition = mapLegacyNursingCondition(legacyNursingText, {
      subject: context.subject,
      encounter: context.encounter,
      effectiveDateTime: context.effectiveDateTime,
      clinicalStatus: conditionClinicalStatusActive,
      verificationStatus: conditionVerificationStatusUnconfirmed,
      problemListCategory: conditionProblemListCategory,
    });
    if (legacyCondition) {
      conditions.push(legacyCondition as Condition);
    }
  }
  const structured = data.dxMedicalStructured ?? [];
  structured.forEach((item) => {
    conditions.push({
      resourceType: 'Condition',
      clinicalStatus: conditionClinicalStatusActive,
      verificationStatus: conditionVerificationStatusUnconfirmed,
      code: {
        coding: [
          {
            system: item.system === 'OTHER' ? HANDOVER_LOCAL_CODE_SYSTEMS.diagnosis : item.system,
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
  const turnContextObservations = mapTurnContextObservation(
    { patientId: data.patientId, encounterId, turnContext: data.turnContext },
    sharedOptions,
  );
  const pendingTaskObservations = mapPendingTaskObservations(
    { patientId: data.patientId, encounterId, pendingTasks: data.pendingTasks },
    sharedOptions,
  );
  const contingencyPlanObservations = mapContingencyPlanObservation(
    { patientId: data.patientId, encounterId, contingencyPlan: data.contingencyPlan },
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
  const riskConditions = mapRiskConditions(data.risksStructured, mappingContext);
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
    },
    sharedOptions,
  );
  const treatmentProcedures = mapTreatments(
    { patientId: data.patientId, encounterId, treatments: data.treatments },
    sharedOptions,
  );
  const outcomeObservations = mapNocOutcomes(
    { patientId: data.patientId, encounterId, outcomes: data.outcomes },
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
    identifier: [{ system: HANDOVER_IDENTIFIER_SYSTEMS.patient, value: data.patientId }],
  };

  const patientEntry = createTransactionEntry(applyProfiles(patient), uuidv4());
  const practitionerId = resolveReferenceId((data as { authorReference?: string }).authorReference, 'Practitioner')
    ?? (data as { authorId?: string }).authorId
    ?? 'handover-app';
  const practitioner: Practitioner = {
    resourceType: 'Practitioner',
    id: practitionerId,
    identifier: [{ system: HANDOVER_IDENTIFIER_SYSTEMS.practitioner, value: practitionerId }],
    name: [{ text: (data as { authorName?: string }).authorName ?? 'Handover Practitioner' }],
  };
  const encounter: Encounter | undefined = encounterId
    ? {
        resourceType: 'Encounter',
        id: encounterId,
        status: 'finished',
        class: FHIR_ENCOUNTER_CLASS_CODES.inpatient,
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
        identifier: [{ system: HANDOVER_IDENTIFIER_SYSTEMS.practitioner, value: id }],
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
    outcomes: [],
    oxygen: [],
    devices: [],
    attachments: [],
    administrative: [],
    care: [],
    sbar: [],
    bedsideChecklist: [],
    notes: [],
    clinicalContext: [],
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
        else if (resource.category?.some((c) => c.coding?.some((coding) => coding.code === CATEGORY.vitalSigns.code))) refs.vitals.push(reference);
        else if (resource.category?.some((c) => c.coding?.some((coding) => coding.code === NOC_OUTCOME_CATEGORY.code))) refs.outcomes.push(reference);
        else if (
          !resource.code?.coding?.length &&
          resource.category?.some((c) =>
            c.coding?.some((coding) => coding.system === TERMINOLOGY_SYSTEMS.OBSERVATION_CATEGORY),
          )
        )
          refs.exams.push(reference);
        else refs.mobilitySkin.push(reference);
        break;
      case 'MedicationStatement':
      case 'MedicationAdministration':
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
  turnContextObservations.forEach((observation) => pushObservationWithRefs(observation, refs.administrative));
  sbarObservations.forEach((observation) => pushObservationWithRefs(observation, refs.sbar));
  pushObservationWithRefs(bedsideChecklistObservation, refs.bedsideChecklist);
  contingencyPlanObservations.forEach((observation) => pushObservationWithRefs(observation, refs.notes));
  pushObservationWithRefs(summaryObservation, refs.notes);
  pushObservationWithRefs(psychosocialObservation, refs.care);
  pendingTaskObservations.forEach((observation) => pushObservationWithRefs(observation, refs.care));

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
  outcomeObservations.forEach(pushEntry);
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
    ...refs.outcomes,
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
  const urnPattern = /^urn:uuid:[0-9a-f]{32}$/;
  const entryReferenceSet = new Set(
    entries
      .map((entry) => {
        const resource = entry.resource as { resourceType?: string; id?: string };
        return resource?.resourceType && resource?.id ? `${resource.resourceType}/${resource.id}` : null;
      })
      .filter((value): value is string => Boolean(value)),
  );
  const entryFullUrlSet = new Set(entries.map((entry) => entry.fullUrl).filter(Boolean));
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
      if (!referencePattern.test(reference) && !urnPattern.test(reference)) {
        errors.push(`entry[${index}].reference "${reference}" is not ResourceType/id`);
        return;
      }
      if (urnPattern.test(reference)) {
        if (!entryFullUrlSet.has(reference)) {
          errors.push(`entry[${index}].reference "${reference}" does not resolve to bundle entries`);
        }
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
  Annotation,
  Observation,
  ObservationComponent,
  CodeableConcept,
  Quantity,
  Reference,
  Meta,
  ResolvedBuildOptions,
  ObservationVitalsInput,
  MedicationStatementInput,
  OxygenTherapyInput,
  AttesterInput,
  MedicationValues,
  OxygenValues,
  DocumentValues,
  OutcomeValues,
  CompositionValues,
  BundleReferenceIndex,
  MappingContext,
  Signature,
  CompositionAttester,
  MedicationStatement,
  MedicationAdministration,
  Procedure,
  DeviceUseStatement,
  Device,
  DocumentReference,
  Composition,
  Condition,
  Bundle,
  MedicationResource,
};

export const __test__ = {
  stableUrn,
  stableHash,
  stableStringify,
  LOINC: TEST_LOINC,
};

