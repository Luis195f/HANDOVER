import { TERMINOLOGY_SYSTEMS } from './codes';

export const FHIR_PROFILE_URI_UNSPECIFIED = 'no especificado';
export const FHIR_LOCAL_TERMINOLOGY_NAMESPACE = 'urn:handover:';

export const HANDOVER_IDENTIFIER_SYSTEMS = {
  patient: 'urn:handover-pro:patient-id',
  encounter: 'urn:handover-pro:encounter-id',
  practitioner: 'urn:handover-pro:practitioner-id',
  treatmentItem: 'urn:handover-pro:treatment-item',
  user: 'urn:handover:user-id',
  unit: 'urn:handover:unit-id',
} as const;

export const HANDOVER_LOCAL_CODE_SYSTEMS = {
  diagnosis: 'urn:handover-pro:diagnosis',
  signatureType: 'urn:handover:signature-type',
  compositionType: 'urn:handover-pro:composition-type',
} as const;

export const FHIR_CORE_PROFILE_URLS = {
  vitalSigns: 'http://hl7.org/fhir/StructureDefinition/vitalsigns',
  bloodPressure: 'http://hl7.org/fhir/StructureDefinition/bp',
  observation: 'http://hl7.org/fhir/StructureDefinition/Observation',
} as const;

export const FHIR_ENCOUNTER_CLASS_CODES = {
  inpatient: {
    system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
    code: 'IMP',
    display: 'inpatient encounter',
  },
} as const;

export const HANDOVER_SIGNATURE_TYPE = {
  system: HANDOVER_LOCAL_CODE_SYSTEMS.signatureType,
  code: 'signature',
  display: 'Signature',
} as const;

export const HANDOVER_COMPOSITION_TYPE = {
  system: HANDOVER_LOCAL_CODE_SYSTEMS.compositionType,
  code: 'handover-shift',
  display: 'Nursing shift handover',
} as const;

export const HANDOVER_COMPOSITION_SECTION_CODES = {
  administrative: {
    system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPOSITION_SECTION,
    code: 'administrative',
    display: 'Administrative',
  },
  vitals: {
    system: TERMINOLOGY_SYSTEMS.LOINC,
    code: '85353-1',
    display: 'Vital signs',
  },
  care: {
    system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPOSITION_SECTION,
    code: 'care-treatments',
    display: 'Care / Treatments',
  },
  sbar: {
    system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPOSITION_SECTION,
    code: 'sbar',
    display: 'SBAR',
  },
  bedsideChecklist: {
    system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPOSITION_SECTION,
    code: 'bedside-checklist',
    display: 'Bedside checklist',
  },
  notes: {
    system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPOSITION_SECTION,
    code: 'notes-summary',
    display: 'Notes / Summary',
  },
} as const;

export const HANDOVER_OBSERVATION_CODES = {
  administrative: {
    system: TERMINOLOGY_SYSTEMS.HANDOVER_OBSERVATION_CODES,
    code: 'administrative',
    display: 'Administrative overview',
  },
  sbar: {
    system: TERMINOLOGY_SYSTEMS.HANDOVER_SBAR,
    code: 'sbar',
    display: 'SBAR summary',
  },
  bedsideChecklist: {
    system: TERMINOLOGY_SYSTEMS.HANDOVER_BEDSIDE_CHECKLIST,
    code: 'bedside-checklist',
    display: 'Bedside checklist',
  },
  notes: {
    system: TERMINOLOGY_SYSTEMS.HANDOVER_OBSERVATION_CODES,
    code: 'handover-notes',
    display: 'Handover notes',
  },
} as const;

export const HANDOVER_CLINICAL_CONTEXT_COMPONENT_CODES = {
  coreProfile: {
    system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT,
    code: 'core-profile',
    display: 'Core profile',
  },
  unitProfile: {
    system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT,
    code: 'unit-profile',
    display: 'Unit profile',
  },
  specialtyOverlay: {
    system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT,
    code: 'specialty-overlay',
    display: 'Specialty overlay',
  },
  prioritySignal: {
    system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT,
    code: 'priority-signal',
    display: 'Contextual priority signal',
  },
  pendingCriticalTaskCount: {
    system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT,
    code: 'pending-critical-task-count',
    display: 'Pending critical task count',
  },
} as const;

export const NANDA_DIAGNOSIS_SYSTEM_URI = TERMINOLOGY_SYSTEMS.NANDA_I;
export const NIC_INTERVENTION_SYSTEM_URI = TERMINOLOGY_SYSTEMS.NIC;
export const NOC_OUTCOME_SYSTEM_URI = TERMINOLOGY_SYSTEMS.NOC;
export const NOC_SCORE_COMPONENT_SYSTEM = TERMINOLOGY_SYSTEMS.HANDOVER_NOC_SCORE;

export const NOC_OUTCOME_CATEGORY = {
  system: TERMINOLOGY_SYSTEMS.OBSERVATION_CATEGORY,
  code: 'outcome',
  display: 'Outcome',
} as const;

export const NOC_SCORE_COMPONENT_CODES = {
  baseline: { system: NOC_SCORE_COMPONENT_SYSTEM, code: 'baseline', display: 'Baseline score' },
  target: { system: NOC_SCORE_COMPONENT_SYSTEM, code: 'target', display: 'Target score' },
  current: { system: NOC_SCORE_COMPONENT_SYSTEM, code: 'current', display: 'Current score' },
} as const;

export const MINIMUM_VIABLE_NNN_MAPPING = {
  nanda: {
    concept: 'NANDA',
    resourceType: 'Condition',
    field: 'Condition.code',
    system: NANDA_DIAGNOSIS_SYSTEM_URI,
    profileUri: FHIR_PROFILE_URI_UNSPECIFIED,
    notes:
      'Uses the local urn:handover:terminology:* namespace until a licensed external NANDA URI is available.',
  },
  nic: {
    concept: 'NIC',
    resourceType: 'Procedure',
    field: 'Procedure.code',
    system: NIC_INTERVENTION_SYSTEM_URI,
    profileUri: FHIR_PROFILE_URI_UNSPECIFIED,
    notes:
      'Procedure is kept as the minimum viable target resource to preserve existing bundle compatibility; local treatment coding may coexist in the same CodeableConcept.',
  },
  noc: {
    concept: 'NOC',
    resourceType: 'Observation',
    field: 'Observation.code',
    system: NOC_OUTCOME_SYSTEM_URI,
    profileUri: FHIR_PROFILE_URI_UNSPECIFIED,
    notes:
      'Observation.category keeps code outcome and score components use the local urn:handover-pro:noc-score namespace for baseline/target/current.',
  },
} as const;

