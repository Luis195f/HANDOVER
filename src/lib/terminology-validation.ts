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

// IMPORTANTE: Record<TerminologySystem, string> debe cubrir TODOS los keys del union.
// Si agregas systems a TERMINOLOGY_SYSTEMS, debes agregarlos aquí también.
const DEFAULT_MESSAGES: Record<TerminologySystem, string> = {
  [TERMINOLOGY_SYSTEMS.SNOMED]: 'El código SNOMED ingresado no es válido',
  [TERMINOLOGY_SYSTEMS.LOINC]: 'Código LOINC desconocido',
  [TERMINOLOGY_SYSTEMS.UCUM]: 'Código UCUM desconocido',
  [TERMINOLOGY_SYSTEMS.ATC]: 'Código ATC desconocido',
  [TERMINOLOGY_SYSTEMS.OBSERVATION_CATEGORY]: 'Código de categoría de observación desconocido',
  [TERMINOLOGY_SYSTEMS.CONDITION_CLINICAL_STATUS]: 'Estado clínico de condición desconocido',
  [TERMINOLOGY_SYSTEMS.CONDITION_VERIFICATION_STATUS]: 'Estado de verificación de condición desconocido',
  [TERMINOLOGY_SYSTEMS.CONDITION_CATEGORY]: 'Categoría de condición desconocida',
  [TERMINOLOGY_SYSTEMS.DOCUMENT_CLASSCODES]: 'Clase documental desconocida',
  [TERMINOLOGY_SYSTEMS.V3_ROUTE_OF_ADMINISTRATION]: 'Vía de administración desconocida',
  [TERMINOLOGY_SYSTEMS.NANDA_I]: 'Código NANDA-I no reconocido',
  [TERMINOLOGY_SYSTEMS.NIC]: 'Código NIC no reconocido',
  [TERMINOLOGY_SYSTEMS.NOC]: 'Código NOC no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_CARE]: 'Código de cuidado no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_TREATMENT_TYPE]: 'Tipo de tratamiento no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_OBSERVATION_CODES]: 'Código HANDOVER Observation Codes no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_COMPOSITION_SECTION]: 'Código HANDOVER Composition Section no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_SBAR]: 'Código HANDOVER SBAR no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_BEDSIDE_CHECKLIST]: 'Código HANDOVER Bedside Checklist no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_BOOLEAN]: 'Valor booleano HANDOVER no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_NOC_SCORE]: 'Código de escala NOC no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT]: 'Código de componente HANDOVER no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_EXAM]: 'Código de examen HANDOVER no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_DIET]: 'Código de dieta HANDOVER no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_STOOL_PATTERN]: 'Código de patrón intestinal HANDOVER no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_MOBILITY_LEVEL]: 'Código de movilidad HANDOVER no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_BRADEN]: 'Código Braden HANDOVER no reconocido',
  [TERMINOLOGY_SYSTEMS.HANDOVER_GLASGOW]: 'Código Glasgow HANDOVER no reconocido',
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

// Local validation para URNs HANDOVER:
// - HANDOVER_BOOLEAN lo restringimos a yes/no.
// - El resto: si hay code (no vacío), lo damos por válido localmente (son códigos internos controlados por la app).
const isLocalHandoverUrnCode = (
  system: TerminologySystem,
  code: string | undefined | null,
): boolean => {
  if (!code) return false;
  const trimmed = String(code).trim();
  if (!trimmed) return false;

  if (system === TERMINOLOGY_SYSTEMS.HANDOVER_BOOLEAN) {
    return trimmed === 'yes' || trimmed === 'no';
  }

  const isHandoverSystem =
    system === TERMINOLOGY_SYSTEMS.NANDA_I ||
    system === TERMINOLOGY_SYSTEMS.NIC ||
    system === TERMINOLOGY_SYSTEMS.NOC ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_CARE ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_TREATMENT_TYPE ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_OBSERVATION_CODES ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_COMPOSITION_SECTION ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_SBAR ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_BEDSIDE_CHECKLIST ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_NOC_SCORE ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_EXAM ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_DIET ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_STOOL_PATTERN ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_MOBILITY_LEVEL ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_BRADEN ||
    system === TERMINOLOGY_SYSTEMS.HANDOVER_GLASGOW;

  if (!isHandoverSystem) return false;
  return true;
};

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



