/*
 * FHIR profile URLs for handover exports.
 * NOTE: This module intentionally avoids Spain-specific profile URLs.
 * Configure these values per deployment (SNS/regional/partner) as needed.
 */

export const FHIR_PROFILES = {
  bundle: {
    default: 'https://example.org/fhir/StructureDefinition/handover-bundle-transaction',
  },
  composition: {
    default: 'https://example.org/fhir/StructureDefinition/handover-composition',
  },
  patient: {
    default: 'https://example.org/fhir/StructureDefinition/handover-patient',
  },
  practitioner: {
    default: 'https://example.org/fhir/StructureDefinition/handover-practitioner',
  },
  encounter: {
    default: 'https://example.org/fhir/StructureDefinition/handover-encounter',
  },
  observation: {
    default: 'https://example.org/fhir/StructureDefinition/handover-observation',
  },
  medicationStatement: {
    default: 'https://example.org/fhir/StructureDefinition/handover-medication-statement',
  },
  procedure: {
    default: 'https://example.org/fhir/StructureDefinition/handover-procedure',
  },
  condition: {
    default: 'https://example.org/fhir/StructureDefinition/handover-condition',
  },
  detectedIssue: {
    default: 'https://example.org/fhir/StructureDefinition/handover-detected-issue',
  },
  documentReference: {
    default: 'https://example.org/fhir/StructureDefinition/handover-document-reference',
  },
  deviceUseStatement: {
    default: 'https://example.org/fhir/StructureDefinition/handover-device-use-statement',
  },
  device: {
    default: 'https://example.org/fhir/StructureDefinition/handover-device',
  },
} as const;

export const FHIR_PROFILE_URLS_BY_RESOURCE_TYPE: Partial<Record<string, string[]>> = {
  Bundle: [FHIR_PROFILES.bundle.default],
  Composition: [FHIR_PROFILES.composition.default],
  Patient: [FHIR_PROFILES.patient.default],
  Practitioner: [FHIR_PROFILES.practitioner.default],
  Encounter: [FHIR_PROFILES.encounter.default],
  Observation: [FHIR_PROFILES.observation.default],
  MedicationStatement: [FHIR_PROFILES.medicationStatement.default],
  Procedure: [FHIR_PROFILES.procedure.default],
  Condition: [FHIR_PROFILES.condition.default],
  DetectedIssue: [FHIR_PROFILES.detectedIssue.default],
  DocumentReference: [FHIR_PROFILES.documentReference.default],
  DeviceUseStatement: [FHIR_PROFILES.deviceUseStatement.default],
  Device: [FHIR_PROFILES.device.default],
};

// Prepared placeholders for profile slicing definitions (future use).
export const FHIR_PROFILE_SLICES = {
  composition: [],
  observation: [],
  medicationStatement: [],
  procedure: [],
  condition: [],
} as const;
