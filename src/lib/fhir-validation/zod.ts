import { z } from 'zod';
import { schemas } from '../fhir/validators';

export interface ValidationResult {
  isValid: boolean;
  errors: Array<{ path: string; message: string }>;
}

const genericResourceSchema = z
  .object({
    resourceType: z.string().min(1),
    id: z.string().min(1).optional(),
  })
  .catchall(z.unknown());

const resourceSchemas: Record<string, z.ZodTypeAny> = {
  Observation: schemas.observation,
  Condition: schemas.condition,
  MedicationStatement: schemas.medicationStatement,
  MedicationAdministration: schemas.medicationAdministration,
  DeviceUseStatement: schemas.deviceUseStatement,
  DocumentReference: schemas.documentReference,
  Composition: schemas.composition,
  Procedure: schemas.procedure,
  Patient: schemas.patient,
  Practitioner: schemas.practitioner,
  Encounter: schemas.encounter,
  Device: schemas.device,
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

type IndexedEntry = {
  index: number;
  fullUrl?: string;
  request?: { method?: string; url?: string };
  resource?: {
    resourceType?: string;
    id?: string;
    subject?: { reference?: string };
    encounter?: { reference?: string };
    context?: { reference?: string };
  };
};

function collectReferenceNodes(
  value: unknown,
  path: Array<string | number> = [],
  refs: Array<{ path: Array<string | number>; reference: string }> = [],
) {
  if (!value || typeof value !== 'object') return refs;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectReferenceNodes(item, [...path, index], refs));
    return refs;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.reference === 'string') {
    refs.push({ path: [...path, 'reference'], reference: record.reference });
  }

  Object.entries(record).forEach(([key, nested]) => {
    collectReferenceNodes(nested, [...path, key], refs);
  });

  return refs;
}

function normalizeResourceReference(reference: string): string | undefined {
  const segments = reference.split('/');
  if (segments.length !== 2) return undefined;

  const [resourceType, resourceId] = segments;
  if (!resourceType || !resourceId) return undefined;

  try {
    const decodedId = decodeURIComponent(resourceId);
    if (decodedId === resourceId) return undefined;
    if (encodeURIComponent(decodedId) !== resourceId) return undefined;
    return `${resourceType}/${decodedId}`;
  } catch {
    return undefined;
  }
}

