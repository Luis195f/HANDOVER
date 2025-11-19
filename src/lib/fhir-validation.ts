import { z } from 'zod';
import { schemas } from './fhir/validators';

export interface ValidationResult {
  isValid: boolean;
  errors: Array<{ path: string; message: string }>;
}

const genericResourceSchema = z
  .object({
    resourceType: z.string().min(1),
    id: z.string().min(1).optional(),
  })
  .passthrough();

const resourceSchemas: Record<string, z.ZodTypeAny> = {
  Observation: schemas.observation,
  MedicationStatement: schemas.medicationStatement,
  DeviceUseStatement: schemas.deviceUseStatement,
  DocumentReference: schemas.documentReference,
  Composition: schemas.composition,
};

const bundleSchema = schemas.bundle;

function formatIssues(issues: z.ZodIssue[]): ValidationResult['errors'] {
  return issues.map((issue) => ({
    path: formatPath(issue.path),
    message: issue.message,
  }));
}

function formatPath(path: (string | number)[]): string {
  if (!path || path.length === 0) return '$';
  return path
    .map((segment) => (typeof segment === 'number' ? `[${segment}]` : segment))
    .reduce((acc, segment) => {
      if (segment.startsWith('[')) {
        return `${acc}${segment}`;
      }
      return acc ? `${acc}.${segment}` : segment;
    }, '');
}

function sanitizeErrors(errors: unknown): ValidationResult['errors'] | undefined {
  if (!Array.isArray(errors)) return undefined;
  const mapped = errors
    .filter((entry): entry is { path?: unknown; message?: unknown } => !!entry && typeof entry === 'object')
    .map((entry) => ({
      path: typeof entry.path === 'string' && entry.path.length > 0 ? entry.path : '$',
      message: typeof entry.message === 'string' ? entry.message : 'Invalid resource',
    }));
  return mapped.length > 0 ? mapped : undefined;
}

export function validateResource(resource: unknown): ValidationResult {
  if (!resource || typeof resource !== 'object') {
    return {
      isValid: false,
      errors: [{ path: '$', message: 'Resource must be an object' }],
    };
  }

  const resourceType = (resource as { resourceType?: unknown }).resourceType;
  if (typeof resourceType !== 'string' || resourceType.length === 0) {
    return {
      isValid: false,
      errors: [{ path: '$.resourceType', message: 'resourceType is required' }],
    };
  }

  const schema = resourceSchemas[resourceType] ?? genericResourceSchema;
  const result = schema.safeParse(resource);
  if (!result.success) {
    return { isValid: false, errors: formatIssues(result.error.issues) };
  }

  const bundledErrors = sanitizeErrors((resource as any)._validationErrors);
  if (bundledErrors) {
    return { isValid: false, errors: bundledErrors };
  }

  return { isValid: true, errors: [] };
}

export function validateBundle(bundle: unknown): ValidationResult {
  const parsed = bundleSchema.safeParse(bundle);
  if (!parsed.success) {
    return { isValid: false, errors: formatIssues(parsed.error.issues) };
  }

  const errors: ValidationResult['errors'] = [];
  const entries = parsed.data.entry ?? [];

  entries.forEach((entry, index) => {
    const resource = entry?.resource;
    if (!resource) return;
    const result = validateResource(resource);
    if (!result.isValid) {
      errors.push(
        ...result.errors.map((err) => {
          const suffix = err.path.replace(/^\$\./, '').replace(/^\$/, '');
          const prefix = suffix ? `entry[${index}].${suffix}` : `entry[${index}]`;
          return {
            path: prefix,
            message: err.message,
          };
        })
      );
    }
  });

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return { isValid: true, errors: [] };
}

export function getValidationErrorsFromBundle(bundle: unknown): ValidationResult['errors'] | undefined {
  if (!bundle || typeof bundle !== 'object') return undefined;
  return sanitizeErrors((bundle as any)._validationErrors);
}
