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
  offline?: boolean;
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

// Importante:
// - TerminologySystem ahora es un union de TODOS los values de TERMINOLOGY_SYSTEMS.
// - Por eso este Record debe cubrir también los nuevos URNs HANDOVER_* que agregaste.
const DEFAULT_MESSAGES: Record<TerminologySystem, string> = {
  [TERMINOLOGY_SYSTEMS.SNOMED]: 'El código SNOMED ingresado no es válido',
  [TERMINOLOGY_SYSTEMS.LOINC]: 'Código LOINC desconocido',
  [TERMINOLOGY_SYSTEMS.UCUM]: 'Código UCUM desconocido',
  [TERMINOLOGY_SYSTEMS.OBSERVATION_CATEGORY]: 'Código de categoría de observación desconocido',

  [TERMINOLOGY_SYSTEMS.HANDOVER_CARE]: 'Código de cuidado no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_TREATMENT_TYPE]: 'Tipo de tratamiento no reconocido',

  // ✅ NUEVOS (deben existir aquí para que el Record<TerminologySystem, ...> compile)
  [TERMINOLOGY_SYSTEMS.HANDOVER_OBSERVATION_CODES]: 'Código HANDOVER (observación) no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_COMPOSITION_SECTION]: 'Código HANDOVER (sección de composición) no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_SBAR]: 'Código HANDOVER (SBAR) no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_BEDSIDE_CHECKLIST]: 'Código HANDOVER (bedside checklist) no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_BOOLEAN]: 'Código HANDOVER (boolean) no reconocido',
};

export const isLocalSnomedCode = (code: string | undefined | null): boolean => {
  if (!code) return false;
  return snomedLocalCodes.has(String(code));
};

export const isLocalLoincCode = (code: string | undefined | null): boolean => {
  if (!code) return false;
  return loincLocalCodes.has(String(code));
};

// Para tus URNs internos (urn:handover-pro:*), en modo local/off no tiene sentido
// marcar inválido lo que la propia app genera/usa.
// - HANDOVER_BOOLEAN lo restringimos a yes/no.
// - El resto: si hay code (no vacío), lo damos por válido localmente.
const isLocalHandoverUrnCode = (system: TerminologySystem, code: string | undefined | null): boolean => {
  if (!code) return false;

  if (system === TERMINOLOGY_SYSTEMS.HANDOVER_BOOLEAN) {
    return code === 'yes' || code === 'no';
  }

  const isHandoverSystem =
    system === TERMINOLOGY_SYSTEMS.HANDOVER_CARE ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_TREATMENT_TYPE ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_OBSERVATION_CODES ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_COMPOSITION_SECTION ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_SBAR ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_BEDSIDE_CHECKLIST ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_BOOLEAN;

  if (!isHandoverSystem) return false;

  return String(code).trim().length > 0;
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

type ValidationOutcome = {
  result?: unknown;
  issue?: unknown;
  message?: unknown;
};

type OutcomeIssue = {
  diagnostics?: unknown;
  details?: { text?: unknown };
};

const asOutcome = (value: unknown): ValidationOutcome =>
  value && typeof value === 'object' ? (value as ValidationOutcome) : {};

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

    const outcome = asOutcome(data);
    if (ok && outcome.result === true) {
      return { valid: true, source: 'remote' };
    }

    const issues = Array.isArray(outcome.issue) ? (outcome.issue as OutcomeIssue[]) : [];
    const outcomeMessage =
      (typeof outcome.message === 'string' ? outcome.message : undefined) ||
      (issues.find((issue) => typeof issue?.diagnostics === 'string')?.diagnostics as string | undefined) ||
      (issues.find((issue) => typeof issue?.details?.text === 'string')?.details?.text as string | undefined);

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
    return { valid: false, message, source: 'offline', offline: true };
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
        : isLocalHandoverUrnCode(system, code);

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

  if (!remoteResult.offline) {
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

