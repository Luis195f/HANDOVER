import { FHIR_BASE_URL } from '@/src/config/env';
import { formatIssuesForUser, type OperationIssue } from '@/src/lib/fhir-outcome';
import {
  validateBundle as validateFHIRBundle,
  validateResourceWithZod,
  type ValidationResult,
} from '@/src/lib/fhir-validation/zod';

export type ValidationErrorDetail = ValidationResult['errors'][number];
export type ValidationMode = 'off' | 'local' | 'remote';
export type ValidationOptions = {
  mode?: ValidationMode;
  accessToken?: string;
  fhirBaseUrl?: string;
};

function resolveEnvValidationMode(): ValidationMode {
  return (
    (process.env.EXPO_PUBLIC_HANDOVER_FHIR_VALIDATION_MODE as ValidationMode | undefined) ||
    (process.env.HANDOVER_FHIR_VALIDATION_MODE as ValidationMode | undefined) ||
    'off'
  );
}

function annotateValidationErrors(bundle: unknown, errors: ValidationErrorDetail[]) {
  if (!bundle || typeof bundle !== 'object') return;
  (bundle as Record<string, unknown>)._validationErrors = errors;
}

function clearValidationErrors(bundle: unknown) {
  if (!bundle || typeof bundle !== 'object') return;
  if ('_validationErrors' in bundle) {
    try {
      delete (bundle as Record<string, unknown>)._validationErrors;
    } catch {
      (bundle as Record<string, unknown>)._validationErrors = undefined;
    }
  }
}

export function serializeIssuesForStorage(issues?: OperationIssue[], max = 10): string | undefined {
  if (!Array.isArray(issues) || issues.length === 0) return undefined;
  return JSON.stringify(issues.slice(0, max));
}

export function capIssuesJson(value?: string, max = 10): string | undefined {
  if (!value) return value;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return JSON.stringify(parsed.slice(0, max));
    }
  } catch {
    return value;
  }
  return value;
}

export function resolveValidationMode(input?: ValidationMode): ValidationMode {
  if (input === 'off' || input === 'local' || input === 'remote') return input;
  const envMode = resolveEnvValidationMode();
  if (envMode === 'local' || envMode === 'remote') return envMode;
  return 'off';
}

function enforceBundleValidation(bundle: unknown, context: string) {
  const result = validateFHIRBundle(bundle);
  if (!result.isValid) {
    const error = new Error(`FHIR bundle validation failed (${context}): ${JSON.stringify(result.errors)}`);
    (error as Error & { validationErrors: ValidationResult['errors'] }).validationErrors = result.errors;
    annotateValidationErrors(bundle, result.errors);
    throw error;
  }

  const fhirValidation = validateResourceWithZod(bundle);
  if (!fhirValidation.isValid) {
    const mappedErrors = fhirValidation.errors;
    const error = new Error(
      `FHIR structure validation failed (${context}): ${mappedErrors.map((err) => err.message).join('; ')}`,
    );
    (error as Error & { validationErrors: ValidationResult['errors'] }).validationErrors = mappedErrors;
    annotateValidationErrors(bundle, mappedErrors);
    throw error;
  }

  clearValidationErrors(bundle);
}

export async function enforceLocalBundleValidation(
  bundle: unknown,
  context: string,
  opts?: ValidationOptions,
): Promise<void> {
  if (resolveValidationMode(opts?.mode) === 'off') return;
  enforceBundleValidation(bundle, context);
}

async function remoteValidateResource(
  resource: Record<string, unknown>,
  opts: Required<Pick<ValidationOptions, 'accessToken' | 'fhirBaseUrl'>>,
): Promise<ValidationErrorDetail[] | null> {
  const resourceType = typeof resource?.resourceType === 'string' ? resource.resourceType : undefined;
  if (!resourceType) return null;

  const url = `${opts.fhirBaseUrl.replace(/\/+$/, '')}/${resourceType}/$validate`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/fhir+json',
    Accept: 'application/fhir+json',
  };
  if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;

  try {
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(resource) });
    if (!resp.ok && resp.status >= 500) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const outcome = await resp.json();
    const issues = Array.isArray(outcome?.issue) ? outcome.issue : [];
    const errors = issues
      .filter((issue: any) => issue?.severity === 'error' || issue?.severity === 'fatal')
      .map((issue: any, index: number) => ({
        path: issue?.expression?.[0] ?? `${resourceType}[${index}]`,
        message: issue?.diagnostics ?? issue?.details?.text ?? 'Validation error',
      }));

    return errors.length > 0 ? errors : null;
  } catch (error) {
    const err = error as Error;
    throw new Error(`Remote validation failed for ${resourceType}: ${err.message}`);
  }
}

export async function enforceBundleValidationWithMode(
  bundle: unknown,
  context: string,
  opts?: ValidationOptions,
): Promise<void> {
  const mode = resolveValidationMode(opts?.mode);
  if (mode === 'off') return;

  enforceBundleValidation(bundle, context);
  if (mode !== 'remote') return;

  const fhirBaseUrl = opts?.fhirBaseUrl ?? FHIR_BASE_URL;
  const accessToken = opts?.accessToken ?? '';
  const entries = Array.isArray((bundle as { entry?: unknown[] } | null | undefined)?.entry)
    ? ((bundle as { entry?: unknown[] }).entry ?? [])
    : [];
  const resources = entries
    .map((entry: any) => (entry && typeof entry === 'object' ? entry.resource : null))
    .filter((res): res is Record<string, unknown> => !!res && typeof res === 'object');

  const errors: ValidationErrorDetail[] = [];
  const concurrency = 3;
  for (let index = 0; index < resources.length; index += concurrency) {
    const slice = resources.slice(index, index + concurrency);
    const results = await Promise.all(
      slice.map((resource) => remoteValidateResource(resource, { accessToken, fhirBaseUrl })),
    );
    for (const result of results) {
      if (result && result.length > 0) {
        errors.push(...result);
      }
    }
  }

  if (errors.length > 0) {
    annotateValidationErrors(bundle, errors);
    const issues = errors.map((err) => ({ diagnostics: err.message, expression: [err.path] }));
    const formatted = formatIssuesForUser(issues, { max: 5 });
    const error = new Error(formatted.message);
    (error as Error & { validationErrors: ValidationResult['errors'] }).validationErrors = errors;
    throw error;
  }

  clearValidationErrors(bundle);
}

export async function enforceRemoteBundleValidationIfNeeded(
  bundle: unknown,
  context: string,
  opts?: ValidationOptions,
): Promise<void> {
  if (resolveValidationMode(opts?.mode) !== 'remote') return;
  await enforceBundleValidationWithMode(bundle, context, { ...opts, mode: 'remote' });
}