function validateBundleContract(entries: IndexedEntry[]): ValidationResult['errors'] {
  const errors: ValidationResult['errors'] = [];
  const entryTypes = new Set<string>();
  const fullUrlToIndex = new Map<string, number>();
  const resourceRefToIndex = new Map<string, number>();
  const patientIndexes: number[] = [];
  const encounterIndexes: number[] = [];
  const practitionerIndexes: number[] = [];

  entries.forEach((entry) => {
    const resourceType = entry.resource?.resourceType;
    if (resourceType) entryTypes.add(resourceType);

    if (typeof entry.fullUrl === 'string') {
      if (fullUrlToIndex.has(entry.fullUrl)) {
        errors.push({
          path: `entry[${entry.index}].fullUrl`,
          message: `Duplicate fullUrl "${entry.fullUrl}"`,
        });
      } else {
        fullUrlToIndex.set(entry.fullUrl, entry.index);
      }
    }

    if (resourceType && typeof entry.resource?.id === 'string' && entry.resource.id.length > 0) {
      const resourceReference = `${resourceType}/${entry.resource.id}`;
      if (resourceRefToIndex.has(resourceReference)) {
        errors.push({
          path: `entry[${entry.index}].resource.id`,
          message: `Duplicate resource reference "${resourceReference}"`,
        });
      } else {
        resourceRefToIndex.set(resourceReference, entry.index);
      }
    }

    if (resourceType === 'Patient') patientIndexes.push(entry.index);
    if (resourceType === 'Encounter') encounterIndexes.push(entry.index);
    if (resourceType === 'Practitioner') practitionerIndexes.push(entry.index);

    if (
      entry.request &&
      typeof entry.request.url === 'string' &&
      resourceType &&
      entry.request.url !== resourceType
    ) {
      errors.push({
        path: `entry[${entry.index}].request.url`,
        message: 'request.url must match resourceType',
      });
    }

    if (
      entry.request &&
      typeof entry.request.method === 'string' &&
      entry.request.method !== 'POST'
    ) {
      errors.push({
        path: `entry[${entry.index}].request.method`,
        message: 'transaction entries must use POST',
      });
    }
  });

  const resolveReferenceIndex = (reference: string): number | undefined => {
    if (fullUrlToIndex.has(reference)) return fullUrlToIndex.get(reference);
    if (resourceRefToIndex.has(reference)) return resourceRefToIndex.get(reference);
    const normalizedReference = normalizeResourceReference(reference);
    if (normalizedReference && resourceRefToIndex.has(normalizedReference)) {
      return resourceRefToIndex.get(normalizedReference);
    }
    return undefined;
  };

  entries.forEach((entry) => {
    if (!entry.resource) return;

    collectReferenceNodes(entry.resource).forEach(({ path, reference }) => {
      if (reference.startsWith('urn:uuid:')) {
        if (!fullUrlToIndex.has(reference)) {
          errors.push({
            path: `entry[${entry.index}].resource.${formatPath(path)}`,
            message: `Reference "${reference}" does not resolve to a bundle entry`,
          });
        }
        return;
      }

      const segments = reference.split('/');
      if (segments.length !== 2) {
        return;
      }

      const [referenceType] = segments;
      if (entryTypes.has(referenceType) && resolveReferenceIndex(reference) === undefined) {
        errors.push({
          path: `entry[${entry.index}].resource.${formatPath(path)}`,
          message: `Reference "${reference}" does not resolve to a bundle entry`,
        });
      }
    });
  });

  const enforceResolvedDirectReference = (
    entry: IndexedEntry,
    path: 'subject' | 'encounter' | 'context',
    expectedIndexes: number[],
  ) => {
    const reference = entry.resource?.[path]?.reference;
    if (typeof reference !== 'string' || expectedIndexes.length !== 1) return;
    const resolvedIndex = resolveReferenceIndex(reference);
    if (resolvedIndex === undefined) return;
    if (resolvedIndex !== expectedIndexes[0]) {
      errors.push({
        path: `entry[${entry.index}].resource.${path}.reference`,
        message: `Expected ${path}.reference to resolve to the bundle ${path === 'subject' ? 'patient' : 'encounter'}`,
      });
    }
  };

  entries.forEach((entry) => {
    const resourceType = entry.resource?.resourceType;
    if (!resourceType || resourceType === 'Patient') return;

    enforceResolvedDirectReference(entry, 'subject', patientIndexes);

    if (resourceType !== 'Encounter') {
      enforceResolvedDirectReference(entry, 'encounter', encounterIndexes);
      enforceResolvedDirectReference(entry, 'context', encounterIndexes);
    }
  });

  entries
    .filter((entry) => entry.resource?.resourceType === 'Composition')
    .forEach((entry) => {
      if (patientIndexes.length === 1 && !entry.resource?.subject?.reference) {
        errors.push({
          path: `entry[${entry.index}].resource.subject.reference`,
          message: 'Composition.subject.reference is required when the bundle includes a Patient',
        });
      }

      if (encounterIndexes.length === 1 && !entry.resource?.encounter?.reference) {
        errors.push({
          path: `entry[${entry.index}].resource.encounter.reference`,
          message: 'Composition.encounter.reference is required when the bundle includes an Encounter',
        });
      }

      if (!Array.isArray((entry.resource as { author?: unknown }).author) || (entry.resource as { author?: unknown[] }).author?.length === 0) {
        errors.push({
          path: `entry[${entry.index}].resource.author`,
          message: 'Composition.author is required',
        });
      }

      if (practitionerIndexes.length === 1) {
        const authors = ((entry.resource as { author?: Array<{ reference?: string }> }).author ?? []);
        authors.forEach((author, authorIndex) => {
          if (typeof author?.reference !== 'string') return;
          const resolvedIndex = resolveReferenceIndex(author.reference);
          if (resolvedIndex === undefined) return;
          if (resolvedIndex !== practitionerIndexes[0]) {
            errors.push({
              path: `entry[${entry.index}].resource.author[${authorIndex}].reference`,
              message: 'Composition.author.reference must resolve to the bundle practitioner',
            });
          }
        });
      }
    });

  return errors;
}

export function validateResourceWithZod(resource: unknown): ValidationResult {
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
  const entries = (parsed.data.entry ?? []).map((entry, index) => ({
    index,
    fullUrl: typeof entry.fullUrl === 'string' ? entry.fullUrl : undefined,
    request:
      entry.request && typeof entry.request === 'object'
        ? {
            method: typeof entry.request.method === 'string' ? entry.request.method : undefined,
            url: typeof entry.request.url === 'string' ? entry.request.url : undefined,
          }
        : undefined,
    resource:
      entry.resource && typeof entry.resource === 'object'
        ? (entry.resource as IndexedEntry['resource'])
        : undefined,
  }));

  entries.forEach((entry, index) => {
    const resource = entry?.resource;
    if (!resource) return;
    const result = validateResourceWithZod(resource);
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

  errors.push(...validateBundleContract(entries));

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return { isValid: true, errors: [] };
}

export function getValidationErrorsFromBundle(bundle: unknown): ValidationResult['errors'] | undefined {
  if (!bundle || typeof bundle !== 'object') return undefined;
  return sanitizeErrors((bundle as any)._validationErrors);
}
