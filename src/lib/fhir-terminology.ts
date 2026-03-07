import { TERMINOLOGY_SYSTEMS } from './codes';

export const FHIR_PROFILE_URI_UNSPECIFIED = 'no especificado';
export const FHIR_LOCAL_TERMINOLOGY_NAMESPACE = 'urn:handover:';

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

