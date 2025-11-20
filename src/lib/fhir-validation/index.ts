// BEGIN HANDOVER_FHIR_VALIDATION
import Ajv, { ErrorObject } from './local-ajv';
import bundleSchema from './schemas/Bundle.json';
import compositionSchema from './schemas/Composition.json';
import conditionSchema from './schemas/Condition.json';
import deviceUseStatementSchema from './schemas/DeviceUseStatement.json';
import documentReferenceSchema from './schemas/DocumentReference.json';
import medicationStatementSchema from './schemas/MedicationStatement.json';
import observationSchema from './schemas/Observation.json';
import patientSchema from './schemas/Patient.json';
import procedureSchema from './schemas/Procedure.json';

const ajv = new Ajv({ allErrors: true, strict: false });

const validators = {
  Bundle: ajv.compile(bundleSchema),
  Composition: ajv.compile(compositionSchema),
  Condition: ajv.compile(conditionSchema),
  DeviceUseStatement: ajv.compile(deviceUseStatementSchema),
  DocumentReference: ajv.compile(documentReferenceSchema),
  MedicationStatement: ajv.compile(medicationStatementSchema),
  Observation: ajv.compile(observationSchema),
  Patient: ajv.compile(patientSchema),
  Procedure: ajv.compile(procedureSchema),
} as const;

export type FhirResourceType = keyof typeof validators;

export type FhirValidationResult = { ok: true } | { ok: false; errors: string[] };

export function validateResource(resource: unknown, type: FhirResourceType): FhirValidationResult {
  const validate = validators[type];
  const valid = validate(resource);
  if (valid) return { ok: true } as const;
  const errors = (validate.errors ?? []).map(formatAjvError);
  return { ok: false, errors } as const;
}

function formatAjvError(err: ErrorObject): string {
  const path = err.instancePath || '/';
  const message = err.message ?? '';
  return `${path} ${message}`.trim();
}
// END HANDOVER_FHIR_VALIDATION

export {
  getValidationErrorsFromBundle,
  validateBundle,
  validateResource as validateResourceWithZod,
  type ValidationResult,
} from './zod';
