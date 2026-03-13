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
import {
  getValidationErrorsFromBundle,
  validateBundle as validateBundleWithZod,
  validateResourceWithZod,
  type ValidationResult,
} from './zod';

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
export type FhirValidationResult = ValidationResult;
export type AjvValidationSummary = ValidationResult;

function toValidationPath(instancePath: string): string {
  if (!instancePath) {
    return '$';
  }

  return instancePath
    .split('/')
    .slice(1)
    .map((segment) => decodeURIComponent(segment))
    .reduce((acc, segment) => {
      if (/^\d+$/.test(segment)) {
        return `${acc}[${segment}]`;
      }
      return acc ? `${acc}.${segment}` : segment;
    }, '');
}

function formatAjvError(err: ErrorObject): ValidationResult['errors'][number] {
  const ajvError = err as ErrorObject & {
    keyword?: string;
    params?: { missingProperty?: unknown };
  };
  const missingProperty =
    ajvError.keyword === 'required' && typeof ajvError.params?.missingProperty === 'string'
      ? String(ajvError.params.missingProperty)
      : undefined;
  const basePath = toValidationPath(err.instancePath || '');
  const path = missingProperty
    ? basePath && basePath !== '$'
      ? `${basePath}.${missingProperty}`
      : missingProperty
    : basePath;

  return {
    path: path || '$',
    message: err.message ?? 'Invalid resource',
  };
}

export function validateResourceWithAjv(resource: unknown, type: FhirResourceType): ValidationResult {
  const validate = validators[type];
  const valid = validate(resource);
  if (valid) {
    return { isValid: true, errors: [] };
  }

  return {
    isValid: false,
    errors: (validate.errors ?? []).map(formatAjvError),
  };
}

export const validateResourceAjv = validateResourceWithAjv;

export function validateBundleWithAjv(bundle: unknown): ValidationResult {
  return validateResourceWithAjv(bundle, 'Bundle');
}

export const validateResource = validateResourceWithZod;
export const validateBundle = validateBundleWithZod;

export {
  getValidationErrorsFromBundle,
  validateBundleWithZod,
  validateResourceWithZod,
  type ValidationResult,
};
// END HANDOVER_FHIR_VALIDATION
