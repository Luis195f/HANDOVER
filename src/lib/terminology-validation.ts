import { DIAGNOSIS_CODES } from '../catalogs/diagnosisCodes';
import {
  FHIR_CODES,
  LOINC,
  MEDICATIONS_QUICKPICK_ICU,
  SNOMED,
  TERMINOLOGY_SYSTEMS,
  type TerminologySystem,
} from './codes';
import { fetchFHIR } from './fhir-client';

export type ValidationMode = 'off' | 'local' | 'remote';

export type CodeValidationResult = {
  valid: boolean;
  message?: string;
  source: 'local' | 'remote' | 'cache' | 'offline';
};

const snomedLocalCodes = new Set<string>([
  ...Object.values(SNOMED),
  ...Object.values(FHIR_CODES.RISK).map((code) => code.code),
  ...DIAGNOSIS_CODES.filter((code) => code.system === 'SNOMED').map((code) => code.code),
  ...MEDICATIONS_QUICKPICK_ICU.filter((item) => item.code.system === TERMINOLOGY_SYSTEMS.SNOMED).map(
    (item) => item.code.code,
  ),
]);

const loincLocalCodes = new Set<string>([
  ...Object.values(LOINC),
  ...Object.values(FHIR_CODES.VITALS).map((code) => code.code),
  ...Object.values(FHIR_CODES.SCALES).map((code) => code.code),
]);

const cache = new Map<string, CodeValidationResult>();

const DEFAULT_MESSAGES: Record<TerminologySystem, string> = {
  [TERMINOLOGY_SYSTEMS.SNOMED]: 'El código SNOMED ingresado no es válido',
  [TERMINOLOGY_SYSTEMS.LOINC]: 'Código LOINC desconocido',
  [TERMINOLOGY_SYSTEMS.UCUM]: 'Código UCUM desconocido',
  [TERMINOLOGY_SYSTEMS.OBSERVATION_CATEGORY]: 'Código de categoría de observación desconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_CARE]: 'Código de cuidado no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_TREATMENT_TYPE]: 'Tipo de tratamiento no reconocido',
};

export const isLocalSnomedCode = (code: string | undefined | null): boolean => {
  if (!code) return false;
  return snomedLocalCodes.has(String(code));
};

export const isLocalLoincCode = (code: string | undefined | null): boolean => {
  if (!code) return false;
  return loincLocalCodes.has(String(code));
};

const resolveValidationMode = (): ValidationMode => {
  const envMode =
    (process.env.EXPO_PUBLIC_HANDOVER_FHIR_VALIDATION_MODE as ValidationMode | undefined) ||
    (process.env.HANDOVER_FHIR_VALIDATION_MODE as ValidationMode | undefined) ||
    'off';

  if (envMode === 'remote') return 'remote';
  if (envMode === 'local') return 'local';
  return 'off';
};

const cacheKey = (system: string, code: string, display?: string) => `${system}|${code}|${display ?? ''}`;

export const clearValidationCache = () => cache.clear();

async function validateRemotely({
  system,
  code,
  display,
}: {
  system: TerminologySystem;
  code: string;
  display?: string;
}): Promise<CodeValidationResult> {
  const searchParams = new URLSearchParams({ code, system });
  if (display) searchParams.set('display', display);

  try {
    const { ok, data } = await fetchFHIR({
      path: `/ValueSet/$validate-code?${searchParams.toString()}`,
      method: 'GET',
    });

    if (ok && data?.result === true) {
      return { valid: true, source: 'remote' };
    }

    const issues = Array.isArray(data?.issue) ? data.issue : [];
    const outcomeMessage =
      data?.message ||
      issues.find((issue: any) => issue?.diagnostics)?.diagnostics ||
      issues.find((issue: any) => issue?.details?.text)?.details?.text;

    return {
      valid: false,
      message: outcomeMessage || DEFAULT_MESSAGES[system] || 'El código no es válido',
      source: 'remote',
    };
  } catch (error: any) {
    const message =
      error?.message?.includes('unauthorized')
        ? 'Sesión expirada, vuelve a iniciar sesión para validar códigos.'
        : 'No se pudo verificar el código en este momento; comprueba tu conexión o selecciona un código conocido';
    return { valid: false, message, source: 'offline' };
  }
}

export async function validateTerminologyCode({
  system,
  code,
  display,
}: {
  system: TerminologySystem;
  code: string;
  display?: string;
}): Promise<CodeValidationResult> {
  if (!code) {
    return { valid: false, message: DEFAULT_MESSAGES[system] || 'Código requerido', source: 'local' };
  }

  const key = cacheKey(system, code, display);
  const cached = cache.get(key);
  if (cached) return { ...cached, source: cached.source === 'remote' ? 'cache' : cached.source };

  const isLocalValid =
    system === TERMINOLOGY_SYSTEMS.SNOMED
      ? isLocalSnomedCode(code)
      : system === TERMINOLOGY_SYSTEMS.LOINC
        ? isLocalLoincCode(code)
        : false;

  if (isLocalValid) {
    const result = { valid: true, source: 'local' as const };
    cache.set(key, result);
    return result;
  }

  const mode = resolveValidationMode();
  if (mode !== 'remote') {
    const message = DEFAULT_MESSAGES[system] || 'Código desconocido';
    const result = { valid: false, message, source: 'local' as const };
    cache.set(key, result);
    return result;
  }

  const remoteResult = await validateRemotely({ system, code, display });

  if (remoteResult.source !== 'offline') {
    cache.set(key, remoteResult);
  }

  return remoteResult;
}

export async function validateSnomed(code: string, display?: string) {
  return validateTerminologyCode({ system: TERMINOLOGY_SYSTEMS.SNOMED, code, display });
}

export async function validateLoinc(code: string, display?: string) {
  return validateTerminologyCode({ system: TERMINOLOGY_SYSTEMS.LOINC, code, display });
}
